/**
 * SkyOps Agent V1 - Capability Registry
 */

import { Capability } from './Capability.ts';

export class CapabilityRegistry {
  private capabilities: Map<string, Capability> = new Map();

  public register(capability: Capability): void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Capability "${capability.id}" is already registered`);
    }
    this.capabilities.set(capability.id, capability);
  }

  public get(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  public getAll(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  public getIds(): string[] {
    return Array.from(this.capabilities.keys());
  }
}
