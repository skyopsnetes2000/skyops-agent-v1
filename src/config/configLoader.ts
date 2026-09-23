/**
 * SkyOps Agent V1 - Configuration Loader
 *
 * Loads typed configuration from environment variables and defaults.
 * Provides safe masking for logging.
 */

import * as path from 'node:path';
import { AgentConfig } from './AgentConfig.ts';
import { validateConfig, ValidationResult } from './validation.ts';
import { LogLevel } from '../observability/Logger.ts';

const DEFAULT_AGENT_VERSION = '1.0.0';

export class ConfigLoader {
  public static loadFromEnv(env: Record<string, string | undefined> = process.env): AgentConfig {
    const defaultSpoolDir = env.SKYOPS_QUEUE_PATH || path.join(process.cwd(), '.skyops', 'spool');

    const config: AgentConfig = {
      agentId: env.SKYOPS_AGENT_ID,
      installationId: env.SKYOPS_INSTALLATION_ID,
      organizationId: env.SKYOPS_ORGANIZATION_ID !== undefined ? env.SKYOPS_ORGANIZATION_ID : 'default-org',
      environmentId: env.SKYOPS_ENVIRONMENT_ID !== undefined ? env.SKYOPS_ENVIRONMENT_ID : 'production-cluster',
      agentVersion: env.SKYOPS_AGENT_VERSION || DEFAULT_AGENT_VERSION,
      logLevel: (env.SKYOPS_LOG_LEVEL?.toUpperCase() as LogLevel) || 'INFO',

      kubernetes: {
        inCluster: env.SKYOPS_K8S_IN_CLUSTER !== 'false',
        kubeconfigPath: env.KUBECONFIG || env.SKYOPS_KUBECONFIG_PATH,
        clusterName: env.SKYOPS_CLUSTER_NAME || 'k8s-cluster',
        namespace: env.SKYOPS_K8S_NAMESPACE || '',
        discoveryIntervalSeconds: parseInt(env.SKYOPS_DISCOVERY_INTERVAL || '300', 10),
        collectionIntervalSeconds: parseInt(env.SKYOPS_COLLECTION_INTERVAL || '15', 10),
        reconnectIntervalSeconds: parseInt(env.SKYOPS_K8S_RECONNECT_INTERVAL || '5', 10),
        maxPodLogLines: parseInt(env.SKYOPS_MAX_LOG_LINES || '100', 10),
        mockMode: env.SKYOPS_K8S_MOCK_MODE === 'true',
      },

      transport: {
        apiUrl: env.SKYOPS_API_URL || 'https://api.skyops.io',
        agentToken: env.SKYOPS_AGENT_TOKEN || '',
        timeoutMs: parseInt(env.SKYOPS_HTTP_TIMEOUT_MS || '15000', 10),
        heartbeatIntervalSeconds: parseInt(env.SKYOPS_HEARTBEAT_INTERVAL || '30', 10),
        batchSize: parseInt(env.SKYOPS_BATCH_SIZE || '50', 10),
        uploadIntervalMs: parseInt(env.SKYOPS_UPLOAD_INTERVAL_MS || '3000', 10),
        maxRetries: parseInt(env.SKYOPS_MAX_RETRIES || '5', 10),
        backoffBaseMs: parseInt(env.SKYOPS_BACKOFF_BASE_MS || '1000', 10),
        backoffMaxMs: parseInt(env.SKYOPS_BACKOFF_MAX_MS || '30000', 10),
        caCertPath: env.SKYOPS_CA_CERT_PATH,
        rejectUnauthorized: env.SKYOPS_TLS_REJECT_UNAUTHORIZED !== 'false',
      },

      queue: {
        spoolDirectory: defaultSpoolDir,
        maxMemoryItems: parseInt(env.SKYOPS_QUEUE_MAX_MEMORY || '5000', 10),
        maxDiskBytes: parseInt(env.SKYOPS_QUEUE_MAX_DISK_BYTES || String(500 * 1024 * 1024), 10), // 500MB
        flushIntervalMs: parseInt(env.SKYOPS_QUEUE_FLUSH_INTERVAL_MS || '2000', 10),
        maxItemAgeSeconds: parseInt(env.SKYOPS_QUEUE_MAX_AGE_SECONDS || '86400', 10), // 24 hours
      },

      security: {
        secretRedactionEnabled: env.SKYOPS_SECRET_REDACTION !== 'false',
        dropSecretDataPayloads: env.SKYOPS_DROP_SECRET_PAYLOADS !== 'false',
      },
    };

    return config;
  }

  public static validate(config: AgentConfig): ValidationResult {
    return validateConfig(config);
  }

  public static getMaskedConfig(config: AgentConfig): Record<string, unknown> {
    return {
      organizationId: config.organizationId,
      environmentId: config.environmentId,
      agentId: config.agentId || '[PENDING_REGISTRATION]',
      agentVersion: config.agentVersion,
      logLevel: config.logLevel,
      kubernetes: {
        inCluster: config.kubernetes.inCluster,
        clusterName: config.kubernetes.clusterName,
        namespace: config.kubernetes.namespace || '[ALL_NAMESPACES]',
        discoveryIntervalSeconds: config.kubernetes.discoveryIntervalSeconds,
        collectionIntervalSeconds: config.kubernetes.collectionIntervalSeconds,
        mockMode: config.kubernetes.mockMode,
      },
      transport: {
        apiUrl: config.transport.apiUrl,
        agentToken: config.transport.agentToken
          ? `${config.transport.agentToken.substring(0, 4)}...${config.transport.agentToken.substring(config.transport.agentToken.length - 4)}`
          : '[EMPTY]',
        heartbeatIntervalSeconds: config.transport.heartbeatIntervalSeconds,
        batchSize: config.transport.batchSize,
        rejectUnauthorized: config.transport.rejectUnauthorized,
      },
      queue: {
        spoolDirectory: config.queue.spoolDirectory,
        maxMemoryItems: config.queue.maxMemoryItems,
        maxDiskBytes: `${(config.queue.maxDiskBytes / (1024 * 1024)).toFixed(0)}MB`,
      },
      security: config.security,
    };
  }
}
