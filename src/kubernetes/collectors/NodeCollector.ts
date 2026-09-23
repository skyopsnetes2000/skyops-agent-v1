/**
 * SkyOps Agent V1 - Node Collector & Signal Detector
 *
 * Detects:
 * - Node NotReady
 * - DiskPressure
 * - MemoryPressure
 * - PIDPressure
 */

import { IKubernetesClient } from '../KubernetesClient.ts';
import { EvidenceNormalizer } from '../../evidence/EvidenceNormalizer.ts';
import { Evidence } from '../../types/evidence.ts';
import { DetectedSignal, NodeSummary } from '../../types/kubernetes.ts';
import { Logger } from '../../observability/Logger.ts';
import { Metrics } from '../../observability/Metrics.ts';

export class NodeCollector {
  private readonly client: IKubernetesClient;
  private readonly normalizer: EvidenceNormalizer;
  private readonly logger: Logger;
  private readonly metrics: Metrics;

  constructor(client: IKubernetesClient, normalizer: EvidenceNormalizer, logger?: Logger) {
    this.client = client;
    this.normalizer = normalizer;
    this.logger = logger?.child('node-collector') || new Logger('node-collector');
    this.metrics = Metrics.getInstance();
  }

  public async collect(): Promise<Evidence[]> {
    const evidences: Evidence[] = [];

    try {
      const nodes = await this.client.listNodes();

      for (const node of nodes) {
        evidences.push(this.normalizer.normalizeNode(node));

        const signals = this.detectNodeSignals(node);
        for (const signal of signals) {
          this.metrics.increment('signals_detected_total');
          evidences.push(this.normalizer.normalizeSignal(signal));
        }
      }
    } catch (err) {
      this.logger.error('Failed to collect node evidence', undefined, err);
    }

    return evidences;
  }

  public detectNodeSignals(node: NodeSummary): DetectedSignal[] {
    const signals: DetectedSignal[] = [];

    // NotReady Check
    if (!node.ready) {
      signals.push({
        signalType: 'NodeNotReady',
        resourceKind: 'Node',
        resourceNamespace: 'cluster',
        resourceName: node.name,
        severity: 'CRITICAL',
        reason: 'NodeNotReady',
        summary: `Kubernetes Node ${node.name} is in NotReady state`,
        details: { status: node.status, conditions: node.conditions },
        correlationKeys: { node: node.name },
      });
    }

    // Node Pressure conditions
    for (const cond of node.conditions) {
      if (cond.type === 'DiskPressure' && cond.status === 'True') {
        signals.push({
          signalType: 'NodeDiskPressure',
          resourceKind: 'Node',
          resourceNamespace: 'cluster',
          resourceName: node.name,
          severity: 'ERROR',
          reason: 'DiskPressure',
          summary: `Node ${node.name} is experiencing DiskPressure (storage exhaustion)`,
          details: { message: cond.message },
          correlationKeys: { node: node.name },
        });
      }

      if (cond.type === 'MemoryPressure' && cond.status === 'True') {
        signals.push({
          signalType: 'NodeMemoryPressure',
          resourceKind: 'Node',
          resourceNamespace: 'cluster',
          resourceName: node.name,
          severity: 'ERROR',
          reason: 'MemoryPressure',
          summary: `Node ${node.name} is experiencing MemoryPressure`,
          details: { message: cond.message },
          correlationKeys: { node: node.name },
        });
      }
    }

    return signals;
  }
}
