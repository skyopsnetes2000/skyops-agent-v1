/**
 * SkyOps Agent V1 - Structured Production Logger
 *
 * Guarantees:
 * - Redacts all tokens, secrets, private keys, passwords automatically
 * - Structured JSON logging format with component context
 * - Never prints unredacted error stacks containing sensitive data
 */

import { SecretRedactor } from '../security/SecretRedactor.ts';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  operation?: string;
  message: string;
  agentId?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export class Logger {
  private level: LogLevel = 'INFO';
  private component: string;
  private agentId?: string;

  constructor(component = 'agent', level?: LogLevel, agentId?: string) {
    this.component = component;
    if (level) {
      this.level = level;
    }
    this.agentId = agentId;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public setAgentId(agentId: string): void {
    this.agentId = agentId;
  }

  public child(subComponent: string): Logger {
    return new Logger(`${this.component}:${subComponent}`, this.level, this.agentId);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private formatAndEmit(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
    err?: unknown
  ): void {
    if (!this.shouldLog(level)) return;

    let errorString: string | undefined;
    if (err) {
      if (err instanceof Error) {
        errorString = SecretRedactor.redactString(`${err.name}: ${err.message}\n${err.stack || ''}`);
      } else {
        errorString = SecretRedactor.redactString(String(err));
      }
    }

    const sanitizedMessage = SecretRedactor.redactString(message);
    const sanitizedMeta = meta ? SecretRedactor.redactObject(meta) : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message: sanitizedMessage,
      agentId: this.agentId,
      metadata: sanitizedMeta,
      error: errorString,
    };

    // Output formatted line
    const output = JSON.stringify(entry);
    if (level === 'ERROR') {
      console.error(output);
    } else if (level === 'WARN') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  public debug(message: string, meta?: Record<string, unknown>, err?: unknown): void {
    this.formatAndEmit('DEBUG', message, meta, err);
  }

  public info(message: string, meta?: Record<string, unknown>, err?: unknown): void {
    this.formatAndEmit('INFO', message, meta, err);
  }

  public warn(message: string, meta?: Record<string, unknown>, err?: unknown): void {
    this.formatAndEmit('WARN', message, meta, err);
  }

  public error(message: string, meta?: Record<string, unknown>, err?: unknown): void {
    this.formatAndEmit('ERROR', message, meta, err);
  }
}
