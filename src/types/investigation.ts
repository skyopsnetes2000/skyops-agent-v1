/**
 * SkyOps Agent V1 - Investigation, Graph, Change & Remediation Models
 */

import { Evidence } from './evidence.ts';

export type InvestigationScope = 'NORMAL' | 'SIGNAL' | 'INVESTIGATION';

export interface GraphNode {
  id: string; // e.g. "k8s:payments:deployment/payments-api"
  kind: string; // "Cluster" | "Namespace" | "Deployment" | "ReplicaSet" | "Pod" | "Container" | "Node" | "Service" | "Ingress" | "PVC" | "ConfigMap" | "Secret"
  namespace?: string;
  name: string;
  uid?: string;
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export type GraphRelationshipType =
  | 'OWNS'                // Deployment -> ReplicaSet -> Pod
  | 'RUNS_ON'             // Pod -> Node
  | 'MOUNTS_PVC'          // Pod -> PVC
  | 'REFERENCES_CONFIG'   // Pod -> ConfigMap / Secret (metadata only)
  | 'EXPOSES'             // Service -> Pod
  | 'ROUTES_TO'           // Ingress -> Service
  | 'USES_IMAGE';         // Container -> Image

export interface GraphEdge {
  from: string; // Source Node ID
  to: string;   // Target Node ID
  relationship: GraphRelationshipType;
  metadata?: Record<string, unknown>;
}

export interface ResourceChange {
  changeId: string;
  timestamp: string;
  resourceId: string;
  resourceKind: string;
  namespace?: string;
  name: string;
  changeType: 'IMAGE_UPDATE' | 'REPLICA_SCALE' | 'ROLLOUT_REVISION' | 'CONFIG_UPDATE' | 'CONDITION_CHANGE' | 'SELECTOR_UPDATE';
  field: string;
  before: unknown;
  after: unknown;
  source: string;
}

export interface FailureChainNode {
  id: string;
  kind: string;
  name: string;
  namespace?: string;
  status: string;
  failureReason?: string;
}

export interface FailureChain {
  rootCauseCandidate?: string;
  nodes: FailureChainNode[];
  edges: Array<{ from: string; to: string; relationship: string }>;
  summary: string;
  confidenceScore: number; // 0.0 to 1.0
}

export interface TimelineEvent {
  timestamp: string;
  type: 'CHANGE' | 'EVENT' | 'SIGNAL' | 'OBSERVATION' | 'ACTION';
  resourceId: string;
  summary: string;
  severity?: string;
  details?: Record<string, unknown>;
}

export interface LogSnippet {
  podName: string;
  namespace: string;
  containerName: string;
  isPrevious: boolean;
  timestamp: string;
  lineCount: number;
  lines: string[];
  truncated: boolean;
}

export interface InvestigationContext {
  incidentId: string;
  timestamp: string;
  agentId: string;
  environmentId: string;
  scope: InvestigationScope;
  affectedResources: string[];
  failureSignals: Evidence[];
  evidence: Evidence[];
  changes: ResourceChange[];
  relationships: GraphEdge[];
  failureChain: FailureChain;
  timeline: TimelineEvent[];
  logSnippets: LogSnippet[];
}

export type RemediationActionType =
  | 'RestartPod'
  | 'RollbackDeployment'
  | 'ScaleDeployment'
  | 'RetryJob'
  | 'DeleteFailedPod'
  | 'RestartDeployment';

export interface RemediationAction {
  actionId: string;
  actionType: RemediationActionType;
  targetResource: {
    kind: string;
    namespace: string;
    name: string;
  };
  parameters: Record<string, unknown>;
  requestedBy: string;
  approvalId: string;
  expiresAt: string; // ISO 8601 UTC
}

export interface RemediationActionResult {
  actionId: string;
  actionType: RemediationActionType;
  targetResource: string;
  executedAt: string;
  success: boolean;
  verificationStatus: 'VERIFIED_HEALTHY' | 'VERIFICATION_FAILED' | 'TIMED_OUT' | 'NOT_VERIFIED';
  details: string;
  verificationAttempts?: number;
}
