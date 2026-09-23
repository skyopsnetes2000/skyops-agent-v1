/**
 * SkyOps Agent V1 - Cluster Discovery Engine
 *
 * Discovers full cluster topology snapshot on startup and periodically:
 * - Nodes, Namespaces, Deployments, Pods, Services, PVCs, Events
 * - Extracts normalized metadata without heavy polling
 */

import { IKubernetesClient } from '../KubernetesClient.ts';
import { DiscoverySnapshot } from '../../types/kubernetes.ts';
import { Logger } from '../../observability/Logger.ts';
import { Metrics } from '../../observability/Metrics.ts';

export class ClusterDiscovery {
  private readonly client: IKubernetesClient;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private lastSnapshot?: DiscoverySnapshot;

  constructor(client: IKubernetesClient, logger?: Logger) {
    this.client = client;
    this.logger = logger?.child('discovery') || new Logger('discovery');
    this.metrics = Metrics.getInstance();
  }

  public async discover(): Promise<DiscoverySnapshot> {
    this.logger.info('Starting full Kubernetes cluster topology discovery snapshot');
    const start = Date.now();

    try {
      const [clusterInfo, nodes, namespaces, pods, deployments, services, pvcs, recentEvents] =
        await Promise.all([
          this.client.getClusterInfo(),
          this.client.listNodes(),
          this.client.listNamespaces(),
          this.client.listPods(),
          this.client.listDeployments(),
          this.client.listServices(),
          this.client.listPersistentVolumeClaims(),
          this.client.listEvents(),
        ]);

      const snapshot: DiscoverySnapshot = {
        clusterInfo,
        nodes,
        namespaces,
        deployments,
        pods,
        services,
        pvcs,
        recentEvents,
        timestamp: new Date().toISOString(),
      };

      this.lastSnapshot = snapshot;

      // Update gauges
      this.metrics.setGauge('discovered_nodes_count', nodes.length);
      this.metrics.setGauge('discovered_pods_count', pods.length);
      this.metrics.setGauge('discovered_deployments_count', deployments.length);

      const durationMs = Date.now() - start;
      this.logger.info('Completed cluster discovery snapshot', {
        durationMs,
        nodes: nodes.length,
        namespaces: namespaces.length,
        pods: pods.length,
        deployments: deployments.length,
      });

      return snapshot;
    } catch (err) {
      this.logger.error('Failed to complete cluster discovery snapshot', undefined, err);
      throw err;
    }
  }

  public getLastSnapshot(): DiscoverySnapshot | undefined {
    return this.lastSnapshot;
  }
}
