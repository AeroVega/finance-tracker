import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('history benchmark default CLI exercises fragmented-v3 and exact reopen', () => {
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('./benchmark-history-reads.mjs', import.meta.url)), '--saves=2'], {
    encoding: 'utf8', timeout: 30000
  });
  const result = JSON.parse(output);
  assert.equal(result.variant, 'current');
  assert.equal(result.layout, 'fragments-v3');
  assert.equal(result.saves, 2);
  assert.equal(result.samples.length, 2);
  assert.ok(result.samples.every(sample => sample.saveRequests > 0 && sample.reopenRequests > 0 && sample.catalogWriteBytes > 0));
  assert.ok(result.retainedEntries > 0);
  assert.ok(result.totalFolderBytes > result.retainedBytes);
  assert.ok(result.catalogFiles >= 5);
  assert.ok(result.catalogSegmentFiles >= 5);
});
