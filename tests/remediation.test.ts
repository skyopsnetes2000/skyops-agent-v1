import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActionExecutor } from '../src/remediation/ActionExecutor.ts';
import { ActionVerifier } from '../src/remediation/ActionVerifier.ts';
import { KubernetesClient } from '../src/kubernetes/KubernetesClient.ts';
import { RemediationAction } from '../src/types/investigation.ts';

describe('Remediation & Post-Action Verification Subsystem', () => {
  const mockClient = new KubernetesClient({
    clusterName: 'prod',
    inCluster: false,
    discoveryIntervalSeconds: 300,
    collectionIntervalSeconds: 15,
    reconnectIntervalSeconds: 10,
    maxPodLogLines: 500,
    mockMode: true,
  });

  const validAction: RemediationAction = {
    actionId: 'act-001',
    actionType: 'RestartPod',
    targetResource: {
      kind: 'Pod',
      namespace: 'production',
      name: 'payments-api-6b79f8-w7v9x',
    },
    parameters: {},
    requestedBy: 'skyops-incident-responder',
    approvalId: 'appr-9921b',
    expiresAt: new Date(Date.now() + 60000).toISOString(), // valid for 1 min
  };

  it('validates authorized typed actions', () => {
    const executor = new ActionExecutor(mockClient);
    const validation = executor.validateAction(validAction);
    assert.equal(validation.valid, true);
  });

  it('rejects unapproved or arbitrary actions', () => {
    const executor = new ActionExecutor(mockClient);

    // 1. Missing approvalId
    const noApproval = { ...validAction, approvalId: '' };
    assert.equal(executor.validateAction(noApproval).valid, false);

    // 2. Expired action
    const expired = { ...validAction, expiresAt: new Date(Date.now() - 5000).toISOString() };
    assert.equal(executor.validateAction(expired).valid, false);

    // 3. Arbitrary shell or non-whitelisted action
    const arbitrary = { ...validAction, actionType: 'ExecuteShellCommand' as any };
    assert.equal(executor.validateAction(arbitrary).valid, false);
  });

  it('executes typed safe RestartPod action', async () => {
    const executor = new ActionExecutor(mockClient);
    const result = await executor.execute(validAction);

    assert.equal(result.actionId, 'act-001');
    assert.equal(result.success, true);
    assert.ok(result.details.includes('Successfully triggered restart'));
  });

  it('executes typed ScaleDeployment action', async () => {
    const executor = new ActionExecutor(mockClient);
    const scaleAction: RemediationAction = {
      actionId: 'act-002',
      actionType: 'ScaleDeployment',
      targetResource: {
        kind: 'Deployment',
        namespace: 'production',
        name: 'payments-api',
      },
      parameters: { replicas: 5 },
      requestedBy: 'skyops-auto-scaler',
      approvalId: 'appr-auto-1',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    const result = await executor.execute(scaleAction);
    assert.equal(result.success, true);
    assert.ok(result.details.includes('scaled deployment'));
  });

  it('ActionVerifier inspects cluster and verifies post-remediation health', async () => {
    const verifier = new ActionVerifier(mockClient);

    const execResult = {
      actionId: 'act-003',
      actionType: 'RollbackDeployment' as const,
      targetResource: 'production/payments-api',
      executedAt: new Date().toISOString(),
      success: true,
      verificationStatus: 'NOT_VERIFIED' as const,
      details: 'Rolled back',
    };

    const action: RemediationAction = {
      actionId: 'act-003',
      actionType: 'RollbackDeployment',
      targetResource: {
        kind: 'Deployment',
        namespace: 'production',
        name: 'payments-api',
      },
      parameters: {},
      requestedBy: 'operator',
      approvalId: 'appr-123',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    // Client returns simulated deployment with readyReplicas
    const verified = await verifier.verify(action, execResult, 2000, 500);
    assert.ok(verified.verificationStatus === 'VERIFIED_HEALTHY' || verified.verificationStatus === 'TIMED_OUT');
  });
});
