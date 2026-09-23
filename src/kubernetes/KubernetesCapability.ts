/**
 * SkyOps Agent V1 - Kubernetes Capability Implementation
 *
 * Implements the standard Capability interface for Kubernetes:
 * - Cluster connection & discovery
 * - Resource and event collectors
 * - Real-time watchers
 * - Evidence generation and queuing
 */

import { Capability, CapabilityContext } from '../capabilities/Capability.ts';
import { ComponentHealth } from '../types/agent.ts';
import { KubernetesConfig } from '../config/AgentConfig.ts';
import { KubernetesClient, IKubernetesClient } from './KubernetesClient.ts';
import { ClusterDiscovery } from './discovery/ClusterDiscovery.ts';
import { PodCollector } from './collectors/PodCollector.ts';
import { DeploymentCollector } from './collectors/DeploymentCollector.ts';
import { NodeCollector } from './collectors/NodeCollector.ts';
import { EventCollector } from './collectors/EventCollector.ts';
import { PodWatcher } from './watchers/PodWatcher.ts';
import { EventWatcher } from './watchers/EventWatcher.ts';
import { EvidenceNormalizer } from '../evidence/EvidenceNormalizer.ts';
import { Logger } from '../observability/Logger.ts';

export class KubernetesCapability implements Capability {
  public readonly id = 'kubernetes';
  public readonly name = 'Kubernetes Operations & Discovery';
  public readonly version = '1.0.0';

  private readonly config: KubernetesConfig;
  private client?: IKubernetesClient;
  private discovery?: ClusterDiscovery;
  private normalizer?: EvidenceNormalizer;
  private podCollector?: PodCollector;
  private deploymentCollector?: DeploymentCollector;
  private nodeCollector?: NodeCollector;
  private eventCollector?: EventCollector;
  private podWatcher?: PodWatcher;
  private eventWatcher?: EventWatcher;

  private context?: CapabilityContext;
  private logger: Logger;
  private isRunning = false;
  private collectionTimer?: NodeJS.Timeout;
  private discoveryTimer?: NodeJS.Timeout;

  constructor(config: KubernetesConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger?.child('k8s-cap') || new Logger('k8s-cap');
  }

  public async initialize(context: CapabilityContext): Promise<void> {
    this.context = context;
    this.client = new KubernetesClient(this.config, this.logger);
    await this.client.initialize();

    this.normalizer = new EvidenceNormalizer(
      context.environmentId,
      context.agentId,
      this.config.clusterName
    );

    this.discovery = new ClusterDiscovery(this.client, this.logger);
    this.podCollector = new PodCollector(this.client, this.normalizer, this.logger);
    this.deploymentCollector = new DeploymentCollector(this.client, this.normalizer, this.logger);
    this.nodeCollector = new NodeCollector(this.client, this.normalizer, this.logger);
    this.eventCollector = new EventCollector(this.client, this.normalizer, this.logger);

    this.podWatcher = new PodWatcher(this.client, this.podCollector, context.queue, this.logger);
    this.eventWatcher = new EventWatcher(this.client, this.eventCollector, context.queue, this.logger);
  }

  public async discover(): Promise<unknown> {
    if (!this.discovery) {
      throw new Error('KubernetesCapability not initialized');
    }
    return await this.discovery.discover();
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Run initial discovery
    try {
      await this.discover();
    } catch (err) {
      this.logger.warn('Initial cluster discovery encountered error, proceeding to start watchers', undefined, err);
    }

    // 2. Start real-time watchers
    if (this.podWatcher) await this.podWatcher.start();
    if (this.eventWatcher) await this.eventWatcher.start();

    // 3. Start periodic background collection
    this.collectionTimer = setInterval(async () => {
      await this.runCollectionCycle();
    }, this.config.collectionIntervalSeconds * 1000);

    // 4. Start periodic background discovery
    this.discoveryTimer = setInterval(async () => {
      try {
        await this.discover();
      } catch (err) {
        this.logger.warn('Periodic discovery refresh failed', undefined, err);
      }
    }, this.config.discoveryIntervalSeconds * 1000);

    this.logger.info('Kubernetes capability started successfully');
  }

  public async runCollectionCycle(): Promise<void> {
    if (!this.context || !this.podCollector || !this.deploymentCollector || !this.nodeCollector) {
      return;
    }

    try {
      const [podEvidences, deployEvidences, nodeEvidences] = await Promise.all([
        this.podCollector.collect(this.config.namespace),
        this.deploymentCollector.collect(this.config.namespace),
        this.nodeCollector.collect(),
      ]);

      const allEvidences = [...podEvidences, ...deployEvidences, ...nodeEvidences];

      // Enqueue detected signals and high severity items
      for (const ev of allEvidences) {
        if (ev.kind === 'SIGNAL' || ev.severity === 'WARN' || ev.severity === 'ERROR' || ev.severity === 'CRITICAL') {
          await this.context.queue.enqueue(ev);
        }
      }
    } catch (err) {
      this.logger.warn('Error during Kubernetes collection cycle', undefined, err);
    }
  }

  public async stop(): Promise<void> {
    this.isRunning = false;

    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = undefined;
    }

    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }

    if (this.podWatcher) await this.podWatcher.stop();
    if (this.eventWatcher) await this.eventWatcher.stop();

    this.logger.info('Kubernetes capability stopped');
  }

  public health(): ComponentHealth {
    const isConnected = this.client?.isConnected() ?? false;

    return {
      name: 'kubernetes',
      status: isConnected && this.isRunning ? 'healthy' : isConnected ? 'degraded' : 'unhealthy',
      message: isConnected ? 'Connected to Kubernetes API' : 'Disconnected from Kubernetes API',
      lastCheckedAt: new Date().toISOString(),
      details: {
        clusterName: this.config.clusterName,
        running: this.isRunning,
        lastSnapshotTime: this.discovery?.getLastSnapshot()?.timestamp,
      },
    };
  }

  public getDiscoverySnapshot() {
    return this.discovery?.getLastSnapshot();
  }
}
