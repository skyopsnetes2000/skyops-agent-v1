/**
 * SkyOps Agent V1 - Normalized Kubernetes Resource and Discovery Models
 */

export interface ClusterInfo {
  clusterName: string;
  serverVersion: string;
  platform: string;
  nodeCount: number;
  namespaceCount: number;
  podCount: number;
  discoveredAt: string;
}

export interface NodeSummary {
  name: string;
  ready: boolean;
  status: string;
  nodePool?: string;
  kubeletVersion: string;
  osImage: string;
  architecture: string;
  cpuCapacity: string;
  memoryCapacity: string;
  conditions: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  taints?: Array<{
    key: string;
    value?: string;
    effect: string;
  }>;
}

export interface ContainerStatusSummary {
  name: string;
  image: string;
  imageID?: string;
  ready: boolean;
  restartCount: number;
  state: 'running' | 'waiting' | 'terminated';
  reason?: string;
  message?: string;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface PodSummary {
  namespace: string;
  name: string;
  uid: string;
  nodeName?: string;
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  ready: boolean;
  restartCount: number;
  createdAt: string;
  ownerKind?: string;
  ownerName?: string;
  labels: Record<string, string>;
  containers: ContainerStatusSummary[];
  qosClass?: string;
  deletionTimestamp?: string;
}

export interface DeploymentSummary {
  namespace: string;
  name: string;
  uid: string;
  replicas: number;
  readyReplicas: number;
  updatedReplicas: number;
  availableReplicas: number;
  unavailableReplicas: number;
  generation: number;
  observedGeneration: number;
  conditions: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  labels: Record<string, string>;
  images: string[];
}

export interface ServiceSummary {
  namespace: string;
  name: string;
  uid: string;
  type: string;
  clusterIP?: string;
  ports: Array<{
    port: number;
    protocol: string;
    targetPort?: number | string;
  }>;
  selector?: Record<string, string>;
}

export interface PVCSummary {
  namespace: string;
  name: string;
  uid: string;
  phase: string;
  storageClass?: string;
  volumeName?: string;
  requestedStorage?: string;
}

export interface EventSummary {
  uid: string;
  namespace: string;
  name: string;
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  involvedObject: {
    kind: string;
    namespace?: string;
    name: string;
    uid?: string;
  };
  count: number;
  firstTimestamp?: string;
  lastTimestamp: string;
  sourceComponent?: string;
}

export interface DiscoverySnapshot {
  clusterInfo: ClusterInfo;
  nodes: NodeSummary[];
  namespaces: string[];
  deployments: DeploymentSummary[];
  pods: PodSummary[];
  services: ServiceSummary[];
  pvcs: PVCSummary[];
  recentEvents: EventSummary[];
  timestamp: string;
}

export interface DetectedSignal {
  signalType: string;
  resourceKind: string;
  resourceNamespace: string;
  resourceName: string;
  severity: 'WARN' | 'ERROR' | 'CRITICAL';
  reason: string;
  summary: string;
  details: Record<string, unknown>;
  correlationKeys: Record<string, string>;
}
