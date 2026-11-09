// Invented-data adapter benchmark only. No Drive, catalog HTTP or credentials.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
if (!process.argv[2]) {
  for (const years of [1, 5, 10]) {
    const run = spawnSync(process.execPath, ['--max-old-space-size=768', new URL(import.meta.url).pathname, String(years)], { stdio: 'inherit' });
    if (run.status !== 0) process.exit(run.status || 1);
  }
  process.exit(0);
}
import { performance } from 'node:perf_hooks';
import { denseLedgerFixture } from './helpers/dense-ledger-fixture.mjs';
import { CanonicalLedgerStore, serializeCanonicalLedger, CANONICAL_INDEX, validateCanonicalSnapshot } from '../js/canonical-ledger-storage.mjs';
import { FRAGMENT_OBJECT_BYTES } from '../js/canonical-fragments.mjs';
const encode = text => new TextEncoder().encode(text);
for (const years of [Number(process.argv[2])]) {
  const { ledger } = denseLedgerFixture(years), physical = new Map();
  const manifest = { syntheticOnly: true, snapshot: {} };
  const lifecycle = { readManifest: async () => structuredClone(manifest), readObject: async path => encode(physical.get(path)),
    async transact({ objects }) { for (const { logicalPath, content } of objects) { physical.set(logicalPath, content); manifest.snapshot[logicalPath] = {}; } } };
  const store = new CanonicalLedgerStore({ lifecycle, layout: 'fragments-v3' });
  await store.load(); const start = performance.now(); assert.deepEqual(await store.save(ledger), ledger); const saved = performance.now();
  assert.deepEqual(await new CanonicalLedgerStore({ lifecycle }).load(), ledger); const reopened = performance.now();
  validateCanonicalSnapshot({ objects: Object.fromEntries([...physical].map(([path, text]) => [path, encode(text)])) });
  const sizes = [...physical.values()].map(text => encode(text).length), logical = serializeCanonicalLedger(ledger);
  assert.ok(Math.max(...sizes) <= FRAGMENT_OBJECT_BYTES);
  console.log(JSON.stringify({ years, activities: ledger.activities.length, logicalObjects: logical.size, physicalObjects: physical.size,
    largestImportBytes: Math.max(...ledger.imports.map(record => encode(JSON.stringify(record)).length)),
    largestPhysicalBytes: Math.max(...sizes), rootBytes: encode(physical.get(CANONICAL_INDEX)).length,
    logicalBytes: [...logical.values()].reduce((n, text) => n + encode(text).length, 0), physicalBytes: sizes.reduce((n, size) => n + size, 0),
    saveAndReadbackMs: Math.round(saved - start), independentReopenMs: Math.round(reopened - saved), rssMiB: Math.round(process.memoryUsage().rss / 1048576), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }));
}
