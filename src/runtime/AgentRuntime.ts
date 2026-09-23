/**
 * SkyOps Agent V1 - Production Agent Runtime Engine
 *
 * Implements the complete agent lifecycle:
 * LOAD_CONFIG -> VALIDATE_CONFIG -> LOAD_IDENTITY -> REGISTER ->
 * INITIALIZE_CAPABILITIES -> CONNECT_K8S -> DISCOVER -> START_WATCHERS ->
 * START_COLLECTION -> START_HEARTBEAT -> RUN -> GRACEFUL_SHUTDOWN
 */

import { AgentConfig } from '../config/AgentConfig.ts';
import { ConfigLoader } from '../config/configLoader.ts';
import { AgentIdentityManager } from '../identity/AgentIdentity.ts';
import { RegistrationWorkflow } from '../identity/registration.ts';
import { TokenManager } from '../security/TokenManager.ts';
import { TLSConfig } from '../security/TLSConfig.ts';
import { TransportClient } from '../transport/TransportClient.ts';
import { RegistrationClient } from '../transport/RegistrationClient.ts';
import { HeartbeatClient } from '../transport/HeartbeatClient.ts';
import { EvidenceUploader } from '../transport/EvidenceUploader.ts';
import { Spool } from '../queue/Spool.ts';
import { PersistentQueue } from '../queue/PersistentQueue.ts';
import { CapabilityRegistry } from '../capabilities/CapabilityRegistry.ts';
import { CapabilityManager } from '../capabilities/CapabilityManager.ts';
import { KubernetesCapability } from '../kubernetes/KubernetesCapability.ts';
import { HealthRegistry } from './health.ts';
import { LifecycleTracker } from './lifecycle.ts';
import { Scheduler } from './scheduler.ts';
import { Logger } from '../observability/Logger.ts';
import { AgentHealth } from '../types/agent.ts';
import { HeartbeatPayload } from '../types/transport.ts';

export class AgentRuntime {
  private readonly config: AgentConfig;
  private readonly logger: Logger;
  private readonly lifecycle: LifecycleTracker;

  // Subsystems
  private identityManager!: AgentIdentityManager;
  private tokenManager!: TokenManager;
  private tlsConfig!: TLSConfig;
  private transportClient!: TransportClient;
  private registrationClient!: RegistrationClient;
  private heartbeatClient!: HeartbeatClient;
  private spool!: Spool;
  private queue!: PersistentQueue;
  private uploader!: EvidenceUploader;
  private capabilityRegistry!: CapabilityRegistry;
  private capabilityManager!: CapabilityManager;
  private k8sCapability!: KubernetesCapability;
  private healthRegistry!: HealthRegistry;
  private scheduler!: Scheduler;

  private isRunning = false;

  constructor(customConfig?: AgentConfig) {
    this.config = customConfig || ConfigLoader.loadFromEnv();
    this.logger = new Logger('runtime', this.config.logLevel);
    this.lifecycle = new LifecycleTracker();
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('AgentRuntime already running');
      return;
    }

    this.logger.info('Starting SkyOps Agent V1', {
      version: this.config.agentVersion,
      environmentId: this.config.environmentId,
      organizationId: this.config.organizationId,
    });

    this.lifecycle.transitionTo('INITIALIZING');

    // 1. Validate configuration
    const validation = ConfigLoader.validate(this.config);
    if (!validation.valid) {
      this.logger.error('Configuration validation failed', { errors: validation.errors });
      this.lifecycle.transitionTo('FAILED');
      throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
    }

    for (const warning of validation.warnings) {
      this.logger.warn(`Config warning: ${warning}`);
    }

    this.lifecycle.transitionTo('CONFIG_LOADED');

    // 2. Security & Credentials
    this.tokenManager = new TokenManager(this.config.transport.agentToken);
    this.tlsConfig = new TLSConfig({
      caCertPath: this.config.transport.caCertPath,
      rejectUnauthorized: this.config.transport.rejectUnauthorized,
      timeoutMs: this.config.transport.timeoutMs,
    });

    // 3. Establish Stable Agent Identity
    this.identityManager = new AgentIdentityManager(
      this.config.queue.spoolDirectory,
      {
        organizationId: this.config.organizationId,
        environmentId: this.config.environmentId,
        agentVersion: this.config.agentVersion,
        clusterName: this.config.kubernetes.clusterName,
        agentId: this.config.agentId,
        installationId: this.config.installationId,
      },
      this.logger
    );

    const identity = this.identityManager.getIdentity();
    this.logger.setAgentId(identity.agentId);
    this.lifecycle.transitionTo('IDENTITY_ESTABLISHED');

    // 4. Initialize Health Registry
    this.healthRegistry = new HealthRegistry(
      identity.agentId,
      identity.environmentId,
      this.config.agentVersion
    );
    this.healthRegistry.registerComponent('runtime', 'healthy', 'Runtime initialized');
    this.healthRegistry.registerComponent('queue', 'healthy', 'Queue initialized');
    this.healthRegistry.registerComponent('transport', 'healthy', 'Transport initialized');

    // 5. Initialize Storage & Durable Queue
    this.spool = new Spool(
      this.config.queue.spoolDirectory,
      this.config.queue.maxDiskBytes,
      this.logger
    );
    this.queue = new PersistentQueue(
      this.spool,
      this.config.queue.maxMemoryItems,
      undefined,
      this.logger
    );
    await this.queue.initialize();

    // 6. Initialize Transport
    this.transportClient = new TransportClient({
      apiUrl: this.config.transport.apiUrl,
      tokenManager: this.tokenManager,
      tlsConfig: this.tlsConfig,
      timeoutMs: this.config.transport.timeoutMs,
      logger: this.logger,
    });

    this.registrationClient = new RegistrationClient(this.transportClient);
    this.heartbeatClient = new HeartbeatClient(this.transportClient, this.logger);

    this.uploader = new EvidenceUploader({
      agentId: identity.agentId,
      environmentId: identity.environmentId,
      transport: this.transportClient,
      queue: this.queue,
      batchSize: this.config.transport.batchSize,
      uploadIntervalMs: this.config.transport.uploadIntervalMs,
      logger: this.logger,
    });

    // 7. Initialize Capabilities
    this.capabilityRegistry = new CapabilityRegistry();
    this.k8sCapability = new KubernetesCapability(this.config.kubernetes, this.logger);
    this.capabilityRegistry.register(this.k8sCapability);

    this.capabilityManager = new CapabilityManager(this.capabilityRegistry, this.logger);
    await this.capabilityManager.initializeAll({
      agentId: identity.agentId,
      environmentId: identity.environmentId,
      organizationId: identity.organizationId,
      queue: this.queue,
      logger: this.logger,
    });

    this.lifecycle.transitionTo('CAPABILITIES_READY');

    // 8. Register with Cloud (graceful fallback to autonomous offline mode)
    const registrationWorkflow = new RegistrationWorkflow(
      this.identityManager,
      this.registrationClient,
      this.logger
    );
    await registrationWorkflow.register(this.capabilityRegistry.getIds());
    this.lifecycle.transitionTo('REGISTERED');

    // 9. Start Capabilities (Discovery & Watchers)
    await this.capabilityManager.startAll();
    this.lifecycle.transitionTo('K8S_CONNECTED');
    this.lifecycle.transitionTo('DISCOVERED');

    // 10. Start Evidence Uploader
    this.uploader.start();

    // 11. Start Periodic Scheduler (Heartbeats & Health Sync)
    this.scheduler = new Scheduler(this.logger);
    this.scheduler.start();

    this.scheduler.register({
      name: 'heartbeat',
      intervalMs: this.config.transport.heartbeatIntervalSeconds * 1000,
      fn: async () => {
        await this.sendHeartbeat();
      },
      immediate: true,
    });

    this.isRunning = true;
    this.lifecycle.transitionTo('RUNNING');
    this.logger.info('SkyOps Agent V1 runtime is fully running');
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.logger.info('Stopping SkyOps Agent V1 gracefully');
    this.lifecycle.transitionTo('DRAINING');

    // Stop recurring tasks
    if (this.scheduler) {
      this.scheduler.stopAll();
    }

    // Stop uploader
    if (this.uploader) {
      this.uploader.stop();
      // Final flush
      try {
        await this.uploader.flush();
      } catch {
        // ignore
      }
    }

    // Stop capabilities
    if (this.capabilityManager) {
      await this.capabilityManager.stopAll();
    }

    this.isRunning = false;
    this.lifecycle.transitionTo('STOPPED');
    this.healthRegistry.setStatus('runtime', 'unhealthy', 'Agent stopped');
    this.logger.info('SkyOps Agent V1 stopped');
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const identity = this.identityManager.getIdentity();
      const capHealth = this.capabilityManager.getHealthMap();

      for (const [key, h] of Object.entries(capHealth)) {
        this.healthRegistry.updateComponent(h);
      }

      const queueDepth = await this.queue.getQueueDepth();
      const spoolBytes = await this.spool.getDiskUsageBytes();
      const discoverySnapshot = this.k8sCapability.getDiscoverySnapshot();

      const healthSnapshot = this.healthRegistry.getSnapshot();

      const payload: HeartbeatPayload = {
        agentId: identity.agentId,
        installationId: identity.installationId,
        environmentId: identity.environmentId,
        agentVersion: this.config.agentVersion,
        timestamp: new Date().toISOString(),
        uptimeSeconds: healthSnapshot.uptimeSeconds,
        status: healthSnapshot.overallStatus,
        health: healthSnapshot,
        queueDepth,
        spoolDiskBytes: spoolBytes,
        clusterMetrics: discoverySnapshot
          ? {
              nodeCount: discoverySnapshot.nodes.length,
              podCount: discoverySnapshot.pods.length,
              deploymentCount: discoverySnapshot.deployments.length,
              activeWarnings: discoverySnapshot.recentEvents.filter((e) => e.type === 'Warning').length,
            }
          : undefined,
      };

      await this.heartbeatClient.sendHeartbeat(payload);

      // Update transport health
      const transportStatus = this.transportClient.getStatus();
      this.healthRegistry.setStatus(
        'transport',
        transportStatus.connected ? 'healthy' : 'degraded',
        transportStatus.lastError || 'Connected to SkyOps Cloud'
      );
    } catch (err) {
      this.healthRegistry.setStatus('transport', 'degraded', 'Failed to transmit heartbeat');
      this.logger.debug('Heartbeat cycle encountered error', undefined, err);
    }
  }

  public getHealth(): AgentHealth {
    if (!this.healthRegistry) {
      return {
        overallStatus: 'unhealthy',
        agentId: this.config.agentId || 'unknown',
        environmentId: this.config.environmentId,
        uptimeSeconds: 0,
        version: this.config.agentVersion,
        components: {},
      };
    }
    return this.healthRegistry.getSnapshot();
  }

  public getIdentity() {
    return this.identityManager?.getIdentity();
  }

  public getLifecyclePhase() {
    return this.lifecycle.getPhase();
  }

  public getDiscoverySnapshot() {
    return this.k8sCapability?.getDiscoverySnapshot();
  }

  public getQueue() {
    return this.queue;
  }
}
