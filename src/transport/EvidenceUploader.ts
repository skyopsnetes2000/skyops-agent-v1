/**
 * SkyOps Agent V1 - Evidence Uploader Worker
 *
 * Drains evidence from PersistentQueue in batches and uploads to SkyOps Cloud.
 * Handles acknowledgements, backoff, and ensures zero data loss during network hiccups.
 */

import { TransportClient } from './TransportClient.ts';
import { PersistentQueue } from '../queue/PersistentQueue.ts';
import {
  EvidenceBatchUploadRequest,
  EvidenceBatchUploadResponse,
} from '../types/transport.ts';
import { Logger } from '../observability/Logger.ts';
import { RetryPolicy } from '../queue/RetryPolicy.ts';

export interface EvidenceUploaderOptions {
  agentId: string;
  environmentId: string;
  transport: TransportClient;
  queue: PersistentQueue;
  batchSize?: number;
  uploadIntervalMs?: number;
  retryPolicy?: RetryPolicy;
  logger?: Logger;
}

export class EvidenceUploader {
  private readonly agentId: string;
  private readonly environmentId: string;
  private readonly transport: TransportClient;
  private readonly queue: PersistentQueue;
  private readonly batchSize: number;
  private readonly uploadIntervalMs: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly logger: Logger;

  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private currentBackoffMs = 0;
  private consecutiveFailures = 0;

  constructor(options: EvidenceUploaderOptions) {
    this.agentId = options.agentId;
    this.environmentId = options.environmentId;
    this.transport = options.transport;
    this.queue = options.queue;
    this.batchSize = options.batchSize ?? 50;
    this.uploadIntervalMs = options.uploadIntervalMs ?? 3000;
    this.retryPolicy = options.retryPolicy || new RetryPolicy();
    this.logger = options.logger?.child('uploader') || new Logger('uploader');
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info('Evidence uploader service started');
    this.scheduleNext(100);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.info('Evidence uploader service stopped');
  }

  private scheduleNext(delayMs: number): void {
    if (!this.isRunning) return;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.flush().finally(() => {
        const nextDelay = this.consecutiveFailures > 0 ? this.currentBackoffMs : this.uploadIntervalMs;
        this.scheduleNext(nextDelay);
      });
    }, delayMs);
  }

  public async flush(): Promise<void> {
    const batch = await this.queue.dequeueBatch(this.batchSize);
    if (batch.length === 0) {
      return;
    }

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    try {
      this.logger.debug(`Uploading evidence batch ${batchId} (${batch.length} items)`);

      const request: EvidenceBatchUploadRequest = {
        agentId: this.agentId,
        environmentId: this.environmentId,
        batchId,
        sentAt: new Date().toISOString(),
        evidence: batch,
      };

      await this.transport.post<EvidenceBatchUploadRequest, EvidenceBatchUploadResponse>(
        '/api/v1/evidence/batch',
        request
      );

      // Successfully delivered
      await this.queue.acknowledgeBatch(batch);
      this.consecutiveFailures = 0;
      this.currentBackoffMs = 0;
      this.logger.debug(`Batch ${batchId} acknowledged by SkyOps Cloud`);
    } catch (err) {
      this.consecutiveFailures += 1;
      this.currentBackoffMs = this.retryPolicy.getDelay(this.consecutiveFailures);

      this.logger.warn(
        `Failed to upload batch ${batchId}, requeueing with backoff (${this.currentBackoffMs}ms)`,
        { consecutiveFailures: this.consecutiveFailures },
        err
      );

      await this.queue.nackBatch(batch);
    }
  }
}
