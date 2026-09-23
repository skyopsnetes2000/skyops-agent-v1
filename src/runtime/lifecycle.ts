/**
 * SkyOps Agent V1 - Lifecycle State Machine
 */

export type LifecyclePhase =
  | 'UNINITIALIZED'
  | 'INITIALIZING'
  | 'CONFIG_LOADED'
  | 'IDENTITY_ESTABLISHED'
  | 'REGISTERED'
  | 'CAPABILITIES_READY'
  | 'K8S_CONNECTED'
  | 'DISCOVERED'
  | 'RUNNING'
  | 'DRAINING'
  | 'STOPPED'
  | 'FAILED';

export class LifecycleTracker {
  private currentPhase: LifecyclePhase = 'UNINITIALIZED';
  private phaseHistory: Array<{ phase: LifecyclePhase; timestamp: string }> = [];

  constructor() {
    this.transitionTo('UNINITIALIZED');
  }

  public transitionTo(phase: LifecyclePhase): void {
    this.currentPhase = phase;
    this.phaseHistory.push({
      phase,
      timestamp: new Date().toISOString(),
    });
  }

  public getPhase(): LifecyclePhase {
    return this.currentPhase;
  }

  public isRunning(): boolean {
    return this.currentPhase === 'RUNNING';
  }

  public getHistory(): Array<{ phase: LifecyclePhase; timestamp: string }> {
    return [...this.phaseHistory];
  }
}
