/**
 * SkyOps Agent V1 - Metrics Subsystem
 *
 * Lightweight internal operational metrics:
 * - Counters for evidence collected, spooled, uploaded, dropped
 * - Gauges for queue depth, disk usage, active watchers
 * - Timer summaries
 */

export class Metrics {
  private static instance: Metrics;

  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();

  private constructor() {
    this.reset();
  }

  public static getInstance(): Metrics {
    if (!Metrics.instance) {
      Metrics.instance = new Metrics();
    }
    return Metrics.instance;
  }

  public reset(): void {
    this.counters.clear();
    this.gauges.clear();

    // Standard initialized metrics
    this.counters.set('evidence_collected_total', 0);
    this.counters.set('evidence_uploaded_total', 0);
    this.counters.set('evidence_spooled_total', 0);
    this.counters.set('evidence_dropped_total', 0);
    this.counters.set('signals_detected_total', 0);
    this.counters.set('heartbeat_success_total', 0);
    this.counters.set('heartbeat_failure_total', 0);
    this.counters.set('k8s_api_errors_total', 0);
    this.counters.set('k8s_events_watched_total', 0);

    this.gauges.set('queue_depth', 0);
    this.gauges.set('spool_disk_bytes', 0);
    this.gauges.set('active_watchers_count', 0);
    this.gauges.set('discovered_nodes_count', 0);
    this.gauges.set('discovered_pods_count', 0);
    this.gauges.set('discovered_deployments_count', 0);
  }

  public increment(counterName: string, delta = 1): void {
    const current = this.counters.get(counterName) || 0;
    this.counters.set(counterName, current + delta);
  }

  public getCounter(counterName: string): number {
    return this.counters.get(counterName) || 0;
  }

  public setGauge(gaugeName: string, value: number): void {
    this.gauges.set(gaugeName, value);
  }

  public getGauge(gaugeName: string): number {
    return this.gauges.get(gaugeName) || 0;
  }

  public getSnapshot(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    timestamp: string;
  } {
    return {
      counters: Object.fromEntries(this.counters.entries()),
      gauges: Object.fromEntries(this.gauges.entries()),
      timestamp: new Date().toISOString(),
    };
  }
}
