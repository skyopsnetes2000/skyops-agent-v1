/**
 * SkyOps Agent V1 - Base Transport Client
 *
 * Handles outbound HTTP/HTTPS communication:
 * - Bearer authentication via TokenManager
 * - TLS enforcement and CA configuration via TLSConfig
 * - Redacted error reporting
 * - Timeout handling
 */

import * as http from 'node:http';
import * as https from 'node:https';
import { TokenManager } from '../security/TokenManager.ts';
import { TLSConfig } from '../security/TLSConfig.ts';
import { TransportStatus } from '../types/transport.ts';
import { Logger } from '../observability/Logger.ts';
import { SecretRedactor } from '../security/SecretRedactor.ts';

export interface TransportClientOptions {
  apiUrl: string;
  tokenManager: TokenManager;
  tlsConfig?: TLSConfig;
  timeoutMs?: number;
  logger?: Logger;
}

export class TransportClient {
  private readonly baseUrl: string;
  private readonly tokenManager: TokenManager;
  private readonly tlsConfig: TLSConfig;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private consecutiveFailures = 0;
  private lastConnectedAt?: string;
  private lastError?: string;

  constructor(options: TransportClientOptions) {
    this.baseUrl = options.apiUrl.replace(/\/+$/, '');
    this.tokenManager = options.tokenManager;
    this.tlsConfig = options.tlsConfig || new TLSConfig();
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.logger = options.logger?.child('transport') || new Logger('transport');
  }

  public async post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
    const fullUrl = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const payload = JSON.stringify(body);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
      'User-Agent': 'SkyOps-Agent/1.0.0',
      ...this.tokenManager.getAuthHeader(),
    };

    return new Promise<TRes>((resolve, reject) => {
      const urlObj = new URL(fullUrl);
      const isHttps = urlObj.protocol === 'https:';
      const requestFn = isHttps ? https.request : http.request;

      const agent = isHttps ? this.tlsConfig.createAgent() : undefined;

      const req = requestFn(
        urlObj,
        {
          method: 'POST',
          headers,
          agent,
          timeout: this.timeoutMs,
        },
        (res) => {
          let responseData = '';

          res.on('data', (chunk) => {
            responseData += chunk;
          });

          res.on('end', () => {
            const statusCode = res.statusCode || 0;

            if (statusCode >= 200 && statusCode < 300) {
              this.consecutiveFailures = 0;
              this.lastConnectedAt = new Date().toISOString();
              this.lastError = undefined;

              try {
                const parsed = JSON.parse(responseData) as TRes;
                resolve(parsed);
              } catch {
                resolve({} as TRes);
              }
            } else {
              this.recordFailure(`HTTP ${statusCode}: ${responseData.substring(0, 100)}`);
              reject(new Error(`Transport request failed with HTTP ${statusCode}`));
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        this.recordFailure(`Request timeout after ${this.timeoutMs}ms`);
        reject(new Error(`Transport request timed out after ${this.timeoutMs}ms`));
      });

      req.on('error', (err) => {
        const redactedErr = SecretRedactor.redactString(err.message);
        this.recordFailure(redactedErr);
        reject(new Error(`Network error communicating with SkyOps Cloud: ${redactedErr}`));
      });

      req.write(payload);
      req.end();
    });
  }

  public async get<TRes>(path: string): Promise<TRes> {
    const fullUrl = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const headers: Record<string, string> = {
      'User-Agent': 'SkyOps-Agent/1.0.0',
      ...this.tokenManager.getAuthHeader(),
    };

    return new Promise<TRes>((resolve, reject) => {
      const urlObj = new URL(fullUrl);
      const isHttps = urlObj.protocol === 'https:';
      const requestFn = isHttps ? https.request : http.request;
      const agent = isHttps ? this.tlsConfig.createAgent() : undefined;

      const req = requestFn(
        urlObj,
        {
          method: 'GET',
          headers,
          agent,
          timeout: this.timeoutMs,
        },
        (res) => {
          let responseData = '';
          res.on('data', (chunk) => {
            responseData += chunk;
          });

          res.on('end', () => {
            const statusCode = res.statusCode || 0;
            if (statusCode >= 200 && statusCode < 300) {
              this.consecutiveFailures = 0;
              this.lastConnectedAt = new Date().toISOString();
              this.lastError = undefined;
              try {
                resolve(JSON.parse(responseData) as TRes);
              } catch {
                resolve({} as TRes);
              }
            } else {
              this.recordFailure(`HTTP ${statusCode}: ${responseData.substring(0, 100)}`);
              reject(new Error(`Transport request failed with HTTP ${statusCode}`));
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        this.recordFailure(`Request timeout after ${this.timeoutMs}ms`);
        reject(new Error(`Transport request timed out after ${this.timeoutMs}ms`));
      });

      req.on('error', (err) => {
        const redactedErr = SecretRedactor.redactString(err.message);
        this.recordFailure(redactedErr);
        reject(new Error(`Network error communicating with SkyOps Cloud: ${redactedErr}`));
      });

      req.end();
    });
  }

  public async uploadInvestigation(context: unknown): Promise<{ success: boolean; incidentId?: string }> {
    return this.post<unknown, { success: boolean; incidentId?: string }>('/api/v1/investigations', context);
  }

  public async receiveAction(): Promise<unknown | null> {
    try {
      const res = await this.get<{ action?: unknown }>('/api/v1/actions/pending');
      return res.action || null;
    } catch {
      return null;
    }
  }

  public async receiveConfiguration(): Promise<Record<string, unknown> | null> {
    try {
      return await this.get<Record<string, unknown>>('/api/v1/config/runtime');
    } catch {
      return null;
    }
  }

  private recordFailure(message: string): void {
    this.consecutiveFailures += 1;
    this.lastError = message;
  }

  public getStatus(): TransportStatus {
    return {
      connected: this.consecutiveFailures === 0,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
      activeEndpoint: this.baseUrl,
    };
  }

  public isConnected(): boolean {
    return this.consecutiveFailures === 0;
  }
}
