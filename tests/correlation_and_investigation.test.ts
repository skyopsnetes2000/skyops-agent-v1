import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceGraph } from '../src/kubernetes/graph/ResourceGraph.ts';
import { ChangeTracker } from '../src/changes/ChangeTracker.ts';
import { LogCollector } from '../src/logs/LogCollector.ts';
import { FailureChainBuilder } from '../src/correlation/FailureChainBuilder.ts';
import { CorrelationEngine } from '../src/correlation/CorrelationEngine.ts';
import { InvestigationEngine } from '../src/investigation/InvestigationEngine.ts';
import { KubernetesClient } from '../src/kubernetes/KubernetesClient.ts';
import { EvidenceBuilder } from '../src/evidence/Evidence.ts';
import { ResourceChange } from '../src/types/investigation.ts';

describe('Correlation & Investigation Subsystems', () => {
  const graph = new ResourceGraph();
  // Set up cluster graph
  graph.addNode({ id: 'k8s:cluster/prod', kind: 'Cluster', name: 'prod' });
  graph.addNode({ id: 'k8s:namespace/payments', kind: 'Namespace', name: 'payments' });
  graph.addNode({ id: 'k8s:payments:deployment/payments-api', kind: 'Deployment', namespace: 'payments', name: 'payments-api' });
  graph.addNode({ id: 'k8s:payments:pod/payments-api-6b79f8-w7v9x', kind: 'Pod', namespace: 'payments', name: 'payments-api-6b79f8-w7v9x' });
  graph.addNode({ id: 'k8s:payments:service/payments-svc', kind: 'Service', namespace: 'payments', name: 'payments-svc' });

  graph.addEdge('k8s:cluster/prod', 'k8s:namespace/payments', 'OWNS');
  graph.addEdge('k8s:namespace/payments', 'k8s:payments:deployment/payments-api', 'OWNS');
  graph.addEdge('k8s:payments:deployment/payments-api', 'k8s:payments:pod/payments-api-6b79f8-w7v9x', 'OWNS');
  graph.addEdge('k8s:payments:service/payments-svc', 'k8s:payments:pod/payments-api-6b79f8-w7v9x', 'EXPOSES');

  const crashSignal = EvidenceBuilder.create()
    .setEnvironment('env-prod', 'agent-1')
    .setSource('kubernetes')
    .setResource('k8s:payments:pod/payments-api-6b79f8-w7v9x', 'pod')
    .setType('SIGNAL_DETECTED', 'SIGNAL', 'CRITICAL')
    .setObservation({
      summary: 'Container payment-gateway is in CrashLoopBackOff (8 restarts)',
      reason: 'CrashLoopBackOff',
    })
    .setCorrelationKeys({
      clusterName: 'prod',
      namespace: 'payments',
      pod: 'payments-api-6b79f8-w7v9x',
      deployment: 'payments-api',
      container: 'payment-gateway',
    })
    .build();

  it('builds structured failure chain connecting deployment to crashed pod and service impact', () => {
    const recentChanges: ResourceChange[] = [
      {
        changeId: 'chg-1',
        timestamp: new Date().toISOString(),
        resourceId: 'k8s:payments:deployment/payments-api',
        resourceKind: 'Deployment',
        namespace: 'payments',
        name: 'payments-api',
        changeType: 'IMAGE_UPDATE',
        field: 'image',
        before: 'payments:v41',
        after: 'payments:v42',
        source: 'DeploymentCollector',
      },
    ];

    const chain = FailureChainBuilder.buildChain(crashSignal, [], graph, recentChanges);

    assert.ok(chain.nodes.length >= 3);
    assert.ok(chain.edges.length >= 2);
    assert.ok(chain.rootCauseCandidate?.includes('Recent IMAGE_UPDATE'));
    assert.ok(chain.summary.includes('Deployment [payments-api]'));
    assert.ok(chain.summary.includes('Pod [payments-api-6b79f8-w7v9x]'));
  });

  it('correlates multiple related signals within sliding window into single incident group', () => {
    const correlationEngine = new CorrelationEngine(graph, 5 * 60 * 1000);

    const relatedSvcSignal = EvidenceBuilder.create()
      .setEnvironment('env-prod', 'agent-1')
      .setSource('kubernetes')
      .setResource('k8s:payments:service/payments-svc', 'service')
      .setType('SIGNAL_DETECTED', 'INCIDENT_CANDIDATE', 'CRITICAL')
      .setObservation({
        summary: 'Service payments-svc has 0 ready endpoints',
        reason: 'NoReadyEndpoints',
      })
      .setCorrelationKeys({
        clusterName: 'prod',
        namespace: 'payments',
        deployment: 'payments-api',
        service: 'payments-svc',
      })
      .build();

    const groups = correlationEngine.correlate([crashSignal, relatedSvcSignal]);

    assert.equal(groups.length, 1, 'Both signals should correlate under the payments:deployment/payments-api group');
    assert.equal(groups[0].leadSignal.evidenceId, crashSignal.evidenceId);
    assert.equal(groups[0].relatedSignals.length, 1);
    assert.ok(groups[0].affectedResources.has(crashSignal.resourceId));
    assert.ok(groups[0].affectedResources.has(relatedSvcSignal.resourceId));
  });

  it('InvestigationEngine conducts deep investigation and synthesizes InvestigationContext', async () => {
    const mockClient = new KubernetesClient({
      clusterName: 'prod',
      inCluster: false,
      discoveryIntervalSeconds: 300,
      collectionIntervalSeconds: 15,
      reconnectIntervalSeconds: 10,
      maxPodLogLines: 500,
      mockMode: true,
    });

    const changeTracker = new ChangeTracker();
    const logCollector = new LogCollector(mockClient);
    const investigationEngine = new InvestigationEngine(mockClient, graph, changeTracker, logCollector);

    const context = await investigationEngine.investigate(
      'inc-test-123',
      'env-prod',
      'agent-prod-1',
      crashSignal
    );

    assert.equal(context.incidentId, 'inc-test-123');
    assert.equal(context.environmentId, 'env-prod');
    assert.ok(context.affectedResources.length >= 1);
    assert.ok(context.failureSignals.length >= 1);
    assert.ok(context.failureChain);
    assert.ok(context.timeline.length >= 1);
    assert.ok(Array.isArray(context.logSnippets));
  });
});
