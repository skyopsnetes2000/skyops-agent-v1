/**
 * SkyOps Agent V1 - Bounded In-Memory Evidence Store and Deduplicator
 *
 * Prevents alert storming and duplicate spam by deduplicating signals
 * using evidence fingerprints within a sliding time window.
 */

import { Evidence } from '../types/evidence.ts';

export class EvidenceStore {
  private readonly maxItems: number;
  private readonly dedupWindowMs: number;
  private items: Evidence[] = [];
  private lastSeenByFingerprint: Map<string, number> = new Map();

  constructor(maxItems = 1000, dedupWindowMs = 60000) {
    this.maxItems = maxItems;
    this.dedupWindowMs = dedupWindowMs;
  }

  /**
   * Adds evidence if it is not a duplicate within the deduplication window.
   * Returns true if added, false if skipped as duplicate.
   */
  public add(evidence: Evidence): boolean {
    const now = Date.now();
    const fp = evidence.metadata.fingerprint;

    if (fp) {
      const lastSeen = this.lastSeenByFingerprint.get(fp);
      if (lastSeen && now - lastSeen < this.dedupWindowMs) {
        // Skip duplicate signal within window
        return false;
      }
      this.lastSeenByFingerprint.set(fp, now);
    }

    this.items.push(evidence);

    // Evict oldest if exceeding max capacity
    if (this.items.length > this.maxItems) {
      this.items.shift();
    }

    // Clean up expired fingerprint entries periodically
    if (this.lastSeenByFingerprint.size > this.maxItems * 2) {
      for (const [key, ts] of this.lastSeenByFingerprint.entries()) {
        if (now - ts > this.dedupWindowMs) {
          this.lastSeenByFingerprint.delete(key);
        }
      }
    }

    return true;
  }

  public getRecent(count = 50): Evidence[] {
    return this.items.slice(-count).reverse();
  }

  public getAll(): Evidence[] {
    return [...this.items];
  }

  public size(): number {
    return this.items.length;
  }

  public clear(): void {
    this.items = [];
    this.lastSeenByFingerprint.clear();
  }
}
