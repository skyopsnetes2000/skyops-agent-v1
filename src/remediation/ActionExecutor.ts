/**
 * SkyOps Agent V1 - Safe Typed Remediation Executor & Authorization Gate
 *
 * Strictly enforces that NO arbitrary shell or unstructured commands can ever be run.
 * Only whitelisted, typed, Kubernetes operations are supported.
 * Validates expiration, approvals, and authorization before execution.
 */

import { KubernetesClient } from '../kubernetes/KubernetesClient.ts';
import { RemediationAction, RemediationActionResult } from '../types/investigation.ts';
import { Logger } from '../observability/Logger.ts';

export class ActionExecutor {
  private client: KubernetesClient;
  private logger: Logger;

  // Allowed typed actions
  private readonly allowedActions = new Set([
    'RestartPod',
    'RollbackDeployment',
    'ScaleDeployment',
    'RetryJob',
    'DeleteFailedPod',
    'RestartDeployment',
  ]);

  constructor(client: KubernetesClient, logger?: Logger) {
    this.client = client;
    this.logger = logger?.child('action-executor') || new Logger('action-executor');
  }

  /**
   * Validates authorization and integrity of a remediation request
   */
  public validateAction(action: RemediationAction): { valid: boolean; reason?: string } {
    // 1. Verify typed action whitelist
    if (!this.allowedActions.has(action.actionType)) {
      return {
        valid: false,
        reason: `Action type '${action.actionType}' is not permitted. Only typed safe operations are allowed.`,
      };
    }

    // 2. Check for required approval ID
    if (!action.approvalId || action.approvalId.trim().length === 0) {
      return { valid: false, reason: 'Action rejected: Missing explicit human or policy approvalId' };
    }

    // 3. Verify expiration window (prevent replay attacks or stale executions)
    const expiresAtMs = new Date(action.expiresAt).getTime();
    if (isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
      return { valid: false, reason: 'Action rejected: Approval timestamp has expired' };
    }

    // 4. Validate target resource coordinates
    if (!action.targetResource?.namespace || !action.targetResource?.name) {
      return { valid: false, reason: 'Action rejected: Missing targetResource namespace or name' };
    }

    return { valid: true };
  }

  /**
   * Executes a validated remediation action against the cluster
   */
  public async execute(action: RemediationAction): Promise<RemediationActionResult> {
    const executedAt = new Date().toISOString();
    const targetString = `${action.targetResource.namespace}/${action.targetResource.name}`;

    // Gatecheck validation
    const validation = this.validateAction(action);
    if (!validation.valid) {
      this.logger.warn(`Rejected unauthorized remediation action [${action.actionId}]`, {
        reason: validation.reason,
      });
      return {
        actionId: action.actionId,
        actionType: action.actionType,
        targetResource: targetString,
        executedAt,
        success: false,
        verificationStatus: 'NOT_VERIFIED',
        details: validation.reason || 'Authorization validation failed',
      };
    }

    this.logger.info(`Executing authorized action ${action.actionType} on ${targetString}`, {
      actionId: action.actionId,
      requestedBy: action.requestedBy,
      approvalId: action.approvalId,
    });

    let success = false;
    let details = '';

    try {
      switch (action.actionType) {
        case 'RestartPod':
        case 'DeleteFailedPod': {
          success = await this.client.restartPod(action.targetResource.namespace, action.targetResource.name);
          details = success
            ? `Successfully triggered restart of pod ${targetString}`
            : `API call failed while restarting pod ${targetString}`;
          break;
        }

        case 'RestartDeployment': {
          success = await this.client.restartDeployment(
            action.targetResource.namespace,
            action.targetResource.name
          );
          details = success
            ? `Successfully initiated rollout restart for deployment ${targetString}`
            : `API call failed while restarting deployment ${targetString}`;
          break;
        }

        case 'RollbackDeployment': {
          const toRevision = action.parameters?.toRevision as number | undefined;
          success = await this.client.rollbackDeployment(
            action.targetResource.namespace,
            action.targetResource.name,
            toRevision
          );
          details = success
            ? `Successfully rolled back deployment ${targetString}`
            : `API call failed rolling back deployment ${targetString}`;
          break;
        }

        case 'ScaleDeployment': {
          const replicas = Number(action.parameters?.replicas);
          if (isNaN(replicas) || replicas < 0 || replicas > 100) {
            success = false;
            details = `Invalid scale replicas parameter: ${action.parameters?.replicas}`;
          } else {
            success = await this.client.scaleDeployment(
              action.targetResource.namespace,
              action.targetResource.name,
              replicas
            );
            details = success
              ? `Successfully scaled deployment ${targetString} to ${replicas} replicas`
              : `API call failed while scaling deployment ${targetString}`;
          }
          break;
        }

        case 'RetryJob': {
          // Restarting pods in the job
          success = await this.client.restartPod(action.targetResource.namespace, action.targetResource.name);
          details = success ? `Triggered job pod retry for ${targetString}` : `Failed to retry job ${targetString}`;
          break;
        }

        default:
          success = false;
          details = `Unsupported action type: ${action.actionType}`;
      }
    } catch (err) {
      success = false;
      details = `Exception during execution: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error('Remediation execution encountered unhandled error', { actionId: action.actionId }, err);
    }

    return {
      actionId: action.actionId,
      actionType: action.actionType,
      targetResource: targetString,
      executedAt,
      success,
      verificationStatus: 'NOT_VERIFIED', // Will be verified by ActionVerifier
      details,
    };
  }
}
