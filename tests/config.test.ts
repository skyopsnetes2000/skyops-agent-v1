import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { ConfigLoader } from '../src/config/configLoader.ts';
import { validateConfig } from '../src/config/validation.ts';

describe('Configuration Subsystem', () => {
  test('loads valid configuration with safe defaults', () => {
    const config = ConfigLoader.loadFromEnv({
      SKYOPS_ORGANIZATION_ID: 'org-test-1',
      SKYOPS_ENVIRONMENT_ID: 'env-prod-us',
      SKYOPS_AGENT_TOKEN: 'skyops_sec_token_999',
      SKYOPS_API_URL: 'https://api.skyops.io',
      SKYOPS_K8S_MOCK_MODE: 'true',
    });

    assert.strictEqual(config.organizationId, 'org-test-1');
    assert.strictEqual(config.environmentId, 'env-prod-us');
    assert.strictEqual(config.transport.agentToken, 'skyops_sec_token_999');
    assert.strictEqual(config.transport.heartbeatIntervalSeconds, 30);
    assert.strictEqual(config.transport.batchSize, 50);
    assert.strictEqual(config.kubernetes.mockMode, true);
    assert.strictEqual(config.security.secretRedactionEnabled, true);

    const validation = validateConfig(config);
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.errors.length, 0);
  });

  test('detects missing required organization and environment IDs', () => {
    const config = ConfigLoader.loadFromEnv({
      SKYOPS_ORGANIZATION_ID: '',
      SKYOPS_ENVIRONMENT_ID: '',
      SKYOPS_API_URL: 'https://api.skyops.io',
    });

    const validation = validateConfig(config);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes('organizationId')));
    assert.ok(validation.errors.some((e) => e.includes('environmentId')));
  });

  test('detects invalid API URL protocol', () => {
    const config = ConfigLoader.loadFromEnv({
      SKYOPS_ORGANIZATION_ID: 'org-1',
      SKYOPS_ENVIRONMENT_ID: 'env-1',
      SKYOPS_API_URL: 'ftp://api.skyops.io',
    });

    const validation = validateConfig(config);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes('Invalid protocol')));
  });

  test('safely masks token in getMaskedConfig', () => {
    const config = ConfigLoader.loadFromEnv({
      SKYOPS_ORGANIZATION_ID: 'org-1',
      SKYOPS_ENVIRONMENT_ID: 'env-1',
      SKYOPS_AGENT_TOKEN: 'secret_token_123456789',
    });

    const masked = ConfigLoader.getMaskedConfig(config);
    const transport = masked.transport as { agentToken: string };
    assert.ok(transport.agentToken.includes('...'));
    assert.ok(!transport.agentToken.includes('secret_token_123456789'));
  });
});
