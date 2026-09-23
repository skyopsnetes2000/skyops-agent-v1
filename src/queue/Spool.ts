/**
 * SkyOps Agent V1 - Durable Disk Spool
 *
 * Guarantees:
 * - Persistent storage across agent crashes, pod restarts, and network outages
 * - Bounded disk space: enforces maximum disk quota to protect node filesystem
 * - Atomic writes (.tmp file + fs.rename) to prevent corrupted records
 * - Automatic startup recovery of previously queued records
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Evidence } from '../types/evidence.ts';
import { Logger } from '../observability/Logger.ts';
import { Metrics } from '../observability/Metrics.ts';

export interface SpoolRecord {
  id: string;
  timestamp: string;
  retryCount: number;
  evidence: Evidence;
}

export class Spool {
  private readonly spoolDir: string;
  private readonly maxDiskBytes: number;
  private readonly logger: Logger;
  private readonly metrics: Metrics;

  constructor(spoolDir: string, maxDiskBytes = 500 * 1024 * 1024, logger?: Logger) {
    this.spoolDir = spoolDir;
    this.maxDiskBytes = maxDiskBytes;
    this.logger = logger?.child('spool') || new Logger('spool');
    this.metrics = Metrics.getInstance();

    fs.mkdirSync(this.spoolDir, { recursive: true });
    this.updateDiskMetrics();
  }

  /**
   * Appends an evidence item to the durable spool on disk
   */
  public async write(evidence: Evidence, retryCount = 0): Promise<string> {
    await this.enforceQuota();

    const id = `rec_${Date.now()}_${evidence.evidenceId.replace(/[^a-zA-Z0-9]/g, '')}`;
    const filename = `${id}.json`;
    const targetPath = path.join(this.spoolDir, filename);
    const tempPath = path.join(this.spoolDir, `${filename}.tmp`);

    const record: SpoolRecord = {
      id,
      timestamp: new Date().toISOString(),
      retryCount,
      evidence,
    };

    const data = JSON.stringify(record, null, 2);

    // Atomic write
    await fs.promises.writeFile(tempPath, data, 'utf-8');
    await fs.promises.rename(tempPath, targetPath);

    this.metrics.increment('evidence_spooled_total');
    this.updateDiskMetrics();

    return id;
  }

  /**
   * Reads up to `limit` records from the spool, sorted by timestamp (FIFO)
   */
  public async readBatch(limit = 50): Promise<SpoolRecord[]> {
    const files = await this.listRecordFiles();
    const batch: SpoolRecord[] = [];

    for (const file of files.slice(0, limit)) {
      const filePath = path.join(this.spoolDir, file);
      try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as SpoolRecord;
        batch.push(parsed);
      } catch (err) {
        this.logger.warn(`Corrupted spool file encountered, removing: ${file}`, undefined, err);
        try {
          await fs.promises.unlink(filePath);
        } catch {
          // ignore unlink error
        }
      }
    }

    return batch;
  }

  /**
   * Deletes a processed record from the spool
   */
  public async acknowledge(id: string): Promise<void> {
    const filename = `${id}.json`;
    const targetPath = path.join(this.spoolDir, filename);
    try {
      if (fs.existsSync(targetPath)) {
        await fs.promises.unlink(targetPath);
      }
    } catch (err) {
      this.logger.warn(`Failed to unlink acknowledged spool file: ${filename}`, undefined, err);
    }
    this.updateDiskMetrics();
  }

  /**
   * Returns current count of records waiting on disk
   */
  public async count(): Promise<number> {
    const files = await this.listRecordFiles();
    return files.length;
  }

  /**
   * Computes current disk bytes consumed by the spool
   */
  public async getDiskUsageBytes(): Promise<number> {
    const files = await this.listRecordFiles();
    let totalBytes = 0;

    for (const file of files) {
      try {
        const stat = await fs.promises.stat(path.join(this.spoolDir, file));
        totalBytes += stat.size;
      } catch {
        // file might have been deleted concurrently
      }
    }

    return totalBytes;
  }

  /**
   * Enforces max disk quota. Deletes oldest files if quota is exceeded.
   */
  private async enforceQuota(): Promise<void> {
    const currentBytes = await this.getDiskUsageBytes();
    if (currentBytes < this.maxDiskBytes) {
      return;
    }

    this.logger.warn('Spool disk usage reached quota threshold, evicting oldest records', {
      currentBytes,
      maxDiskBytes: this.maxDiskBytes,
    });

    const files = await this.listRecordFiles();
    let bytesRemaining = currentBytes;

    for (const file of files) {
      if (bytesRemaining < this.maxDiskBytes * 0.8) {
        break; // Reached comfortable headroom (80% of max quota)
      }
      const filePath = path.join(this.spoolDir, file);
      try {
        const stat = await fs.promises.stat(filePath);
        await fs.promises.unlink(filePath);
        bytesRemaining -= stat.size;
        this.metrics.increment('evidence_dropped_total');
      } catch {
        // ignore
      }
    }

    this.updateDiskMetrics();
  }

  private async listRecordFiles(): Promise<string[]> {
    try {
      if (!fs.existsSync(this.spoolDir)) {
        await fs.promises.mkdir(this.spoolDir, { recursive: true });
      }
      const entries = await fs.promises.readdir(this.spoolDir);
      return entries
        .filter((name) => name.startsWith('rec_') && name.endsWith('.json'))
        .sort(); // Lexicographical sort corresponds to timestamp order due to rec_timestamp naming
    } catch (err) {
      this.logger.error('Failed to list spool directory', { spoolDir: this.spoolDir }, err);
      return [];
    }
  }

  private updateDiskMetrics(): void {
    this.getDiskUsageBytes().then((bytes) => {
      this.metrics.setGauge('spool_disk_bytes', bytes);
    }).catch(() => {
      // ignore
    });
  }
}
