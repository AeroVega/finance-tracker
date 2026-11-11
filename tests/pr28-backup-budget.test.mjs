import test from 'node:test';
import assert from 'node:assert/strict';
import { measureCanonicalBackupFlow } from './helpers/pr28-backup-scenario.mjs';

// Serial catalog-backup.mjs at 70728162, using the same real HTTP transaction
// and session adapters. These counts include every per-mutation ownership check
// but exclude connect/release, periodic heartbeat, retries, pagination and CORS.
const BEFORE = { portableExport: 235, portableVerify: 0, backup: 1874,
  backupReopen: 238, restore: 1635, restoreReopen: 238 };

test('completed canonical recipe backs up and restores all retained history within HTTP budgets', async t => {
  const measured = await measureCanonicalBackupFlow();
  const { current } = measured.variants;
  t.diagnostic(JSON.stringify({ before: BEFORE, ...measured }));
  assert.ok(measured.recipeRequests <= 4800, 'the canonical recipe keeps its original request budget');
  assert.equal(measured.heartbeatRequests, 0);
  assert.equal(measured.selectedObjects, 10);
  assert.equal(measured.retainedObjects, Object.values(measured.retainedByKind).reduce((sum, count) => sum + count, 0));
  assert.equal(measured.retainedByKind['journal-event'], 74);
  assert.ok(measured.retainedByKind['data-object'] >= measured.selectedObjects);
  for (const [phase, budget] of Object.entries({ portableExport: 260, portableVerify: 0,
    backup: 1950, backupReopen: 260, restore: 1700, restoreReopen: 260 })) {
    assert.ok(current[phase].requests <= budget, `${phase} used ${current[phase].requests} HTTP requests`);
    assert.equal(Object.values(current[phase].categories).reduce((sum, count) => sum + count, 0), current[phase].requests);
    // This is a no-heartbeat phase measurement, not a global production limit.
    assert.ok(current[phase].peakConcurrency <= 4);
  }
  for (const phase of ['backup', 'restore']) {
    assert.equal(current[phase].categories.create, measured.retainedObjects + 4,
      'copy every retained object plus the preparation marker, one bounded catalog segment, catalog root and final manifest');
    assert.equal(current[phase].categories.update, 1, 'mark the existing preparation ready once');
    assert.equal(current[phase].categories['generate-id'], 7);
    // Crypto and event-loop scheduling may hide overlap in this zero-delay
    // HTTP simulation. The separate latch-based copy tests prove admission of
    // four operations without relying on timing or machine load.
    assert.ok(current[phase].peakMutations <= 4, 'copy write concurrency must remain bounded');
  }
  for (const phase of ['portableExport', 'portableVerify', 'backupReopen', 'restoreReopen']) {
    assert.equal(current[phase].categories.create, 0);
    assert.equal(current[phase].categories.update, 0);
  }
});
