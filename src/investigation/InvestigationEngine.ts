/**
 * SkyOps Agent V1 - Scoped Investigation Engine & AI Context Synthesizer
 *
 * Implements 3 adaptive investigation scopes:
 * - NORMAL_MODE: Lightweight topology & periodic pulse
 * - SIGNAL_MODE: Collect immediate proximate evidence around an anomaly
 * - INVESTIGATION_MODE: Deep, targeted expansion around an affected resource
 *   (Containers, Current Logs, Previous Logs, Warning Events, Deployment, Node,
 *    Services, Configuration references, and Recent Changes).
 *
 * Synthesizes the structured InvestigationContext for SkyOps AI reasoning.
 */

import { ResourceGraph } from '../kubernetes/graph/ResourceGraph.ts';
import { ChangeTracker } from '../changes/ChangeTracker.ts';
import { LogCollector } from '../logs/LogCollector.ts';
import { KubernetesClient } from '../kubernetes/KubernetesClient.ts';
import { Evidence } from '../types/evidence.ts';
import {
  InvestigationContext,
  InvestigationScope,
  TimelineEvent,
  LogSnippet,
} from '../types/investigation.ts';
import { FailureChainBuilder } from '../correlation/FailureChainBuilder.ts';
import { Logger } from '../observability/Logger.ts';

export class InvestigationEngine {
  private client: KubernetesClient;
  private graph: ResourceGraph;
  private changeTracker: ChangeTracker;
  private logCollector: LogCollector;
  private logger: Logger;

  private currentScope: InvestigationScope = 'NORMAL';

  constructor(
    client: KubernetesClient,
    graph: ResourceGraph,
    changeTracker: ChangeTracker,
    logCollector: LogCollector,
    logger?: Logger
  ) {
    this.client = client;
    this.graph = graph;
    this.changeTracker = changeTracker;
    this.logCollector = logCollector;
    this.logger = logger?.child('investigation-engine') || new Logger('investigation-engine');
  }

  public getScope(): InvestigationScope {
    return this.currentScope;
  }

  public setScope(scope: InvestigationScope): void {
    this.currentScope = scope;
    this.logger.info(`Investigation scope shifted to: ${scope}`);
  }

  /**
   * Conducts a targeted deep investigation around a failing resource or incident
   */
  public async investigate(
    incidentId: string,
    environmentId: string,
    agentId: string,
    primarySignal: Evidence,
    relatedSignals: Evidence[] = []
  ): Promise<InvestigationContext> {
    this.setScope('INVESTIGATION');
    const startMs = Date.now();
    const targetResourceId = primarySignal.resourceId;
    const namespace = primarySignal.correlationKeys.namespace || 'default';
    const podName = primarySignal.correlationKeys.pod;
    const containerName = primarySignal.correlationKeys.container;

    this.logger.info(`Launching targeted investigation for [${targetResourceId}]`, {
      incidentId,
      signal: primarySignal.evidenceType,
    });

    // 1. Expand Subgraph (Up to 2 hops around target)
    const { nodes: relatedNodes, edges: relatedEdges } = this.graph.getRelatedResources(targetResourceId, 2);
    const affectedResources = Array.from(new Set([targetResourceId, ...relatedNodes.map((n) => n.id)]));

    // 2. Collect targeted logs for failing container (if pod and container are known)
    let logSnippets: LogSnippet[] = [];
    if (podName && containerName) {
      try {
        logSnippets = await this.logCollector.collectFailureContextLogs(namespace, podName, containerName, {
          tailLines: 60,
          maxBytes: 30 * 1024,
        });
      } catch (err) {
        this.logger.warn('Failed collecting container logs during investigation', undefined, err);
      }
    }

    // 3. Collect recent changes affecting this workload or namespace (last 15 minutes)
    const fifteenMinutesAgo = startMs - 15 * 60 * 1000;
    const recentChanges = this.changeTracker.getRecentChanges(undefined, fifteenMinutesAgo).filter(
      (c) => c.namespace === namespace || c.resourceId === targetResourceId
    );

    // 4. Synthesize Failure Chain
    const allSignals = [primarySignal, ...relatedSignals];
    const failureChain = FailureChainBuilder.buildChain(primarySignal, relatedSignals, this.graph, recentChanges);

    // 5. Build Unified Incident Timeline
    const timeline: TimelineEvent[] = [];

    // Add changes to timeline
    for (const chg of recentChanges) {
      timeline.push({
        timestamp: chg.timestamp,
        type: 'CHANGE',
        resourceId: chg.resourceId,
        summary: `Workload changed: ${chg.changeType} on ${chg.field}`,
        details: { before: chg.before, after: chg.after },
      });
    }

    // Add signals to timeline
    for (const sig of allSignals) {
      timeline.push({
        timestamp: sig.timestamp,
        type: 'SIGNAL',
        resourceId: sig.resourceId,
        summary: sig.observation.summary,
        severity: sig.severity,
        details: sig.observation.details,
      });
    }

    // Sort timeline chronologically
    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const context: InvestigationContext = {
      incidentId,
      timestamp: new Date().toISOString(),
      agentId,
      environmentId,
      scope: 'INVESTIGATION',
      affectedResources,
      failureSignals: allSignals,
      evidence: allSignals,
      changes: recentChanges,
      relationships: relatedEdges,
      failureChain,
      timeline,
      logSnippets,
    };

    this.logger.info(`Investigation completed in ${Date.now() - startMs}ms`, {
      affectedResourcesCount: affectedResources.length,
      logSnippetsCount: logSnippets.length,
      changesCount: recentChanges.length,
      rootCause: failureChain.rootCauseCandidate,
    });

    // Return to SIGNAL scope after active investigation completes
    this.setScope('SIGNAL');

    return context;
  }
}
