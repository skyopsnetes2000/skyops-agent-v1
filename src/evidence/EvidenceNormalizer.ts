/**
 * SkyOps Agent V1 - Evidence Normalizer
 *
 * Normalizes raw Kubernetes resources and signals into structured Evidence.
 */

import { EvidenceBuilder } from './Evidence.ts';
import { Evidence } from '../types/evidence.ts';
import {
  PodSummary,
  DeploymentSummary,
  NodeSummary,
  EventSummary,
  DetectedSignal,
} from '../types/kubernetes.ts';

export class EvidenceNormalizer {
  private readonly environmentId: string;
  private readonly agentId: string;
  private readonly clusterName: string;

  constructor(environmentId: string, agentId: string, clusterName = 'k8s-cluster') {
    this.environmentId = environmentId;
    this.agentId = agentId;
    this.clusterName = clusterName;
  }

  /**
   * Normalizes a detected abnormal signal into SIGNAL Evidence
   */
  public normalizeSignal(signal: DetectedSignal): Evidence {
    const resourceId = `k8s:${signal.resourceNamespace || 'cluster'}:${signal.resourceKind.toLowerCase()}/${signal.resourceName}`;

    return EvidenceBuilder.create()
      .setEnvironment(this.environmentId, this.agentId)
      .setSource('kubernetes')
      .setResource(resourceId, signal.resourceKind.toLowerCase())
      .setType('SIGNAL_DETECTED', 'SIGNAL', signal.severity)
      .setObservation({
        summary: signal.summary,
        reason: signal.reason,
        details: signal.details,
      })
      .setCorrelationKeys({
        clusterName: this.clusterName,
        namespace: signal.resourceNamespace,
        ...signal.correlationKeys,
      })
      .setCollector('kubernetes-detector')
      .build();
  }

  /**
   * Normalizes a Kubernetes warning or normal Event
   */
  public normalizeEvent(event: EventSummary): Evidence {
    const kind = event.involvedObject.kind.toLowerCase();
    const ns = event.involvedObject.namespace || event.namespace || 'default';
    const name = event.involvedObject.name;
    const resourceId = `k8s:${ns}:${kind}/${name}`;

    const isWarning = event.type === 'Warning';
    const severity = isWarning ? 'WARN' : 'INFO';
    const evidenceKind = isWarning ? 'SIGNAL' : 'OBSERVATION';

    return EvidenceBuilder.create()
      .setEnvironment(this.environmentId, this.agentId)
      .setSource('kubernetes')
      .setResource(resourceId, kind)
      .setType('KUBERNETES_EVENT', evidenceKind, severity)
      .setObservation({
        summary: event.message,
        reason: event.reason,
        count: event.count,
        details: {
          eventUid: event.uid,
          sourceComponent: event.sourceComponent,
          firstTimestamp: event.firstTimestamp,
          lastTimestamp: event.lastTimestamp,
        },
      })
      .setCorrelationKeys({
        clusterName: this.clusterName,
        namespace: ns,
        [kind]: name,
      })
      .setCollector('kubernetes-event-collector')
      .build();
  }

  /**
   * Normalizes a Pod snapshot state
   */
  public normalizePod(pod: PodSummary): Evidence {
    const resourceId = `k8s:${pod.namespace}:pod/${pod.name}`;
    const severity = pod.phase === 'Failed' ? 'ERROR' : pod.phase === 'Pending' ? 'WARN' : 'INFO';

    return EvidenceBuilder.create()
      .setEnvironment(this.environmentId, this.agentId)
      .setSource('kubernetes')
      .setResource(resourceId, 'pod')
      .setType('RESOURCE_STATE', 'OBSERVATION', severity)
      .setObservation({
        summary: `Pod ${pod.name} in namespace ${pod.namespace} is ${pod.phase}`,
        reason: pod.phase,
        restartCount: pod.restartCount,
        details: {
          nodeName: pod.nodeName,
          qosClass: pod.qosClass,
          ready: pod.ready,
          containers: pod.containers.map((c) => ({
            name: c.name,
            state: c.state,
            reason: c.reason,
            ready: c.ready,
            restartCount: c.restartCount,
          })),
        },
      })
      .setLabelsAndAnnotations(pod.labels)
      .setCorrelationKeys({
        clusterName: this.clusterName,
        namespace: pod.namespace,
        pod: pod.name,
        node: pod.nodeName,
        deployment: pod.ownerKind === 'ReplicaSet' || pod.ownerKind === 'Deployment' ? pod.ownerName : undefined,
      })
      .setCollector('kubernetes-pod-collector')
      .build();
  }

  /**
   * Normalizes a Deployment state
   */
  public normalizeDeployment(deployment: DeploymentSummary): Evidence {
    const resourceId = `k8s:${deployment.namespace}:deployment/${deployment.name}`;
    const isDegraded = deployment.unavailableReplicas > 0 || deployment.readyReplicas < deployment.replicas;

    return EvidenceBuilder.create()
      .setEnvironment(this.environmentId, this.agentId)
      .setSource('kubernetes')
      .setResource(resourceId, 'deployment')
      .setType('DEPLOYMENT_CHANGE', isDegraded ? 'SIGNAL' : 'OBSERVATION', isDegraded ? 'WARN' : 'INFO')
      .setObservation({
        summary: `Deployment ${deployment.name}: ${deployment.readyReplicas}/${deployment.replicas} replicas ready`,
        reason: isDegraded ? 'ReplicaMismatch' : 'ReplicasReady',
        details: {
          replicas: deployment.replicas,
          readyReplicas: deployment.readyReplicas,
          availableReplicas: deployment.availableReplicas,
          unavailableReplicas: deployment.unavailableReplicas,
          images: deployment.images,
        },
      })
      .setLabelsAndAnnotations(deployment.labels)
      .setCorrelationKeys({
        clusterName: this.clusterName,
        namespace: deployment.namespace,
        deployment: deployment.name,
      })
      .setCollector('kubernetes-deployment-collector')
      .build();
  }

  /**
   * Normalizes a Node state
   */
  public normalizeNode(node: NodeSummary): Evidence {
    const resourceId = `k8s:cluster:node/${node.name}`;
    const severity = !node.ready ? 'ERROR' : 'INFO';

    return EvidenceBuilder.create()
      .setEnvironment(this.environmentId, this.agentId)
      .setSource('kubernetes')
      .setResource(resourceId, 'node')
      .setType('NODE_FAILURE', !node.ready ? 'SIGNAL' : 'OBSERVATION', severity)
      .setObservation({
        summary: `Node ${node.name} is ${node.ready ? 'Ready' : 'NotReady'}`,
        reason: node.status,
        details: {
          kubeletVersion: node.kubeletVersion,
          cpuCapacity: node.cpuCapacity,
          memoryCapacity: node.memoryCapacity,
          conditions: node.conditions,
        },
      })
      .setCorrelationKeys({
        clusterName: this.clusterName,
        node: node.name,
      })
      .setCollector('kubernetes-node-collector')
      .build();
  }
}
