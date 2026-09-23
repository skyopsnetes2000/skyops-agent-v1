/**
 * SkyOps Agent V1 - Universal Normalized Evidence Model
 */

export type EvidenceSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export type EvidenceKind =
  | 'OBSERVATION'          // Raw / normalized resource state
  | 'SIGNAL'               // Detected abnormal condition
  | 'INCIDENT_CANDIDATE';  // Correlated failure candidate

export type EvidenceType =
  | 'POD_FAILURE'
  | 'CONTAINER_RESTART'
  | 'IMAGE_PULL_FAILURE'
  | 'DEPLOYMENT_CHANGE'
  | 'NODE_FAILURE'
  | 'PROBE_FAILURE'
  | 'PVC_FAILURE'
  | 'KUBERNETES_EVENT'
  | 'LOG_EVENT'
  | 'RESOURCE_STATE'
  | 'CONFIG_CHANGE'
  | 'SIGNAL_DETECTED';

export type EvidenceSource = 'kubernetes' | 'agent' | 'system';

export interface CorrelationKeys {
  clusterName?: string;
  namespace?: string;
  pod?: string;
  node?: string;
  deployment?: string;
  service?: string;
  container?: string;
  image?: string;
  imageDigest?: string;
  commitSha?: string;
  pvc?: string;
  [key: string]: string | undefined;
}

export interface EvidenceObservation {
  summary: string;
  reason?: string;
  details?: Record<string, unknown>;
  rawStatus?: string;
  count?: number;
  exitCode?: number;
  restartCount?: number;
}

export interface Evidence {
  evidenceId: string;
  environmentId: string;
  agentId: string;
  timestamp: string; // ISO 8601 UTC
  source: EvidenceSource;
  resourceId: string; // Uniform resource identifier e.g. "k8s:default:pod/payments-api-xxx"
  resourceType: string; // "pod", "deployment", "node", "event", "pvc"
  evidenceType: EvidenceType;
  kind: EvidenceKind;
  severity: EvidenceSeverity;
  observation: EvidenceObservation;
  metadata: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    collector: string;
    version?: string;
    fingerprint: string;
  };
  correlationKeys: CorrelationKeys;
}
