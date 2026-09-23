/**
 * SkyOps Agent V1 - Configuration Validation
 */

import { AgentConfig } from './AgentConfig.ts';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateConfig(config: AgentConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required Organization and Environment IDs
  if (!config.organizationId || config.organizationId.trim() === '') {
    errors.push('SKYOPS_ORGANIZATION_ID or organizationId must be provided.');
  }

  if (!config.environmentId || config.environmentId.trim() === '') {
    errors.push('SKYOPS_ENVIRONMENT_ID or environmentId must be provided.');
  }

  // API URL validation
  if (!config.transport.apiUrl || config.transport.apiUrl.trim() === '') {
    errors.push('SKYOPS_API_URL or transport.apiUrl must be specified.');
  } else {
    try {
      const url = new URL(config.transport.apiUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.push(`Invalid protocol in apiUrl: ${url.protocol}. Expected http: or https:`);
      }
      if (url.protocol === 'http:' && !url.hostname.includes('localhost') && !url.hostname.includes('127.0.0.1')) {
        warnings.push('Production deployment uses plaintext HTTP for apiUrl. HTTPS is strongly recommended.');
      }
    } catch {
      errors.push(`Invalid apiUrl format: ${config.transport.apiUrl}`);
    }
  }

  // Token warning
  if (!config.transport.agentToken || config.transport.agentToken.trim() === '') {
    warnings.push('SKYOPS_AGENT_TOKEN is empty. Cloud registration or authentication may fail.');
  }

  // Intervals & numerical validation
  if (config.transport.heartbeatIntervalSeconds < 5) {
    errors.push('Heartbeat interval must be at least 5 seconds.');
  }

  if (config.transport.batchSize < 1 || config.transport.batchSize > 1000) {
    errors.push('Batch size must be between 1 and 1000.');
  }

  if (config.queue.maxMemoryItems < 100) {
    warnings.push('Queue maxMemoryItems is unusually small (< 100). Memory queue may overflow quickly.');
  }

  if (config.queue.maxDiskBytes < 10 * 1024 * 1024) {
    errors.push('Queue maxDiskBytes must be at least 10MB to guarantee spool resilience.');
  }

  if (config.kubernetes.discoveryIntervalSeconds < 10) {
    errors.push('Kubernetes discovery interval must be at least 10 seconds.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
