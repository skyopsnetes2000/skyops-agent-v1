/**
 * SkyOps Agent V1 - Configuration Models
 */

import { LogLevel } from '../observability/Logger.ts';

export interface KubernetesConfig {
  inCluster: boolean;
  kubeconfigPath?: string;
  clusterName: string;
  namespace?: string; // Empty means all namespaces
  discoveryIntervalSeconds: number;
  collectionIntervalSeconds: number;
  reconnectIntervalSeconds: number;
  maxPodLogLines: number;
  mockMode?: boolean; // For local/demo environments without live API
}

export interface TransportConfig {
  apiUrl: string;
  agentToken: string;
  timeoutMs: number;
  heartbeatIntervalSeconds: number;
  batchSize: number;
  uploadIntervalMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  caCertPath?: string;
  rejectUnauthorized: boolean;
}

export interface QueueConfig {
  spoolDirectory: string;
  maxMemoryItems: number;
  maxDiskBytes: number;
  flushIntervalMs: number;
  maxItemAgeSeconds: number;
}

export interface SecurityConfig {
  secretRedactionEnabled: boolean;
  dropSecretDataPayloads: boolean;
}

export interface AgentConfig {
  agentId?: string;
  installationId?: string;
  organizationId: string;
  environmentId: string;
  agentVersion: string;
  logLevel: LogLevel;
  kubernetes: KubernetesConfig;
  transport: TransportConfig;
  queue: QueueConfig;
  security: SecurityConfig;
}
