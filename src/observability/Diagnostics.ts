/**
 * SkyOps Agent V1 - Diagnostics
 *
 * Provides self-inspection data for local debugging and support.
 */

import * as os from 'node:os';
import { Metrics } from './Metrics.ts';
import { AgentHealth } from '../types/agent.ts';

export interface DiagnosticReport {
  timestamp: string;
  agentVersion: string;
  system: {
    platform: string;
    arch: string;
    nodeVersion: string;
    hostname: string;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    loadAverage: number[];
    processUptimeSeconds: number;
    memoryUsage: NodeJS.MemoryUsage;
  };
  health?: AgentHealth;
  metrics: ReturnType<Metrics['getSnapshot']>;
}

export class Diagnostics {
  public static generateReport(version: string, health?: AgentHealth): DiagnosticReport {
    return {
      timestamp: new Date().toISOString(),
      agentVersion: version,
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        hostname: os.hostname(),
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytes: os.freemem(),
        loadAverage: os.loadavg(),
        processUptimeSeconds: Math.floor(process.uptime()),
        memoryUsage: process.memoryUsage(),
      },
      health,
      metrics: Metrics.getInstance().getSnapshot(),
    };
  }
}
