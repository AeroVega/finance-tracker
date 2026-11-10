import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountCopyGuide } from '../prototype/pr25-copy-guide.mjs';
import { createCopyGuideDriver, logicalArchiveGraph } from '../prototype/pr25-copy-guide-driver.mjs';
import { startCopyProgress, copyProgressText } from '../prototype/pr25-copy-progress.mjs';
import { MemoryCatalogDrive, setupCatalog } from './helpers/catalog-drive.mjs';
import { serializeCanonicalLedger, serializeFragmentedCanonicalLedger } from '../js/canonical-ledger-storage.mjs';
import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent } from '../js/canonical-import.mjs';
import { parseProviderCsv } from '../js/provider-csv.mjs';
import { exportCatalogArchive } from '../js/catalog-backup.mjs';
import { validateSyntheticApplicationSnapshot } from '../js/synthetic-application-structure.mjs';
import { encode, hashRaw } from '../js/catalog-storage.mjs';

const html = await readFile(new URL('../prototype/pr25-acceptance.html', import.meta.url), 'utf8');
const failure = code => Object.assign(new Error('Private provider body: secret-folder-id'), { code });
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function sourceFixture(serialize = serializeCanonicalLedger) {
  const setup = await setupCatalog();
  let ledger = registerAccount(createLedger(), { institutionId: 'wells-fargo', displayName: 'Invented source', currency: 'USD', accountType: 'checking' });
  const accountId = ledger.accounts[0].accountId;
  const parsed = await parseProviderCsv({ bytes: await readFile(new URL('../fixtures/pr28/wells-fargo-foundation.csv', import.meta.url)), sourceFormat: 'wells-fargo-csv-v1' });
  ledger = prepareCanonicalImport(ledger, { parsed, syntheticOnly: true, accountMappings: { default: accountId },
    coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } } }).ledger;
  ledger = applyFinancialEvent(ledger, { type: 'classification', commandId: 'invented-initial', activityId: ledger.activities[0].activityId, activityKind: 'spending', categoryId: 'invented-old' });
  // Intentionally differs from the untouched acceptance recipe. Exact source
  // history, not hardcoded event counts or dates, is the comparison contract.
  ledger = applyFinancialEvent(ledger, { type: 'category-correction', commandId: 'invented-correction', activityId: ledger.activities[0].activityId, categoryId: 'invented-corrected' });
  await setup.engine.transact({ manifestFileId: setup.manifestFileId, expectedBase: setup.manifest,
    objects: [...serialize(ledger)].map(([logicalPath, content]) => ({ logicalPath, content })), commitRecord: { operationType: 'synthetic-canonical-guide-test' } });
  return { ...setup, counts: Object.fromEntries(['accounts', 'imports', 'activities', 'events'].map(name => [name, ledger[name].length])) };
}

function element(id) {
  return { id, dataset: {}, disabled: false, hidden: false, textContent: '', value: '', files: [], events: new Map(),
    addEventListener(type, callback) { this.events.set(type, callback); }, emit(type, event) { return this.events.get(type)?.(event); },
    after(node) { node.afterId = id; } };
}
async function page(serialize = serializeCanonicalLedger) {
  const source = await sourceFixture(serialize);
  const sourceId = source.adapter.folderId, backupId = 'invented-backup-folder', restoreId = 'invented-restore-folder';
  const drives = new Map([[sourceId, source.adapter], [backupId, new MemoryCatalogDrive(backupId)], [restoreId, new MemoryCatalogDrive(restoreId)]]);
  const state = { picks: [sourceId, backupId, restoreId], calls: [], sessions: [], downloads: [], now: 0, timers: new Map(), sequence: 0,
    confirm: true, authorizations: 0, expired: false, start: async () => {}, release: async () => {}, resume: async () => {}, recover: async () => {} };
  class Coordinator {
    constructor(folder) { this.folder = folder; this.session = null; this.canWrite = false; this.queue = Promise.resolve(); state.sessions.push(this); }
    async start() { state.calls.push(['start', this.folder.id]); await state.start(this); this.session = { sessionId: 'invented-session-' + state.sessions.length }; this.canWrite = true; }
    startHeartbeat() { return () => state.calls.push(['stop', this.folder.id]); }
    async assertCanWrite() { if (!this.canWrite) throw failure('not-owner'); if (state.expired) { this.canWrite = false; throw failure('authorization-required'); } }
    withWrite(work) { const result = this.queue.then(async () => { await this.assertCanWrite(); return work(); }); this.queue = result.catch(() => {}); return result; }
    async release() { state.calls.push(['release', this.folder.id]); await this.queue; await state.release(this); this.session = null; this.canWrite = false; return { released: true }; }
    async resume() { state.calls.push(['resume', this.folder.id]); await state.resume(this); this.canWrite = true; }
    async inspect() { return { status: 'stale', record: { ...this.session } }; }
    async recoverStale({ confirm }) { assert.equal(confirm, true); state.calls.push(['recover', this.folder.id]); await state.recover(this); this.session ||= { sessionId: 'recovered-invented' }; this.canWrite = true; }
  }
  const driver = createCopyGuideDriver({ storage: { token() { if (state.expired) throw failure('authorization-required'); return 'invented-token'; } },
    authorize: async () => { state.authorizations++; state.expired = false; state.revoked = false; },
    pick: async title => { state.calls.push(['pick', title]); const id = state.picks.shift(); if (id instanceof Error) throw id; return { id, name: 'Private synthetic label' }; },
    makeAdapter: folder => drives.get(folder.id), makeCoordinator: folder => new Coordinator(folder),
    download: archive => state.downloads.push(structuredClone(archive)) });
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element(id)]));
  const get = id => elements.get(id), events = new Map();
  const ui = mountCopyGuide({ document: { getElementById: get }, driver,
    window: { confirm: () => state.confirm, addEventListener: (event, callback) => events.set(event, callback) }, now: () => state.now,
    progressFactory: options => startCopyProgress({ ...options, now: () => state.now,
      schedule: callback => { state.timers.set(++state.sequence, callback); return state.sequence; }, cancel: id => state.timers.delete(id) }) });
  ui.ready();
  const h = { state, drives, source, sourceId, backupId, restoreId, get, driver, events,
    click: id => get('guide-' + id).emit('click'),
    load: file => { get('guide-archive').files = file ? [file] : []; return get('guide-archive').emit('change'); },
    savedFile: () => ({ name: 'Private saved name.json', text: async () => JSON.stringify(state.downloads.at(-1)) }),
    text: () => [...elements.values()].map(item => item.textContent).join('\n') };
  return h;
}
async function throughExport(h) { await h.click('source'); await h.click('backup'); await h.click('export'); }

for (const [layout, serialize] of [['records-v1', serializeCanonicalLedger], ['fragments-v3', serializeFragmentedCanonicalLedger]])
test(layout + ': actual guide handlers complete corrected-source backup, saved-file roundtrip, independent restores and release', async () => {
  const h = await page(serialize);
  assert.equal(h.state.calls.length, 0, 'page load must not select or write');
  const mutations = h.source.adapter.mutations;
  await h.click('source'); assert.equal(h.get('guide-source-result').dataset.result, 'pass');
  const { accounts, imports, activities, events } = h.source.counts;
  assert.ok(h.get('guide-source-result').textContent.includes(`${accounts} accounts, ${imports} imports, ${activities} activities and ${events} audit events`));
  assert.equal(h.get('guide-backup').disabled, false); assert.equal(h.get('guide-restore').disabled, true);
  await h.click('backup'); assert.equal(h.get('guide-backup-reopen-result').dataset.result, 'pass');
  await h.click('export'); assert.match(h.get('guide-export-result').textContent, /Download requested/);
  assert.equal(h.get('guide-restore').disabled, true, 'in-memory export cannot pass local-file acceptance');
  assert.equal(h.get('guide-archive-result').dataset.result, 'pending');
  await h.load(h.savedFile()); assert.equal(h.get('guide-archive-result').dataset.result, 'pass');
  assert.equal(h.get('guide-export').disabled, true, 'do not silently reset an accepted file by downloading again');
  await h.click('restore');
  assert.equal(h.get('guide-restore-result').dataset.result, 'pass'); assert.equal(h.get('guide-restore-reopen-result').dataset.result, 'pass');
  assert.match(h.get('guide-next').textContent, /^Copy checks passed/);
  assert.equal(h.driver.hasSessions(), false); assert.equal(h.state.timers.size, 0);
  assert.equal(h.source.adapter.mutations, mutations, 'source data must not change');
  assert.deepEqual(h.state.calls.filter(([call]) => call === 'start').map(([, id]) => id), [h.sourceId, h.backupId, h.backupId, h.restoreId, h.restoreId]);
  assert.equal(h.state.calls.filter(([call]) => call === 'release').length, 5);
  assert.doesNotMatch(h.text(), /Private|secret-folder|invented-token|invented-backup-folder/);
  assert.match(h.get('guide-backup-time').textContent, /share this operation time/);
});

test('fragmented source corruption cannot produce a summary or enable backup', async () => {
  const h = await page(serializeFragmentedCanonicalLedger);
  const file = [...h.source.adapter.files.values()].find(file =>
    JSON.parse(new TextDecoder().decode(file.bytes)).format === 'finance-tracker-canonical-fragment');
  assert.ok(file, 'fixture must contain a canonical fragment');
  file.bytes = encode({});
  await h.click('source');
  assert.notEqual(h.get('guide-source-result').dataset.result, 'pass');
  assert.equal(h.get('guide-backup').disabled, true);
  assert.equal(h.drives.get(h.backupId).files.size, 0);
  await h.click('release');
});

test('empty, wrong and cancelled source choices never initialize storage or pass', async () => {
  for (const chosen of ['empty', 'cancel', 'backup']) {
    const h = await page();
    if (chosen === 'empty') h.state.picks = [h.backupId];
    if (chosen === 'cancel') h.state.picks = [failure('selection-cancelled')];
    if (chosen === 'backup') {
      const item = h.source.adapter.files.get(h.source.manifestFileId);
      item.bytes = encode({ ...await h.source.adapter.readJson(h.source.manifestFileId), role: 'backup' });
    }
    await h.click('source');
    assert.notEqual(h.get('guide-source-result').dataset.result, 'pass');
    assert.equal(h.state.sessions.length, 0); assert.equal(h.get('guide-backup').disabled, true);
    assert.equal(h.get('guide-source').disabled, false); assert.equal(h.drives.get(h.backupId).files.size, 0);
  }
});

test('cancelled backup, same source, and nonempty target cannot copy; a new selection can retry', async () => {
  const h = await page(); await h.click('source');
  const mutations = h.source.adapter.mutations;
  for (const choice of [failure('selection-cancelled'), h.sourceId]) {
    h.state.picks = [choice]; await h.click('backup');
    assert.notEqual(h.get('guide-backup-result').dataset.result, 'pass');
    assert.equal(h.state.sessions.length, 1); assert.equal(h.get('guide-export').disabled, true);
  }
  h.drives.get(h.backupId).files.set('invented-partial', { bytes: encode({}), metadata: { name: 'partial evidence' } });
  h.state.picks = [h.backupId]; await h.click('backup'); assert.equal(h.drives.get(h.backupId).files.size, 1);
  h.state.picks = [h.restoreId]; await h.click('backup'); assert.equal(h.get('guide-backup-reopen-result').dataset.result, 'pass');
  assert.equal(h.source.adapter.mutations, mutations);
});

test('rejected synthetic folder names explain the requirement without writing or losing verified prerequisites', async () => {
  const h = await page();
  h.state.picks = [failure('synthetic-folder-required'), h.sourceId];
  await h.click('source');
  assert.match(h.get('guide-source-result').textContent, /with 'synthetic' in its name/);
  assert.equal(h.state.sessions.length, 0);
  assert.equal(h.get('guide-backup').disabled, true);
  await h.click('source');
  const mutations = h.source.adapter.mutations;
  for (const kind of ['backup', 'restore']) {
    const targetId = kind === 'backup' ? h.backupId : h.restoreId;
    const sessions = h.state.sessions.length;
    h.state.picks = [failure('synthetic-folder-required'), targetId];
    await h.click(kind);
    const result = h.get(`guide-${kind}-result`);
    assert.equal(result.dataset.result, 'error');
    assert.match(result.textContent, /with 'synthetic' in its name/);
    assert.match(result.textContent, /No copy was started for this selection/);
    assert.doesNotMatch(result.textContent, /Provider details|Private|secret-folder/);
    assert.equal(h.state.sessions.length, sessions, 'rejected selection must not open a destination session');
    assert.equal(h.drives.get(targetId).files.size, 0, 'rejected selection must not write a destination');
    assert.equal(h.source.adapter.mutations, mutations);
    assert.equal(h.get(`guide-${kind}`).disabled, false, 'allow a deliberate valid selection');
    if (kind === 'backup') assert.equal(h.get('guide-source-result').dataset.result, 'pass');
    else assert.equal(h.get('guide-archive-result').dataset.result, 'pass');
    await h.click(kind);
    assert.equal(h.get(`guide-${kind}-reopen-result`).dataset.result, 'pass');
    if (kind === 'backup') {
      await h.click('export');
      await h.load(h.savedFile());
    }
  }
  assert.equal(h.driver.hasSessions(), false);
});

test('double click and overlapping file action are refused, progress is adjacent and durations remain beside earlier steps', async () => {
  const h = await page(); await h.click('source');
  const gate = deferred(); let admitted = false;
  h.state.start = async session => { if (session.folder.id === h.backupId && !admitted) { admitted = true; await gate.promise; } };
  h.state.now = 1000; const pending = h.click('backup'); await tick();
  assert.equal(h.get('guide-progress').afterId, 'guide-backup-result');
  const choices = h.state.calls.filter(([name]) => name === 'pick').length;
  await h.click('backup'); await h.click('export'); await h.load(h.savedFile());
  assert.equal(h.state.calls.filter(([name]) => name === 'pick').length, choices); assert.equal(h.state.downloads.length, 0);
  h.state.now = 13000; for (const callback of h.state.timers.values()) callback();
  gate.resolve(); await pending;
  assert.match(h.get('guide-backup-time').textContent, /12 seconds/);
  const before = h.get('guide-backup-time').textContent;
  await h.click('export'); assert.equal(h.get('guide-backup-time').textContent, before);
  assert.equal(h.state.timers.size, 0);
});

test('invalid, cancelled or different valid local archive cannot restore; export origin never counts as file selection', async () => {
  const h = await page(); await throughExport(h);
  assert.equal(h.get('guide-restore').disabled, true);
  for (const file of [null, { text: async () => 'private invalid JSON' }, { text: async () => JSON.stringify({}) }]) {
    await h.load(file); assert.equal(h.get('guide-restore').disabled, true); assert.notEqual(h.get('guide-archive-result').dataset.result, 'pass');
  }
  const otherExport = structuredClone(h.state.downloads[0]); otherExport.exportedAt = '2026-11-07T12:00:00.000Z';
  const { archiveSha256: _, ...unsigned } = otherExport; otherExport.archiveSha256 = await hashRaw(encode(unsigned));
  await h.load({ text: async () => JSON.stringify(otherExport) });
  assert.match(h.get('guide-archive-result').textContent, /actual file from this run/); assert.equal(h.get('guide-restore').disabled, true);
  await h.load(h.savedFile()); assert.equal(h.get('guide-restore').disabled, false);
  await h.load(null); assert.equal(h.get('guide-restore').disabled, true, 'a cancelled replacement selection is not passed');
  assert.doesNotMatch(h.text(), /private invalid JSON/);
});

test('source change after verification blocks backup without destination writes', async () => {
  const h = await page(); await h.click('source');
  const manifest = await h.source.adapter.readJson(h.source.manifestFileId);
  h.source.adapter.files.get(h.source.manifestFileId).bytes = encode({ ...manifest, role: 'backup' });
  await h.click('backup'); assert.match(h.get('guide-backup-result').textContent, /source changed/);
  assert.equal(h.drives.get(h.backupId).files.size, 0); assert.equal(h.get('guide-export').disabled, true);
});

test('valid manifest mutation after copy release fails independent reopen without erasing copy result', async () => {
  const h = await page(); await h.click('source'); let once = false;
  h.state.release = async session => {
    if (session.folder.id !== h.backupId || once) return; once = true;
    const adapter = h.drives.get(h.backupId), [file] = (await adapter.listChildren()).filter(file => file.appProperties?.financeTrackerKind === 'dashboard-synthetic-manifest');
    adapter.files.get(file.id).bytes = encode({ ...await adapter.readJson(file.id), role: 'primary' });
  };
  await h.click('backup'); assert.equal(h.get('guide-backup-result').dataset.result, 'pass');
  assert.equal(h.get('guide-backup-reopen-result').dataset.result, 'error'); assert.equal(h.get('guide-export').disabled, true);
});

test('copy failure and failed release stay distinct, forbid reuse and expose recovery rather than success', async () => {
  const h = await page(); await h.click('source');
  const target = h.drives.get(h.backupId), original = target.createImmutable.bind(target);
  target.createImmutable = async options => { await original(options); throw failure('private-error-code'); };
  // Force verification to fail as well so an ambiguous successful write cannot
  // incorrectly be called a failed copy by the test itself.
  target.readBytes = async () => { throw failure('provider-unavailable'); };
  h.state.release = async session => { if (session.folder.id === h.backupId) { session.canWrite = false; throw failure('release-unconfirmed'); } };
  await h.click('backup');
  assert.match(h.get('guide-backup-result').textContent, /copy or reopen failed, and session release also/);
  assert.equal(h.get('guide-backup').disabled, true); assert.equal(h.get('guide-export').disabled, true);
  assert.match(h.get('guide-next').textContent, /resolve session release/);
  assert.doesNotMatch(h.text(), /private-error-code|Private provider|durable quarantine/);
  h.state.release = async () => {}; await h.click('release');
  assert.equal(h.get('guide-source').disabled, false); assert.equal(h.get('guide-backup').disabled, true);
  h.state.picks = [h.sourceId, h.backupId]; await h.click('source'); await h.click('backup');
  assert.match(h.get('guide-backup-result').textContent, /new empty synthetic folder/);
});

test('explicit release reauthorizes and resumes only the same session, then resets every dependent step', async () => {
  const h = await page(); await h.click('source'); await h.click('backup');
  h.state.expired = true; h.state.sessions[0].canWrite = false;
  await h.click('release');
  assert.equal(h.state.authorizations, 2); assert.ok(h.state.calls.some(([name]) => name === 'resume'));
  assert.equal(h.driver.hasSessions(), false); assert.equal(h.get('guide-source').disabled, false);
  for (const id of ['backup', 'export', 'archive', 'restore']) assert.equal(h.get('guide-' + id).disabled, true);
  assert.match(h.get('guide-next').textContent, /choose your existing completed canonical synthetic source/);
});

test('already-released matching session is confirmed, replaced or stale sessions require safe resolution', async () => {
  for (const outcome of ['session-released', 'ownership-lost', 'stale-session']) {
    const h = await page(); await h.click('source'); h.state.sessions[0].canWrite = false;
    h.state.resume = async session => { if (outcome === 'session-released') session.session = null; throw failure(outcome); };
    await h.click('release');
    if (outcome === 'session-released') { assert.equal(h.driver.hasSessions(), false); assert.equal(h.get('guide-release-result').dataset.result, 'pass'); }
    else {
      assert.equal(h.get('guide-release-result').dataset.result, 'error'); assert.equal(h.get('guide-backup').disabled, true);
      assert.equal(h.state.calls.filter(([name]) => name === 'recover').length, 0);
      if (outcome === 'stale-session') {
        assert.equal(h.get('guide-recover-release').hidden, false);
        h.state.confirm = false; await h.click('recover-release'); assert.equal(h.state.calls.filter(([name]) => name === 'recover').length, 0);
        h.state.confirm = true; await h.click('recover-release'); assert.equal(h.driver.hasSessions(), false);
      }
    }
  }
});

test('source stale recovery is explicit and never equated with transaction recovery', async () => {
  const h = await page(); h.state.start = async () => { throw failure('stale-session'); };
  await h.click('source'); assert.equal(h.get('guide-recover').hidden, false);
  h.state.confirm = false; await h.click('recover'); assert.notEqual(h.get('guide-source-result').dataset.result, 'pass');
  assert.equal(h.state.calls.filter(([name]) => name === 'recover').length, 0);
  h.state.confirm = true; await h.click('recover'); assert.equal(h.get('guide-source-result').dataset.result, 'pass');
  assert.equal(h.state.calls.filter(([name]) => name === 'recover').length, 1);
});

test('pagehide while copy is pending cannot pass or launch a second release; interrupted writes stop and preserved target is not reused', async () => {
  const h = await page(); await h.click('source');
  const target = h.drives.get(h.backupId), gate = deferred();
  const original = target.createImmutable.bind(target); let admitted = false;
  target.createImmutable = async options => { if (!admitted) { admitted = true; await gate.promise; } return original(options); };
  const pending = h.click('backup'); while (!admitted) await tick();
  h.events.get('pagehide')(); gate.resolve(); await pending; await tick();
  assert.notEqual(h.get('guide-backup-result').dataset.result, 'pass'); assert.equal(h.get('guide-export').disabled, true);
  assert.match(h.get('guide-next').textContent, /interrupted/); assert.equal(h.state.timers.size, 0);
  assert.ok(h.state.calls.filter(([name, id]) => name === 'release' && id === h.backupId).length <= 1);
  await h.click('backup'); assert.equal(h.state.calls.filter(([name]) => name === 'pick').length, 2);
});

test('graph equality includes exact corrected records and is independent of archive object order', async () => {
  const h = await page(); const archive = await exportCatalogArchive({ adapter: h.source.adapter, manifestFileId: h.source.manifestFileId,
    withSourceLock: work => work(), validateStructure: validateSyntheticApplicationSnapshot });
  const reordered = structuredClone(archive); reordered.objects.reverse(); reordered.manifest.copyId = 'invented-new-copy';
  assert.equal(logicalArchiveGraph(archive), logicalArchiveGraph(reordered));
  reordered.objects[0].contentBase64 += 'A'; assert.notEqual(logicalArchiveGraph(archive), logicalArchiveGraph(reordered));
  assert.match(copyProgressText({ phase: 'choosing-source' }).phase, /existing completed source/);
  assert.match(copyProgressText({ phase: 'releasing-source' }).phase, /source session/);
});

test('guide has separate outcomes, advanced controls and no persisted report identifiers', async () => {
  const source = await readFile(new URL('../prototype/pr25-copy-guide.mjs', import.meta.url), 'utf8');
  const driver = await readFile(new URL('../prototype/pr25-copy-guide-driver.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source + driver, /localStorage|sessionStorage|indexedDB|console\.|innerHTML/);
  assert.match(html, /id="guide-advanced"/); assert.match(html, /id="legacy-tools"/);
  assert.match(html, /BACKUP folder with "synthetic" in its name/);
  assert.match(html, /RESTORED COPY folder with "synthetic" in its name/);
  for (const id of ['source', 'backup', 'backup-reopen', 'export', 'archive', 'restore', 'restore-reopen', 'release']) assert.match(html, new RegExp('id="guide-' + id + '-result"'));
});

test('actual guide handlers preserve the completed HTTP-adapter recipe plus a sixteenth intentional correction', async () => {
  const { setupHttpCanonicalWorkbench, loadCanonicalFixtureBytes } = await import('./helpers/pr28-http-workbench.mjs');
  const { createLiveRunner } = await import('../prototype/pr28-live-checks.mjs');
  const { HttpCatalogDrive } = await import('./helpers/http-catalog-drive.mjs');
  const { GoogleDriveTransactionAdapter } = await import('../js/drive-transaction-engine.mjs');
  const { SessionCoordinator } = await import('../js/session-coordination.mjs');
  const { createDriveSessionAdapter } = await import('../js/drive-session-adapter.mjs');
  const { ApplicationStorageLifecycle } = await import('../js/application-storage-lifecycle.mjs');
  const { CanonicalLedgerStore } = await import('../js/canonical-ledger-storage.mjs');
  const source = await setupHttpCanonicalWorkbench();
  const runner = createLiveRunner({ withWorkbench: source.withWorkbench, loadBytes: loadCanonicalFixtureBytes });
  assert.equal(await runner.run(), true);
  await source.lifecycle.start(); const before = await source.driver.reopen();
  assert.equal(before.events.length, 15);
  const corrected = applyFinancialEvent(before, { type: 'category-correction', commandId: 'invented-extra-guide-correction',
    activityId: before.activities[0].activityId, categoryId: 'invented-manual-correction-after-recipe' });
  assert.equal(corrected.events.length, 16);
  await source.driver.save(corrected); await source.driver.release();
  const baselineManifest = source.http.json(source.manifestFileId);
  const backup = new HttpCatalogDrive({ folderId: 'invented-guide-http-backup', idPrefix: 'invented-guide-backup-' });
  const restored = new HttpCatalogDrive({ folderId: 'invented-guide-http-restored', idPrefix: 'invented-guide-restored-' });
  const drives = new Map([source.http, backup, restored].map(http => [http.folderId, http]));
  const picks = [...drives.keys()], sessions = []; let downloaded;
  const accessToken = () => 'invented-test-token';
  const driver = createCopyGuideDriver({ storage: { token: accessToken }, authorize: async () => {},
    pick: async () => ({ id: picks.shift(), name: 'Invented synthetic HTTP guide' }),
    makeAdapter: folder => new GoogleDriveTransactionAdapter({ folderId: folder.id, accessToken, fetchImpl: drives.get(folder.id).fetch }),
    makeCoordinator: folder => { const coordinator = new SessionCoordinator({ adapter: createDriveSessionAdapter({ folderId: folder.id, accessToken, fetchImpl: drives.get(folder.id).fetch }) }); sessions.push(coordinator); return coordinator; },
    download: archive => { downloaded = structuredClone(archive); } });
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element(id)])), get = id => elements.get(id);
  const ui = mountCopyGuide({ document: { getElementById: get }, window: { addEventListener() {}, confirm: () => true }, driver,
    progressFactory: options => startCopyProgress({ ...options, schedule: () => 1, cancel() {} }) });
  ui.ready();
  try {
    for (const id of ['source', 'backup', 'export']) {
      await get('guide-' + id).emit('click'); assert.equal(get('guide-' + id + '-result').dataset.result, 'pass', get('guide-' + id + '-result').textContent);
    }
    assert.equal(get('guide-restore').disabled, true);
    get('guide-archive').files = [{ text: async () => JSON.stringify(downloaded) }]; await get('guide-archive').emit('change');
    await get('guide-restore').emit('click');
    assert.equal(get('guide-restore-reopen-result').dataset.result, 'pass', get('guide-restore-reopen-result').textContent);
    assert.equal(sessions.length, 5); assert.ok(sessions.every(session => !session.canWrite && session.session === null));
    assert.deepEqual(source.http.json(source.manifestFileId), baselineManifest);
    for (const target of [backup, restored]) {
      const [file] = [...target.files.values()].filter(file => file.metadata.appProperties?.financeTrackerKind === 'dashboard-synthetic-manifest');
      const lifecycle = new ApplicationStorageLifecycle({ syntheticOnly: true, catalogProtocol: true, folderName: 'Invented synthetic guide comparison',
        folderId: target.folderId, manifestFileId: file.metadata.id, accessToken, fetchImpl: target.fetch, makeManifest: () => ({}),
        lifecycleTarget: new EventTarget(), setIntervalImpl: () => 1, clearIntervalImpl() {} });
      await lifecycle.start();
      try { const ledger = await new CanonicalLedgerStore({ lifecycle }).load(); assert.deepEqual(ledger, corrected); assert.equal(ledger.events.length, 16); }
      finally { await lifecycle.release(); }
    }
  } finally { await driver.releaseAll(); }
});

test('retained original imports are explicitly unsupported and never copied by the focused guide', async () => {
  const { SyntheticOriginalRetentionStore } = await import('../js/drive-original-retention.mjs');
  const h = await page();
  const originals = new SyntheticOriginalRetentionStore({ adapter: h.source.adapter, withWrite: work => work(), assertWritable: async () => {} });
  await originals.retainFixture();
  const mutations = h.source.adapter.mutations;
  await h.click('source');
  assert.match(h.get('guide-source-result').textContent, /separately retained original files/);
  assert.equal(h.get('guide-backup').disabled, true); assert.equal(h.get('guide-export').disabled, true);
  assert.equal(h.drives.get(h.backupId).files.size, 0); assert.equal(h.source.adapter.mutations, mutations);
  await h.click('release'); assert.equal(h.driver.hasSessions(), false);
});

test('failed destination release alone never passes copy or reopen and explicit matching-session release can recover', async () => {
  const h = await page(); await h.click('source');
  h.state.release = async session => { if (session.folder.id === h.backupId) { session.canWrite = false; throw failure('release-unconfirmed'); } };
  await h.click('backup');
  assert.equal(h.get('guide-backup-result').dataset.result, 'error'); assert.notEqual(h.get('guide-backup-reopen-result').dataset.result, 'pass');
  assert.equal(h.get('guide-export').disabled, true); assert.equal(h.get('guide-backup').disabled, true);
  assert.equal(h.state.sessions.filter(session => session.folder.id === h.backupId).length, 1, 'no independent reopen until release verifies');
  h.state.release = async () => {}; await h.click('release');
  assert.equal(h.get('guide-release-result').dataset.result, 'pass');
  for (const id of ['backup', 'export', 'archive', 'restore']) assert.equal(h.get('guide-' + id).disabled, true);
});

test('failed restore never inherits prior local-file success or reuses a partially written folder', async () => {
  const h = await page(); await throughExport(h); await h.load(h.savedFile());
  const target = h.drives.get(h.restoreId); target.stopAfter = 2;
  await h.click('restore');
  assert.equal(h.get('guide-restore-result').dataset.result, 'error'); assert.notEqual(h.get('guide-restore-reopen-result').dataset.result, 'pass');
  assert.match(h.get('guide-restore-result').textContent, /Quarantine has NOT been independently confirmed/);
  target.reboot(); const mutations = target.mutations;
  h.state.picks = [h.restoreId]; await h.click('restore');
  assert.match(h.get('guide-restore-result').textContent, /new empty synthetic folder/); assert.equal(target.mutations, mutations);
});


test('normal internal navigation waits for verified release while abrupt pagehide remains handled', async () => {
  const h = await page(); await h.click('source');
  for (const id of ['guide-return', 'prototype-tools']) {
    let blocked = false;
    h.get(id).emit('click', { preventDefault() { blocked = true; } });
    assert.equal(blocked, true); assert.equal(h.get(id).ariaDisabled, 'true');
    assert.match(h.get('guide-navigation-result').textContent, /Release sessions before leaving/);
  }
  await h.click('release');
  let blocked = false; h.get('guide-return').emit('click', { preventDefault() { blocked = true; } });
  assert.equal(blocked, false); assert.equal(h.get('guide-return').ariaDisabled, 'false');
});


test('release reauthorizes a provider-rejected token even when its local expiry is still valid', async () => {
  const h = await page(); await h.click('source');
  h.state.revoked = true; h.state.expired = false;
  h.state.resume = async () => { if (h.state.revoked) throw failure('authorization-required'); };
  await h.click('release');
  assert.equal(h.state.authorizations, 2); assert.equal(h.state.revoked, false);
  assert.equal(h.get('guide-release-result').dataset.result, 'pass'); assert.equal(h.driver.hasSessions(), false);
});

test('pagehide during a pending source claim releases a late successful claim and stops its heartbeat', async () => {
  const h = await page(), claim = deferred(); let admitted = false;
  h.state.start = async () => { admitted = true; await claim.promise; };
  const pending = h.click('source'); while (!admitted) await tick();
  h.events.get('pagehide')(); claim.resolve(); await pending; await tick();
  assert.equal(h.driver.hasSessions(), false); assert.equal(h.state.sessions[0].canWrite, false);
  assert.equal(h.state.calls.filter(([name]) => name === 'release').length, 1);
  assert.equal(h.state.calls.filter(([name]) => name === 'stop').length, 1);
  assert.equal(h.get('guide-source-result').dataset.result, 'error'); assert.match(h.get('guide-next').textContent, /interrupted/);
  assert.equal(h.get('guide-backup').disabled, true); assert.equal(h.state.timers.size, 0);
});


test('pagehide during pending stale-source recovery releases the late claim, and failed cleanup remains unconfirmed', async () => {
  for (const releaseFails of [false, true]) {
    const h = await page(), recovery = deferred(); let admitted = false;
    h.state.start = async () => { throw failure('stale-session'); };
    await h.click('source');
    h.state.recover = async () => { admitted = true; await recovery.promise; };
    if (releaseFails) h.state.release = async () => { throw failure('release-unconfirmed'); };
    const pending = h.click('recover'); while (!admitted) await tick();
    h.events.get('pagehide')(); recovery.resolve(); await pending; await tick();
    assert.equal(h.get('guide-source-result').dataset.result, 'error'); assert.equal(h.get('guide-backup').disabled, true);
    assert.equal(h.state.calls.filter(([name]) => name === 'release').length, 1);
    assert.equal(h.driver.hasSessions(), releaseFails);
    if (releaseFails) assert.match(h.get('guide-release-result').textContent, /Release after interruption was not confirmed/);
    else assert.equal(h.state.sessions[0].canWrite, false);
    assert.equal(h.state.timers.size, 0);
  }
});
