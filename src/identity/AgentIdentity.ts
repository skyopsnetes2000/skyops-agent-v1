/**
 * SkyOps Agent V1 - Persistent Agent Identity Manager
 *
 * Guarantees:
 * - Stable, immutable agent identity across pod restarts and container rebuilds
 * - Persistent storage in identity.json on local state volume
 * - Explicit separation from ephemeral hostname/pod name
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { AgentIdentity, AgentStatus } from '../types/agent.ts';
import { Logger } from '../observability/Logger.ts';

export class AgentIdentityManager {
  private identity: AgentIdentity;
  private readonly storageFilePath: string;
  private readonly logger: Logger;

  constructor(
    storageDir: string,
    initialConfig: {
      organizationId: string;
      environmentId: string;
      agentVersion: string;
      clusterName?: string;
      agentId?: string;
      installationId?: string;
    },
    logger?: Logger
  ) {
    this.logger = logger?.child('identity') || new Logger('identity');
    fs.mkdirSync(storageDir, { recursive: true });
    this.storageFilePath = path.join(storageDir, 'identity.json');

    // Attempt to load existing identity from disk
    const existing = this.loadFromDisk();

    if (existing) {
      this.logger.info('Loaded existing persistent agent identity', {
        agentId: existing.agentId,
        installationId: existing.installationId,
        createdAt: existing.createdAt,
      });

      this.identity = {
        ...existing,
        organizationId: initialConfig.organizationId,
        environmentId: initialConfig.environmentId,
        agentVersion: initialConfig.agentVersion,
        clusterName: initialConfig.clusterName || existing.clusterName,
        lastSeenAt: new Date().toISOString(),
        status: 'starting',
      };
    } else {
      // Create new stable identity
      const now = new Date().toISOString();
      const generatedAgentId = initialConfig.agentId || `skyops-agent-${crypto.randomUUID()}`;
      const generatedInstallId = initialConfig.installationId || `inst-${crypto.randomUUID()}`;

      this.identity = {
        agentId: generatedAgentId,
        installationId: generatedInstallId,
        organizationId: initialConfig.organizationId,
        environmentId: initialConfig.environmentId,
        agentVersion: initialConfig.agentVersion,
        createdAt: now,
        lastSeenAt: now,
        status: 'starting',
        clusterName: initialConfig.clusterName,
      };

      this.saveToDisk();
      this.logger.info('Generated new persistent agent identity', {
        agentId: this.identity.agentId,
        installationId: this.identity.installationId,
      });
    }
  }

  public getIdentity(): AgentIdentity {
    return { ...this.identity };
  }

  public getAgentId(): string {
    return this.identity.agentId;
  }

  public getEnvironmentId(): string {
    return this.identity.environmentId;
  }

  public updateStatus(status: AgentStatus): void {
    this.identity.status = status;
    this.identity.lastSeenAt = new Date().toISOString();
    this.saveToDisk();
  }

  public setAssignedAgentId(agentId: string): void {
    if (this.identity.agentId !== agentId) {
      this.logger.info('Agent ID updated from cloud registration', {
        previous: this.identity.agentId,
        assigned: agentId,
      });
      this.identity.agentId = agentId;
      this.identity.lastSeenAt = new Date().toISOString();
      this.saveToDisk();
    }
  }

  private loadFromDisk(): AgentIdentity | null {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.agentId && parsed.installationId) {
          return parsed as AgentIdentity;
        }
      }
    } catch (err) {
      this.logger.warn('Failed to read identity file from disk, generating new identity', undefined, err);
    }
    return null;
  }

  private saveToDisk(): void {
    try {
      const tempPath = `${this.storageFilePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.identity, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.storageFilePath);
    } catch (err) {
      this.logger.error('Failed to write identity file to disk', { path: this.storageFilePath }, err);
    }
  }
}
