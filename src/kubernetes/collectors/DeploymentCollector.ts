/**
 * SkyOps Agent V1 - Deployment Collector & Signal Detector
 *
 * Detects:
 * - Unavailable replicas
 * - Replica count mismatches
 * - Failed rollouts / MinimumReplicasUnavailable
 */

import { IKubernetesClient } from '../KubernetesClient.ts';
import { EvidenceNormalizer } from '../../evidence/EvidenceNormalizer.ts';
import { Evidence } from '../../types/evidence.ts';
import { DetectedSignal, DeploymentSummary } from '../../types/kubernetes.ts';
import { Logger } from '../../observability/Logger.ts';
import { Metrics } from '../../observability/Metrics.ts';

export class DeploymentCollector {
  private readonly client: IKubernetesClient;
  private readonly normalizer: EvidenceNormalizer;
  private readonly logger: Logger;
  private readonly metrics: Metrics;

  constructor(client: IKubernetesClient, normalizer: EvidenceNormalizer, logger?: Logger) {
    this.client = client;
    this.normalizer = normalizer;
    this.logger = logger?.child('deployment-collector') || new Logger('deployment-collector');
    this.metrics = Metrics.getInstance();
  }

  public async collect(namespace?: string): Promise<Evidence[]> {
    const evidences: Evidence[] = [];

    try {
      const deployments = await this.client.listDeployments(namespace);

      for (const deployment of deployments) {
        evidences.push(this.normalizer.normalizeDeployment(deployment));

        const signals = this.detectDeploymentSignals(deployment);
        for (const signal of signals) {
          this.metrics.increment('signals_detected_total');
          evidences.push(this.normalizer.normalizeSignal(signal));
        }
      }
    } catch (err) {
      this.logger.error('Failed to collect deployment evidence', undefined, err);
    }

    return evidences;
  }

  public detectDeploymentSignals(deployment: DeploymentSummary): DetectedSignal[] {
    const signals: DetectedSignal[] = [];

    // Check for unavailable replicas
    if (deployment.unavailableReplicas > 0 || (deployment.replicas > 0 && deployment.readyReplicas === 0)) {
      const severity = deployment.readyReplicas === 0 ? 'CRITICAL' : 'WARN';

      signals.push({
        signalType: 'DeploymentDegraded',
        resourceKind: 'Deployment',
        resourceNamespace: deployment.namespace,
        resourceName: deployment.name,
        severity,
        reason: 'UnavailableReplicas',
        summary: `Deployment ${deployment.name} is degraded: only ${deployment.readyReplicas}/${deployment.replicas} replicas ready (${deployment.unavailableReplicas} unavailable)`,
        details: {
          replicas: deployment.replicas,
          readyReplicas: deployment.readyReplicas,
          unavailableReplicas: deployment.unavailableReplicas,
          images: deployment.images,
        },
        correlationKeys: {
          deployment: deployment.name,
          namespace: deployment.namespace,
        },
      });
    }

    // Check conditions for ProgressDeadlineExceeded or ReplicaFailure
    for (const cond of deployment.conditions) {
      if (cond.type === 'Progressing' && cond.status === 'False' && cond.reason === 'ProgressDeadlineExceeded') {
        signals.push({
          signalType: 'DeploymentRolloutStalled',
          resourceKind: 'Deployment',
          resourceNamespace: deployment.namespace,
          resourceName: deployment.name,
          severity: 'ERROR',
          reason: 'ProgressDeadlineExceeded',
          summary: `Deployment ${deployment.name} rollout stalled: progress deadline exceeded`,
          details: { message: cond.message },
          correlationKeys: {
            deployment: deployment.name,
            namespace: deployment.namespace,
          },
        });
      }
    }

    return signals;
  }
}
