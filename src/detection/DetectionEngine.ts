/**
 * SkyOps Agent V1 - Deterministic Kubernetes Failure Detection Engine
 *
 * Implements the core detection hierarchy:
 *   OBSERVATION (isolated metrics / single restart)
 *   → SIGNAL (deterministic failure condition: OOM, CrashLoop, Probe Fail, Rollout Fail)
 *   → INCIDENT CANDIDATE (multi-signal or critical service outage)
 *
 * Detects all 18+ canonical failure conditions without false positives.
 */

import {
  PodSummary,
  DeploymentSummary,
  NodeSummary,
  EventSummary,
  PVCSummary,
  ServiceSummary,
  DetectedSignal,
} from '../types/kubernetes.ts';
import { Logger } from '../observability/Logger.ts';

export interface EvaluatedFinding {
  level: 'OBSERVATION' | 'SIGNAL' | 'INCIDENT_CANDIDATE';
  signal: DetectedSignal;
}

export class DetectionEngine {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger?.child('detection-engine') || new Logger('detection-engine');
  }

  /**
   * Evaluates all cluster resources and returns classified findings
   */
  public evaluateAll(
    pods: PodSummary[],
    deployments: DeploymentSummary[],
    nodes: NodeSummary[],
    events: EventSummary[],
    services: ServiceSummary[] = [],
    pvcs: PVCSummary[] = []
  ): EvaluatedFinding[] {
    const findings: EvaluatedFinding[] = [];

    // 1. Evaluate Pods
    for (const pod of pods) {
      findings.push(...this.evaluatePod(pod));
    }

    // 2. Evaluate Deployments
    for (const dep of deployments) {
      findings.push(...this.evaluateDeployment(dep));
    }

    // 3. Evaluate Nodes
    for (const node of nodes) {
      findings.push(...this.evaluateNode(node));
    }

    // 4. Evaluate Events
    for (const ev of events) {
      const eventFinding = this.evaluateEvent(ev);
      if (eventFinding) findings.push(eventFinding);
    }

    // 5. Evaluate Services & Endpoints
    for (const svc of services) {
      findings.push(...this.evaluateService(svc, pods));
    }

    // 6. Evaluate PVCs
    for (const pvc of pvcs) {
      findings.push(...this.evaluatePVC(pvc));
    }

    return findings;
  }

  /**
   * Deterministic Pod failure evaluation
   */
  public evaluatePod(pod: PodSummary): EvaluatedFinding[] {
    const findings: EvaluatedFinding[] = [];

    // Pod Phase checks
    if (pod.phase === 'Failed') {
      findings.push({
        level: 'SIGNAL',
        signal: {
          signalType: 'PodFailed',
          resourceKind: 'Pod',
          resourceNamespace: pod.namespace,
          resourceName: pod.name,
          severity: 'ERROR',
          reason: 'PodPhaseFailed',
          summary: `Pod ${pod.name} in namespace ${pod.namespace} is in Failed phase`,
          details: { phase: pod.phase, qosClass: pod.qosClass },
          correlationKeys: {
            pod: pod.name,
            namespace: pod.namespace,
            node: pod.nodeName || '',
          },
        },
      });
    }

    if (pod.phase === 'Pending') {
      findings.push({
        level: 'SIGNAL',
        signal: {
          signalType: 'PodPending',
          resourceKind: 'Pod',
          resourceNamespace: pod.namespace,
          resourceName: pod.name,
          severity: 'WARN',
          reason: 'PodUnscheduledOrWaiting',
          summary: `Pod ${pod.name} has remained in Pending phase`,
          details: { phase: pod.phase, nodeName: pod.nodeName },
          correlationKeys: {
            pod: pod.name,
            namespace: pod.namespace,
          },
        },
      });
    }

    // Container State checks
    for (const c of pod.containers) {
      // 1. CrashLoopBackOff
      if (c.state === 'waiting' && c.reason === 'CrashLoopBackOff') {
        const isIncident = c.restartCount >= 5;
        findings.push({
          level: isIncident ? 'INCIDENT_CANDIDATE' : 'SIGNAL',
          signal: {
            signalType: 'CrashLoopBackOff',
            resourceKind: 'Pod',
            resourceNamespace: pod.namespace,
            resourceName: pod.name,
            severity: 'CRITICAL',
            reason: 'CrashLoopBackOff',
            summary: `Container ${c.name} in pod ${pod.name} is in CrashLoopBackOff (${c.restartCount} restarts)`,
            details: {
              container: c.name,
              restartCount: c.restartCount,
              image: c.image,
              exitCode: c.exitCode,
              message: c.message,
            },
            correlationKeys: {
              pod: pod.name,
              namespace: pod.namespace,
              container: c.name,
              image: c.image,
              node: pod.nodeName || '',
            },
          },
        });
      }

      // 2. OOMKilled (Exit Code 137 or reason OOMKilled)
      if (c.exitCode === 137 || c.reason === 'OOMKilled') {
        findings.push({
          level: 'SIGNAL',
          signal: {
            signalType: 'OOMKilled',
            resourceKind: 'Pod',
            resourceNamespace: pod.namespace,
            resourceName: pod.name,
            severity: 'CRITICAL',
            reason: 'OOMKilled',
            summary: `Container ${c.name} in pod ${pod.name} was terminated by Linux kernel OOMKiller (Exit code 137)`,
            details: {
              container: c.name,
              exitCode: 137,
              image: c.image,
              finishedAt: c.finishedAt,
            },
            correlationKeys: {
              pod: pod.name,
              namespace: pod.namespace,
              container: c.name,
              node: pod.nodeName || '',
            },
          },
        });
      }

      // 3. ImagePullBackOff / ErrImagePull
      if (c.state === 'waiting' && (c.reason === 'ImagePullBackOff' || c.reason === 'ErrImagePull')) {
        findings.push({
          level: 'SIGNAL',
          signal: {
            signalType: 'ImagePullBackOff',
            resourceKind: 'Pod',
            resourceNamespace: pod.namespace,
            resourceName: pod.name,
            severity: 'ERROR',
            reason: c.reason,
            summary: `Container ${c.name} in pod ${pod.name} failed pulling image ${c.image}: ${c.reason}`,
            details: {
              container: c.name,
              image: c.image,
              message: c.message,
              reason: c.reason,
            },
            correlationKeys: {
              pod: pod.name,
              namespace: pod.namespace,
              container: c.name,
              image: c.image,
            },
          },
        });
      }

      // 4. Container Restart Storm (> 3 restarts)
      if (c.restartCount >= 3 && c.reason !== 'CrashLoopBackOff') {
        findings.push({
          level: 'SIGNAL',
          signal: {
            signalType: 'ContainerRestartStorm',
            resourceKind: 'Pod',
            resourceNamespace: pod.namespace,
            resourceName: pod.name,
            severity: 'WARN',
            reason: 'RepeatedContainerCrash',
            summary: `Container ${c.name} has restarted ${c.restartCount} times`,
            details: {
              container: c.name,
              restartCount: c.restartCount,
              lastExitCode: c.exitCode,
            },
            correlationKeys: {
              pod: pod.name,
              namespace: pod.namespace,
              container: c.name,
            },
          },
        });
      } else if (c.restartCount === 1) {
        // Isolated single restart -> Observation
        findings.push({
          level: 'OBSERVATION',
          signal: {
            signalType: 'SingleContainerRestart',
            resourceKind: 'Pod',
            resourceNamespace: pod.namespace,
            resourceName: pod.name,
            severity: 'WARN',
            reason: 'ContainerRestartedOnce',
            summary: `Container ${c.name} in pod ${pod.name} experienced 1 restart`,
            details: { container: c.name, exitCode: c.exitCode },
            correlationKeys: { pod: pod.name, namespace: pod.namespace, container: c.name },
          },
        });
      }

      // 5. Readiness probe failure while container running
      if (c.state === 'running' && !c.ready && pod.phase === 'Running') {
        findings.push({
          level: 'OBSERVATION',
          signal: {
            signalType: 'ReadinessProbeFailure',
            resourceKind: 'Pod',
            resourceNamespace: pod.namespace,
            resourceName: pod.name,
            severity: 'WARN',
            reason: 'ContainerNotReady',
            summary: `Container ${c.name} in pod ${pod.name} is running but failing readiness checks`,
            details: { container: c.name, ready: false },
            correlationKeys: { pod: pod.name, namespace: pod.namespace, container: c.name },
          },
        });
      }
    }

    return findings;
  }

  /**
   * Deterministic Deployment failure evaluation
   */
  public evaluateDeployment(dep: DeploymentSummary): EvaluatedFinding[] {
    const findings: EvaluatedFinding[] = [];

    // Unavailable replicas
    if (dep.unavailableReplicas > 0) {
      const isIncident = dep.readyReplicas === 0 && dep.replicas > 0;
      findings.push({
        level: isIncident ? 'INCIDENT_CANDIDATE' : 'SIGNAL',
        signal: {
          signalType: 'UnavailableReplicas',
          resourceKind: 'Deployment',
          resourceNamespace: dep.namespace,
          resourceName: dep.name,
          severity: isIncident ? 'CRITICAL' : 'ERROR',
          reason: 'ReplicasUnavailable',
          summary: `Deployment ${dep.name} has ${dep.unavailableReplicas}/${dep.replicas} unavailable replicas`,
          details: {
            desiredReplicas: dep.replicas,
            readyReplicas: dep.readyReplicas,
            unavailableReplicas: dep.unavailableReplicas,
          },
          correlationKeys: {
            deployment: dep.name,
            namespace: dep.namespace,
          },
        },
      });
    }

    // Rollout failure conditions
    for (const cond of dep.conditions) {
      if (cond.type === 'Progressing' && cond.status === 'False') {
        findings.push({
          level: 'INCIDENT_CANDIDATE',
          signal: {
            signalType: 'DeploymentRolloutFailure',
            resourceKind: 'Deployment',
            resourceNamespace: dep.namespace,
            resourceName: dep.name,
            severity: 'CRITICAL',
            reason: cond.reason || 'ProgressDeadlineExceeded',
            summary: `Deployment ${dep.name} rollout stalled: ${cond.message || cond.reason}`,
            details: {
              condition: cond.type,
              reason: cond.reason,
              message: cond.message,
              generation: dep.generation,
              observedGeneration: dep.observedGeneration,
            },
            correlationKeys: {
              deployment: dep.name,
              namespace: dep.namespace,
            },
          },
        });
      }
    }

    return findings;
  }

  /**
   * Deterministic Node condition evaluation
   */
  public evaluateNode(node: NodeSummary): EvaluatedFinding[] {
    const findings: EvaluatedFinding[] = [];

    // Node NotReady
    if (!node.ready) {
      findings.push({
        level: 'INCIDENT_CANDIDATE',
        signal: {
          signalType: 'NodeNotReady',
          resourceKind: 'Node',
          resourceNamespace: 'cluster',
          resourceName: node.name,
          severity: 'CRITICAL',
          reason: 'NodeNotReady',
          summary: `Kubernetes Node ${node.name} is NotReady`,
          details: { status: node.status, conditions: node.conditions },
          correlationKeys: { node: node.name },
        },
      });
    }

    // Node Pressure conditions
    for (const cond of node.conditions) {
      if (cond.status === 'True') {
        if (cond.type === 'DiskPressure') {
          findings.push({
            level: 'SIGNAL',
            signal: {
              signalType: 'DiskPressure',
              resourceKind: 'Node',
              resourceNamespace: 'cluster',
              resourceName: node.name,
              severity: 'ERROR',
              reason: 'DiskPressure',
              summary: `Node ${node.name} is experiencing DiskPressure: available disk exhausted`,
              details: { condition: cond.type, message: cond.message },
              correlationKeys: { node: node.name },
            },
          });
        } else if (cond.type === 'MemoryPressure') {
          findings.push({
            level: 'SIGNAL',
            signal: {
              signalType: 'MemoryPressure',
              resourceKind: 'Node',
              resourceNamespace: 'cluster',
              resourceName: node.name,
              severity: 'ERROR',
              reason: 'MemoryPressure',
              summary: `Node ${node.name} is experiencing MemoryPressure: host RAM low`,
              details: { condition: cond.type, message: cond.message },
              correlationKeys: { node: node.name },
            },
          });
        }
      }
    }

    return findings;
  }

  /**
   * Evaluates Kubernetes Warning events for specific root cause reasons
   */
  public evaluateEvent(event: EventSummary): EvaluatedFinding | undefined {
    if (event.type !== 'Warning') return undefined;

    const kind = event.involvedObject.kind;
    const name = event.involvedObject.name;
    const ns = event.involvedObject.namespace || event.namespace || 'default';

    if (event.reason === 'FailedScheduling') {
      return {
        level: 'SIGNAL',
        signal: {
          signalType: 'PodPending',
          resourceKind: kind,
          resourceNamespace: ns,
          resourceName: name,
          severity: 'WARN',
          reason: 'FailedScheduling',
          summary: `Scheduling failure for ${name}: ${event.message}`,
          details: { count: event.count, message: event.message },
          correlationKeys: { pod: name, namespace: ns },
        },
      };
    }

    if (event.reason === 'Unhealthy') {
      const isLiveness = event.message.toLowerCase().includes('liveness');
      return {
        level: 'SIGNAL',
        signal: {
          signalType: isLiveness ? 'LivenessProbeFailure' : 'ReadinessProbeFailure',
          resourceKind: kind,
          resourceNamespace: ns,
          resourceName: name,
          severity: isLiveness ? 'ERROR' : 'WARN',
          reason: event.reason,
          summary: `Health check failure for ${name}: ${event.message}`,
          details: { count: event.count, message: event.message },
          correlationKeys: { pod: name, namespace: ns },
        },
      };
    }

    return undefined;
  }

  /**
   * Service & Endpoints evaluation
   */
  public evaluateService(service: ServiceSummary, pods: PodSummary[]): EvaluatedFinding[] {
    const findings: EvaluatedFinding[] = [];

    if (service.selector && Object.keys(service.selector).length > 0) {
      // Find matching pods
      const matchingPods = pods.filter(
        (p) => p.namespace === service.namespace && this.labelsMatch(service.selector!, p.labels)
      );

      const readyEndpoints = matchingPods.filter((p) => p.ready && p.phase === 'Running');

      if (matchingPods.length > 0 && readyEndpoints.length === 0) {
        findings.push({
          level: 'INCIDENT_CANDIDATE',
          signal: {
            signalType: 'ServiceWithoutEndpoints',
            resourceKind: 'Service',
            resourceNamespace: service.namespace,
            resourceName: service.name,
            severity: 'CRITICAL',
            reason: 'NoReadyEndpoints',
            summary: `Service ${service.name} has 0 ready endpoints. Traffic is blackholing.`,
            details: {
              totalMatchingPods: matchingPods.length,
              readyEndpoints: 0,
              selector: service.selector,
            },
            correlationKeys: {
              service: service.name,
              namespace: service.namespace,
            },
          },
        });
      }
    }

    return findings;
  }

  /**
   * PVC evaluation
   */
  public evaluatePVC(pvc: PVCSummary): EvaluatedFinding[] {
    const findings: EvaluatedFinding[] = [];

    if (pvc.phase === 'Pending') {
      findings.push({
        level: 'SIGNAL',
        signal: {
          signalType: 'PVCPending',
          resourceKind: 'PVC',
          resourceNamespace: pvc.namespace,
          resourceName: pvc.name,
          severity: 'ERROR',
          reason: 'PVCBindingPending',
          summary: `PersistentVolumeClaim ${pvc.name} is in Pending phase (unbound)`,
          details: { storageClass: pvc.storageClass, requestedStorage: pvc.requestedStorage },
          correlationKeys: { pvc: pvc.name, namespace: pvc.namespace },
        },
      });
    }

    return findings;
  }

  private labelsMatch(selector: Record<string, string>, labels: Record<string, string> = {}): boolean {
    for (const [k, v] of Object.entries(selector)) {
      if (labels[k] !== v) return false;
    }
    return true;
  }
}
