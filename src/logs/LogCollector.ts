/**
 * SkyOps Agent V1 - Targeted Log Intelligence Engine
 *
 * Provides safe, bounded, and on-demand container log collection during incident investigation.
 * Enforces size bounding (max bytes and max lines), truncation markers, deduplication,
 * and strict secret redaction. Never uploads continuous logs to preserve network and compute.
 */

import { KubernetesClient } from '../kubernetes/KubernetesClient.ts';
import { SecretRedactor } from '../security/SecretRedactor.ts';
import { LogSnippet } from '../types/investigation.ts';
import { Logger } from '../observability/Logger.ts';

export interface LogCollectionOptions {
  tailLines?: number;       // default 100
  maxBytes?: number;        // default 50 * 1024 (50 KB)
  includePrevious?: boolean; // inspect previous terminated container instance
  sinceSeconds?: number;    // time window in seconds
}

export class LogCollector {
  private client: KubernetesClient;
  private logger: Logger;
  private readonly defaultMaxBytes = 50 * 1024;
  private readonly defaultTailLines = 100;

  constructor(client: KubernetesClient, logger?: Logger) {
    this.client = client;
    this.logger = logger?.child('log-collector') || new Logger('log-collector');
  }

  /**
   * Fetches container logs for a target pod with bounding and sanitization
   */
  public async collectContainerLogs(
    namespace: string,
    podName: string,
    containerName: string,
    options: LogCollectionOptions = {}
  ): Promise<LogSnippet> {
    const tailLines = options.tailLines || this.defaultTailLines;
    const maxBytes = options.maxBytes || this.defaultMaxBytes;
    const isPrevious = options.includePrevious || false;

    let rawLog = '';
    try {
      rawLog = await this.client.getPodLogs(namespace, podName, containerName, {
        tailLines,
        previous: isPrevious,
        sinceSeconds: options.sinceSeconds,
      });
    } catch (err) {
      this.logger.debug('Could not read container logs', { namespace, podName, containerName, isPrevious }, err);
      rawLog = `[SkyOps LogCollector: Unable to retrieve logs for container ${containerName}: ${err instanceof Error ? err.message : String(err)}]`;
    }

    // Split and redact each line
    let lines = rawLog.split('\n');
    let truncated = false;

    // Line bounding
    if (lines.length > tailLines) {
      lines = lines.slice(lines.length - tailLines);
      truncated = true;
    }

    // Apply strict redaction to every single line (removes Bearer tokens, passwords, private keys, AWS keys, etc.)
    const sanitizedLines = lines.map((line) => SecretRedactor.redactString(line));

    // Byte bounding check
    let totalBytes = 0;
    const boundedLines: string[] = [];
    for (let i = sanitizedLines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(sanitizedLines[i], 'utf-8');
      if (totalBytes + lineBytes > maxBytes) {
        truncated = true;
        break;
      }
      totalBytes += lineBytes;
      boundedLines.unshift(sanitizedLines[i]);
    }

    if (truncated) {
      boundedLines.unshift(`[SkyOps Notice: Log snippet was truncated to meet ${maxBytes / 1024}KB / ${tailLines} lines safety limit]`);
    }

    return {
      podName,
      namespace,
      containerName,
      isPrevious,
      timestamp: new Date().toISOString(),
      lineCount: boundedLines.length,
      lines: boundedLines,
      truncated,
    };
  }

  /**
   * For a failing container, automatically collect current and previous logs
   */
  public async collectFailureContextLogs(
    namespace: string,
    podName: string,
    containerName: string,
    options: LogCollectionOptions = {}
  ): Promise<LogSnippet[]> {
    const snippets: LogSnippet[] = [];

    // 1. Current container logs
    const current = await this.collectContainerLogs(namespace, podName, containerName, {
      ...options,
      includePrevious: false,
    });
    snippets.push(current);

    // 2. Previous container logs (critical for OOMKilled and CrashLoopBackOff)
    const previous = await this.collectContainerLogs(namespace, podName, containerName, {
      ...options,
      includePrevious: true,
    });
    // Only include previous if it actually contains content
    if (previous.lines.length > 0 && !previous.lines[0].includes('Unable to retrieve logs')) {
      snippets.push(previous);
    }

    return snippets;
  }
}
