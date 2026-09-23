/**
 * SkyOps Agent V1 - Post-Remediation Verification Engine
 *
 * Implements the Observe -> Verify loop:
 * After an action executes, the verifier observes the cluster to confirm whether
 * the affected resource genuinely returned to a healthy state (e.g. pods Ready,
 * rollout succeeded, zero unavailable replicas) rather than just blindly trusting
 * the API execution return code.
 */

import { KubernetesClient } from '../kubernetes/KubernetesClient.ts';
import { RemediationAction, RemediationActionResult } from '../types/investigation.ts';
import { Logger } from '../observability/Logger.ts';

export class ActionVerifier {
  private client: KubernetesClient;
  private logger: Logger;

  constructor(client: KubernetesClient, logger?: Logger) {
    this.client = client;
    this.logger = logger?.child('action-verifier') || new Logger('action-verifier');
  }

  /**
   * Verifies the outcome of an action by inspecting post-execution Kubernetes state
   */
  public async verify(
    action: RemediationAction,
    executionResult: RemediationActionResult,
    maxWaitMs = 15000,
    pollIntervalMs = 2000
  ): Promise<RemediationActionResult> {
    if (!executionResult.success) {
      return {
        ...executionResult,
        verificationStatus: 'VERIFICATION_FAILED',
        details: `${executionResult.details} (Action failed before verification)`,
      };
    }

    const { kind, namespace, name } = action.targetResource;
    this.logger.info(`Starting post-remediation verification for ${kind} ${namespace}/${name}`, {
      actionId: action.actionId,
    });

    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < maxWaitMs) {
      attempts++;

      try {
        if (kind.toLowerCase() === 'deployment') {
          const deployments = await this.client.listDeployments(namespace);
          const dep = deployments.find((d) => d.name === name);

          if (dep) {
            // Check if deployment has healthy replicas and 0 unavailable
            const isHealthy =
              dep.readyReplicas >= dep.replicas &&
              dep.unavailableReplicas === 0 &&
              dep.observedGeneration >= dep.generation;

            if (isHealthy) {
              this.logger.info(`Verification passed: Deployment ${name} is fully healthy with ${dep.readyReplicas}/${dep.replicas} ready replicas`);
              return {
                ...executionResult,
                verificationStatus: 'VERIFIED_HEALTHY',
                verificationAttempts: attempts,
                details: `Verified: Deployment ${name} reached desired state (${dep.readyReplicas}/${dep.replicas} replicas ready).`,
              };
            }
          }
        } else if (kind.toLowerCase() === 'pod') {
          const pods = await this.client.listPods(namespace);
          const pod = pods.find((p) => p.name === name || p.name.startsWith(name));

          if (pod) {
            // If action was RestartPod, check if a healthy replacement pod is running & ready
            if (pod.ready && pod.phase === 'Running') {
              this.logger.info(`Verification passed: Pod ${pod.name} is running and ready`);
              return {
                ...executionResult,
                verificationStatus: 'VERIFIED_HEALTHY',
                verificationAttempts: attempts,
                details: `Verified: Pod ${pod.name} is running and ready.`,
              };
            }
          }
        }
      } catch (err) {
        this.logger.debug('Verification inspection check encountered transient error', undefined, err);
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    this.logger.warn(`Verification timed out after ${maxWaitMs}ms for ${kind} ${namespace}/${name}`);
    return {
      ...executionResult,
      verificationStatus: 'TIMED_OUT',
      verificationAttempts: attempts,
      details: `Verification timed out after ${maxWaitMs / 1000}s waiting for ${kind} ${namespace}/${name} to become ready.`,
    };
  }
}
