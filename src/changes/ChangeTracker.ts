/**
 * SkyOps Agent V1 - Kubernetes Change Intelligence Engine
 *
 * Tracks fine-grained infrastructure & workload state transitions over time.
 * Detects image upgrades, replica scaling, node condition shifts, and selector alterations.
 * These change events feed directly into the RCA (Root Cause Analysis) pipeline.
 */

import { ResourceChange } from '../types/investigation.ts';
import { PodSummary, DeploymentSummary, NodeSummary, ServiceSummary } from '../types/kubernetes.ts';
import { Logger } from '../observability/Logger.ts';

export class ChangeTracker {
  private previousDeployments: Map<string, DeploymentSummary> = new Map();
  private previousNodes: Map<string, NodeSummary> = new Map();
  private previousServices: Map<string, ServiceSummary> = new Map();
  private previousPods: Map<string, PodSummary> = new Map();

  // Bounded circular buffer for recorded changes (max 1000 items)
  private changeHistory: ResourceChange[] = [];
  private readonly maxHistorySize = 1000;
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger?.child('change-tracker') || new Logger('change-tracker');
  }

  /**
   * Clears state for tests or clean reboot
   */
  public reset(): void {
    this.previousDeployments.clear();
    this.previousNodes.clear();
    this.previousServices.clear();
    this.previousPods.clear();
    this.changeHistory = [];
  }

  /**
   * Tracks changes across discovered deployments
   */
  public trackDeployments(currentDeployments: DeploymentSummary[]): ResourceChange[] {
    const changes: ResourceChange[] = [];
    const now = new Date().toISOString();

    for (const dep of currentDeployments) {
      const key = `${dep.namespace}/${dep.name}`;
      const prev = this.previousDeployments.get(key);

      if (prev) {
        // 1. Detect Image Version Changes
        const prevImages = (prev.images || []).join(',');
        const currImages = (dep.images || []).join(',');
        if (prevImages !== currImages) {
          const change: ResourceChange = {
            changeId: `chg_img_${Date.now()}_${dep.name}`,
            timestamp: now,
            resourceId: `k8s:${dep.namespace}:deployment/${dep.name}`,
            resourceKind: 'Deployment',
            namespace: dep.namespace,
            name: dep.name,
            changeType: 'IMAGE_UPDATE',
            field: 'spec.template.spec.containers[*].image',
            before: prev.images,
            after: dep.images,
            source: 'DeploymentCollector',
          };
          changes.push(change);
          this.recordChange(change);
        }

        // 2. Detect Desired Replica Scaling Changes
        if (prev.replicas !== dep.replicas) {
          const change: ResourceChange = {
            changeId: `chg_rep_${Date.now()}_${dep.name}`,
            timestamp: now,
            resourceId: `k8s:${dep.namespace}:deployment/${dep.name}`,
            resourceKind: 'Deployment',
            namespace: dep.namespace,
            name: dep.name,
            changeType: 'REPLICA_SCALE',
            field: 'spec.replicas',
            before: prev.replicas,
            after: dep.replicas,
            source: 'DeploymentCollector',
          };
          changes.push(change);
          this.recordChange(change);
        }

        // 3. Detect Rollout Generation Shifts
        if (prev.generation !== dep.generation) {
          const change: ResourceChange = {
            changeId: `chg_gen_${Date.now()}_${dep.name}`,
            timestamp: now,
            resourceId: `k8s:${dep.namespace}:deployment/${dep.name}`,
            resourceKind: 'Deployment',
            namespace: dep.namespace,
            name: dep.name,
            changeType: 'ROLLOUT_REVISION',
            field: 'metadata.generation',
            before: prev.generation,
            after: dep.generation,
            source: 'DeploymentCollector',
          };
          changes.push(change);
          this.recordChange(change);
        }
      }

      this.previousDeployments.set(key, dep);
    }

    return changes;
  }

  /**
   * Tracks changes across discovered nodes
   */
  public trackNodes(currentNodes: NodeSummary[]): ResourceChange[] {
    const changes: ResourceChange[] = [];
    const now = new Date().toISOString();

    for (const node of currentNodes) {
      const prev = this.previousNodes.get(node.name);

      if (prev) {
        // Ready condition transition
        if (prev.ready !== node.ready) {
          const change: ResourceChange = {
            changeId: `chg_node_ready_${Date.now()}_${node.name}`,
            timestamp: now,
            resourceId: `k8s:node/${node.name}`,
            resourceKind: 'Node',
            name: node.name,
            changeType: 'CONDITION_CHANGE',
            field: 'status.conditions[Ready]',
            before: prev.ready ? 'Ready' : 'NotReady',
            after: node.ready ? 'Ready' : 'NotReady',
            source: 'NodeCollector',
          };
          changes.push(change);
          this.recordChange(change);
        }

        // Pressure conditions
        const prevConditions = (prev.conditions || []).map((c) => `${c.type}:${c.status}`).sort().join(',');
        const currConditions = (node.conditions || []).map((c) => `${c.type}:${c.status}`).sort().join(',');
        if (prevConditions !== currConditions) {
          const change: ResourceChange = {
            changeId: `chg_node_cond_${Date.now()}_${node.name}`,
            timestamp: now,
            resourceId: `k8s:node/${node.name}`,
            resourceKind: 'Node',
            name: node.name,
            changeType: 'CONDITION_CHANGE',
            field: 'status.conditions',
            before: prev.conditions,
            after: node.conditions,
            source: 'NodeCollector',
          };
          changes.push(change);
          this.recordChange(change);
        }
      }

      this.previousNodes.set(node.name, node);
    }

    return changes;
  }

  /**
   * Tracks changes across services (e.g. selector alterations that drop endpoints)
   */
  public trackServices(currentServices: ServiceSummary[]): ResourceChange[] {
    const changes: ResourceChange[] = [];
    const now = new Date().toISOString();

    for (const svc of currentServices) {
      const key = `${svc.namespace}/${svc.name}`;
      const prev = this.previousServices.get(key);

      if (prev) {
        const prevSel = JSON.stringify(prev.selector || {});
        const currSel = JSON.stringify(svc.selector || {});
        if (prevSel !== currSel) {
          const change: ResourceChange = {
            changeId: `chg_svc_sel_${Date.now()}_${svc.name}`,
            timestamp: now,
            resourceId: `k8s:${svc.namespace}:service/${svc.name}`,
            resourceKind: 'Service',
            namespace: svc.namespace,
            name: svc.name,
            changeType: 'SELECTOR_UPDATE',
            field: 'spec.selector',
            before: prev.selector,
            after: svc.selector,
            source: 'ServiceCollector',
          };
          changes.push(change);
          this.recordChange(change);
        }
      }

      this.previousServices.set(key, svc);
    }

    return changes;
  }

  private recordChange(change: ResourceChange): void {
    this.changeHistory.push(change);
    if (this.changeHistory.length > this.maxHistorySize) {
      this.changeHistory.shift();
    }
    this.logger.info(`Tracked Kubernetes change: ${change.changeType} on ${change.resourceId}`, {
      field: change.field,
      before: change.before,
      after: change.after,
    });
  }

  /**
   * Retrieves recent changes for a specific resource, or within a time window
   */
  public getRecentChanges(resourceId?: string, sinceTimestampMs?: number): ResourceChange[] {
    return this.changeHistory.filter((c) => {
      if (resourceId && c.resourceId !== resourceId) return false;
      if (sinceTimestampMs && new Date(c.timestamp).getTime() < sinceTimestampMs) return false;
      return true;
    });
  }

  public getAllChanges(): ResourceChange[] {
    return [...this.changeHistory];
  }
}
