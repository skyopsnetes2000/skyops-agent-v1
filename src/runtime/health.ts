/**
 * SkyOps Agent V1 - Central Health Registry
 *
 * Tracks individual component health states and computes aggregate health.
 * Ensures the agent is not marked completely dead if only one subsystem is degraded.
 */

import { AgentHealth, ComponentHealth, HealthStatus } from '../types/agent.ts';

export class HealthRegistry {
  private readonly agentId: string;
  private readonly environmentId: string;
  private readonly agentVersion: string;
  private readonly startedAt: number;
  private components: Map<string, ComponentHealth> = new Map();

  constructor(agentId: string, environmentId: string, agentVersion: string) {
    this.agentId = agentId;
    this.environmentId = environmentId;
    this.agentVersion = agentVersion;
    this.startedAt = Date.now();
  }

  public registerComponent(name: string, initialStatus: HealthStatus = 'healthy', message = 'Initialized'): void {
    this.components.set(name, {
      name,
      status: initialStatus,
      message,
      lastCheckedAt: new Date().toISOString(),
    });
  }

  public updateComponent(health: ComponentHealth): void {
    this.components.set(health.name, health);
  }

  public setStatus(name: string, status: HealthStatus, message?: string, details?: Record<string, unknown>): void {
    this.components.set(name, {
      name,
      status,
      message,
      lastCheckedAt: new Date().toISOString(),
      details,
    });
  }

  public getSnapshot(): AgentHealth {
    const componentEntries = Object.fromEntries(this.components.entries());
    const statuses = Array.from(this.components.values()).map((c) => c.status);

    let overallStatus: HealthStatus = 'healthy';
    if (statuses.includes('unhealthy')) {
      // If critical components (like runtime or queue) are unhealthy, overall is unhealthy
      const runtimeStatus = this.components.get('runtime')?.status;
      const queueStatus = this.components.get('queue')?.status;
      if (runtimeStatus === 'unhealthy' || queueStatus === 'unhealthy') {
        overallStatus = 'unhealthy';
      } else {
        overallStatus = 'degraded';
      }
    } else if (statuses.includes('degraded')) {
      overallStatus = 'degraded';
    }

    return {
      overallStatus,
      agentId: this.agentId,
      environmentId: this.environmentId,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      version: this.agentVersion,
      components: componentEntries,
    };
  }
}
