// Synthetic HTTP only. No credentials, external fetches or actual Drive files.
// Usage: node tests/benchmark-synthetic-year.mjs [--layout=both|records-v1|fragments-v3]
import assert from 'node:assert/strict';
import { createSyntheticFinancialYear } from '../js/synthetic-financial-year.mjs';
import { CanonicalLedgerStore } from '../js/canonical-ledger-storage.mjs';
import { setupHttpCanonicalWorkbench } from './helpers/pr28-http-workbench.mjs';
import { HTTP_CATEGORIES } from './helpers/http-catalog-drive.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !/^--layout=(both|records-v1|fragments-v3)$/.test(arg))) {
  throw new Error('Usage: node tests/benchmark-synthetic-year.mjs [--layout=both|records-v1|fragments-v3]');
}
const choice = args[0]?.slice('--layout='.length) || 'both';
for (const layout of choice === 'both' ? ['records-v1', 'fragments-v3'] : [choice]) {
  const started = performance.now();
  const h = await setupHttpCanonicalWorkbench();
  const stats = phase => {
    const requests = h.http.requests.filter(request => request.phase === phase);
    return {requests: requests.length, categories: Object.fromEntries(HTTP_CATEGORIES.map(category =>
      [category, requests.filter(request => request.category === category).length]))};
  };
  const emit = result => console.log(JSON.stringify({layout, ...result}));
  // Same admission, save, independent reopen and reverify sequence as the
  // seeder. Choosing layout here does not add a format switch to the UI.
  h.http.phase = 'admit';
  const empty = await h.lifecycle.readManifest();
  assert.equal(empty.revision, 0); assert.equal(empty.role, 'primary');
  assert.equal(empty.syntheticOnly, true); assert.deepEqual(empty.snapshot, {});
  assert.equal(empty.catalogFinalizationPending, null);
  emit({phase: 'admit', ...stats('admit')});
  h.http.phase = 'seed';
  const recipe = await createSyntheticFinancialYear();
  const store = new CanonicalLedgerStore({lifecycle: h.lifecycle, layout});
  assert.equal(await store.load(), null);
  await store.save(recipe.ledger);
  assert.deepEqual(await new CanonicalLedgerStore({lifecycle: h.lifecycle}).load(), recipe.ledger);
  emit({phase: 'seed', elapsedMs: performance.now() - started, ...stats('seed')});
  const manifest = h.http.json(h.manifestFileId), catalog = h.http.json(manifest.locatorCatalog.fileId);
  emit({snapshot: Object.keys(manifest.snapshot).length, retainedEntries: Object.keys(catalog.entries).length,
    retainedKinds: Object.values(catalog.entries).reduce((counts, entry) => {
      counts[entry.kind] = (counts[entry.kind] || 0) + 1; return counts;
    }, {}), peakReads: h.http.peakConcurrency, peakMutations: h.http.peakMutations});
  h.http.phase = 'verify-again';
  const mutations = h.http.mutations;
  assert.deepEqual(await new CanonicalLedgerStore({lifecycle: h.lifecycle}).load(), recipe.ledger);
  assert.equal(h.http.mutations, mutations);
  emit({phase: 'verify-again', ...stats('verify-again')});
  h.http.phase = 'release'; await h.lifecycle.release();
  emit({phase: 'release', ...stats('release'), totalElapsedMs: performance.now() - started});
}
