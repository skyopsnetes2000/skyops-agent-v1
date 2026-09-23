/**
 * SkyOps Agent V1 - Capability Manager
 *
 * Coordinates initialization, starting, stopping, and health
 * aggregation across all registered capabilities with error boundaries.
 */

import { CapabilityRegistry } from './CapabilityRegistry.ts';
import { CapabilityContext } from './Capability.ts';
import { ComponentHealth } from '../types/agent.ts';
import { Logger } from '../observability/Logger.ts';

export class CapabilityManager {
  private readonly registry: CapabilityRegistry;
  private readonly logger: Logger;
  private started = false;

  constructor(registry: CapabilityRegistry, logger?: Logger) {
    this.registry = registry;
    this.logger = logger?.child('capabilities') || new Logger('capabilities');
  }

  public async initializeAll(context: CapabilityContext): Promise<void> {
    for (const cap of this.registry.getAll()) {
      try {
        this.logger.info(`Initializing capability: ${cap.name} (v${cap.version})`);
        await cap.initialize(context);
      } catch (err) {
        this.logger.error(`Failed to initialize capability ${cap.id}`, undefined, err);
      }
    }
  }

  public async startAll(): Promise<void> {
    this.started = true;
    for (const cap of this.registry.getAll()) {
      try {
        this.logger.info(`Starting capability: ${cap.name}`);
        await cap.start();
      } catch (err) {
        this.logger.error(`Failed to start capability ${cap.id}`, undefined, err);
      }
    }
  }

  public async stopAll(): Promise<void> {
    this.started = false;
    for (const cap of this.registry.getAll()) {
      try {
        this.logger.info(`Stopping capability: ${cap.name}`);
        await cap.stop();
      } catch (err) {
        this.logger.warn(`Error stopping capability ${cap.id}`, undefined, err);
      }
    }
  }

  public getHealthMap(): Record<string, ComponentHealth> {
    const healthMap: Record<string, ComponentHealth> = {};
    for (const cap of this.registry.getAll()) {
      try {
        healthMap[cap.id] = cap.health();
      } catch (err) {
        healthMap[cap.id] = {
          name: cap.name,
          status: 'unhealthy',
          message: err instanceof Error ? err.message : String(err),
          lastCheckedAt: new Date().toISOString(),
        };
      }
    }
    return healthMap;
  }
}
