import { test, describe, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Spool } from '../src/queue/Spool.ts';
import { PersistentQueue } from '../src/queue/PersistentQueue.ts';
import { EvidenceBuilder } from '../src/evidence/Evidence.ts';

describe('Persistent Queue & Durable Spool', () => {
  const testSpoolDir = path.join(process.cwd(), '.skyops_test_spool');

  before(() => {
    fs.rmSync(testSpoolDir, { recursive: true, force: true });
  });

  after(() => {
    fs.rmSync(testSpoolDir, { recursive: true, force: true });
  });

  test('durable spool writes and recovers records across restarts', async () => {
    const spool = new Spool(testSpoolDir, 10 * 1024 * 1024);

    const ev = EvidenceBuilder.create()
      .setEnvironment('env-q', 'ag-q')
      .setResource('k8s:default:pod/worker', 'pod')
      .setType('POD_FAILURE', 'SIGNAL', 'ERROR')
      .setObservation({ summary: 'Pod Crash' })
      .build();

    const recordId = await spool.write(ev);
    assert.ok(recordId.startsWith('rec_'));

    const count = await spool.count();
    assert.strictEqual(count, 1);

    const batch = await spool.readBatch(10);
    assert.strictEqual(batch.length, 1);
    assert.strictEqual(batch[0].evidence.evidenceId, ev.evidenceId);

    // Acknowledge and verify removal
    await spool.acknowledge(recordId);
    const countAfter = await spool.count();
    assert.strictEqual(countAfter, 0);
  });

  test('queue automatically spills over to disk spool when memory capacity is reached', async () => {
    const spoolDir2 = path.join(process.cwd(), '.skyops_test_spool_overflow');
    fs.rmSync(spoolDir2, { recursive: true, force: true });

    const spool = new Spool(spoolDir2, 10 * 1024 * 1024);
    // Queue with small maxMemoryItems = 2
    const queue = new PersistentQueue(spool, 2);
    await queue.initialize();

    // Enqueue 4 items
    for (let i = 1; i <= 4; i++) {
      const ev = EvidenceBuilder.create()
        .setEnvironment('env-q', 'ag-q')
        .setResource(`k8s:default:pod/p-${i}`, 'pod')
        .setType('POD_FAILURE', 'SIGNAL', 'ERROR')
        .setObservation({ summary: `Item ${i}` })
        .build();
      await queue.enqueue(ev);
    }

    assert.strictEqual(queue.getMemoryQueueSize(), 2, 'Memory queue should hold max 2 items');
    const spooledOnDisk = await spool.count();
    assert.strictEqual(spooledOnDisk, 2, 'Remaining 2 items should spill to disk spool');

    // Dequeue batch of 4 - should seamlessly combine memory + disk spool items
    const batch = await queue.dequeueBatch(4);
    assert.strictEqual(batch.length, 4);

    // Acknowledge all
    await queue.acknowledgeBatch(batch);
    const totalRemaining = await queue.getQueueDepth();
    assert.strictEqual(totalRemaining, 0);

    fs.rmSync(spoolDir2, { recursive: true, force: true });
  });

  test('queue recovers unacknowledged spooled records upon restart', async () => {
    const recoveryDir = path.join(process.cwd(), '.skyops_test_recovery');
    fs.rmSync(recoveryDir, { recursive: true, force: true });

    const spool1 = new Spool(recoveryDir, 10 * 1024 * 1024);
    const ev = EvidenceBuilder.create()
      .setEnvironment('env-r', 'ag-r')
      .setResource('k8s:default:pod/crashed', 'pod')
      .setType('POD_FAILURE', 'SIGNAL', 'CRITICAL')
      .setObservation({ summary: 'Unfinished work' })
      .build();

    // Write directly to disk spool (simulating unsent records before a crash)
    await spool1.write(ev);

    // Simulate Agent Restart: instantiate a new Queue with same spool dir
    const spool2 = new Spool(recoveryDir, 10 * 1024 * 1024);
    const queue2 = new PersistentQueue(spool2, 100);
    await queue2.initialize();

    assert.strictEqual(queue2.getMemoryQueueSize(), 1, 'Should have recovered 1 record from disk');
    const batch = await queue2.dequeueBatch(10);
    assert.strictEqual(batch.length, 1);
    assert.strictEqual(batch[0].evidenceId, ev.evidenceId);

    fs.rmSync(recoveryDir, { recursive: true, force: true });
  });
});
