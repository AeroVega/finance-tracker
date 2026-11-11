import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogHistoryVerifier, verifyCatalogHistory, readCatalog, encode } from '../js/catalog-storage.mjs';
import { GoogleDriveTransactionAdapter } from '../js/drive-transaction-engine.mjs';
import { CatalogTransactionEngine } from '../js/catalog-transaction-engine.mjs';
import { setupCatalog } from './helpers/catalog-drive.mjs';
import { setupHttpCanonicalWorkbench } from './helpers/pr28-http-workbench.mjs';
import { createLedger, registerAccount } from '../js/canonical-import.mjs';
import { exportCatalogArchive, verifyCatalogArchive } from '../js/catalog-backup.mjs';
import { validateSyntheticApplicationSnapshot } from '../js/synthetic-application-structure.mjs';

async function setup() {
  const h = await setupCatalog();
  const result = await h.engine.transact(h.transaction);
  for (const file of h.adapter.files.values()) file.metadata.version = '90071992547409930';
  const create = h.adapter.createImmutable.bind(h.adapter);
  h.adapter.createImmutable = async input => {
    try { return await create(input); }
    finally { if (h.adapter.files.has(input.fileId)) h.adapter.files.get(input.fileId).metadata.version = '1'; }
  };
  h.adapter.readMetadataBatch = GoogleDriveTransactionAdapter.prototype.readMetadataBatch;
  const reads = [], original = h.adapter.readBytes.bind(h.adapter);
  h.adapter.readBytes = async id => { reads.push(id); return original(id); };
  const verifier = createCatalogHistoryVerifier();
  const verified = await verifier.verify(h.adapter, result.manifest);
  reads.length = 0;
  return { ...h, manifest: result.manifest, verifier, verified, reads };
}

const target = h => Object.values(h.verified.catalog.entries).find(entry => entry.kind === 'data-object');
const bump = file => { file.metadata.version = String(BigInt(file.metadata.version) + 1n); };

test('private history evidence reuses only exact versions and never shares returned byte buffers', async () => {
  const h = await setup();
  const original = h.verified.objects.get('data-object:' + target(h).identity).slice();
  h.verified.objects.get('data-object:' + target(h).identity).fill(0);
  h.verified.catalog.entries['data-object:' + target(h).identity].fileId = 'caller-rebound';
  const again = await h.verifier.verify(h.adapter, h.manifest);
  assert.deepEqual(again.objects.get('data-object:' + target({ verified: again }).identity), original);
  assert.deepEqual(h.reads, [h.manifest.locatorCatalog.fileId]);
  const changed = target({ verified: again });
  bump(h.adapter.files.get(changed.fileId));
  h.reads.length = 0;
  await h.verifier.verify(h.adapter, h.manifest);
  assert.deepEqual(new Set(h.reads), new Set([...[h.manifest.locatorCatalog.fileId], changed.fileId]));
});

test('changed historical bytes download again and fail even when the client hash tag is untouched', async () => {
  const h = await setup(), entry = target(h), file = h.adapter.files.get(entry.fileId);
  file.bytes[0] ^= 1; bump(file);
  await assert.rejects(h.verifier.verify(h.adapter, h.manifest), { code: 'immutable-hash-mismatch' });
  assert.ok(h.reads.includes(entry.fileId));
  file.bytes[0] ^= 1; bump(file);
  h.reads.length = 0;
  await h.verifier.verify(h.adapter, h.manifest);
  for (const entry of Object.values(h.verified.catalog.entries)) assert.ok(h.reads.includes(entry.fileId), 'failure clears every cached object');
});

test('cached objects still require both complete metadata brackets with unchanged bindings', async t => {
  const mutations = {
    missing: (map, id) => map.delete(id),
    duplicate: (map, id) => map.set('extra', map.get(id)),
    folder: (map, id) => { map.get(id).parents = ['other']; },
    trashed: (map, id) => { map.get(id).trashed = true; },
    hash: (map, id) => { map.get(id).appProperties.financeTrackerHash = '0'.repeat(64); },
    kind: (map, id) => { map.get(id).appProperties.financeTrackerKind = 'commit-record'; },
    version: (map, id) => { map.get(id).version += '1'; },
    'missing version': (map, id) => { delete map.get(id).version; }
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const h = await setup(), entry = target(h);
    const batch = h.adapter.readMetadataBatch.bind(h.adapter);
    let calls = 0;
    h.adapter.readMetadataBatch = async ids => {
      const result = await batch(ids);
      if (ids.includes(entry.fileId) && ++calls === 2) mutate(result, entry.fileId);
      return result;
    };
    const before = h.adapter.mutations;
    await assert.rejects(h.verifier.verify(h.adapter, h.manifest));
    assert.equal(h.adapter.mutations, before);
    assert.deepEqual(h.reads, [h.manifest.locatorCatalog.fileId], 'cache hit still checks closing bracket');
  });
});

test('clear during a verification prevents an in-flight operation from restoring evidence', async () => {
  const h = await setup(), batch = h.adapter.readMetadataBatch.bind(h.adapter);
  let calls = 0;
  h.adapter.readMetadataBatch = async ids => {
    const result = await batch(ids);
    if (++calls === 2) h.verifier.clear();
    return result;
  };
  await h.verifier.verify(h.adapter, h.manifest);
  h.reads.length = 0;
  await h.verifier.verify(h.adapter, h.manifest);
  for (const entry of Object.values(h.verified.catalog.entries)) assert.ok(h.reads.includes(entry.fileId));
});

test('cache limits and adapters without version batches fall back to complete byte reads', async t => {
  for (const options of [{ maxBytes: 0 }, { maxEntries: 0 }, { maxBytes: 1 }, { maxEntries: 1 }]) await t.test(JSON.stringify(options), async () => {
    const h = await setup(), verifier = createCatalogHistoryVerifier(options);
    await verifier.verify(h.adapter, h.manifest); h.reads.length = 0;
    await verifier.verify(h.adapter, h.manifest);
    assert.ok(h.reads.length >= Object.keys(h.verified.catalog.entries).length, 'at most one object fits');
  });
  const h = await setup();
  delete h.adapter.readMetadataBatch;
  await h.verifier.verify(h.adapter, h.manifest);
  h.reads.length = 0;
  await h.verifier.verify(h.adapter, h.manifest);
  for (const entry of Object.values(h.verified.catalog.entries)) assert.ok(h.reads.includes(entry.fileId));
});

test('a different adapter or lower manifest revision cannot reuse earlier evidence', async () => {
  const h = await setup();
  const replacement = Object.create(Object.getPrototypeOf(h.adapter));
  Object.assign(replacement, h.adapter);
  await h.verifier.verify(replacement, h.manifest);
  for (const entry of Object.values(h.verified.catalog.entries)) assert.ok(h.reads.includes(entry.fileId));
  h.reads.length = 0;
  await h.verifier.verify(replacement, h.transaction.expectedBase);
  assert.ok(h.reads.includes(Object.values(h.verified.catalog.entries).find(entry => entry.kind === 'commit-record' && entry.identity === h.transaction.expectedBase.commitId).fileId));
});

test('explicit recovery starts cold and rejects corruption even if simulated provider version fails to change', async () => {
  const h = await setup();
  await h.engine.verifyHistory(h.manifest);
  h.adapter.files.get(target(h).fileId).bytes[0] ^= 1;
  await assert.rejects(h.engine.recover({ manifestFileId: h.manifestFileId }), { code: 'immutable-hash-mismatch' });
  assert.equal(h.engine.recoveryRequired, true);
});

test('all durable interruption boundaries recover with warm history and retain exact old or new state', async t => {
  for (let boundary = 1; boundary <= 16; boundary++) await t.test('boundary ' + boundary, async () => {
    const h = await setup();
    await h.engine.verifyHistory(h.manifest);
    const start = h.adapter.mutations;
    h.adapter.stopAfter = start + boundary;
    await assert.rejects(h.engine.transact({ ...h.transaction, expectedBase: h.manifest,
      objects: [{ logicalPath: 'synthetic/ledger.json', content: '{"syntheticOnly":true,"value":2}' }] }), { code: 'transaction-unresolved' });
    h.adapter.reboot();
    const fresh = new CatalogTransactionEngine({ adapter: h.adapter, assertWritable: async () => {} });
    const recovered = await fresh.recover({ manifestFileId: h.manifestFileId });
    assert.equal(recovered.manifest.catalogFinalizationPending, null);
    assert.ok([1, 2].includes(recovered.manifest.revision));
    const verified = await verifyCatalogHistory(h.adapter, recovered.manifest);
    const hash = recovered.manifest.snapshot['synthetic/ledger.json'];
    assert.equal(JSON.parse(new TextDecoder().decode(verified.objects.get('data-object:' + hash))).value, recovered.manifest.revision);
    for (const [key, bytes] of h.verified.objects) assert.deepEqual(verified.objects.get(key), bytes);
    assert.deepEqual((await fresh.recover({ manifestFileId: h.manifestFileId })).manifest, recovered.manifest);
  });
});

test('warm recovery checks newly enumerated journal versions before reusing indexed bytes', async () => {
  const h = await setup();
  await h.engine.verifyHistory(h.manifest);
  const journal = Object.values(h.verified.catalog.entries).find(entry => entry.kind === 'journal-event');
  const list = h.adapter.listChildren.bind(h.adapter);
  let calls = 0;
  h.adapter.listChildren = async () => {
    if (++calls === 3) { const file = h.adapter.files.get(journal.fileId); file.bytes[0] ^= 1; bump(file); }
    return list();
  };
  const before = h.adapter.mutations;
  await assert.rejects(h.engine.recoverInternal({ manifestFileId: h.manifestFileId }), { code: 'immutable-hash-mismatch' });
  assert.equal(h.adapter.mutations, before);
});

test('HTTP lifecycle clears evidence on release/reconnect and backup exports retain full byte verification', async () => {
  const h = await setupHttpCanonicalWorkbench();
  const ledger = registerAccount(createLedger(), { institutionId: 'wells-fargo', displayName: 'Invented cache account', currency: 'USD', accountType: 'checking' });
  await h.driver.save(ledger); await h.driver.reopen();
  const manifest = h.http.json(h.manifestFileId), catalog = await readCatalog(h.lifecycle.transactionAdapter, manifest);
  const retained = Object.values(catalog.entries).length;
  h.http.phase = 'cached-reopen'; await h.driver.reopen();
  assert.ok(h.http.summary('cached-reopen').categories.media < retained);
  h.http.phase = 'archive';
  const archive = await exportCatalogArchive({ adapter: h.lifecycle.transactionAdapter, manifestFileId: h.manifestFileId,
    withSourceLock: operation => h.lifecycle.coordinator.withWrite(operation), validateStructure: validateSyntheticApplicationSnapshot });
  await verifyCatalogArchive(archive, { validateStructure: validateSyntheticApplicationSnapshot });
  assert.ok(h.http.summary('archive').categories.media >= retained);
  await h.lifecycle.release();
  h.http.phase = 'reconnect'; await h.lifecycle.start();
  assert.ok(h.http.summary('reconnect').categories.media >= retained);
  assert.deepEqual(await h.driver.reopen(), ledger);
  const historical = Object.values(catalog.entries).find(entry => entry.kind === 'data-object');
  // An uncached archive catches corruption even if a test double violates Drive's version contract.
  h.http.files.get(historical.fileId).bytes[0] ^= 1;
  await assert.rejects(h.driver.verifyPortable(), { code: 'immutable-hash-mismatch' });
});

test('warm cache never authorizes a write after ownership loss', async () => {
  const h = await setup();
  await h.engine.verifyHistory(h.manifest);
  h.engine.assertWritable = async () => { throw Object.assign(new Error('Invented lost lease'), { code: 'ownership-lost' }); };
  const before = h.adapter.mutations;
  await assert.rejects(h.engine.transact({ ...h.transaction, expectedBase: h.manifest }), { code: 'ownership-lost' });
  assert.equal(h.adapter.mutations, before);
  h.reads.length = 0;
  await h.engine.verifyHistory(h.manifest);
  for (const entry of Object.values(h.verified.catalog.entries)) assert.ok(h.reads.includes(entry.fileId), 'lease error discarded evidence');
});

test('Drive verification requests bypass the browser HTTP cache', async () => {
  const requests = [];
  const adapter = new GoogleDriveTransactionAdapter({ folderId: 'invented-cache-folder', accessToken: () => 'invented', fetchImpl: async (url, options) => {
    requests.push(options);
    return new Response('{}');
  } });
  await adapter.request('https://www.googleapis.com/drive/v3/files', { cache: 'force-cache' });
  await adapter.readBytes('invented-object');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.cache === 'no-store'));
});

test('rolled-back head cannot use a warm history to overwrite later durable commit evidence', async () => {
  const h = await setup();
  await h.engine.verifyHistory(h.manifest);
  h.adapter.files.get(h.manifestFileId).bytes = encode(h.transaction.expectedBase);
  bump(h.adapter.files.get(h.manifestFileId));
  const before = h.adapter.mutations;
  await assert.rejects(h.engine.transact({ ...h.transaction, expectedBase: h.manifest }));
  assert.equal(h.adapter.mutations, before);
  assert.equal(h.engine.recoveryRequired, true);
});

test('offline and failed ownership transitions discard warm lifecycle evidence', async t => {
  for (const mode of ['offline', 'ownership']) await t.test(mode, async () => {
    const h = await setupHttpCanonicalWorkbench();
    const ledger = registerAccount(createLedger(), { institutionId: 'wells-fargo', displayName: 'Invented transition', currency: 'USD', accountType: 'checking' });
    await h.driver.save(ledger); await h.driver.reopen();
    const manifest = h.http.json(h.manifestFileId), catalog = await readCatalog(h.lifecycle.transactionAdapter, manifest);
    const retained = Object.values(catalog.entries).length;
    if (mode === 'offline') await h.lifecycle.handleOffline();
    else {
      h.lifecycle.coordinator.assertCanWrite = async () => { throw Object.assign(new Error('Invented lease failure'), { code: 'ownership-lost' }); };
      await assert.rejects(h.lifecycle.requireReady(), { code: 'ownership-lost' });
    }
    h.http.phase = 'cold-after-transition';
    await h.lifecycle.engine.verifyHistory(manifest);
    assert.ok(h.http.summary('cold-after-transition').categories.media >= retained);
  });
});

test('an older successful read cannot refill evidence after a concurrent verification fails', async () => {
  const h = await setup(), batch = h.adapter.readMetadataBatch.bind(h.adapter);
  let release, reached;
  const paused = new Promise(resolve => { reached = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  let calls = 0;
  h.adapter.readMetadataBatch = async ids => {
    const result = await batch(ids);
    if (++calls === 2) { reached(); await resume; }
    return result;
  };
  const old = h.verifier.verify(h.adapter, h.manifest);
  await paused;
  await assert.rejects(h.verifier.verify(h.adapter, { ...h.manifest, manifestVersion: 'invalid' }), { code: 'catalog-manifest-required' });
  release(); await old;
  h.reads.length = 0;
  await h.verifier.verify(h.adapter, h.manifest);
  for (const entry of Object.values(h.verified.catalog.entries)) assert.ok(h.reads.includes(entry.fileId));
});

test('segment cache reuses only verified bytes and changed segment versions force exact rereads', async () => {
  const h = await setup();
  const root = await h.adapter.readJson(h.manifest.locatorCatalog.fileId);
  h.reads.length = 0;
  await h.verifier.verify(h.adapter, h.manifest);
  assert.deepEqual(h.reads, [h.manifest.locatorCatalog.fileId]);
  const file = h.adapter.files.get(root.segmentTip.fileId);
  file.bytes[0] ^= 1; bump(file);
  await assert.rejects(h.verifier.verify(h.adapter, h.manifest), { code: 'immutable-hash-mismatch' });
  assert.ok(h.reads.includes(root.segmentTip.fileId));
  file.bytes[0] ^= 1; bump(file); h.reads.length = 0;
  await h.verifier.verify(h.adapter, h.manifest);
  assert.ok(h.reads.includes(root.segmentTip.fileId), 'failed verification clears segment evidence too');
  for (const entry of Object.values(h.verified.catalog.entries)) assert.ok(h.reads.includes(entry.fileId));
});

test('cached segment metadata must agree at both version brackets', async () => {
  const h = await setup(), root = await h.adapter.readJson(h.manifest.locatorCatalog.fileId);
  const batch = h.adapter.readMetadataBatch.bind(h.adapter);
  let calls = 0;
  h.adapter.readMetadataBatch = async ids => {
    const metadata = await batch(ids);
    if (ids.includes(root.segmentTip.fileId) && ++calls === 2) metadata.get(root.segmentTip.fileId).version += '1';
    return metadata;
  };
  await assert.rejects(h.verifier.verify(h.adapter, h.manifest), { code: 'immutable-version-mismatch' });
});

test('segment reuse shares the existing byte budget and explicit clears force remote bytes', async () => {
  const h = await setup(), root = await h.adapter.readJson(h.manifest.locatorCatalog.fileId);
  const limited = createCatalogHistoryVerifier({ maxBytes: 1 });
  await limited.verify(h.adapter, h.manifest); h.reads.length = 0;
  await limited.verify(h.adapter, h.manifest);
  assert.ok(h.reads.includes(root.segmentTip.fileId));
  h.verifier.clear(); h.reads.length = 0;
  await h.verifier.verify(h.adapter, h.manifest);
  assert.ok(h.reads.includes(root.segmentTip.fileId));
});
