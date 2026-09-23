/**
 * SkyOps Agent V1 - Kubernetes Event Watcher
 *
 * Real-time watcher for cluster Warning and Normal events.
 */

import { KubernetesWatcher } from './KubernetesWatcher.ts';
import { IKubernetesClient } from '../KubernetesClient.ts';
import { EventCollector } from '../collectors/EventCollector.ts';
import { PersistentQueue } from '../../queue/PersistentQueue.ts';
import { Logger } from '../../observability/Logger.ts';

export class EventWatcher extends KubernetesWatcher {
  private readonly client: IKubernetesClient;
  private readonly eventCollector: EventCollector;
  private readonly queue: PersistentQueue;
  private timer?: NodeJS.Timeout;

  constructor(
    client: IKubernetesClient,
    eventCollector: EventCollector,
    queue: PersistentQueue,
    logger?: Logger
  ) {
    super('events', logger);
    this.client = client;
    this.eventCollector = eventCollector;
    this.queue = queue;
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    this.logger.info('Event watcher started');
    this.lastSuccessfulEventAt = new Date().toISOString();

    this.timer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        const evidences = await this.eventCollector.collect();
        for (const ev of evidences) {
          if (ev.severity === 'WARN' || ev.severity === 'ERROR' || ev.kind === 'SIGNAL') {
            await this.queue.enqueue(ev);
          }
        }
        this.lastSuccessfulEventAt = new Date().toISOString();
      } catch (err) {
        this.logger.warn('Event watcher encountered error', undefined, err);
        this.lastError = err instanceof Error ? err.message : String(err);
      }
    }, 10000);
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.logger.info('Event watcher stopped');
  }
}
