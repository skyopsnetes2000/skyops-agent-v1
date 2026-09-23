/**
 * SkyOps Agent V1 - Kubernetes Event Collector
 *
 * Scrapes cluster warning events (e.g. BackOff, Unhealthy, FailedMount, FailedScheduling).
 */

import { IKubernetesClient } from '../KubernetesClient.ts';
import { EvidenceNormalizer } from '../../evidence/EvidenceNormalizer.ts';
import { Evidence } from '../../types/evidence.ts';
import { Logger } from '../../observability/Logger.ts';
import { Metrics } from '../../observability/Metrics.ts';

export class EventCollector {
  private readonly client: IKubernetesClient;
  private readonly normalizer: EvidenceNormalizer;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private seenEventUids: Set<string> = new Set();

  constructor(client: IKubernetesClient, normalizer: EvidenceNormalizer, logger?: Logger) {
    this.client = client;
    this.normalizer = normalizer;
    this.logger = logger?.child('event-collector') || new Logger('event-collector');
    this.metrics = Metrics.getInstance();
  }

  public async collect(namespace?: string): Promise<Evidence[]> {
    const evidences: Evidence[] = [];

    try {
      const events = await this.client.listEvents(namespace);

      for (const event of events) {
        // Dedup by UID
        if (event.uid && this.seenEventUids.has(event.uid)) {
          continue;
        }

        if (event.uid) {
          this.seenEventUids.add(event.uid);
          // Bound seen set
          if (this.seenEventUids.size > 2000) {
            this.seenEventUids.clear();
          }
        }

        this.metrics.increment('k8s_events_watched_total');
        evidences.push(this.normalizer.normalizeEvent(event));
      }
    } catch (err) {
      this.logger.error('Failed to collect Kubernetes events', undefined, err);
    }

    return evidences;
  }
}
