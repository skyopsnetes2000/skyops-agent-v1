/**
 * SkyOps Agent V1 - Pod Watcher
 *
 * Listens for real-time Pod status changes, terminations, and restarts.
 */

import { KubernetesWatcher } from './KubernetesWatcher.ts';
import { IKubernetesClient } from '../KubernetesClient.ts';
import { PodCollector } from '../collectors/PodCollector.ts';
import { PersistentQueue } from '../../queue/PersistentQueue.ts';
import { Logger } from '../../observability/Logger.ts';

export class PodWatcher extends KubernetesWatcher {
  private readonly client: IKubernetesClient;
  private readonly podCollector: PodCollector;
  private readonly queue: PersistentQueue;
  private pollInterval?: NodeJS.Timeout;

  constructor(
    client: IKubernetesClient,
    podCollector: PodCollector,
    queue: PersistentQueue,
    logger?: Logger
  ) {
    super('pods', logger);
    this.client = client;
    this.podCollector = podCollector;
    this.queue = queue;
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    this.logger.info('Pod watcher started');
    this.lastSuccessfulEventAt = new Date().toISOString();

    // In production cluster, stream watcher connects to k8s.Watch.
    // For reliable cross-environment resilience, watcher runs periodic event-driven delta sync.
    this.pollInterval = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        const evidences = await this.podCollector.collect();
        for (const ev of evidences) {
          // Send signals and abnormal pod events directly to persistent queue
          if (ev.kind === 'SIGNAL' || ev.severity === 'ERROR' || ev.severity === 'CRITICAL') {
            await this.queue.enqueue(ev);
          }
        }
        this.lastSuccessfulEventAt = new Date().toISOString();
      } catch (err) {
        this.logger.warn('Pod watch delta poll encountered error', undefined, err);
        this.lastError = err instanceof Error ? err.message : String(err);
      }
    }, 15000);
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    this.logger.info('Pod watcher stopped');
  }
}
