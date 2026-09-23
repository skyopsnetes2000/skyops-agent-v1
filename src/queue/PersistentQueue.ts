/**
 * SkyOps Agent V1 - Persistent Queue Subsystem
 *
 * Guarantees:
 * - In-memory bounded queue for ultra-fast throughput during normal operations
 * - Automatic overflow and spillover to durable disk Spool
 * - Zero evidence loss during cloud outages or network disconnects
 * - Batching and acknowledgement-driven dequeue
 */

import { Evidence } from '../types/evidence.ts';
import { Spool, SpoolRecord } from './Spool.ts';
import { RetryPolicy } from './RetryPolicy.ts';
import { Logger } from '../observability/Logger.ts';
import { Metrics } from '../observability/Metrics.ts';

export interface QueueItem {
  id: string;
  evidence: Evidence;
  retryCount: number;
  enqueuedAt: number;
  inSpool: boolean;
}

export class PersistentQueue {
  private readonly spool: Spool;
  private readonly maxMemoryItems: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly logger: Logger;
  private readonly metrics: Metrics;

  // In-memory queue
  private memoryQueue: QueueItem[] = [];
  // Currently in-flight items awaiting ACK
  private inFlight: Map<string, QueueItem> = new Map();
  // Spool IDs already loaded in memory or in flight
  private activeSpoolIds: Set<string> = new Set();

  constructor(
    spool: Spool,
    maxMemoryItems = 5000,
    retryPolicy?: RetryPolicy,
    logger?: Logger
  ) {
    this.spool = spool;
    this.maxMemoryItems = maxMemoryItems;
    this.retryPolicy = retryPolicy || new RetryPolicy();
    this.logger = logger?.child('queue') || new Logger('queue');
    this.metrics = Metrics.getInstance();
  }

  /**
   * Initializes queue, recovering any unacknowledged records from disk spool
   */
  public async initialize(): Promise<void> {
    const spooledCount = await this.spool.count();
    if (spooledCount > 0) {
      this.logger.info(`Discovered ${spooledCount} persistent records in disk spool, preparing recovery`);
      const recovered = await this.spool.readBatch(Math.min(spooledCount, this.maxMemoryItems));

      for (const rec of recovered) {
        this.activeSpoolIds.add(rec.id);
        this.memoryQueue.push({
          id: rec.id,
          evidence: rec.evidence,
          retryCount: rec.retryCount,
          enqueuedAt: Date.now(),
          inSpool: true,
        });
      }
      this.logger.info(`Recovered ${recovered.length} records into active queue`);
    }
    this.updateMetrics();
  }

  /**
   * Enqueues an evidence item. If memory queue exceeds capacity,
   * write directly to durable disk spool.
   */
  public async enqueue(evidence: Evidence): Promise<void> {
    const id = `item_${Date.now()}_${evidence.evidenceId.substring(0, 8)}`;

    if (this.memoryQueue.length >= this.maxMemoryItems) {
      // Memory threshold reached: spill to disk spool immediately
      const spoolId = await this.spool.write(evidence, 0);
      this.logger.debug('Memory queue full, spilled evidence item to disk spool', { id, spoolId });
    } else {
      this.memoryQueue.push({
        id,
        evidence,
        retryCount: 0,
        enqueuedAt: Date.now(),
        inSpool: false,
      });
    }

    this.updateMetrics();
  }

  /**
   * Dequeues up to `batchSize` items for delivery to Cloud.
   * Items are moved into the in-flight map until acknowledged or nacked.
   */
  public async dequeueBatch(batchSize = 50): Promise<Evidence[]> {
    const batch: Evidence[] = [];
    const itemsToProcess: QueueItem[] = [];

    // First take from memory queue
    while (itemsToProcess.length < batchSize && this.memoryQueue.length > 0) {
      const item = this.memoryQueue.shift();
      if (item) {
        if (item.inSpool) {
          this.activeSpoolIds.delete(item.id);
        }
        this.inFlight.set(item.id, item);
        itemsToProcess.push(item);
      }
    }

    // If batch still has room, fetch additional from disk spool
    if (itemsToProcess.length < batchSize) {
      const needed = batchSize - itemsToProcess.length;
      const spooledRecords = await this.spool.readBatch(needed * 2);

      for (const rec of spooledRecords) {
        if (itemsToProcess.length >= batchSize) break;
        // Skip if already in flight or currently waiting in memoryQueue
        if (this.inFlight.has(rec.id) || this.activeSpoolIds.has(rec.id)) continue;

        const queueItem: QueueItem = {
          id: rec.id,
          evidence: rec.evidence,
          retryCount: rec.retryCount,
          enqueuedAt: Date.now(),
          inSpool: true,
        };
        this.inFlight.set(rec.id, queueItem);
        itemsToProcess.push(queueItem);
      }
    }

    for (const item of itemsToProcess) {
      batch.push(item.evidence);
    }

    this.updateMetrics();
    return batch;
  }

  /**
   * Acknowledges successful delivery of a batch of evidence
   */
  public async acknowledgeBatch(evidences: Evidence[]): Promise<void> {
    for (const ev of evidences) {
      // Find matching item in flight
      for (const [id, item] of this.inFlight.entries()) {
        if (item.evidence.evidenceId === ev.evidenceId) {
          this.inFlight.delete(id);
          if (item.inSpool) {
            this.activeSpoolIds.delete(item.id);
            await this.spool.acknowledge(item.id);
          }
          break;
        }
      }
    }

    this.metrics.increment('evidence_uploaded_total', evidences.length);
    this.updateMetrics();
  }

  /**
   * Requeues failed items with exponential backoff or spills them to spool
   */
  public async nackBatch(evidences: Evidence[]): Promise<void> {
    for (const ev of evidences) {
      for (const [id, item] of this.inFlight.entries()) {
        if (item.evidence.evidenceId === ev.evidenceId) {
          this.inFlight.delete(id);

          item.retryCount += 1;

          if (this.retryPolicy.shouldRetry(item.retryCount)) {
            // Persist to spool on failure to ensure zero data loss during network down
            if (!item.inSpool) {
              const spoolId = await this.spool.write(item.evidence, item.retryCount);
              item.id = spoolId;
              item.inSpool = true;
              this.activeSpoolIds.add(spoolId);
            }
            // Put back into memory queue if there is space, else stays in spool
            if (this.memoryQueue.length < this.maxMemoryItems) {
              this.memoryQueue.push(item);
            }
          } else {
            this.logger.warn('Evidence exceeded max upload retries, dropping', {
              evidenceId: ev.evidenceId,
              retryCount: item.retryCount,
            });
            this.metrics.increment('evidence_dropped_total');
            if (item.inSpool) {
              this.activeSpoolIds.delete(item.id);
              await this.spool.acknowledge(item.id);
            }
          }
          break;
        }
      }
    }

    this.updateMetrics();
  }

  /**
   * Current total queue depth (in-memory + in-flight + spool)
   */
  public async getQueueDepth(): Promise<number> {
    const spoolCount = await this.spool.count();
    return this.memoryQueue.length + this.inFlight.size + spoolCount;
  }

  public getMemoryQueueSize(): number {
    return this.memoryQueue.length;
  }

  public getInFlightSize(): number {
    return this.inFlight.size;
  }

  private updateMetrics(): void {
    const total = this.memoryQueue.length + this.inFlight.size;
    this.metrics.setGauge('queue_depth', total);
  }
}
