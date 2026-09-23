/**
 * SkyOps Agent V1 - Core Agent Types
 */

export type AgentStatus =
  | 'starting'
  | 'registering'
  | 'discovering'
  | 'running'
  | 'degraded'
  | 'stopping'
  | 'stopped';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  name: string;
  status: HealthStatus;
  message?: string;
  lastCheckedAt: string;
  details?: Record<string, unknown>;
}

export interface AgentHealth {
  overallStatus: HealthStatus;
  agentId: string;
  environmentId: string;
  uptimeSeconds: number;
  version: string;
  components: Record<string, ComponentHealth>;
}

export interface AgentIdentity {
  agentId: string;
  installationId: string;
  organizationId: string;
  environmentId: string;
  agentVersion: string;
  createdAt: string;
  lastSeenAt: string;
  status: AgentStatus;
  clusterName?: string;
}
