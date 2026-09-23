import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceGraph } from '../src/kubernetes/graph/ResourceGraph.ts';
import { DiscoverySnapshot } from '../src/types/kubernetes.ts';

describe('Resource Graph & Relationship Subsystem', () => {
  const mockSnapshot: DiscoverySnapshot = {
    clusterInfo: {
      clusterName: 'prod-cluster',
      serverVersion: 'v1.30.2',
      platform: 'linux/amd64',
      nodeCount: 2,
      namespaceCount: 1,
      podCount: 2,
      discoveredAt: new Date().toISOString(),
    },
    namespaces: ['payments'],
    nodes: [
      {
        name: 'node-worker-1',
        ready: true,
        status: 'Ready',
        kubeletVersion: 'v1.30.2',
        osImage: 'COS',
        architecture: 'amd64',
        cpuCapacity: '8',
        memoryCapacity: '32Gi',
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        name: 'node-worker-2',
        ready: true,
        status: 'Ready',
        kubeletVersion: 'v1.30.2',
        osImage: 'COS',
        architecture: 'amd64',
        cpuCapacity: '8',
        memoryCapacity: '32Gi',
        conditions: [{ type: 'Ready', status: 'True' }],
      },
    ],
    deployments: [
      {
        namespace: 'payments',
        name: 'payments-api',
        uid: 'dep-uid-1',
        replicas: 2,
        readyReplicas: 1,
        updatedReplicas: 2,
        availableReplicas: 1,
        unavailableReplicas: 1,
        generation: 3,
        observedGeneration: 3,
        conditions: [{ type: 'Available', status: 'True' }],
        labels: { app: 'payments', role: 'api' },
        images: ['registry.internal.io/payments:v42'],
      },
    ],
    pods: [
      {
        namespace: 'payments',
        name: 'payments-api-6b79f8-w7v9x',
        uid: 'pod-uid-1',
        nodeName: 'node-worker-1',
        phase: 'Running',
        ready: false,
        restartCount: 5,
        createdAt: new Date().toISOString(),
        ownerKind: 'ReplicaSet',
        ownerName: 'payments-api-6b79f8',
        labels: { app: 'payments', role: 'api' },
        containers: [
          {
            name: 'server',
            image: 'registry.internal.io/payments:v42',
            ready: false,
            restartCount: 5,
            state: 'waiting',
            reason: 'CrashLoopBackOff',
          },
        ],
      },
      {
        namespace: 'payments',
        name: 'payments-api-6b79f8-z2m4p',
        uid: 'pod-uid-2',
        nodeName: 'node-worker-2',
        phase: 'Running',
        ready: true,
        restartCount: 0,
        createdAt: new Date().toISOString(),
        ownerKind: 'ReplicaSet',
        ownerName: 'payments-api-6b79f8',
        labels: { app: 'payments', role: 'api' },
        containers: [
          {
            name: 'server',
            image: 'registry.internal.io/payments:v42',
            ready: true,
            restartCount: 0,
            state: 'running',
          },
        ],
      },
    ],
    services: [
      {
        namespace: 'payments',
        name: 'payments-svc',
        uid: 'svc-uid-1',
        type: 'ClusterIP',
        clusterIP: '10.96.0.45',
        ports: [{ port: 80, protocol: 'TCP' }],
        selector: { app: 'payments', role: 'api' },
      },
    ],
    pvcs: [
      {
        namespace: 'payments',
        name: 'payments-data-pvc',
        uid: 'pvc-uid-1',
        phase: 'Bound',
        storageClass: 'standard',
        requestedStorage: '10Gi',
      },
    ],
    recentEvents: [],
    timestamp: new Date().toISOString(),
  };

  it('builds complete resource graph from discovery snapshot', () => {
    const graph = new ResourceGraph();
    graph.buildFromSnapshot(mockSnapshot);

    const nodes = graph.getAllNodes();
    const edges = graph.getAllEdges();

    assert.ok(nodes.length >= 8, `Expected at least 8 graph nodes, got ${nodes.length}`);
    assert.ok(edges.length >= 6, `Expected at least 6 edges, got ${edges.length}`);

    // Verify Cluster node exists
    const cluster = graph.getNode('k8s:cluster/prod-cluster');
    assert.ok(cluster);
    assert.equal(cluster.kind, 'Cluster');

    // Verify Deployment node exists
    const dep = graph.getNode('k8s:payments:deployment/payments-api');
    assert.ok(dep);
    assert.equal(dep.kind, 'Deployment');
  });

  it('resolves parent workload and replica set links for a pod', () => {
    const graph = new ResourceGraph();
    graph.buildFromSnapshot(mockSnapshot);

    const podId = 'k8s:payments:pod/payments-api-6b79f8-w7v9x';
    const parentWorkload = graph.getParentWorkload(podId);

    assert.ok(parentWorkload, 'Expected parent workload to be resolved');
    assert.equal(parentWorkload.kind, 'Deployment');
    assert.equal(parentWorkload.name, 'payments-api');
  });

  it('resolves exposing services matching pod labels', () => {
    const graph = new ResourceGraph();
    graph.buildFromSnapshot(mockSnapshot);

    const podId = 'k8s:payments:pod/payments-api-6b79f8-w7v9x';
    const services = graph.getExposingServices(podId);

    assert.equal(services.length, 1);
    assert.equal(services[0].name, 'payments-svc');
  });

  it('links pod to scheduled node', () => {
    const graph = new ResourceGraph();
    graph.buildFromSnapshot(mockSnapshot);

    const podId = 'k8s:payments:pod/payments-api-6b79f8-w7v9x';
    const scheduledNode = graph.getScheduledNode(podId);

    assert.ok(scheduledNode);
    assert.equal(scheduledNode.name, 'node-worker-1');
  });

  it('performs neighborhood subgraph expansion up to depth 2', () => {
    const graph = new ResourceGraph();
    graph.buildFromSnapshot(mockSnapshot);

    const podId = 'k8s:payments:pod/payments-api-6b79f8-w7v9x';
    const neighborhood = graph.getRelatedResources(podId, 2);

    assert.ok(neighborhood.nodes.length >= 4);
    assert.ok(neighborhood.edges.length >= 3);
  });
});
