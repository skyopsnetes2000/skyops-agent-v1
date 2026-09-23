/**
 * SkyOps Agent V1 - Explicit Kubernetes Resource Relationship Graph
 *
 * Models and maintains explicit parent-child, networking, storage, and configuration
 * dependencies across the cluster. Used by the Correlation and Investigation engines
 * to build deterministic Failure Chains and blast radius analysis.
 */

import { DiscoverySnapshot, PodSummary, DeploymentSummary, ServiceSummary, PVCSummary, NodeSummary } from '../../types/kubernetes.ts';
import { GraphNode, GraphEdge, GraphRelationshipType } from '../../types/investigation.ts';
import { Logger } from '../../observability/Logger.ts';

export class ResourceGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  // Adjacency indices for fast bi-directional lookups
  private outgoing: Map<string, GraphEdge[]> = new Map();
  private incoming: Map<string, GraphEdge[]> = new Map();
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger?.child('resource-graph') || new Logger('resource-graph');
  }

  public clear(): void {
    this.nodes.clear();
    this.edges = [];
    this.outgoing.clear();
    this.incoming.clear();
  }

  public addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) this.outgoing.set(node.id, []);
    if (!this.incoming.has(node.id)) this.incoming.set(node.id, []);
  }

  public getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  private parseNodeId(id: string): { kind: string; name: string; namespace?: string } {
    const kindMap: Record<string, string> = {
      deployment: 'Deployment',
      replicaset: 'ReplicaSet',
      statefulset: 'StatefulSet',
      daemonset: 'DaemonSet',
      pod: 'Pod',
      service: 'Service',
      node: 'Node',
      namespace: 'Namespace',
      cluster: 'Cluster',
      container: 'Container',
      image: 'Image',
      pvc: 'PVC',
      job: 'Job',
      cronjob: 'CronJob',
    };

    const parts = id.split(':');
    if (parts.length === 3) {
      // k8s:<namespace>:<kind>/<name>
      const ns = parts[1];
      const [rawKind, name] = parts[2].split('/');
      const kind = kindMap[rawKind.toLowerCase()] || (rawKind.charAt(0).toUpperCase() + rawKind.slice(1));
      return { kind, name: name || rawKind, namespace: ns };
    }
    if (parts.length === 2) {
      // k8s:<kind>/<name>
      const [rawKind, name] = parts[1].split('/');
      const kind = kindMap[rawKind.toLowerCase()] || (rawKind.charAt(0).toUpperCase() + rawKind.slice(1));
      return { kind, name: name || rawKind };
    }
    return { kind: 'Unknown', name: id };
  }

  public addEdge(from: string, to: string, relationship: GraphRelationshipType, metadata?: Record<string, unknown>): void {
    // Ensure nodes exist in registry
    if (!this.nodes.has(from)) {
      const parsed = this.parseNodeId(from);
      this.addNode({ id: from, kind: parsed.kind, name: parsed.name, namespace: parsed.namespace });
    }
    if (!this.nodes.has(to)) {
      const parsed = this.parseNodeId(to);
      this.addNode({ id: to, kind: parsed.kind, name: parsed.name, namespace: parsed.namespace });
    }

    const edge: GraphEdge = { from, to, relationship, metadata };
    this.edges.push(edge);

    if (!this.outgoing.has(from)) this.outgoing.set(from, []);
    this.outgoing.get(from)!.push(edge);

    if (!this.incoming.has(to)) this.incoming.set(to, []);
    this.incoming.get(to)!.push(edge);
  }

  public getOutgoingEdges(nodeId: string): GraphEdge[] {
    return this.outgoing.get(nodeId) || [];
  }

  public getIncomingEdges(nodeId: string): GraphEdge[] {
    return this.incoming.get(nodeId) || [];
  }

  public getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  public getAllEdges(): GraphEdge[] {
    return [...this.edges];
  }

  /**
   * Builds full topological graph from a DiscoverySnapshot
   */
  public buildFromSnapshot(snapshot: DiscoverySnapshot): void {
    this.clear();

    const clusterId = `k8s:cluster/${snapshot.clusterInfo.clusterName}`;
    this.addNode({
      id: clusterId,
      kind: 'Cluster',
      name: snapshot.clusterInfo.clusterName,
      metadata: { serverVersion: snapshot.clusterInfo.serverVersion },
    });

    // 1. Namespaces
    for (const ns of snapshot.namespaces) {
      const nsId = `k8s:namespace/${ns}`;
      this.addNode({ id: nsId, kind: 'Namespace', name: ns });
      this.addEdge(clusterId, nsId, 'OWNS');
    }

    // 2. Nodes
    for (const node of snapshot.nodes) {
      const nodeId = `k8s:node/${node.name}`;
      this.addNode({
        id: nodeId,
        kind: 'Node',
        name: node.name,
        metadata: { ready: node.ready, kubeletVersion: node.kubeletVersion, os: node.osImage },
      });
      this.addEdge(clusterId, nodeId, 'OWNS');
    }

    // 3. Deployments
    for (const dep of snapshot.deployments) {
      const depId = `k8s:${dep.namespace}:deployment/${dep.name}`;
      const nsId = `k8s:namespace/${dep.namespace}`;
      this.addNode({
        id: depId,
        kind: 'Deployment',
        namespace: dep.namespace,
        name: dep.name,
        uid: dep.uid,
        labels: dep.labels,
        metadata: { replicas: dep.replicas, readyReplicas: dep.readyReplicas, images: dep.images },
      });
      this.addEdge(nsId, depId, 'OWNS');

      // Link images used by deployment
      for (const img of dep.images) {
        const imgId = `k8s:image/${img}`;
        this.addNode({ id: imgId, kind: 'Image', name: img });
        this.addEdge(depId, imgId, 'USES_IMAGE');
      }
    }

    // 4. Pods
    for (const pod of snapshot.pods) {
      const podId = `k8s:${pod.namespace}:pod/${pod.name}`;
      const nsId = `k8s:namespace/${pod.namespace}`;
      this.addNode({
        id: podId,
        kind: 'Pod',
        namespace: pod.namespace,
        name: pod.name,
        uid: pod.uid,
        labels: pod.labels,
        metadata: { phase: pod.phase, ready: pod.ready, restarts: pod.restartCount },
      });
      this.addEdge(nsId, podId, 'OWNS');

      // Link to Node if scheduled
      if (pod.nodeName) {
        const nodeId = `k8s:node/${pod.nodeName}`;
        this.addEdge(podId, nodeId, 'RUNS_ON');
      }

      // Link to Parent Workload (Deployment / ReplicaSet / Job)
      if (pod.ownerKind && pod.ownerName) {
        const ownerKindLower = pod.ownerKind.toLowerCase();
        let parentId = `k8s:${pod.namespace}:${ownerKindLower}/${pod.ownerName}`;

        // If owner is ReplicaSet, link to parent Deployment if name matches prefix
        if (pod.ownerKind === 'ReplicaSet') {
          // Kubernetes ReplicaSet naming convention: <deployment-name>-<hash>
          const parts = pod.ownerName.split('-');
          if (parts.length > 1) {
            const possibleDepName = parts.slice(0, -1).join('-');
            const depId = `k8s:${pod.namespace}:deployment/${possibleDepName}`;
            if (this.nodes.has(depId)) {
              this.addEdge(depId, parentId, 'OWNS');
            }
          }
        }

        this.addEdge(parentId, podId, 'OWNS');
      }

      // Link Containers and Images
      for (const c of pod.containers) {
        const containerId = `k8s:${pod.namespace}:container/${pod.name}/${c.name}`;
        this.addNode({
          id: containerId,
          kind: 'Container',
          namespace: pod.namespace,
          name: c.name,
          metadata: { state: c.state, restartCount: c.restartCount, ready: c.ready },
        });
        this.addEdge(podId, containerId, 'OWNS');

        const imgId = `k8s:image/${c.image}`;
        this.addNode({ id: imgId, kind: 'Image', name: c.image });
        this.addEdge(containerId, imgId, 'USES_IMAGE');
      }
    }

    // 5. Services & Selector Matching to Pods
    for (const svc of snapshot.services) {
      const svcId = `k8s:${svc.namespace}:service/${svc.name}`;
      const nsId = `k8s:namespace/${svc.namespace}`;
      this.addNode({
        id: svcId,
        kind: 'Service',
        namespace: svc.namespace,
        name: svc.name,
        uid: svc.uid,
        metadata: { type: svc.type, clusterIP: svc.clusterIP, selector: svc.selector },
      });
      this.addEdge(nsId, svcId, 'OWNS');

      // Match service selector to pods in same namespace
      if (svc.selector && Object.keys(svc.selector).length > 0) {
        for (const pod of snapshot.pods) {
          if (pod.namespace === svc.namespace && this.labelsMatch(svc.selector, pod.labels)) {
            const podId = `k8s:${pod.namespace}:pod/${pod.name}`;
            this.addEdge(svcId, podId, 'EXPOSES');
          }
        }
      }
    }

    // 6. Persistent Volume Claims
    for (const pvc of snapshot.pvcs) {
      const pvcId = `k8s:${pvc.namespace}:pvc/${pvc.name}`;
      const nsId = `k8s:namespace/${pvc.namespace}`;
      this.addNode({
        id: pvcId,
        kind: 'PVC',
        namespace: pvc.namespace,
        name: pvc.name,
        uid: pvc.uid,
        metadata: { phase: pvc.phase, storageClass: pvc.storageClass, requestedStorage: pvc.requestedStorage },
      });
      this.addEdge(nsId, pvcId, 'OWNS');
    }

    this.logger.debug('ResourceGraph built from snapshot', {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.length,
    });
  }

  /**
   * Helper: check if a resource's labels satisfy a selector
   */
  private labelsMatch(selector: Record<string, string>, labels: Record<string, string> = {}): boolean {
    for (const [k, v] of Object.entries(selector)) {
      if (labels[k] !== v) return false;
    }
    return true;
  }

  /**
   * Traversal: Get parent workload for a given Pod ID
   */
  public getParentWorkload(podId: string): GraphNode | undefined {
    const incoming = this.getIncomingEdges(podId);
    for (const edge of incoming) {
      if (edge.relationship === 'OWNS') {
        const parent = this.getNode(edge.from);
        if (parent) {
          const pk = parent.kind.toLowerCase();
          if (pk === 'replicaset') {
            const rsIncoming = this.getIncomingEdges(parent.id);
            for (const rsEdge of rsIncoming) {
              if (rsEdge.relationship === 'OWNS') {
                const rsParent = this.getNode(rsEdge.from);
                if (rsParent && rsParent.kind.toLowerCase() === 'deployment') return rsParent;
              }
            }
            return parent;
          }
          if (pk === 'deployment' || pk === 'statefulset' || pk === 'daemonset' || pk === 'job') {
            return parent;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Traversal: Find Services exposing a given pod
   */
  public getExposingServices(podId: string): GraphNode[] {
    const incoming = this.getIncomingEdges(podId);
    const services: GraphNode[] = [];
    for (const edge of incoming) {
      if (edge.relationship === 'EXPOSES') {
        const node = this.getNode(edge.from);
        if (node && node.kind === 'Service') services.push(node);
      }
    }
    return services;
  }

  /**
   * Traversal: Find Node that a pod is scheduled on
   */
  public getScheduledNode(podId: string): GraphNode | undefined {
    const outgoing = this.getOutgoingEdges(podId);
    for (const edge of outgoing) {
      if (edge.relationship === 'RUNS_ON') {
        return this.getNode(edge.to);
      }
    }
    return undefined;
  }

  /**
   * Traversal: Expand subgraph up to `depth` levels around a target resource
   */
  public getRelatedResources(resourceId: string, depth = 2): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const visitedNodes = new Set<string>([resourceId]);
    const collectedEdges: GraphEdge[] = [];
    let currentLevel = [resourceId];

    for (let d = 0; d < depth; d++) {
      const nextLevel: string[] = [];
      for (const id of currentLevel) {
        // Collect outgoing
        for (const edge of this.getOutgoingEdges(id)) {
          collectedEdges.push(edge);
          if (!visitedNodes.has(edge.to)) {
            visitedNodes.add(edge.to);
            nextLevel.push(edge.to);
          }
        }
        // Collect incoming
        for (const edge of this.getIncomingEdges(id)) {
          collectedEdges.push(edge);
          if (!visitedNodes.has(edge.from)) {
            visitedNodes.add(edge.from);
            nextLevel.push(edge.from);
          }
        }
      }
      currentLevel = nextLevel;
    }

    const collectedNodes: GraphNode[] = [];
    for (const id of visitedNodes) {
      const n = this.getNode(id);
      if (n) collectedNodes.push(n);
    }

    return { nodes: collectedNodes, edges: collectedEdges };
  }
}
