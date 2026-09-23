import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { PodCollector } from '../src/kubernetes/collectors/PodCollector.ts';
import { DeploymentCollector } from '../src/kubernetes/collectors/DeploymentCollector.ts';
import { NodeCollector } from '../src/kubernetes/collectors/NodeCollector.ts';
import { EvidenceNormalizer } from '../src/evidence/EvidenceNormalizer.ts';
import { PodSummary, DeploymentSummary, NodeSummary } from '../src/types/kubernetes.ts';
import { IKubernetesClient } from '../src/kubernetes/KubernetesClient.ts';

// Dummy client for collector instantiation
const dummyClient = {} as IKubernetesClient;
const normalizer = new EvidenceNormalizer('test-env', 'test-agent', 'test-cluster');

describe('Signal Detection Engine', () => {
  test('detects CrashLoopBackOff in container status', () => {
    const collector = new PodCollector(dummyClient, normalizer);

    const pod: PodSummary = {
      namespace: 'production',
      name: 'api-service-abc123',
      uid: 'uid-1',
      phase: 'Running',
      ready: false,
      restartCount: 5,
      createdAt: new Date().toISOString(),
      labels: {},
      containers: [
        {
          name: 'api',
          image: 'myregistry.io/api:v1',
          ready: false,
          restartCount: 5,
          state: 'waiting',
          reason: 'CrashLoopBackOff',
          message: 'back-off 1m20s restarting failed container',
        },
      ],
    };

    const signals = collector.detectPodSignals(pod);
    assert.strictEqual(signals.length, 1);
    assert.strictEqual(signals[0].signalType, 'CrashLoopBackOff');
    assert.strictEqual(signals[0].severity, 'CRITICAL');
    assert.strictEqual(signals[0].correlationKeys.pod, 'api-service-abc123');
    assert.strictEqual(signals[0].correlationKeys.container, 'api');
  });

  test('detects OOMKilled from container exit code 137', () => {
    const collector = new PodCollector(dummyClient, normalizer);

    const pod: PodSummary = {
      namespace: 'production',
      name: 'worker-job-xyz',
      uid: 'uid-2',
      phase: 'Running',
      ready: false,
      restartCount: 3,
      createdAt: new Date().toISOString(),
      labels: {},
      containers: [
        {
          name: 'worker',
          image: 'myregistry.io/worker:v2',
          ready: false,
          restartCount: 3,
          state: 'terminated',
          reason: 'OOMKilled',
          exitCode: 137,
        },
      ],
    };

    const signals = collector.detectPodSignals(pod);
    const oomSignal = signals.find((s) => s.signalType === 'OOMKilled');
    assert.ok(oomSignal);
    assert.strictEqual(oomSignal.severity, 'CRITICAL');
    assert.strictEqual(oomSignal.details.exitCode, 137);
  });

  test('detects ImagePullBackOff / ErrImagePull', () => {
    const collector = new PodCollector(dummyClient, normalizer);

    const pod: PodSummary = {
      namespace: 'staging',
      name: 'web-front-456',
      uid: 'uid-3',
      phase: 'Pending',
      ready: false,
      restartCount: 0,
      createdAt: new Date().toISOString(),
      labels: {},
      containers: [
        {
          name: 'web',
          image: 'myregistry.io/web:v99-nonexistent',
          ready: false,
          restartCount: 0,
          state: 'waiting',
          reason: 'ImagePullBackOff',
          message: 'manifest for myregistry.io/web:v99-nonexistent not found',
        },
      ],
    };

    const signals = collector.detectPodSignals(pod);
    const imgSignal = signals.find((s) => s.signalType === 'ImagePullFailure');
    assert.ok(imgSignal);
    assert.strictEqual(imgSignal.severity, 'ERROR');
  });

  test('detects Deployment degraded condition when ready replicas are lower than desired', () => {
    const collector = new DeploymentCollector(dummyClient, normalizer);

    const deployment: DeploymentSummary = {
      namespace: 'production',
      name: 'checkout-service',
      uid: 'dep-uid-1',
      replicas: 5,
      readyReplicas: 2,
      updatedReplicas: 5,
      availableReplicas: 2,
      unavailableReplicas: 3,
      generation: 1,
      observedGeneration: 1,
      conditions: [],
      labels: {},
      images: ['myregistry.io/checkout:v4'],
    };

    const signals = collector.detectDeploymentSignals(deployment);
    assert.strictEqual(signals.length, 1);
    assert.strictEqual(signals[0].signalType, 'DeploymentDegraded');
    assert.strictEqual(signals[0].severity, 'WARN');
    assert.strictEqual(signals[0].details.unavailableReplicas, 3);
  });

  test('detects NodeNotReady and DiskPressure conditions', () => {
    const collector = new NodeCollector(dummyClient, normalizer);

    const node: NodeSummary = {
      name: 'node-pool-compute-1',
      ready: false,
      status: 'NotReady',
      kubeletVersion: 'v1.30.0',
      osImage: 'Linux',
      architecture: 'amd64',
      cpuCapacity: '8',
      memoryCapacity: '32Gi',
      conditions: [
        { type: 'Ready', status: 'False', reason: 'KubeletNotReady' },
        { type: 'DiskPressure', status: 'True', message: 'Disk space exhausted on /var/lib/docker' },
      ],
    };

    const signals = collector.detectNodeSignals(node);
    assert.strictEqual(signals.length, 2);

    const notReady = signals.find((s) => s.signalType === 'NodeNotReady');
    const diskPressure = signals.find((s) => s.signalType === 'NodeDiskPressure');

    assert.ok(notReady);
    assert.strictEqual(notReady.severity, 'CRITICAL');
    assert.ok(diskPressure);
    assert.strictEqual(diskPressure.severity, 'ERROR');
  });
});
