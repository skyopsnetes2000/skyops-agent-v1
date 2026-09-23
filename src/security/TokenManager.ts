/**
 * SkyOps Agent V1 - Token Manager
 *
 * Manages agent authentication token with memory scoping,
 * validation, and safe header creation.
 */

export class TokenManager {
  private token: string;
  private tokenCreatedAt: Date;

  constructor(initialToken?: string) {
    this.token = initialToken || '';
    this.tokenCreatedAt = new Date();
  }

  public setToken(token: string): void {
    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token provided to TokenManager');
    }
    this.token = token.trim();
    this.tokenCreatedAt = new Date();
  }

  public getToken(): string {
    return this.token;
  }

  public hasToken(): boolean {
    return this.token.length > 0;
  }

  public getAuthHeader(): Record<string, string> {
    if (!this.hasToken()) {
      return {};
    }
    return {
      Authorization: `Bearer ${this.token}`,
    };
  }

  public getMaskedToken(): string {
    if (!this.token) return '[NOT_SET]';
    if (this.token.length <= 8) return '****';
    return `${this.token.substring(0, 4)}...${this.token.substring(this.token.length - 4)}`;
  }

  public getCreatedAt(): Date {
    return this.tokenCreatedAt;
  }

  public clear(): void {
    this.token = '';
  }
}
