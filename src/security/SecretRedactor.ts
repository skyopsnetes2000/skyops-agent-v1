/**
 * SkyOps Agent V1 - Production Secret Redactor
 *
 * Enforces zero-leakage policy:
 * - Redacts Bearer tokens, JWTs, AWS credentials, GCP keys
 * - Redacts private keys (RSA, EC, OPENSSH)
 * - Redacts passwords, connection strings, authorization headers
 * - Strips values of Kubernetes Secrets and sensitive environment variables
 */

export class SecretRedactor {
  // Sensitive key patterns
  private static readonly SENSITIVE_KEY_REGEX =
    /^(.*)?(password|passwd|secret|token|apikey|api_key|auth|bearer|credential|privkey|private_key|access_key|id_rsa)(.*)?$/i;

  // Pattern rules for values
  private static readonly PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
    // Bearer / Authorization headers
    {
      regex: /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
      replacement: '$1[REDACTED_TOKEN]',
    },
    // Generic JWT (header.payload.signature)
    {
      regex: /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+\b/g,
      replacement: '[REDACTED_JWT]',
    },
    // Private Key blocks
    {
      regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
      replacement: '[REDACTED_PRIVATE_KEY]',
    },
    // AWS Access Key ID (AKIA...)
    {
      regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
      replacement: '[REDACTED_AWS_KEY_ID]',
    },
    // URL with username:password e.g. postgres://user:pass@host
    {
      regex: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:]+):([^@]+)@/g,
      replacement: '$1$2:[REDACTED_PASSWORD]@',
    },
    // Common API Key prefixes (sk_live, ghp_, glpat-, slack token xoxb/xoxp)
    {
      regex: /\b(sk_live_[0-9a-zA-Z]{24,}|ghp_[0-9a-zA-Z]{36}|glpat-[0-9a-zA-Z\-_]{20,}|xox[baprs]-[0-9a-zA-Z\-]{10,})\b/g,
      replacement: '[REDACTED_API_KEY]',
    },
  ];

  /**
   * Redacts sensitive substrings within plain text or logs
   */
  public static redactString(input: string): string {
    if (!input || typeof input !== 'string') return input;

    let result = input;
    for (const rule of SecretRedactor.PATTERNS) {
      result = result.replace(rule.regex, rule.replacement);
    }
    return result;
  }

  /**
   * Recursively traverses and sanitizes objects, arrays, and primitives.
   * Never mutates input in place.
   */
  public static redactObject<T>(input: T): T {
    if (input === null || input === undefined) {
      return input;
    }

    if (typeof input === 'string') {
      return SecretRedactor.redactString(input) as unknown as T;
    }

    if (Array.isArray(input)) {
      return input.map((item) => SecretRedactor.redactObject(item)) as unknown as T;
    }

    if (typeof input === 'object') {
      const sanitized: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (SecretRedactor.SENSITIVE_KEY_REGEX.test(key)) {
          // If the key is sensitive, unconditionally mask the value
          sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = SecretRedactor.redactObject(value);
        } else if (typeof value === 'string') {
          sanitized[key] = SecretRedactor.redactString(value);
        } else {
          sanitized[key] = value;
        }
      }

      return sanitized as T;
    }

    return input;
  }

  /**
   * Sanitizes a Kubernetes resource object, ensuring that any Secret
   * data or stringData is completely stripped of values.
   */
  public static sanitizeK8sResource(resource: Record<string, unknown>): Record<string, unknown> {
    const kind = String(resource?.kind || '');
    const clean = SecretRedactor.redactObject(resource) as Record<string, unknown>;

    if (kind.toLowerCase() === 'secret') {
      // Redact and replace all entries in data / stringData with metadata only
      if (clean.data && typeof clean.data === 'object') {
        const dataKeys = Object.keys(clean.data as Record<string, unknown>);
        clean.data = dataKeys.reduce((acc, k) => {
          acc[k] = `[REDACTED_SECRET_BYTES_SIZE_${(clean.data as Record<string, string>)[k]?.length || 0}]`;
          return acc;
        }, {} as Record<string, string>);
      }
      if (clean.stringData && typeof clean.stringData === 'object') {
        clean.stringData = '[REDACTED_SECRET_STRING_DATA]';
      }
    }

    return clean;
  }
}
