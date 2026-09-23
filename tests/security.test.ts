import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { SecretRedactor } from '../src/security/SecretRedactor.ts';
import { TokenManager } from '../src/security/TokenManager.ts';
import { TLSConfig } from '../src/security/TLSConfig.ts';

describe('Security Subsystem', () => {
  test('redacts Bearer tokens in strings', () => {
    const raw = 'Request header: Bearer ya29.a0AfH6SMD_secret_token_value and Authorization: Bearer abc123def456';
    const redacted = SecretRedactor.redactString(raw);
    assert.ok(!redacted.includes('ya29.a0AfH6SMD_secret_token_value'));
    assert.ok(!redacted.includes('abc123def456'));
    assert.ok(redacted.includes('[REDACTED_TOKEN]'));
  });

  test('redacts AWS Access Keys and Private Keys', () => {
    const raw = 'Key AKIAIOSFODNN7EXAMPLE and -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    const redacted = SecretRedactor.redactString(raw);
    assert.ok(!redacted.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(redacted.includes('[REDACTED_AWS_KEY_ID]'));
    assert.ok(redacted.includes('[REDACTED_PRIVATE_KEY]'));
  });

  test('redacts sensitive object keys recursively', () => {
    const payload = {
      user: 'admin',
      password: 'super_secret_password',
      db_token: 'tok-12345',
      nested: {
        api_key: 'ghp_123456789012345678901234567890123456',
        public_info: 'safe',
      },
    };

    const sanitized = SecretRedactor.redactObject(payload);
    assert.strictEqual(sanitized.user, 'admin');
    assert.strictEqual(sanitized.password, '[REDACTED]');
    assert.strictEqual(sanitized.db_token, '[REDACTED]');
    assert.strictEqual(sanitized.nested.api_key, '[REDACTED]');
    assert.strictEqual(sanitized.nested.public_info, 'safe');
  });

  test('strips secret data bytes from Kubernetes Secret resources', () => {
    const secretResource = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: 'database-credentials',
        namespace: 'default',
      },
      data: {
        username: 'cG9zdGdyZXM=',
        password: 'c3VwZXJzZWNyZXQ=',
      },
    };

    const sanitized = SecretRedactor.sanitizeK8sResource(secretResource);
    const data = sanitized.data as Record<string, string>;
    assert.ok(!data.password.includes('c3VwZXJzZWNyZXQ='));
    assert.ok(data.password.includes('[REDACTED_SECRET_BYTES_SIZE_'));
  });

  test('TokenManager safely stores and formats auth headers', () => {
    const tm = new TokenManager('my-test-secret-token');
    assert.strictEqual(tm.hasToken(), true);
    assert.strictEqual(tm.getAuthHeader().Authorization, 'Bearer my-test-secret-token');
    assert.strictEqual(tm.getMaskedToken(), 'my-t...oken');

    tm.clear();
    assert.strictEqual(tm.hasToken(), false);
    assert.deepStrictEqual(tm.getAuthHeader(), {});
  });

  test('TLSConfig rejects unauthorized certificates by default in production', () => {
    const tls = new TLSConfig();
    assert.strictEqual(tls.isRejectUnauthorized(), true);
  });
});
