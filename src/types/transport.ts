/**
 * SkyOps Agent V1 - Transport Protocol Types
 */

import { AgentHealth } from './agent.ts';
import { Evidence } from './evidence.ts';

export interface RegistrationRequest {
  agentId: string;
  installationId: string;
  organizationId: string;
  environmentId: string;
  agentVersion: string;
  clusterName?: string;
  capabilities: string[];
  systemInfo: {
    nodeVersion: string;
    platform: string;
    arch: string;
  };
}

export interface RegistrationResponse {
  registered: boolean;
  assignedAgentId: string;
  sessionToken?: string;
  configOverrides?: Record<string, unknown>;
  message?: string;
}

export interface HeartbeatPayload {
  agentId: string;
  installationId: string;
  environmentId: string;
  agentVersion: string;
  timestamp: string;
  uptimeSeconds: number;
  status: string;
  health: AgentHealth;
  queueDepth: number;
  spoolDiskBytes: number;
  lastSuccessfulSync?: string;
  clusterMetrics?: {
    nodeCount: number;
    podCount: number;
    deploymentCount: number;
    activeWarnings: number;
  };
}

export interface HeartbeatResponse {
  acknowledged: boolean;
  serverTimestamp: string;
  syncIntervalSeconds?: number;
  commands?: Array<{
    commandId: string;
    type: string;
    payload?: Record<string, unknown>;
  }>;
}

export interface EvidenceBatchUploadRequest {
  agentId: string;
  environmentId: string;
  batchId: string;
  sentAt: string;
  evidence: Evidence[];
}

export interface EvidenceBatchUploadResponse {
  batchId: string;
  acceptedCount: number;
  rejectedCount: number;
  failedEvidenceIds?: string[];
  acknowledged: boolean;
}

export interface TransportStatus {
  connected: boolean;
  lastConnectedAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  activeEndpoint: string;
}
