import { test, describe, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { AgentRuntime } from '../src/runtime/AgentRuntime.ts';
import { ConfigLoader } from '../src/config/configLoader.ts';

describe('Agent Runtime Engine', () => {
  const runtimeSpoolDir = path.join(process.cwd(), '.skyops_test_runtime');
  let mockServer: http.Server;
  let mockPort: number;

  before(async () => {
    fs.rmSync(runtimeSpoolDir, { recursive: true, force: true });
    fs.mkdirSync(runtimeSpoolDir, { recursive: true });

    // Start a lightweight local mock SkyOps Cloud server
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/api/v1/agents/register') {
          res.writeHead(200);
          res.end(JSON.stringify({ registered: true, assignedAgentId: 'mock-agent-id' }));
        } else if (req.url === '/api/v1/agents/heartbeat') {
          res.writeHead(200);
          res.end(JSON.stringify({ acknowledged: true, serverTimestamp: new Date().toISOString() }));
        } else if (req.url === '/api/v1/evidence/batch') {
          res.writeHead(200);
          res.end(JSON.stringify({ received: 1, batchId: 'b-1', accepted: true }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'not found' }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address();
        if (typeof addr === 'object' && addr !== null) {
          mockPort = addr.port;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      if (typeof mockServer.closeAllConnections === 'function') {
        mockServer.closeAllConnections();
      }
      mockServer.close(() => resolve());
    });
    fs.rmSync(runtimeSpoolDir, { recursive: true, force: true });
  });

  test('executes complete agent lifecycle from boot to graceful shutdown', async () => {
    const config = ConfigLoader.loadFromEnv({
      SKYOPS_ORGANIZATION_ID: 'org-runtime-test',
      SKYOPS_ENVIRONMENT_ID: 'env-prod-test',
      SKYOPS_AGENT_TOKEN: 'test_token_123',
      SKYOPS_API_URL: `http://127.0.0.1:${mockPort}`,
      SKYOPS_K8S_MOCK_MODE: 'true',
      SKYOPS_QUEUE_PATH: runtimeSpoolDir,
      SKYOPS_HEARTBEAT_INTERVAL: '10',
      SKYOPS_DISCOVERY_INTERVAL: '60',
      SKYOPS_COLLECTION_INTERVAL: '10',
      SKYOPS_UPLOAD_INTERVAL_MS: '500',
      SKYOPS_HTTP_TIMEOUT_MS: '2000',
    });

    const runtime = new AgentRuntime(config);
    assert.strictEqual(runtime.getLifecyclePhase(), 'UNINITIALIZED');

    // Start runtime
    await runtime.start();

    // Verify state
    assert.strictEqual(runtime.getLifecyclePhase(), 'RUNNING');

    const identity = runtime.getIdentity();
    assert.ok(identity);
    assert.strictEqual(identity?.organizationId, 'org-runtime-test');
    assert.strictEqual(identity?.environmentId, 'env-prod-test');

    const health = runtime.getHealth();
    assert.ok(health.overallStatus === 'healthy' || health.overallStatus === 'degraded');
    assert.ok(health.components['runtime']);
    assert.ok(health.components['kubernetes']);
    assert.ok(health.components['queue']);
    assert.ok(health.components['transport']);

    const snapshot = runtime.getDiscoverySnapshot();
    assert.ok(snapshot);
    assert.ok(snapshot?.nodes.length > 0);
    assert.ok(snapshot?.pods.length > 0);

    // Let the background loop run for 600ms to test uploader and queue
    await new Promise((r) => setTimeout(r, 600));

    // Graceful shutdown
    await runtime.stop();
    assert.strictEqual(runtime.getLifecyclePhase(), 'STOPPED');
  });
});
