/**
 * SkyOps Agent V1 - Retry Policy
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor?: number;
  jitter?: boolean;
}

export class RetryPolicy {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly factor: number;
  private readonly jitter: boolean;

  constructor(options: Partial<RetryOptions> = {}) {
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.factor = options.factor ?? 2;
    this.jitter = options.jitter !== false;
  }

  public getDelay(attempt: number): number {
    if (attempt <= 0) return 0;
    const exponential = this.baseDelayMs * Math.pow(this.factor, attempt - 1);
    const capped = Math.min(exponential, this.maxDelayMs);

    if (this.jitter) {
      // Add random jitter of +/- 20%
      const jitterRatio = 0.8 + Math.random() * 0.4;
      return Math.floor(capped * jitterRatio);
    }

    return capped;
  }

  public shouldRetry(attempt: number): boolean {
    return attempt < this.maxRetries;
  }

  public getMaxRetries(): number {
    return this.maxRetries;
  }
}
