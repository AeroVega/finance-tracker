import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLedger, registerAccount } from '../js/canonical-import.mjs';
import { serializeCanonicalLedger } from '../js/canonical-ledger-storage.mjs';
import { SyntheticYearSeeder } from '../js/synthetic-year-seeder.mjs';
import { DashboardSyntheticStorage, requireEmptySyntheticFolder } from '../js/dashboard-synthetic-storage.mjs';
import { createSyntheticFinancialYear } from '../js/synthetic-financial-year.mjs';
import { setupHttpCanonicalWorkbench } from './helpers/pr28-http-workbench.mjs';

function fakeLifecycle() {
  let manifest = { syntheticOnly: true, role: 'primary', revision: 0, databaseId: 'invented-db', copyId: 'invented-copy', snapshot: {}, catalogFinalizationPending: null };
  let objects = {}, mutations = 0, failure = null;
  const lifecycle = {
    folderId: 'invented-folder', state: 'ready', acceptingWrites: true, manifestFileId: 'invented-manifest',
    get mutations() { return mutations; },
    get manifest() { return manifest; },
    set failure(value) { failure = value; },
    async readManifest() { return structuredClone(manifest); },
    async readObject(path) { return objects[path]; },
    async readVerifiedSnapshot() { return { manifest: structuredClone(manifest), objects: structuredClone(objects) }; },
    async transact(transaction) {
      assert.deepEqual(transaction.expectedBase, manifest);
      mutations++;
      if (failure === 'before') { failure = null; throw Object.assign(new Error('Uncertain'), { code: 'transaction-unresolved' }); }
      for (const {logicalPath, content} of transaction.objects) {
        objects[logicalPath] = new TextEncoder().encode(content); manifest.snapshot[logicalPath] = 'invented-hash';
      }
      manifest.revision++;
      if (failure === 'after') { failure = null; throw Object.assign(new Error('Lost response'), { code: 'transaction-unresolved' }); }
    },
    setLedger(ledger) {
      objects = {};
      manifest.snapshot = {};
      for (const [path, content] of serializeCanonicalLedger(ledger)) {
        objects[path] = new TextEncoder().encode(content); manifest.snapshot[path] = 'invented-hash';
      }
      manifest.revision = 1;
    }
  };
  return lifecycle;
}
function recipe() {
  return { ledger: registerAccount(createLedger(), { institutionId:'wells-fargo', displayName:'Invented account', currency:'USD', accountType:'checking' }) };
}

for (const files of [[], [{name:'foreign.txt'}], [{name:'ft-synthetic-dashboard-manifest.json'}], [{name:'finance-tracker-active-session.json',appProperties:{financeTrackerSession:'v1'}}]]) {
  test('fresh folder admission refuses every visible existing file: ' + JSON.stringify(files), async () => {
    let mutations = 0;
    const adapter = { async listChildren() { return files; }, async createImmutable() { mutations++; } };
    if (files.length) await assert.rejects(requireEmptySyntheticFolder(adapter), {code:'empty-folder-required'});
    else await requireEmptySyntheticFolder(adapter);
    assert.equal(mutations, 0);
  });
}

test('fresh admission pins exact copy and refuses nonpristine, nonprimary or production identities', async () => {
  for (const patch of [{revision:1},{role:'backup'},{syntheticOnly:false},{catalogFinalizationPending:'pending'},{snapshot:{other:'hash'}}]) {
    const lifecycle = fakeLifecycle(); Object.assign(lifecycle.manifest, patch);
    const seeder = new SyntheticYearSeeder({createRecipe:recipe});
    await assert.rejects(seeder.admitFreshConnection(lifecycle), {code:'fresh-genesis-required'});
    assert.equal(lifecycle.mutations, 0);
  }
});

test('one fresh upload verifies independently and repeated clicks never duplicate financial effects', async () => {
  const lifecycle = fakeLifecycle(), expected = recipe(), phases = [];
  const seeder = new SyntheticYearSeeder({createRecipe:() => expected, onProgress:phase => phases.push(phase)});
  await seeder.admitFreshConnection(lifecycle);
  const first = seeder.verifyOrSeed(lifecycle);
  await assert.rejects(seeder.verifyOrSeed(lifecycle), {code:'operation-in-progress'});
  assert.equal((await first).alreadySaved, false);
  assert.equal((await seeder.verifyOrSeed(lifecycle)).alreadySaved, true);
  assert.equal(lifecycle.mutations, 1);
  assert.deepEqual(phases.slice(0,5), ['preparing','checking','saving','reopening','verified']);
});

test('existing different data and unrelated snapshot objects are never replaced', async () => {
  for (const kind of ['ledger','other-object','changed-copy']) {
    const lifecycle = fakeLifecycle(), seeder = new SyntheticYearSeeder({createRecipe:recipe});
    await seeder.admitFreshConnection(lifecycle);
    if (kind === 'ledger') lifecycle.setLedger(recipe().ledger);
    if (kind === 'other-object') lifecycle.manifest.snapshot['synthetic/dashboard-transactions.json'] = 'hash';
    if (kind === 'changed-copy') lifecycle.manifest.copyId = 'other-copy';
    await assert.rejects(seeder.verifyOrSeed(lifecycle), {code:kind === 'changed-copy' ? 'new-empty-folder-required' : 'unrecognized-seed-copy'});
    assert.equal(lifecycle.mutations, 0);
  }
});

test('after reload only an exact saved recipe verifies; an empty existing folder cannot gain fresh permission', async () => {
  const lifecycle = fakeLifecycle(), expected = recipe();
  const seeder = new SyntheticYearSeeder({createRecipe:() => expected});
  await assert.rejects(seeder.verifyOrSeed(lifecycle), {code:'new-empty-folder-required'});
  lifecycle.setLedger(expected.ledger);
  assert.equal((await seeder.verifyOrSeed(lifecycle)).alreadySaved, true);
  assert.equal(lifecycle.mutations, 0);
});

test('uncertain committed outcome verifies without another write and aborted outcome retries only in the same tab', async () => {
  for (const failure of ['before','after']) {
    const lifecycle = fakeLifecycle(), expected = recipe(), seeder = new SyntheticYearSeeder({createRecipe:() => expected});
    await seeder.admitFreshConnection(lifecycle); lifecycle.failure = failure;
    await assert.rejects(seeder.verifyOrSeed(lifecycle), {code:'transaction-unresolved'});
    lifecycle.state = 'recovery-required'; lifecycle.acceptingWrites = false;
    await assert.rejects(seeder.verifyOrSeed(lifecycle), {code:'reconnect-required'});
    lifecycle.state = 'ready'; lifecycle.acceptingWrites = true;
    if (failure === 'before') await assert.rejects(new SyntheticYearSeeder({createRecipe:() => expected}).verifyOrSeed(lifecycle), {code:'new-empty-folder-required'});
    const result = await seeder.verifyOrSeed(lifecycle);
    assert.equal(result.alreadySaved, failure === 'after');
    assert.equal(lifecycle.mutations, failure === 'after' ? 1 : 2);
  }
});

test('the complete year saves and reopens through the legacy fragmented-v3 adapter and catalog/session engine with synthetic HTTP only', async () => {
  const setup = await setupHttpCanonicalWorkbench();
  const seeder = new SyntheticYearSeeder();
  await seeder.admitFreshConnection(setup.lifecycle);
  setup.http.phase = 'year-seed';
  const actual = await seeder.verifyOrSeed(setup.lifecycle);
  const requestCount = setup.http.summary('year-seed').requests;
  assert.ok(requestCount <= 660, `Fragmented seed with monthly index and bounded catalog segments exceeded its request budget: ${requestCount}`);
  assert.equal(setup.http.peakMutations, 1, 'durable mutations stay serial');
  setup.http.phase = 'year-verify';
  assert.equal(actual.alreadySaved, false);
  assert.deepEqual(actual.ledger, (await createSyntheticFinancialYear()).ledger);
  assert.equal((await seeder.verifyOrSeed(setup.lifecycle)).alreadySaved, true);
  assert.equal((await setup.lifecycle.readManifest()).revision, 1);
  await setup.lifecycle.release();
});

test('year UI is opt-in, has recovery and release, and cannot ingest user CSVs', () => {
  const html = readFileSync(new URL('../prototype/synthetic-year.html', import.meta.url),'utf8');
  const js = readFileSync(new URL('../prototype/synthetic-year.mjs', import.meta.url),'utf8');
  assert.match(html, /Production financial-data persistence remains NO-GO/);
  assert.match(html, /drive.file access cannot prove/);
  assert.doesNotMatch(html, /type="file"/);
  assert.doesNotMatch(html, /storage-layout|chunks-v2/);
  assert.match(html, /canonical version 4/i);
  assert.match(html, /compact-json-v1 values and paged fallback/);
  assert.match(html, /Opening a copy still verifies and loads the complete ledger/);
  assert.match(html, /href="\.\.\/index.html#storage">main workspace/);
  assert.doesNotMatch(html, /four-row preview|into 15 payload objects/);
  assert.doesNotMatch(js, /storage-layout|chunks-v2|serializePackedCanonicalLedger/);
  for (const id of ['upload','reconnect','verify','recover','stale','release']) assert.match(html, new RegExp('id="' + id + '"[^>]*disabled'));
  assert.match(js, /if \(busy\) return/);
  assert.match(js, /connect\(\{ requireEmpty: true, canonicalLayout: 'partitions-v5' \}\)/);
  assert.match(js, /connect\(\{ requireExisting: true \}\)/);
  assert.match(js, /beforeunload/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|console\./);
  const dashboard = readFileSync(new URL('../js/dashboard-synthetic-storage.mjs', import.meta.url),'utf8');
  assert.ok(dashboard.indexOf('if (requireEmpty) await requireEmptySyntheticFolder') < dashboard.indexOf('this.lifecycle = new ApplicationStorageLifecycle'));
  assert.ok(dashboard.indexOf('if (requireExisting && !inspected.manifestFileId)') < dashboard.indexOf('this.lifecycle = new ApplicationStorageLifecycle'));
});


test('year reconnect opts out of original-file retention and deletion even for an unrelated copy', async () => {
  const storage = new DashboardSyntheticStorage({maintainOriginals:false});
  storage.lifecycle = new Proxy({}, { get() { assert.fail('retention must not access this copy'); } });
  storage.originals = {process() { assert.fail('retention processing must not run'); }};
  await storage.startOriginalRetention();
  assert.equal(storage.originals, null);
  assert.equal(storage.retentionTimer, null);
  const ui = readFileSync(new URL('../prototype/synthetic-year.mjs',import.meta.url),'utf8');
  assert.match(ui, /maintainOriginals: false/);
  assert.equal(new DashboardSyntheticStorage().maintainOriginals, true, 'other tools keep established retention behavior');
});


test('legacy lifecycle fallback creates fragmented v3 and reconnect preserves it; grouped v2 is rejected', async () => {
  const lifecycle = fakeLifecycle(), generated = recipe();
  const seeder = new SyntheticYearSeeder({ createRecipe: () => generated });
  await seeder.admitFreshConnection(lifecycle); await seeder.verifyOrSeed(lifecycle);
  const index = JSON.parse(new TextDecoder().decode(await lifecycle.readObject('synthetic/canonical-v1/index.json')));
  assert.equal(index.version, 3);
  const writes = lifecycle.mutations;
  const reopened = new SyntheticYearSeeder({ createRecipe: () => generated });
  assert.equal((await reopened.verifyOrSeed(lifecycle)).alreadySaved, true);
  assert.equal(lifecycle.mutations, writes);
  assert.throws(() => new SyntheticYearSeeder({ layout: 'unknown' }), { code: 'unsupported-canonical-layout' });
  assert.throws(() => new SyntheticYearSeeder({ layout: 'chunks-v2' }), { code: 'unsupported-canonical-layout' });
});
