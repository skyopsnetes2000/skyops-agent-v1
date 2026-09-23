import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeTracker } from '../src/changes/ChangeTracker.ts';
import { LogCollector } from '../src/logs/LogCollector.ts';
import { KubernetesClient } from '../src/kubernetes/KubernetesClient.ts';
import { DeploymentSummary, NodeSummary, ServiceSummary } from '../src/types/kubernetes.ts';

describe('Change Intelligence & Log Intelligence Subsystems', () => {
  describe('ChangeTracker', () => {
    it('detects deployment image upgrades', () => {
      const tracker = new ChangeTracker();

      const initialDeployments: DeploymentSummary[] = [
        {
          namespace: 'production',
          name: 'payments-api',
          uid: 'dep-1',
          replicas: 3,
          readyReplicas: 3,
          updatedReplicas: 3,
          availableReplicas: 3,
          unavailableReplicas: 0,
          generation: 1,
          observedGeneration: 1,
          conditions: [],
          labels: {},
          images: ['registry.internal.io/payments:v41'],
        },
      ];

      // Initial baseline
      const initialChanges = tracker.trackDeployments(initialDeployments);
      assert.equal(initialChanges.length, 0);

      // Now upgrade image to v42
      const updatedDeployments: DeploymentSummary[] = [
        {
          ...initialDeployments[0],
          generation: 2,
          images: ['registry.internal.io/payments:v42'],
        },
      ];

      const changes = tracker.trackDeployments(updatedDeployments);
      assert.ok(changes.length >= 1);

      const imageChange = changes.find((c) => c.changeType === 'IMAGE_UPDATE');
      assert.ok(imageChange);
      assert.equal(imageChange.resourceId, 'k8s:production:deployment/payments-api');
      assert.deepEqual(imageChange.before, ['registry.internal.io/payments:v41']);
      assert.deepEqual(imageChange.after, ['registry.internal.io/payments:v42']);
    });

    it('detects replica count scale adjustments', () => {
      const tracker = new ChangeTracker();
      const dep: DeploymentSummary = {
        namespace: 'production',
        name: 'checkout',
        uid: 'dep-2',
        replicas: 2,
        readyReplicas: 2,
        updatedReplicas: 2,
        availableReplicas: 2,
        unavailableReplicas: 0,
        generation: 1,
        observedGeneration: 1,
        conditions: [],
        labels: {},
        images: ['checkout:v1'],
      };

      tracker.trackDeployments([dep]);

      // Scale up to 5
      const scaled = tracker.trackDeployments([{ ...dep, replicas: 5 }]);
      const scaleChange = scaled.find((c) => c.changeType === 'REPLICA_SCALE');
      assert.ok(scaleChange);
      assert.equal(scaleChange.before, 2);
      assert.equal(scaleChange.after, 5);
    });

    it('detects node ready condition transitions', () => {
      const tracker = new ChangeTracker();
      const node: NodeSummary = {
        name: 'node-worker-a',
        ready: true,
        status: 'Ready',
        kubeletVersion: 'v1.30.2',
        osImage: 'COS',
        architecture: 'amd64',
        cpuCapacity: '8',
        memoryCapacity: '32Gi',
        conditions: [{ type: 'Ready', status: 'True' }],
      };

      tracker.trackNodes([node]);

      // Node becomes NotReady
      const updated = tracker.trackNodes([{ ...node, ready: false, conditions: [{ type: 'Ready', status: 'False' }] }]);
      assert.ok(updated.length >= 1);
      const readyChange = updated.find((c) => c.field === 'status.conditions[Ready]');
      assert.ok(readyChange);
      assert.equal(readyChange.before, 'Ready');
      assert.equal(readyChange.after, 'NotReady');
    });
  });

  describe('LogCollector', () => {
    const mockClient = new KubernetesClient({
      clusterName: 'test-cluster',
      inCluster: false,
      discoveryIntervalSeconds: 300,
      collectionIntervalSeconds: 15,
      reconnectIntervalSeconds: 10,
      maxPodLogLines: 500,
      mockMode: true,
    });

    it('collects container logs with line and byte bounding', async () => {
      const logCollector = new LogCollector(mockClient);
      const snippet = await logCollector.collectContainerLogs('production', 'payments-pod', 'payments-service', {
        tailLines: 50,
        maxBytes: 10 * 1024,
      });

      assert.equal(snippet.podName, 'payments-pod');
      assert.equal(snippet.containerName, 'payments-service');
      assert.ok(snippet.lines.length > 0);
      assert.equal(snippet.isPrevious, false);
    });

    it('collects previous terminated container logs for root-cause analysis', async () => {
      const logCollector = new LogCollector(mockClient);
      const failureSnippets = await logCollector.collectFailureContextLogs('production', 'payments-pod', 'payments-service');

      assert.ok(failureSnippets.length >= 1);
      const previousSnippet = failureSnippets.find((s) => s.isPrevious);
      assert.ok(previousSnippet, 'Expected previous container log snippet to be included');
      assert.ok(previousSnippet.lines.some((l) => l.includes('FATAL') || l.includes('Out of memory') || l.includes('Starting')));
    });

    it('enforces secret redaction on sensitive strings in logs', async () => {
      // Create a client that returns secrets in logs
      const customClient = {
        ...mockClient,
        getPodLogs: async () => 'Connecting to database with Bearer eyJhbGciOiJIUzI1NiJ9.secretToken and AWS_KEY=AKIAIOSFODNN7EXAMPLE',
      } as unknown as KubernetesClient;

      const logCollector = new LogCollector(customClient);
      const snippet = await logCollector.collectContainerLogs('default', 'auth-pod', 'auth-container');

      assert.ok(snippet.lines.length > 0);
      assert.ok(!snippet.lines[0].includes('eyJhbGciOiJIUzI1NiJ9.secretToken'), 'JWT token must be redacted');
      assert.ok(!snippet.lines[0].includes('AKIAIOSFODNN7EXAMPLE'), 'AWS Key must be redacted');
      assert.ok(snippet.lines[0].includes('[REDACTED_TOKEN]'));
      assert.ok(snippet.lines[0].includes('[REDACTED_AWS_KEY_ID]'));
    });
  });
});
