/**
 * SkyOps Agent V1 - Resilient Kubernetes Watcher Base
 *
 * Guarantees:
 * - Automatic reconnection with exponential backoff on stream drops
 * - Error isolation: watcher failure NEVER crashes the agent runtime
 * - Deduplication and resourceVersion handling
 */

import { Logger } from '../../observability/Logger.ts';
import { Metrics } from '../../observability/Metrics.ts';
import { ComponentHealth } from '../../types/agent.ts';

export abstract class KubernetesWatcher {
  protected readonly name: string;
  protected readonly logger: Logger;
  protected readonly metrics: Metrics;
  protected isRunning = false;
  protected reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  protected lastSuccessfulEventAt?: string;
  protected lastError?: string;

  constructor(name: string, logger?: Logger) {
    this.name = name;
    this.logger = logger?.child(`watcher:${name}`) || new Logger(`watcher:${name}`);
    this.metrics = Metrics.getInstance();
  }

  public abstract start(): Promise<void>;
  public abstract stop(): Promise<void>;

  protected scheduleReconnect(baseDelayMs = 2000): void {
    if (!this.isRunning) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts += 1;
    const delay = Math.min(baseDelayMs * Math.pow(1.5, this.reconnectAttempts), 30000);

    this.logger.warn(`Watcher ${this.name} disconnected, scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      if (!this.isRunning) return;
      try {
        await this.start();
        this.reconnectAttempts = 0;
        this.lastError = undefined;
        this.logger.info(`Watcher ${this.name} successfully reconnected`);
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.scheduleReconnect(baseDelayMs);
      }
    }, delay);
  }

  public getHealth(): ComponentHealth {
    return {
      name: `watcher:${this.name}`,
      status: this.isRunning && !this.lastError ? 'healthy' : this.isRunning ? 'degraded' : 'unhealthy',
      message: this.lastError || (this.isRunning ? 'Watch stream active' : 'Stopped'),
      lastCheckedAt: new Date().toISOString(),
      details: {
        reconnectAttempts: this.reconnectAttempts,
        lastSuccessfulEventAt: this.lastSuccessfulEventAt,
      },
    };
  }
}
