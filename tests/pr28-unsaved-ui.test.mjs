import { showDiagnostic, clearDiagnostic } from '../js/app-diagnostics.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as canonical from '../js/canonical-import.mjs';
import { canonicalizeJcs } from '../js/transaction-protocol.mjs';
import { parseProviderCsv } from '../js/provider-csv.mjs';
import {CanonicalLedgerStore as ActualCanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {EMPTY_CANONICAL_BYTES,emptyCanonicalRootHash,PAGED_CANONICAL_VERIFIER} from '../js/paged-canonical-format.mjs';
import {verifyPartitionedCanonicalCommit} from '../js/canonical-paged-storage.mjs';

const moduleUrl = new URL('../prototype/pr28-import.mjs', import.meta.url);
const source = await readFile(moduleUrl, 'utf8');
const html = await readFile(new URL('../prototype/pr28-import.html', import.meta.url), 'utf8');
const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// Execute the real page handlers and financial functions with a small DOM and
// controlled storage responses. Persistence protocol tests use the real engine.
async function controller({ guided = false, actualPaged = false } = {}) {
  const empty=actualPaged?await emptyCanonicalRootHash():null,objects=new Map(actualPaged?[[empty,EMPTY_CANONICAL_BYTES.slice()]]:[]);
  let manifest={version:4,syntheticOnly:true,role:'primary',revision:'0',pending:null,root:empty,databaseId:'invented-db',copyId:'invented-copy'};
  const nodes = new Map(), allNodes = [], listeners = new Map(), prompts = [];
  let focused, storage;
  const state = { saved: null, answer: true, onSave: null, onLoad: null, onConnect: null, cacheFailure: false, preserveBaseOnSaveError: false };
  const calls = { connects: 0, loads: 0, saves: 0, releases: 0, recoveries: 0 };
  function element(tag = '') {
    let text = '';
    const item = { tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, events: new Map(), value: '', disabled: false, hidden: false, checked: false, writes: 0,
      get textContent() { return text; }, set textContent(value) { text = value; this.writes++; },
      append(...children) { this.children.push(...children); if (this.tagName === 'SELECT' && this.children.length === children.length) this.value = children[0]?.value || ''; },
      prepend(...children) { this.children.unshift(...children); },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(type, callback) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(callback); },
      async emit(type, event = {}) { for (const callback of this.events.get(type) || []) await callback(event); },
      focus() { focused = this; }, select() { this.selected = true; }, remove() {},
      insertAdjacentElement(position, node) { this.diagnosticPanel = node; },
      querySelectorAll(selector) { const tags = selector.split(',').map(tag => tag.toUpperCase()); return descendants(this).filter(node => tags.includes(node.tagName)); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    };
    allNodes.push(item); return item;
  }
  function descendants(item) { return item.children.flatMap(child => [child, ...descendants(child)]); }
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"/g)) nodes.set(match[2], element(match[1]));
  if (guided) { nodes.set('workbench-details', element('details')); nodes.set('workbench', element('div')); nodes.set('pause-canonical', element('button')); }
  const get = id => nodes.get(id) || null;
  const controls = () => allNodes.filter(node => ['BUTTON', 'INPUT', 'SELECT'].includes(node.tagName));
  if (guided) get('workbench').querySelectorAll = controls;
  get('fixture').value = 'wells-foundation';
  get('event-type').value = 'classification'; get('classification').value = 'spending';
  class Storage {
    constructor(options) { this.options = options; this.lifecycle = null; storage = this; }
    async prepare() {}
    async connect(options) {
      if(actualPaged)assert.equal(options.canonicalLayout,'partitions-v5');
      calls.connects++; await state.onConnect?.();
      this.lifecycle = { state: 'ready', acceptingWrites: true, started: true, coordinator: { canWrite: true },
        async recover() { calls.recoveries++; this.state = 'ready'; this.acceptingWrites = true; }
      };
      if(actualPaged)Object.assign(this.lifecycle,{pagedCanonical:true,folderId:'invented-folder',
        readManifest:async()=>structuredClone(manifest),
        assertCurrentManifest:async expected=>assert.deepEqual(expected,manifest),
        readPartitionedSnapshot:async()=>({manifest:structuredClone(manifest),rootHash:manifest.root,semanticVersion:PAGED_CANONICAL_VERIFIER,store:{read:async hash=>{if(!objects.has(hash))throw new Error('missing bytes');return objects.get(hash).slice();}}}),
        async savePartitionedRoot({expectedBase,rootHash,objects:descriptors,preparationStore,semanticVersion,prepare}){
          assert.deepEqual(expectedBase,manifest);calls.saves++;await state.onSave?.();
          if(prepare)({rootHash,objects:descriptors,preparationStore}=await prepare({rootHash:manifest.root,semanticVersion,store:{read:async hash=>{assert.ok(objects.has(hash));return objects.get(hash).slice();}}}));
          for(const d of descriptors)objects.set(d.sha256,await preparationStore.read(d.sha256));
          const next={...manifest,root:rootHash,revision:String(BigInt(manifest.revision)+1n)};
          await verifyPartitionedCanonicalCommit({manifest:next,commit:{root:rootHash,previousRoot:manifest.root,revision:next.revision,semanticVersion,operation:'synthetic-canonical-import',changeEvidenceRoot:null},readObject:async q=>objects.get(q.sha256)});manifest=next;
        }});
    }
    async recoverStaleSession() { await this.lifecycle.recover(); }
    async release() { calls.releases++; this.lifecycle = null; }
  }
  class Store {
    constructor(options){if(actualPaged)return new ActualCanonicalLedgerStore(options);}
    async load() { this.base = null; calls.loads++; await state.onLoad?.(); this.base = { databaseId: 'invented-database', copyId: 'invented-copy', revision: calls.saves }; return structuredClone(state.saved); }
    async save(next) {
      const priorBase = this.base; this.base = null; calls.saves++;
      try { await state.onSave?.(next); } catch (error) { if (state.preserveBaseOnSaveError) this.base = priorBase; throw error; }
      await storage.options.afterMutation();
      state.saved = structuredClone(next); this.base = { databaseId: 'invented-database', copyId: 'invented-copy', revision: calls.saves }; return structuredClone(state.saved);
    }
  }
  const context = { ...canonical, createLedgerSessionOwner: () => {
    const owner = canonical.createLedgerSessionOwner();
    return { invalidate: owner.invalidate, open: (...args) => { if (state.cacheFailure) throw new Error('invented cache allocation failure'); return owner.open(...args); } };
  }, applyFinancialEvent: (ledger, command) => canonical.applyFinancialEvent(ledger, JSON.parse(JSON.stringify(command))), parseProviderCsv, DashboardSyntheticStorage: Storage, CanonicalLedgerStore: Store,
    document: { getElementById: get, createElement: element, querySelectorAll: controls },
    window: { addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); } },
    navigator: { onLine: true }, crypto, canonicalizeJcs: value => canonicalizeJcs(JSON.parse(JSON.stringify(value))), structuredClone, URL, Uint8Array,
    confirm: question => { prompts.push(question); return typeof state.answer === 'function' ? state.answer(question) : state.answer; },
    fetch: async url => { const bytes = await readFile(url); return { ok: true, arrayBuffer: async () => bytes }; }
  };
  const executable = source.replace(/^import .*;$/gm, '').replace(/^export /gm, '').replaceAll('import.meta.url', JSON.stringify(moduleUrl.href));
  context.clearDiagnostic = clearDiagnostic;
  context.showDiagnostic = (error, options) => showDiagnostic(error, { ...options, document: context.document, navigator: context.navigator });
  vm.runInNewContext(executable + '\nglobalThis.page = { withAcceptanceWorkbench, subscribeAcceptanceStatus, pausePreparedInterruption, inspect: () => ({ ledger, dirty, busy, store, saveState, ledgerSession }) };', context);
  await tick();
  const click = id => get(id).emit('click');
  return { state, calls, get, click, prompts, listeners, context, page: context.page, storage: () => storage, focused: () => focused,
    leave() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; for (const callback of listeners.get('beforeunload') || []) callback(event); return event; },
    async stage() {
      await click('parse');
      const labels = descendants(get('mappings')).filter(node => node.tagName === 'LABEL');
      const field = prefix => labels.find(label => label.textContent.startsWith(prefix)).children[0];
      field('Explicit destination').value = 'new'; field('New invented').value = 'Invented unsaved UI checking';
      field('New account ISO').value = 'USD'; field('New account type').value = 'checking';
      field('Declared start').value = '2026-01-01'; field('Declared end').value = '2026-01-31'; field('I confirm').checked = true;
      await click('stage'); assert.equal(context.page.inspect().dirty, true);
    }
  };
}

const status = h => h.get('save-status-text').textContent;

test('visible shared callout describes manual save and native-warning limits without hiding inside the optional workbench', () => {
  const connection = html.slice(html.indexOf('<section id="connect-storage"'), html.indexOf('<section id="choose-source"'));
  assert.match(connection, /id="save-status"/);
  assert.match(connection, /id="save-status-text" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(connection, /Changes are not saved automatically/);
  assert.match(connection, /Browser close or reload warnings may not appear, especially on mobile/);
  assert.match(connection, /href="#save-records"/);
  assert.match(html, /id="save-title" tabindex="-1"/);
  assert.doesNotMatch(html, /id="dirty"[^>]*role="status"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|sendBeacon/);
});

test('actual handlers warn only for dirty or busy state, never autosave, and keep one native listener', async () => {
  const h = await controller();
  assert.equal(h.leave().prevented, false); assert.equal(h.calls.saves, 0);
  const gate = deferred(); h.state.onConnect = () => gate.promise;
  const connecting = h.click('connect');
  assert.match(status(h), /Operation in progress/); assert.doesNotMatch(status(h), /Saving and verifying/);
  assert.equal(h.leave().prevented, true);
  gate.resolve(); await connecting;
  assert.equal(h.leave().prevented, false);
  await h.stage();
  assert.match(status(h), /Unsaved changes.*Save canonical ledger/);
  assert.equal(h.get('show-save').hidden, false);
  assert.equal(h.calls.saves, 0);
  const warning = h.leave(); assert.equal(warning.prevented, true); assert.equal(warning.returnValue, '');
  assert.equal(h.calls.saves, 0);
  const writes = h.get('save-status-text').writes;
  for (let i = 0; i < 4; i++) h.storage().options.onStatus({ message: 'Connection still ready.' });
  assert.equal(h.get('save-status-text').writes, writes, 'unchanged heartbeat status is not announced again');
  assert.equal(h.listeners.get('beforeunload').length, 1);
  await h.click('save');
  assert.equal(h.calls.saves, 1); assert.equal(h.page.inspect().dirty, false);
  assert.match(status(h), /No unsaved changes/); assert.equal(h.leave().prevented, false);
  assert.equal(h.get('show-save').hidden, true);
});

test('saving remains dirty and guarded until verification resolves and repeated Save cannot write twice', async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  const gate = deferred(); h.state.onSave = () => gate.promise;
  const pending = h.click('save');
  assert.match(status(h), /Saving and verifying changes/); assert.equal(h.page.inspect().dirty, true);
  assert.equal(h.get('save').disabled, true); assert.equal(h.leave().prevented, true);
  await h.click('save'); assert.equal(h.calls.saves, 1);
  gate.resolve(); await pending;
  assert.match(status(h), /No unsaved changes/); assert.match(h.get('result').textContent, /saved and verified/);
  assert.equal(h.leave().prevented, false);
});

for (const code of ['history-rewrite-refused', 'recovery-required']) test(`${code} keeps staged changes and never claims a verified save`, async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  const original = h.page.inspect().ledger;
  h.state.onSave = next => {
    // Simulate an uncertain outcome that may already have written data.
    if (code === 'recovery-required') h.state.saved = structuredClone(next);
    throw Object.assign(new Error('private provider text'), { code });
  };
  await h.click('save');
  assert.equal(h.page.inspect().ledger, original); assert.equal(h.page.inspect().dirty, true);
  assert.match(status(h), /Save did not finish and verify.*recovery.*reopen/i);
  assert.doesNotMatch(status(h), /nothing.*saved|no data saved|saved successfully/i);
  assert.doesNotMatch(h.get('result').textContent, /private provider text/);
  assert.equal(h.leave().prevented, true); assert.equal(h.calls.saves, 1);
  h.state.onLoad = () => { throw Object.assign(new Error('unavailable'), { code: 'offline' }); };
  await h.click('reopen'); assert.equal(h.page.inspect().ledger, original); assert.equal(h.page.inspect().dirty, true);
  assert.match(status(h), /Save did not finish and verify/);
  h.state.onLoad = null; await h.click('reopen');
  assert.equal(h.page.inspect().dirty, false); assert.match(status(h), /No unsaved changes/);
  assert.equal(h.leave().prevented, false);
});

test('cancelled connect, reopen and release preserve dirty ledger without starting storage actions', async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  const original = h.page.inspect().ledger, calls = { ...h.calls };
  h.state.answer = false;
  for (const id of ['connect', 'reopen', 'release']) {
    await h.click(id); assert.equal(h.page.inspect().ledger, original); assert.equal(h.page.inspect().dirty, true);
    assert.equal(h.leave().prevented, true);
  }
  assert.deepEqual(h.calls, calls); assert.equal(h.prompts.length, 3);
  assert.match(h.prompts[0], /Discard unsaved/); assert.match(h.prompts[1], /Discard unsaved/); assert.match(h.prompts[2], /without saving/);
});

test('confirmed reconnect/reopen clear dirty only after successful load, and cancelled connection preserves local work', async () => {
  for (const id of ['connect', 'reopen']) {
    const h = await controller(); await h.click('connect'); await h.stage();
    const original = h.page.inspect().ledger, gate = deferred(); h.state.onLoad = () => gate.promise;
    const opening = h.click(id); await tick();
    assert.equal(h.page.inspect().ledger, original); assert.equal(h.page.inspect().dirty, true); assert.equal(h.leave().prevented, true);
    gate.resolve(); await opening;
    assert.equal(h.page.inspect().dirty, false); assert.equal(h.page.inspect().ledger.imports.length, 0);
  }
  const h = await controller(); await h.click('connect'); await h.stage(); const original = h.page.inspect().ledger;
  h.state.onConnect = () => { throw Object.assign(new Error('cancelled'), { code: 'connection-cancelled' }); };
  await h.click('connect');
  assert.equal(h.page.inspect().ledger, original); assert.equal(h.page.inspect().dirty, true);
  assert.match(status(h), /Unsaved changes.*Saving is unavailable/); assert.equal(h.leave().prevented, true);
});

test('confirmed release leaves unsaved ledger in the tab and keeps the warning with Save unavailable', async () => {
  const h = await controller(); await h.click('connect'); await h.stage(); const original = h.page.inspect().ledger;
  await h.click('release');
  assert.equal(h.calls.releases, 1); assert.equal(h.calls.saves, 0);
  assert.equal(h.page.inspect().ledger, original); assert.equal(h.page.inspect().dirty, true);
  assert.equal(h.get('save').disabled, true); assert.match(status(h), /Unsaved changes.*Saving is unavailable/);
  assert.equal(h.leave().prevented, true);
});

test('recovery asks before replacing dirty records and cancellation preserves local work', async () => {
  for (const id of ['stale', 'recover']) {
    const h = await controller(); await h.click('connect'); await h.stage(); const original = h.page.inspect().ledger;
    h.storage().lifecycle.state = id === 'stale' ? 'stale-session' : 'recovery-required';
    h.state.answer = question => !question.includes('Discard unsaved');
    await h.click(id);
    assert.equal(h.calls.recoveries, 1); assert.equal(h.calls.loads, 1);
    assert.equal(h.page.inspect().ledger, original); assert.equal(h.page.inspect().dirty, true); assert.equal(h.leave().prevented, true);
    assert.match(h.prompts.at(-1), /Discard unsaved local changes and reopen/);
    h.state.answer = true; await h.click(id);
    assert.equal(h.calls.loads, 2); assert.equal(h.page.inspect().dirty, false); assert.equal(h.leave().prevented, false);
    assert.equal(h.calls.saves, 0);
  }
});

test('offline and restored ownership refresh the callout without clearing staged changes or writing', async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  h.context.navigator.onLine = false; for (const callback of h.listeners.get('offline')) callback();
  assert.match(status(h), /Saving is unavailable/); assert.equal(h.get('save').disabled, true);
  h.context.navigator.onLine = true; for (const callback of h.listeners.get('online')) callback();
  assert.match(status(h), /Choose Save canonical ledger/); assert.equal(h.get('save').disabled, false);
  h.storage().lifecycle.acceptingWrites = false; h.storage().options.onStatus({ message: 'Ownership check required.' });
  assert.match(status(h), /Saving is unavailable/); assert.equal(h.page.inspect().dirty, true); assert.equal(h.calls.saves, 0);
});

test('review-and-save link opens the collapsed guided workbench and moves keyboard focus to Save', async () => {
  const h = await controller({ guided: true }); await h.click('connect'); await h.stage();
  h.get('workbench-details').open = false;
  await h.click('show-save');
  assert.equal(h.get('workbench-details').open, true); assert.equal(h.focused(), h.get('save-title'));
  assert.equal(h.calls.saves, 0); assert.equal(h.page.inspect().dirty, true);
});

test('the acceptance lease preserves busy guard, staged status, verified save, and repeated-start refusal', async () => {
  const h = await controller({ guided: true }); await h.click('connect');
  const gate = deferred(), entered = deferred();
  const pending = h.page.withAcceptanceWorkbench(async workbench => {
    assert.equal(h.leave().prevented, true); assert.match(status(h), /Operation in progress/);
    workbench.stage(canonical.registerAccount(h.page.inspect().ledger, { institutionId: 'wells-fargo', displayName: 'Invented leased account', currency: 'USD', accountType: 'checking' }));
    entered.resolve(); await gate.promise;
    await workbench.save(h.page.inspect().ledger);
    assert.equal(h.page.inspect().dirty, false); assert.equal(h.leave().prevented, true, 'lease remains busy after save');
  });
  await entered.promise;
  assert.match(status(h), /Unsaved changes.*operation is in progress/);
  await assert.rejects(h.page.withAcceptanceWorkbench(() => {}), error => error.code === 'operation-in-progress');
  await h.click('save'); assert.equal(h.calls.saves, 0);
  gate.resolve(); await pending;
  assert.equal(h.calls.saves, 1); assert.match(status(h), /No unsaved changes/); assert.equal(h.leave().prevented, false);
});

test('failed verification of a clean no-op save remains unverified without inventing unsaved changes', async () => {
  const h = await controller({ guided: true }); await h.click('connect');
  h.state.onSave = () => { throw Object.assign(new Error('unavailable'), { code: 'verification-failed' }); };
  await assert.rejects(h.page.withAcceptanceWorkbench(workbench => workbench.save(h.page.inspect().ledger)), error => error.code === 'verification-failed');
  assert.equal(h.page.inspect().dirty, false); assert.equal(h.page.inspect().busy, false);
  assert.match(status(h), /Save did not finish and verify.*recovery.*reopen/i);
  assert.doesNotMatch(status(h), /No unsaved changes|Your staged changes/);
  assert.equal(h.get('show-save').hidden, false); assert.equal(h.get('show-save').textContent, 'Review save status');
  assert.equal(h.leave().prevented, false, 'no staged changes and no active operation');
  await h.click('reopen');
  assert.match(status(h), /No unsaved changes/); assert.equal(h.get('show-save').hidden, true);
});

test('interruption pause is explicit, remains dirty and busy, and never announces a successful save', async () => {
  const h = await controller({ guided: true }); await h.click('connect'); await h.stage();
  void h.click('pause-canonical'); await tick();
  assert.equal(h.calls.saves, 1); assert.equal(h.page.inspect().dirty, true); assert.equal(h.page.inspect().busy, true);
  assert.match(status(h), /Interruption test paused.*not a verified save.*close the tab/);
  assert.match(h.get('result').textContent, /PAUSED after the first durable write/);
  assert.equal(h.leave().prevented, true); assert.equal(h.get('save').disabled, true);
  await h.click('save'); assert.equal(h.calls.saves, 1);
});


test('actual event handler shows adjacent receipt and unsaved audit count; an exact repeat cannot append accidentally', async () => {
  const h = await controller(); await h.click('connect'); await h.stage(); await h.click('save');
  const activityId = h.page.inspect().ledger.activities[0].activityId;
  h.get('activity').value = activityId; h.get('category').value = 'invented-default'; h.get('evidence').value = 'Invented receipt';
  await h.click('event');
  assert.equal(h.page.inspect().ledger.events.length, 1);
  assert.match(h.get('event-result').textContent, /classification staged for INVENTED MARKET PURCHASE/);
  assert.match(h.get('event-result').textContent, new RegExp(activityId));
  assert.match(h.get('event-count').textContent, /1 audit events not yet saved/);
  assert.equal(h.get('event').disabled, true); assert.equal(h.get('repeat-event').hidden, false);
  await h.click('event');
  assert.equal(h.page.inspect().ledger.events.length, 1);
  assert.match(h.get('event-result').textContent, /No second audit event/);
  h.state.answer = false; await h.click('repeat-event');
  assert.equal(h.page.inspect().ledger.events.length, 1);
  h.state.answer = true; await h.click('repeat-event');
  assert.equal(h.page.inspect().ledger.events.length, 2, 'intentional repeated audit command remains possible');
  assert.match(h.prompts.at(-1), /Append another identical audit event intentionally/);
  await h.click('save'); assert.match(h.get('event-count').textContent, /0 audit events not yet saved.*No unsaved changes/);
  h.get('activity').value = activityId; await h.get('activity').emit('change');
  assert.equal(h.get('event').disabled, true); assert.equal(h.get('event').textContent, 'This action is already saved');
  await h.click('event'); assert.match(h.get('event-result').textContent, /already saved/);
  assert.equal(h.page.inspect().ledger.events.length, 2);
  h.get('event-type').value = 'category-correction';
  h.get('category').value = 'invented-different'; await h.get('category').emit('input');
  assert.equal(h.get('event').disabled, false); await h.click('event');
  assert.equal(h.page.inspect().ledger.events.length, 3, 'a real correction is not suppressed');
  assert.match(h.get('event-count').textContent, /1 audit events not yet saved/);
});

test('inline staging failure replaces stale success and a later valid action clears red error state', async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  assert.match(h.get('stage-result').textContent, /Import staged locally/);
  await h.click('stage'); assert.equal(h.get('stage-result').dataset.error, 'true');
  h.get('activity').value = h.page.inspect().ledger.activities[0].activityId;
  await h.click('event'); assert.equal(h.get('event-result').dataset.error, 'true');
  assert.match(h.get('event-result').textContent, /Enter evidence/);
  h.get('evidence').value = 'Invented evidence'; await h.click('event');
  assert.equal(h.get('event-result').dataset.error, 'false');
  assert.equal(h.page.inspect().ledger.events.length, 1);
  await h.click('save'); await h.click('reopen');
  assert.match(h.get('event-count').textContent, /0 audit events not yet saved/);
  assert.match(h.get('event-result').textContent, /Verified saved ledger loaded/);
});

for (const changed of ['identity', 'graph', 'offline', 'ownership', 'clean', 'unverified']) test(`prepared pause refuses ${changed} without writing`, async () => {
  const h = await controller({ guided: true }); await h.click('connect'); await h.stage();
  const lifecycle = h.storage().lifecycle;
  lifecycle.folderId = 'invented-folder'; lifecycle.readManifest = async () => ({ databaseId: 'invented-database', copyId: 'invented-copy' });
  const prepared = { identity: { databaseId: 'invented-database', copyId: 'invented-copy', folderId: 'invented-folder' }, ledger: structuredClone(h.page.inspect().ledger) };
  if (changed === 'identity') prepared.identity.copyId = 'other-copy';
  if (changed === 'graph') prepared.ledger.accounts[0].displayName = 'Other invented name';
  if (changed === 'offline') h.context.navigator.onLine = false;
  if (changed === 'ownership') lifecycle.acceptingWrites = false;
  if (changed === 'clean') await h.click('save');
  if (changed === 'unverified') { h.state.onSave = () => { throw new Error('failed'); }; await h.click('save'); }
  const saves = h.calls.saves;
  await assert.rejects(h.page.pausePreparedInterruption(prepared), error => ['prepared-interruption-required', 'prepared-interruption-changed'].includes(error.code));
  assert.equal(h.calls.saves, saves); assert.equal(h.page.inspect().busy, false);
});

test('prepared pause matches canonical object keys, holds one lease and reports PAUSED only after durable mutation', async () => {
  const h = await controller({ guided: true }); await h.click('connect'); await h.stage();
  const lifecycle = h.storage().lifecycle;
  lifecycle.folderId = 'invented-folder'; lifecycle.readManifest = async () => ({ databaseId: 'invented-database', copyId: 'invented-copy' });
  const prepared = { identity: { folderId: 'invented-folder', copyId: 'invented-copy', databaseId: 'invented-database' }, ledger: JSON.parse(canonicalizeJcs(h.page.inspect().ledger)) };
  void h.page.pausePreparedInterruption(prepared); await tick();
  assert.equal(h.calls.saves, 1); assert.equal(h.page.inspect().saveState, 'paused');
  await assert.rejects(h.page.pausePreparedInterruption(prepared), error => error.code === 'operation-in-progress');
  assert.equal(h.calls.saves, 1); assert.match(status(h), /not a verified save/);
});


for (const retry of ['connect', 'reopen', 'recover', 'stale']) test(`a verified ${retry} clears a prior generic red result without claiming discarded drafts were saved`, async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  h.state.onSave = () => { throw Object.assign(new Error('failed'), { code: 'verification-failed' }); };
  await h.click('save'); assert.equal(h.get('result').dataset.error, 'true');
  assert.match(h.get('result').textContent, /Error code: unknown/);
  assert.doesNotMatch(h.get('result').textContent, /verification-failed/);
  h.state.onSave = null;
  if (retry === 'recover') h.storage().lifecycle.state = 'recovery-required';
  if (retry === 'stale') h.storage().lifecycle.state = 'stale-session';
  await h.click(retry);
  assert.equal(h.get('result').dataset.error, 'false');
  assert.doesNotMatch(h.get('result').textContent, /verification-failed|Staged changes remain/);
  assert.equal(h.page.inspect().dirty, false); assert.equal(h.page.inspect().ledger.events.length, 0);
  assert.equal(h.calls.saves, 1, 'reopen/reconnect did not save the discarded draft');
});


test('financial session survives local events and reads, then closes before save awaits', async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  const first = h.page.inspect().ledgerSession;
  assert.ok(first); assert.equal(Object.isFrozen(h.page.inspect().ledger), true);
  h.get('activity').value = h.page.inspect().ledger.activities[0].activityId;
  h.get('evidence').value = 'Invented cached event'; h.get('classification').value = 'spending';
  await h.click('event');
  assert.equal(h.page.inspect().ledgerSession, first); assert.equal(first.revision(), 1);
  const staged = h.page.inspect().ledger;
  h.get('report-start').value = '2026-01-01'; h.get('report-end').value = '2026-01-31';
  await h.click('summarize'); assert.equal(h.page.inspect().ledgerSession, first);
  assert.equal(h.page.inspect().ledger, staged); assert.match(h.get('summary').textContent, /"spending": "100.00"/);
  const gate = deferred(); h.state.onSave = () => gate.promise;
  const saving = h.click('save');
  assert.equal(h.page.inspect().ledgerSession, null);
  assert.throws(() => first.snapshot(), /ledger-session-closed/);
  gate.resolve(); await saving;
  const second = h.page.inspect().ledgerSession;
  assert.ok(second); assert.notEqual(second, first); assert.equal(second.revision(), 0);
  assert.deepEqual(second.snapshot(), h.state.saved);
});

test('uncertain save closes the session, retains its frozen draft and does not rebind it', async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  const first = h.page.inspect().ledgerSession, staged = h.page.inspect().ledger;
  h.state.onSave = next => { h.state.saved = structuredClone(next); throw Object.assign(new Error('uncertain'), { code: 'recovery-required' }); };
  await h.click('save');
  assert.equal(h.page.inspect().ledgerSession, null); assert.equal(h.page.inspect().ledger, staged);
  assert.throws(() => first.snapshot(), /ledger-session-closed/);
  await h.click('reopen');
  assert.ok(h.page.inspect().ledgerSession); assert.notEqual(h.page.inspect().ledgerSession, first);
  assert.equal(h.page.inspect().dirty, false); assert.equal(h.calls.saves, 1);
});

test('offline, storage-base replacement, release and failed reopen invalidate old handles', async () => {
  for (const boundary of ['offline', 'base', 'release', 'reopen']) {
    const h = await controller(); await h.click('connect'); await h.stage();
    const first = h.page.inspect().ledgerSession, staged = h.page.inspect().ledger;
    if (boundary === 'offline') {
      h.context.navigator.onLine = false; for (const callback of h.listeners.get('offline')) callback();
      h.context.navigator.onLine = true; for (const callback of h.listeners.get('online')) callback();
    } else if (boundary === 'base') {
      h.page.inspect().store.base = { ...h.page.inspect().store.base };
      h.storage().options.onStatus({ message: 'Invented new storage base.' });
    } else if (boundary === 'release') await h.click('release');
    else {
      h.state.onLoad = () => { throw Object.assign(new Error('unavailable'), { code: 'offline' }); };
      await h.click('reopen');
    }
    assert.equal(h.page.inspect().ledgerSession, null, boundary);
    assert.equal(h.page.inspect().ledger, staged, boundary);
    assert.throws(() => first.snapshot(), /ledger-session-closed/, boundary);
    assert.equal(h.calls.saves, 0, boundary);
  }
});


test('optional cache failure cannot turn an independently verified save into failure', async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  const old = h.page.inspect().ledgerSession;
  h.state.cacheFailure = true; await h.click('save');
  assert.throws(() => old.snapshot(), /ledger-session-closed/);
  assert.equal(h.page.inspect().ledgerSession, null); assert.equal(h.page.inspect().dirty, false);
  assert.equal(h.page.inspect().saveState, 'idle'); assert.match(status(h), /No unsaved changes/);
  assert.match(h.get('result').textContent, /saved and verified/); assert.equal(h.calls.saves, 1);
  h.get('activity').value = h.page.inspect().ledger.activities[0].activityId;
  h.get('evidence').value = 'Invented pure fallback'; h.get('classification').value = 'spending';
  await h.click('event'); assert.equal(h.page.inspect().ledger.events.length, 1);
  assert.equal(h.page.inspect().ledgerSession, null); assert.equal(h.page.inspect().dirty, true);
});

test('new imports and closed cache handles cannot leave a stale session in use', async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  const first = h.page.inspect().ledgerSession;
  await h.stage(); const second = h.page.inspect().ledgerSession;
  assert.ok(second); assert.notEqual(second, first);
  assert.throws(() => first.snapshot(), /ledger-session-closed/);
  second.close(); h.storage().options.onStatus({ message: 'Invented closed cache.' });
  assert.equal(h.page.inspect().ledgerSession, null);
  h.get('activity').value = h.page.inspect().ledger.activities[0].activityId;
  h.get('evidence').value = 'Invented post-close fallback'; h.get('classification').value = 'spending';
  await h.click('event'); assert.equal(h.page.inspect().ledger.events.length, 1);
  assert.ok(h.page.inspect().ledgerSession); assert.notEqual(h.page.inspect().ledgerSession, second);
});


test('failed-save fence survives retained base, recovery with declined reopen and pure fallback edits', async () => {
  const h = await controller(); await h.click('connect'); await h.stage();
  const oldBase = h.page.inspect().store.base, old = h.page.inspect().ledgerSession;
  h.state.preserveBaseOnSaveError = true;
  h.state.onSave = () => { throw Object.assign(new Error('preflight'), { code: 'ownership-unverified' }); };
  await h.click('save');
  assert.equal(h.page.inspect().store.base, oldBase); assert.equal(h.page.inspect().ledgerSession, null);
  h.state.answer = question => !question.includes('Discard unsaved'); await h.click('recover');
  const loads = h.calls.loads;
  h.get('activity').value = h.page.inspect().ledger.activities[0].activityId;
  h.get('evidence').value = 'Invented pure edit while verification remains open'; h.get('classification').value = 'spending';
  await h.click('event');
  assert.equal(h.page.inspect().ledger.events.length, 1); assert.equal(h.page.inspect().ledgerSession, null);
  assert.equal(h.page.inspect().saveState, 'unverified'); assert.equal(h.calls.loads, loads);
  assert.throws(() => old.snapshot(), /ledger-session-closed/);
  h.state.answer = true; h.state.onSave = null; await h.click('save');
  assert.equal(h.page.inspect().saveState, 'idle'); assert.ok(h.page.inspect().ledgerSession);
});


test('guided import actual v5 genesis, explicit save and reconnect use the real paged canonical store',async()=>{
  const h=await controller({guided:true,actualPaged:true});await h.click('connect');
  assert.equal(h.page.inspect().store.layout,'partitions-v5');
  await h.page.withAcceptanceWorkbench(driver=>driver.requireFresh());
  await h.stage();const proposed=structuredClone(h.page.inspect().ledger);assert.equal(h.calls.saves,0);
  await h.click('save');assert.equal(h.calls.saves,1);assert.equal(h.page.inspect().dirty,false);
  const root=h.page.inspect().store.base.root;assert.equal(typeof root,'string');
  await h.click('connect');assert.deepEqual(h.page.inspect().ledger,proposed);assert.equal(h.page.inspect().store.base.root,root);
  await assert.rejects(h.page.withAcceptanceWorkbench(driver=>driver.requireFresh()),e=>e.code==='fresh-empty-copy-required');
  assert.equal(h.calls.saves,1);
});
