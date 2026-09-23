import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { EvidenceBuilder } from '../src/evidence/Evidence.ts';
import { EvidenceNormalizer } from '../src/evidence/EvidenceNormalizer.ts';
import { EvidenceStore } from '../src/evidence/EvidenceStore.ts';
import { EventSummary } from '../src/types/kubernetes.ts';

describe('Evidence & Normalization Engine', () => {
  test('EvidenceBuilder constructs valid normalized evidence with deterministic fingerprint', () => {
    const ev = EvidenceBuilder.create()
      .setEnvironment('env-prod', 'agent-001')
      .setSource('kubernetes')
      .setResource('k8s:default:pod/my-pod', 'pod')
      .setType('POD_FAILURE', 'SIGNAL', 'CRITICAL')
      .setObservation({
        summary: 'Container crashed with exit code 137',
        reason: 'OOMKilled',
      })
      .setCorrelationKeys({
        pod: 'my-pod',
        namespace: 'default',
      })
      .build();

    assert.ok(ev.evidenceId.startsWith('ev-'));
    assert.strictEqual(ev.environmentId, 'env-prod');
    assert.strictEqual(ev.agentId, 'agent-001');
    assert.strictEqual(ev.evidenceType, 'POD_FAILURE');
    assert.strictEqual(ev.kind, 'SIGNAL');
    assert.strictEqual(ev.severity, 'CRITICAL');
    assert.ok(ev.metadata.fingerprint.length > 0);
  });

  test('EvidenceNormalizer maps Kubernetes warning events to SIGNAL evidence', () => {
    const normalizer = new EvidenceNormalizer('env-test', 'agent-test', 'cluster-alpha');

    const warningEvent: EventSummary = {
      uid: 'evt-1234',
      namespace: 'production',
      name: 'auth-svc-pod.1726a',
      type: 'Warning',
      reason: 'FailedMount',
      message: 'MountVolume.SetUp failed for volume "secret-token": secret "auth-secret" not found',
      involvedObject: {
        kind: 'Pod',
        namespace: 'production',
        name: 'auth-svc-pod',
      },
      count: 3,
      lastTimestamp: new Date().toISOString(),
    };

    const ev = normalizer.normalizeEvent(warningEvent);
    assert.strictEqual(ev.kind, 'SIGNAL');
    assert.strictEqual(ev.severity, 'WARN');
    assert.strictEqual(ev.evidenceType, 'KUBERNETES_EVENT');
    assert.strictEqual(ev.resourceId, 'k8s:production:pod/auth-svc-pod');
    assert.strictEqual(ev.correlationKeys.clusterName, 'cluster-alpha');
    assert.strictEqual(ev.correlationKeys.namespace, 'production');
    assert.strictEqual(ev.correlationKeys.pod, 'auth-svc-pod');
  });

  test('EvidenceStore deduplicates identical signals within time window', () => {
    const store = new EvidenceStore(100, 5000); // 5 second dedup window

    const ev1 = EvidenceBuilder.create()
      .setEnvironment('env-1', 'ag-1')
      .setResource('k8s:default:pod/p1', 'pod')
      .setType('POD_FAILURE', 'SIGNAL', 'ERROR')
      .setObservation({ summary: 'Pod CrashLoopBackOff', reason: 'CrashLoopBackOff' })
      .build();

    const ev2 = EvidenceBuilder.create()
      .setEnvironment('env-1', 'ag-1')
      .setResource('k8s:default:pod/p1', 'pod')
      .setType('POD_FAILURE', 'SIGNAL', 'ERROR')
      .setObservation({ summary: 'Pod CrashLoopBackOff', reason: 'CrashLoopBackOff' })
      .build();

    const added1 = store.add(ev1);
    const added2 = store.add(ev2); // Should be deduplicated

    assert.strictEqual(added1, true);
    assert.strictEqual(added2, false, 'Duplicate fingerprint within window must be deduplicated');
    assert.strictEqual(store.size(), 1);
  });
});
