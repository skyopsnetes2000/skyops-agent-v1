/**
 * SkyOps Agent V1 - Pod Collector & Signal Detector
 *
 * Deterministically detects Kubernetes pod failure signals:
 * - CrashLoopBackOff
 * - OOMKilled (Exit code 137 or reason OOMKilled)
 * - ImagePullBackOff / ErrImagePull
 * - Stalled Pending Pods
 * - Failed Pods
 * - Container termination anomalies
 */

import { IKubernetesClient } from '../KubernetesClient.ts';
import { EvidenceNormalizer } from '../../evidence/EvidenceNormalizer.ts';
import { Evidence } from '../../types/evidence.ts';
import { DetectedSignal, PodSummary } from '../../types/kubernetes.ts';
import { Logger } from '../../observability/Logger.ts';
import { Metrics } from '../../observability/Metrics.ts';

export class PodCollector {
  private readonly client: IKubernetesClient;
  private readonly normalizer: EvidenceNormalizer;
  private readonly logger: Logger;
  private readonly metrics: Metrics;

  constructor(client: IKubernetesClient, normalizer: EvidenceNormalizer, logger?: Logger) {
    this.client = client;
    this.normalizer = normalizer;
    this.logger = logger?.child('pod-collector') || new Logger('pod-collector');
    this.metrics = Metrics.getInstance();
  }

  public async collect(namespace?: string): Promise<Evidence[]> {
    const evidences: Evidence[] = [];

    try {
      const pods = await this.client.listPods(namespace);

      for (const pod of pods) {
        // 1. Always generate base observation
        evidences.push(this.normalizer.normalizePod(pod));

        // 2. Detect abnormal signals
        const signals = this.detectPodSignals(pod);
        for (const signal of signals) {
          this.metrics.increment('signals_detected_total');
          evidences.push(this.normalizer.normalizeSignal(signal));
        }
      }
    } catch (err) {
      this.logger.error('Failed to collect pod evidence', undefined, err);
    }

    return evidences;
  }

  public detectPodSignals(pod: PodSummary): DetectedSignal[] {
    const signals: DetectedSignal[] = [];

    // Pod Phase checks
    if (pod.phase === 'Failed') {
      signals.push({
        signalType: 'FailedPod',
        resourceKind: 'Pod',
        resourceNamespace: pod.namespace,
        resourceName: pod.name,
        severity: 'ERROR',
        reason: 'PodFailed',
        summary: `Pod ${pod.name} in namespace ${pod.namespace} has entered Failed phase`,
        details: { restartCount: pod.restartCount, phase: pod.phase },
        correlationKeys: { pod: pod.name, node: pod.nodeName || '' },
      });
    }

    // Pending Pod check (stalled pending)
    if (pod.phase === 'Pending') {
      const createdMs = new Date(pod.createdAt).getTime();
      const ageMinutes = (Date.now() - createdMs) / 60000;

      if (ageMinutes > 5) {
        signals.push({
          signalType: 'StalledPendingPod',
          resourceKind: 'Pod',
          resourceNamespace: pod.namespace,
          resourceName: pod.name,
          severity: 'WARN',
          reason: 'PodPendingExceededThreshold',
          summary: `Pod ${pod.name} has been stuck in Pending phase for ${ageMinutes.toFixed(1)} minutes`,
          details: { ageMinutes, phase: pod.phase },
          correlationKeys: { pod: pod.name, node: pod.nodeName || '' },
        });
      }
    }

    // Container Status checks
    for (const container of pod.containers) {
      // 1. CrashLoopBackOff detection
      if (container.reason === 'CrashLoopBackOff' || (container.state === 'waiting' && container.reason?.includes('CrashLoop'))) {
        signals.push({
          signalType: 'CrashLoopBackOff',
          resourceKind: 'Pod',
          resourceNamespace: pod.namespace,
          resourceName: pod.name,
          severity: 'CRITICAL',
          reason: 'CrashLoopBackOff',
          summary: `Container ${container.name} in pod ${pod.name} is in CrashLoopBackOff (Restart count: ${container.restartCount})`,
          details: {
            container: container.name,
            image: container.image,
            restartCount: container.restartCount,
            exitCode: container.exitCode,
            message: container.message,
          },
          correlationKeys: {
            pod: pod.name,
            container: container.name,
            image: container.image,
            node: pod.nodeName || '',
          },
        });
      }

      // 2. OOMKilled detection
      if (container.reason === 'OOMKilled' || container.exitCode === 137) {
        signals.push({
          signalType: 'OOMKilled',
          resourceKind: 'Pod',
          resourceNamespace: pod.namespace,
          resourceName: pod.name,
          severity: 'CRITICAL',
          reason: 'OOMKilled',
          summary: `Container ${container.name} in pod ${pod.name} was terminated by Linux kernel OOMKiller (Exit code 137)`,
          details: {
            container: container.name,
            image: container.image,
            exitCode: 137,
            restartCount: container.restartCount,
          },
          correlationKeys: {
            pod: pod.name,
            container: container.name,
            image: container.image,
            node: pod.nodeName || '',
          },
        });
      }

      // 3. ImagePullBackOff / ErrImagePull detection
      if (container.reason === 'ImagePullBackOff' || container.reason === 'ErrImagePull') {
        signals.push({
          signalType: 'ImagePullFailure',
          resourceKind: 'Pod',
          resourceNamespace: pod.namespace,
          resourceName: pod.name,
          severity: 'ERROR',
          reason: container.reason,
          summary: `Container ${container.name} failed to pull image "${container.image}": ${container.message || 'Manifest or auth error'}`,
          details: {
            container: container.name,
            image: container.image,
            reason: container.reason,
            message: container.message,
          },
          correlationKeys: {
            pod: pod.name,
            container: container.name,
            image: container.image,
          },
        });
      }
    }

    return signals;
  }
}
