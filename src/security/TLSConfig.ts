/**
 * SkyOps Agent V1 - TLS Configuration
 *
 * Enforces production security:
 * - Reject unauthorized certificates by default
 * - Configurable CA certificates for private enterprise PKI
 * - Safe timeouts
 */

import * as https from 'node:https';
import * as fs from 'node:fs';

export interface TLSConfigOptions {
  caCertPath?: string;
  caCertPem?: string;
  rejectUnauthorized?: boolean;
  timeoutMs?: number;
}

export class TLSConfig {
  private readonly ca?: string | Buffer;
  private readonly rejectUnauthorized: boolean;
  private readonly timeoutMs: number;

  constructor(options: TLSConfigOptions = {}) {
    // In production, rejectUnauthorized MUST be true.
    this.rejectUnauthorized = options.rejectUnauthorized !== false;
    this.timeoutMs = options.timeoutMs ?? 30000;

    if (options.caCertPem) {
      this.ca = options.caCertPem;
    } else if (options.caCertPath) {
      if (fs.existsSync(options.caCertPath)) {
        this.ca = fs.readFileSync(options.caCertPath);
      } else {
        throw new Error(`Configured CA certificate path does not exist: ${options.caCertPath}`);
      }
    }
  }

  public createAgent(): https.Agent {
    return new https.Agent({
      rejectUnauthorized: this.rejectUnauthorized,
      ca: this.ca,
      timeout: this.timeoutMs,
      keepAlive: true,
      keepAliveMsecs: 10000,
    });
  }

  public isRejectUnauthorized(): boolean {
    return this.rejectUnauthorized;
  }

  public getTimeoutMs(): number {
    return this.timeoutMs;
  }
}
