import { test, describe, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AgentIdentityManager } from '../src/identity/AgentIdentity.ts';

describe('Identity Subsystem', () => {
  const testDir = path.join(process.cwd(), '.skyops_test_identity');

  before(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  after(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('creates new stable identity on first initialization', () => {
    const manager = new AgentIdentityManager(testDir, {
      organizationId: 'org-test',
      environmentId: 'env-prod',
      agentVersion: '1.0.0',
    });

    const identity = manager.getIdentity();
    assert.ok(identity.agentId.startsWith('skyops-agent-'));
    assert.ok(identity.installationId.startsWith('inst-'));
    assert.strictEqual(identity.organizationId, 'org-test');
    assert.strictEqual(identity.environmentId, 'env-prod');
    assert.strictEqual(identity.agentVersion, '1.0.0');

    // Verify identity.json was written
    const savedPath = path.join(testDir, 'identity.json');
    assert.ok(fs.existsSync(savedPath));
  });

  test('survives restarts by reloading the exact same identity', () => {
    const manager1 = new AgentIdentityManager(testDir, {
      organizationId: 'org-test',
      environmentId: 'env-prod',
      agentVersion: '1.0.0',
    });
    const id1 = manager1.getIdentity();

    // Reinitialize in same directory (simulating container or pod restart)
    const manager2 = new AgentIdentityManager(testDir, {
      organizationId: 'org-test',
      environmentId: 'env-prod',
      agentVersion: '1.0.1', // upgraded version
    });
    const id2 = manager2.getIdentity();

    assert.strictEqual(id1.agentId, id2.agentId, 'agentId must be preserved across restarts');
    assert.strictEqual(id1.installationId, id2.installationId, 'installationId must be preserved');
    assert.strictEqual(id2.agentVersion, '1.0.1', 'agentVersion should update on upgrade');
  });
});
