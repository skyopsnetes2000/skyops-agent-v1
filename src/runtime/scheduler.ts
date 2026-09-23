/**
 * SkyOps Agent V1 - Safe Task Scheduler
 *
 * Runs scheduled recurring tasks with error boundaries so
 * individual task failures never bring down the scheduler.
 */

import { Logger } from '../observability/Logger.ts';

export interface ScheduledTask {
  name: string;
  intervalMs: number;
  fn: () => Promise<void>;
  immediate?: boolean;
}

export class Scheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private readonly logger: Logger;
  private isRunning = false;

  constructor(logger?: Logger) {
    this.logger = logger?.child('scheduler') || new Logger('scheduler');
  }

  public register(task: ScheduledTask): void {
    if (this.timers.has(task.name)) {
      this.cancel(task.name);
    }

    const execute = async () => {
      if (!this.isRunning) return;
      try {
        await task.fn();
      } catch (err) {
        this.logger.error(`Scheduled task "${task.name}" failed`, undefined, err);
      }
    };

    if (task.immediate) {
      execute().catch(() => {});
    }

    const timer = setInterval(execute, task.intervalMs);
    this.timers.set(task.name, timer);
  }

  public cancel(taskName: string): void {
    const timer = this.timers.get(taskName);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(taskName);
    }
  }

  public start(): void {
    this.isRunning = true;
  }

  public stopAll(): void {
    this.isRunning = false;
    for (const [name, timer] of this.timers.entries()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}
