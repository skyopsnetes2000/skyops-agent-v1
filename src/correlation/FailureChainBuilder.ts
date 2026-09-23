/**
 * SkyOps Agent V1 - Structured Failure Chain Builder
 *
 * Traverses the ResourceGraph, detected Signals, and Change records to synthesize
 * an explicit causal path explaining how an initial failure propagated through the stack.
 *
 * Example:
 * Deployment [payments-api]
 *   ↓ (owns)
 * Pod [payments-api-6b79-w7v9x]
 *   ↓ (container)
 * Container [payment-gateway]
 *   ↓ (exits)
 * Exit Code 137 (OOMKilled)
 *   ↓ (degrades)
 * Service [payments-svc] (0 Endpoints)
 */

import { ResourceGraph } from '../kubernetes/graph/ResourceGraph.ts';
import { ResourceChange, FailureChain, FailureChainNode } from '../types/investigation.ts';
import { Evidence } from '../types/evidence.ts';

export class FailureChainBuilder {
  /**
   * Constructs an explicit failure chain starting from a root or primary signal
   */
  public static buildChain(
    primarySignal: Evidence,
    relatedSignals: Evidence[],
    graph: ResourceGraph,
    recentChanges: ResourceChange[] = []
  ): FailureChain {
    const nodes: FailureChainNode[] = [];
    const edges: Array<{ from: string; to: string; relationship: string }> = [];

    const primaryResourceId = primarySignal.resourceId;
    const namespace = primarySignal.correlationKeys.namespace || 'default';

    // 1. Identify Target Resource in Graph
    const targetGraphNode = graph.getNode(primaryResourceId);
    const targetKind = targetGraphNode?.kind || primarySignal.resourceType.toUpperCase();
    const targetName = targetGraphNode?.name || primarySignal.resourceId.split('/').pop() || 'unknown';

    // 2. Look for Parent Workload (Deployment / ReplicaSet / StatefulSet)
    let parentWorkload = targetGraphNode ? graph.getParentWorkload(targetGraphNode.id) : undefined;

    // Check if there was a recent change (e.g. image update) on the parent deployment or pod
    const matchedChange = recentChanges.find(
      (c) =>
        c.resourceId === primaryResourceId ||
        (parentWorkload && c.resourceId === parentWorkload.id) ||
        (c.namespace === namespace && c.changeType === 'IMAGE_UPDATE')
    );

    // Root Cause identification
    let rootCauseCandidate = primarySignal.observation.reason || primarySignal.evidenceType;
    let confidenceScore = 0.85;

    // Build chain nodes from top to bottom
    if (parentWorkload) {
      const parentNode: FailureChainNode = {
        id: parentWorkload.id,
        kind: parentWorkload.kind,
        name: parentWorkload.name,
        namespace: parentWorkload.namespace,
        status: 'DEGRADED',
        failureReason: matchedChange ? `Recent ${matchedChange.changeType}: ${matchedChange.field}` : undefined,
      };
      nodes.push(parentNode);

      edges.push({
        from: parentNode.id,
        to: primaryResourceId,
        relationship: 'OWNS',
      });

      if (matchedChange) {
        rootCauseCandidate = `Recent ${matchedChange.changeType} on ${parentWorkload.name} (${String(matchedChange.before)} -> ${String(matchedChange.after)})`;
        confidenceScore = 0.95;
      }
    }

    // Add Primary Resource Node (Pod / Deployment)
    const primaryNode: FailureChainNode = {
      id: primaryResourceId,
      kind: targetKind,
      name: targetName,
      namespace,
      status: 'FAILED',
      failureReason: primarySignal.observation.summary,
    };
    nodes.push(primaryNode);

    // Add Container / Process Failure Node if applicable
    const containerName = primarySignal.correlationKeys.container;
    if (containerName) {
      const containerId = `${primaryResourceId}/container/${containerName}`;
      const containerNode: FailureChainNode = {
        id: containerId,
        kind: 'Container',
        name: containerName,
        namespace,
        status: primarySignal.observation.reason || 'CRASHED',
        failureReason: primarySignal.observation.summary,
      };
      nodes.push(containerNode);

      edges.push({
        from: primaryResourceId,
        to: containerId,
        relationship: 'CONTAINS',
      });
    }

    // Look for Exposing Services that lost endpoints
    if (targetGraphNode) {
      const exposingServices = graph.getExposingServices(targetGraphNode.id);
      for (const svc of exposingServices) {
        const svcSignal = relatedSignals.find(
          (s) => s.resourceId === svc.id || s.correlationKeys.service === svc.name
        );

        const svcNode: FailureChainNode = {
          id: svc.id,
          kind: 'Service',
          name: svc.name,
          namespace: svc.namespace,
          status: svcSignal ? 'OUTAGE_NO_ENDPOINTS' : 'IMPACTED',
          failureReason: svcSignal ? svcSignal.observation.summary : 'Endpoints degraded by pod failure',
        };
        nodes.push(svcNode);

        edges.push({
          from: primaryResourceId,
          to: svc.id,
          relationship: 'DEGRADES_SERVICE',
        });
      }
    }

    // Synthesize human & AI readable summary
    const summaryParts: string[] = [];
    if (parentWorkload) {
      summaryParts.push(`${parentWorkload.kind} [${parentWorkload.name}]`);
    }
    summaryParts.push(`${targetKind} [${targetName}]`);
    if (containerName) {
      summaryParts.push(`Container [${containerName}]`);
    }
    summaryParts.push(`${primarySignal.observation.reason || 'FAILURE'}`);

    const summary = summaryParts.join(' → ');

    return {
      rootCauseCandidate,
      nodes,
      edges,
      summary,
      confidenceScore,
    };
  }
}
