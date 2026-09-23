/**
 * SkyOps Agent V1 - Real-time Signal Correlation Engine
 *
 * Correlates disparate cluster events and signals across:
 * - Resource ownership (Pod -> ReplicaSet -> Deployment)
 * - Shared namespaces and services
 * - Temporal correlation windows (sliding 5-minute bucket)
 * - Identical image digests or node hosts
 *
 * Prevents alert storms by clustering related signals into structured Incident Candidates.
 */

import { Evidence } from '../types/evidence.ts';
import { ResourceGraph } from '../kubernetes/graph/ResourceGraph.ts';
import { FailureChainBuilder } from './FailureChainBuilder.ts';
import { FailureChain, ResourceChange } from '../types/investigation.ts';
import { Logger } from '../observability/Logger.ts';

export interface CorrelatedIncidentGroup {
  groupId: string;
  leadSignal: Evidence;
  relatedSignals: Evidence[];
  affectedResources: Set<string>;
  namespaces: Set<string>;
  firstTimestamp: string;
  lastTimestamp: string;
  failureChain: FailureChain;
}

export class CorrelationEngine {
  private graph: ResourceGraph;
  private logger: Logger;
  private readonly correlationWindowMs: number;
  // Active incident groups mapped by correlation key (e.g. "namespace:workload" or "node")
  private activeGroups: Map<string, CorrelatedIncidentGroup> = new Map();

  constructor(graph: ResourceGraph, correlationWindowMs = 5 * 60 * 1000, logger?: Logger) {
    this.graph = graph;
    this.correlationWindowMs = correlationWindowMs;
    this.logger = logger?.child('correlation-engine') || new Logger('correlation-engine');
  }

  public clear(): void {
    this.activeGroups.clear();
  }

  /**
   * Evaluates a stream of new Evidence items and groups them into Correlated Incident Groups
   */
  public correlate(
    newSignals: Evidence[],
    recentChanges: ResourceChange[] = []
  ): CorrelatedIncidentGroup[] {
    const nowMs = Date.now();
    this.pruneExpiredGroups(nowMs);

    for (const signal of newSignals) {
      if (signal.kind !== 'SIGNAL' && signal.kind !== 'INCIDENT_CANDIDATE') {
        continue;
      }

      const correlationKey = this.deriveCorrelationKey(signal);
      let group = this.activeGroups.get(correlationKey);

      if (!group) {
        // Create new correlation group
        const failureChain = FailureChainBuilder.buildChain(signal, [], this.graph, recentChanges);
        group = {
          groupId: `inc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          leadSignal: signal,
          relatedSignals: [],
          affectedResources: new Set([signal.resourceId]),
          namespaces: new Set([signal.correlationKeys.namespace || 'default']),
          firstTimestamp: signal.timestamp,
          lastTimestamp: signal.timestamp,
          failureChain,
        };
        this.activeGroups.set(correlationKey, group);
        this.logger.info(`Formed new incident correlation group for [${correlationKey}]`, {
          leadSignal: signal.evidenceType,
          resource: signal.resourceId,
        });
      } else {
        // Group already exists; append related signal and update failure chain
        group.relatedSignals.push(signal);
        group.affectedResources.add(signal.resourceId);
        if (signal.correlationKeys.namespace) {
          group.namespaces.add(signal.correlationKeys.namespace);
        }
        group.lastTimestamp = signal.timestamp;

        // Recompute failure chain with full set of related signals
        group.failureChain = FailureChainBuilder.buildChain(
          group.leadSignal,
          group.relatedSignals,
          this.graph,
          recentChanges
        );
      }
    }

    return Array.from(this.activeGroups.values());
  }

  /**
   * Derives a deterministic grouping key for correlation
   */
  private deriveCorrelationKey(signal: Evidence): string {
    const ns = signal.correlationKeys.namespace || 'cluster';
    const dep = signal.correlationKeys.deployment;
    const pod = signal.correlationKeys.pod;
    const node = signal.correlationKeys.node;

    if (dep) return `${ns}:deployment/${dep}`;
    if (pod) {
      // If pod name matches standard deployment replica pattern, strip hash suffix
      const parts = pod.split('-');
      if (parts.length > 2) {
        const workloadPrefix = parts.slice(0, -2).join('-');
        return `${ns}:workload/${workloadPrefix}`;
      }
      return `${ns}:pod/${pod}`;
    }
    if (node) return `node/${node}`;
    return `${ns}:${signal.resourceId}`;
  }

  private pruneExpiredGroups(nowMs: number): void {
    for (const [key, group] of this.activeGroups.entries()) {
      const lastSeenMs = new Date(group.lastTimestamp).getTime();
      if (nowMs - lastSeenMs > this.correlationWindowMs) {
        this.activeGroups.delete(key);
      }
    }
  }

  public getActiveGroups(): CorrelatedIncidentGroup[] {
    return Array.from(this.activeGroups.values());
  }
}
