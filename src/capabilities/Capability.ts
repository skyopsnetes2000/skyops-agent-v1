/**
 * SkyOps Agent V1 - Capability Lifecycle Interface
 *
 * Provides the extensible plugin architecture for future capabilities
 * (Kubernetes now, later Docker, Kafka, AWS, GCP, etc.)
 */

import { ComponentHealth } from '../types/agent.ts';
import { PersistentQueue } from '../queue/PersistentQueue.ts';
import { Logger } from '../observability/Logger.ts';

export interface CapabilityContext {
  agentId: string;
  environmentId: string;
  organizationId: string;
  queue: PersistentQueue;
  logger: Logger;
}

export interface Capability {
  readonly id: string;
  readonly name: string;
  readonly version: string;

  initialize(context: CapabilityContext): Promise<void>;
  health(): ComponentHealth;
  discover?(): Promise<unknown>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
