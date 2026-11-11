import { showDiagnostic, clearDiagnostic } from '../js/app-diagnostics.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as canonical from '../js/canonical-import.mjs';
import { parseProviderCsv } from '../js/provider-csv.mjs';

const moduleUrl = new URL('../prototype/pr28-import.mjs', import.meta.url);
const source = await readFile(moduleUrl, 'utf8');
const html = await readFile(new URL('../prototype/pr28-import.html', import.meta.url), 'utf8');
const tick = () => new Promise(setImmediate);
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const nodesOf = (node, tag) => descendants(node).filter(child => child.tagName === tag.toUpperCase());
const labelled = (node, text) => nodesOf(node, 'label').find(label => label.ownText === text)?.children[0];
const button = (node, text) => nodesOf(node, 'button').find(item => item.ownText === text);
const navigation = (node, label) => nodesOf(node, 'button').find(item => item.attributes['aria-label'] === label);
const fieldset = (h, id) => nodesOf(h.get('reviews'), 'fieldset').find(node => node.dataset.observationId === id);
const history = (h, id) => nodesOf(h.get('reviews'), 'details').find(node => node.dataset.reviewDecisionId === id);
const pending = ledger => ledger.observations.filter(row => ['review', 'rejected'].includes(row.disposition) && !row.resolved);
async function enter(node, value, type = 'input') { assert.ok(node); node.value = value; await node.emit(type); }
async function openMatch(row) { const details = nodesOf(row, 'details').find(node => node.className === 'review-match'); details.open = true; await details.emit('toggle'); return details; }

// The real module, event handlers and canonical functions run against a minimal
// connected DOM. Storage is controlled, not a second financial implementation.
// These are deterministic node/accessibility-contract tests, not layout timings.
async function controller(saved) {
  const roots = new Map(), windowEvents = new Map(); let focused, storage;
  const state = { saved: structuredClone(saved), answer: true, saves: 0, serializations: [], onLoad: null };
  function element(tag) {
    let ownText = '', value = '';
    return {
      tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, events: new Map(), disabled: false, open: false,
      get ownText() { return ownText; }, get textContent() { return ownText + this.children.map(child => child.textContent).join(''); },
      set textContent(text) { ownText = String(text); this.children = []; },
      get value() { return value; }, set value(next) { value = String(next); },
      append(...children) { const empty = !this.children.length; this.children.push(...children); if (this.tagName === 'SELECT' && empty) value = children[0]?.value || ''; },
      prepend(...children) { this.children.unshift(...children); },
      replaceChildren(...children) { this.children = []; ownText = ''; value = ''; this.append(...children); },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      addEventListener(type, callback) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(callback); },
      async emit(type, event = {}) { if (type === 'click' && this.disabled) return; for (const callback of this.events.get(type) || []) await callback(event); },
      focus() { focused = this; }, select() {}, remove() {},
      insertAdjacentElement(position, node) { this.diagnosticPanel = node; },
      querySelectorAll(selector) { const tags = selector.split(',').map(tag => tag.toUpperCase()); return descendants(this).filter(node => tags.includes(node.tagName)); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    };
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"/g)) roots.set(match[2], element(match[1]));
  const get = id => roots.get(id) || null;
  get('event-type').value = 'classification'; get('classification').value = 'spending'; get('fixture').value = 'wells-foundation';
  class Storage {
    constructor(options) { this.options = options; this.lifecycle = null; storage = this; }
    async prepare() {}
    async connect() { this.lifecycle = { state: 'ready', acceptingWrites: true, coordinator: { canWrite: true } }; }
    async release() { this.lifecycle = null; }
  }
  class Store {
    async load() { await state.onLoad?.(); return structuredClone(state.saved); }
    async save(next) { state.saves++; state.saved = structuredClone(next); return structuredClone(next); }
  }
  const context = { ...canonical, parseProviderCsv, DashboardSyntheticStorage: Storage, CanonicalLedgerStore: Store,
    document: { getElementById: get, createElement: element, querySelectorAll: selector => [...roots.values()].flatMap(root => [root, ...root.querySelectorAll(selector)]).filter(node => selector.split(',').map(tag => tag.toUpperCase()).includes(node.tagName)) },
    window: { addEventListener(type, callback) { windowEvents.set(type, callback); } },
    navigator: { onLine: true }, crypto, structuredClone, URL, Uint8Array, TypeError,
    JSON: { parse: JSON.parse, stringify(value, ...args) { state.serializations.push(value); return JSON.stringify(value, ...args); } },
    confirm: () => state.answer
  };
  const executable = source.replace(/^import .*;$/gm, '').replace(/^export /gm, '').replaceAll('import.meta.url', JSON.stringify(moduleUrl.href));
  context.clearDiagnostic = clearDiagnostic;
  context.showDiagnostic = (error, options) => showDiagnostic(error, { ...options, document: context.document, navigator: context.navigator });
  vm.runInNewContext(executable + '\nglobalThis.page = { withAcceptanceWorkbench, inspect: () => ({ ledger, dirty, busy }) };', context);
  await tick(); await get('connect').emit('click');
  return { state, get, context, page: context.page, storage: () => storage, focused: () => focused,
    click: id => get(id).emit('click'),
    refresh() { windowEvents.get('online')(); }
  };
}

function overlap(count) {
  let sequence = 0;
  const options = { now: () => '2026-11-07T00:00:00.000Z', idFactory: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` };
  let ledger = canonical.registerAccount(canonical.createLedger(options), { institutionId: 'sofi', displayName: 'Invented UI review account', currency: 'USD', accountType: 'checking' }, options);
  const accountId = ledger.accounts[0].accountId;
  const records = Array.from({ length: count }, (_, i) => ({ sourceAccountKey: 'default', sourceFields: { Description: `INVENTED SHOP ${i}`, Amount: '-12.34' }, rowOrdinal: i + 1, physicalLine: i + 2, sourceDescription: `INVENTED SHOP ${i}`, normalizedDescription: `invented shop ${i}`, sourceAction: 'Card purchase', sourceRecordId: null, amountText: '-12.34', currency: null, effectiveDate: '2026-01-15', postedDate: null, settlementDate: null, lifecycleStatus: 'posted', valid: true, errorCode: null }));
  const input = { syntheticOnly: true, parsed: { sourceFormat: 'sofi-csv-v1', institutionId: 'sofi', fileFingerprint: `invented-ui-${count}`, rowsSeen: count + 1, ignoredCount: 0, records, sourceAccountKeys: ['default'], sourceCoverage: null }, accountMappings: { default: accountId }, coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } } };
  ledger = canonical.prepareCanonicalImport(ledger, input, options).ledger;
  input.parsed.fileFingerprint += '-overlap';
  ledger = canonical.prepareCanonicalImport(ledger, input, options).ledger;
  return { ledger, options };
}

const large = overlap(1000).ledger;

test('1000 activities and 1000 reviews render ten rows and native 50-target pages plus one retained choice', async () => {
  const h = await controller(large), reviews = h.get('reviews');
  assert.equal(large.activities.length, 1000); assert.equal(pending(large).length, 1000);
  assert.equal(nodesOf(reviews, 'fieldset').length, 10);
  assert.equal(nodesOf(reviews, 'option').length, 0, 'closed matching controls create no options');
  assert.ok(descendants(reviews).length < 150);
  for (const row of nodesOf(reviews, 'fieldset')) {
    const details = await openMatch(row), select = labelled(details, 'Match to activity');
    assert.equal(select.tagName, 'SELECT'); assert.equal(select.value, '', 'never chooses a target automatically');
    assert.equal(select.children.length, 51);
  }
  assert.equal(nodesOf(reviews, 'option').length, 510);
  assert.ok(descendants(reviews).length < 850, 'ten opened match controls stay bounded');
  for (const row of nodesOf(reviews, 'fieldset')) {
    const details = nodesOf(row, 'details')[0], select = labelled(details, 'Match to activity');
    await enter(select, large.activities[0].activityId, 'change');
    await navigation(details, 'Match activities last page').emit('click');
    assert.equal(labelled(details, 'Match to activity').children.length, 52);
  }
  assert.equal(nodesOf(reviews, 'option').length, 520, 'absolute option bound includes one retained choice plus placeholder per selector');
  assert.ok(descendants(reviews).length < 850);
  for (const control of nodesOf(reviews, 'button')) assert.equal(control.type, 'button');
  const first = navigation(reviews, 'Pending reviews first page'); assert.equal(first.disabled, true);
  h.refresh(); assert.equal(first.disabled, true, 'heartbeats cannot re-enable boundary controls');
  assert.equal(h.state.saves, 0); assert.equal(h.page.inspect().dirty, false);
});

test('every review and target is reachable, selection is explicit, and page/search drafts survive rerenders', async () => {
  const h = await controller(large), firstReview = pending(large)[0], lastReview = pending(large).at(-1), lastTarget = large.activities.at(-1);
  let row = fieldset(h, firstReview.observationId);
  await enter(labelled(row, 'Decision rationale'), 'First-page rationale stays here');
  await navigation(h.get('reviews'), 'Pending reviews last page').emit('click');
  assert.equal(nodesOf(h.get('reviews'), 'fieldset').length, 10); assert.ok(fieldset(h, lastReview.observationId));
  assert.match(h.focused().textContent, /Pending reviews: 991–1000 of 1000/);
  row = fieldset(h, lastReview.observationId); let details = await openMatch(row);
  await navigation(details, 'Match activities last page').emit('click');
  let select = labelled(details, 'Match to activity');
  assert.equal(select.value, ''); assert.ok(select.children.some(option => option.value === lastTarget.activityId));
  await enter(select, lastTarget.activityId, 'change');
  await navigation(details, 'Match activities first page').emit('click');
  select = labelled(details, 'Match to activity');
  assert.equal(select.value, lastTarget.activityId); assert.equal(select.children.length, 52, 'one off-page explicit choice is pinned');
  const search = labelled(details, 'Search match activities by description, date or activity ID');
  await enter(search, lastTarget.activityId);
  let prevented = false; await search.emit('keydown', { key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(labelled(details, 'Match to activity').children.length, 2);
  await enter(labelled(row, 'Decision rationale'), 'Same invented final purchase, explicitly checked');
  await navigation(h.get('reviews'), 'Pending reviews first page').emit('click');
  assert.equal(labelled(fieldset(h, firstReview.observationId), 'Decision rationale').value, 'First-page rationale stays here');
  // A real unrelated action rerenders the whole ledger without consuming drafts.
  await enter(h.get('activity'), large.activities[0].activityId, 'change');
  await enter(h.get('evidence'), 'Invented unrelated classification'); await h.click('event');
  await navigation(h.get('reviews'), 'Pending reviews last page').emit('click');
  row = fieldset(h, lastReview.observationId); details = nodesOf(row, 'details')[0];
  assert.equal(details.open, true);
  assert.equal(labelled(details, 'Match to activity').value, lastTarget.activityId);
  assert.equal(labelled(details, 'Search match activities by description, date or activity ID').value, lastTarget.activityId);
  assert.equal(labelled(row, 'Decision rationale').value, 'Same invented final purchase, explicitly checked');
  await button(row, 'match').emit('click');
  const next = h.page.inspect().ledger;
  assert.equal(next.reviewDecisions.at(-1).action, 'match'); assert.equal(next.reviewDecisions.at(-1).activityId, lastTarget.activityId);
  assert.equal(next.activities.length, 1000); assert.equal(pending(next).length, 999);
  assert.equal(h.page.inspect().dirty, true); assert.equal(h.state.saves, 0);
  assert.equal(canonical.validateLedger(next), true);
});

test('resolving the last page clamps it, and returning a decision to review retains append-only history', async () => {
  const { ledger } = overlap(11), h = await controller(ledger), last = pending(ledger).at(-1);
  await navigation(h.get('reviews'), 'Pending reviews last page').emit('click');
  const row = fieldset(h, last.observationId); await enter(labelled(row, 'Decision rationale'), 'Invented separate purchase');
  await button(row, 'keep-separate').emit('click');
  let current = h.page.inspect().ledger;
  const decision = current.reviewDecisions.at(-1), created = decision.activityId;
  assert.equal(pending(current).length, 10); assert.equal(nodesOf(h.get('reviews'), 'fieldset').length, 10);
  assert.match(h.get('reviews').textContent, /Pending reviews: 1–10 of 10/);
  assert.match(h.focused().textContent, /Pending reviews: 1–10 of 10/);
  const previous = history(h, decision.reviewDecisionId);
  await enter(labelled(previous, 'Reason for returning to review'), 'Recheck original invented evidence');
  await button(previous, 'Return to review').emit('click');
  current = h.page.inspect().ledger;
  assert.equal(current.reviewDecisions.length, 2); assert.equal(current.reviewDecisions[0].reviewDecisionId, decision.reviewDecisionId);
  assert.equal(current.reviewDecisions[1].action, 'reverse'); assert.equal(pending(current).length, 11);
  assert.equal(canonical.getEffectiveActivities(current).find(activity => activity.activityId === created).active, false);
  assert.equal(current.observations.at(-1).sourceFields.Description, last.sourceFields.Description);
  assert.equal(h.state.saves, 0); assert.equal(canonical.validateLedger(current), true);
});

test('collapsed provenance is serialized only when expanded, once per rendered snapshot', async () => {
  const h = await controller(large), current = h.page.inspect().ledger;
  for (const value of Object.values(current).filter(Array.isArray)) assert.equal(h.state.serializations.includes(value), false);
  const details = nodesOf(h.get('provenance'), 'details').find(node => node.children[0].ownText.startsWith('observations ·'));
  assert.equal(nodesOf(details, 'pre').length, 0);
  details.open = true; await details.emit('toggle');
  assert.equal(h.state.serializations.filter(value => value === current.observations).length, 1);
  assert.equal(JSON.parse(nodesOf(details, 'pre')[0].textContent).length, 2000);
  details.open = false; await details.emit('toggle'); details.open = true; await details.emit('toggle');
  assert.equal(h.state.serializations.filter(value => value === current.observations).length, 1);
});

test('missing-currency fields survive paging and a verified save, but successful reopen discards all form drafts', async () => {
  const parsed = await parseProviderCsv({ bytes: await readFile(new URL('../fixtures/fidelity.csv', import.meta.url)), sourceFormat: 'fidelity-accounts-history-csv-v1' });
  let ledger = canonical.createLedger(); const accountMappings = {}, coverageByAccount = {};
  for (const key of parsed.sourceAccountKeys) {
    ledger = canonical.registerAccount(ledger, { institutionId: 'fidelity', displayName: 'Invented currency draft ' + key, currency: 'USD', accountType: 'retirement' });
    const accountId = ledger.accounts.at(-1).accountId; accountMappings[key] = accountId;
    coverageByAccount[accountId] = { start: '2026-03-01', end: '2026-03-31', provenance: 'user-confirmed' };
  }
  // Repeat only invented malformed source rows, preserving their multiplicity.
  const template = parsed.records.find(row => row.currency === null);
  parsed.records = Array.from({ length: 11 }, (_, index) => ({ ...structuredClone(template), rowOrdinal: index + 1, physicalLine: index + 2 }));
  parsed.rowsSeen = 12;
  ledger = canonical.prepareCanonicalImport(ledger, { parsed, accountMappings, coverageByAccount, syntheticOnly: true }).ledger;
  const h = await controller(ledger), first = pending(ledger)[0];
  let row = fieldset(h, first.observationId);
  await enter(labelled(row, 'Explicit currency for this source row'), 'usd');
  await enter(labelled(row, 'Decision rationale'), 'Explicit invented USD evidence');
  await navigation(h.get('reviews'), 'Pending reviews last page').emit('click');
  const lastRow = nodesOf(h.get('reviews'), 'fieldset')[0];
  await enter(labelled(lastRow, 'Decision rationale'), 'Invented rejected source'); await button(lastRow, 'reject').emit('click');
  await h.click('save');
  row = fieldset(h, first.observationId);
  assert.equal(labelled(row, 'Explicit currency for this source row').value, 'usd');
  assert.equal(labelled(row, 'Decision rationale').value, 'Explicit invented USD evidence');
  assert.equal(h.page.inspect().dirty, false, 'raw text is not a staged audit decision');
  await h.click('reopen'); row = fieldset(h, first.observationId);
  assert.equal(labelled(row, 'Explicit currency for this source row').value, '');
  assert.equal(labelled(row, 'Decision rationale').value, '');
  await enter(labelled(row, 'Explicit currency for this source row'), 'USD');
  await enter(labelled(row, 'Decision rationale'), 'Confirmed invented currency');
  await button(row, 'keep-separate').emit('click');
  const next = h.page.inspect().ledger, created = next.activities.at(-1);
  assert.equal(created.currency, 'USD'); assert.equal(created.lifecycleStatus, 'unknown');
  assert.equal(next.observations[0].sourceFields.Currency, ''); assert.equal(next.reviewDecisions.at(-1).currency, 'USD');
});

test('decision history pages retain reversal text and only the latest decision offers reversal', async () => {
  let { ledger, options } = overlap(11);
  for (const row of pending(ledger)) ledger = canonical.applyReviewDecision(ledger, { observationId: row.observationId, action: 'reject', rationale: 'Invented rejection' }, options);
  const h = await controller(ledger), first = ledger.reviewDecisions[0], last = ledger.reviewDecisions.at(-1);
  assert.equal(nodesOf(h.get('reviews'), 'details').filter(node => node.dataset.reviewDecisionId).length, 10);
  let previous = history(h, first.reviewDecisionId);
  await enter(labelled(previous, 'Reason for returning to review'), 'Retained reversal draft');
  await navigation(h.get('reviews'), 'Previous decisions last page').emit('click');
  assert.ok(history(h, last.reviewDecisionId));
  await navigation(h.get('reviews'), 'Previous decisions first page').emit('click');
  previous = history(h, first.reviewDecisionId);
  assert.equal(labelled(previous, 'Reason for returning to review').value, 'Retained reversal draft');
  await button(previous, 'Return to review').emit('click');
  assert.equal(labelled(history(h, first.reviewDecisionId), 'Reason for returning to review'), undefined);
  assert.equal(h.page.inspect().ledger.reviewDecisions.length, 12);
  await navigation(h.get('reviews'), 'Previous decisions last page').emit('click');
  const reversed = history(h, h.page.inspect().ledger.reviewDecisions.at(-1).reviewDecisionId);
  assert.ok(reversed); assert.equal(button(reversed, 'Return to review'), undefined);
});

test('the match picker excludes other accounts and currencies and a forged target still fails canonical validation', async () => {
  let { ledger } = overlap(3);
  const original = ledger.activities[0], review = pending(ledger)[0];
  // Build valid separate-account and different-currency activities via the real importer.
  const other = overlap(1).ledger;
  const anotherAccount = canonical.registerAccount(ledger, { institutionId: 'sofi', displayName: 'Invented second account', currency: 'USD', accountType: 'checking' });
  const accountId = anotherAccount.accounts.at(-1).accountId;
  const sourceRow = other.observations[0].candidate;
  const parsed = { institutionId: 'sofi', sourceFormat: 'sofi-csv-v1', fileFingerprint: 'invented-other-account', rowsSeen: 3, ignoredCount: 0, sourceAccountKeys: ['default'], sourceCoverage: null,
    records: [
      { ...sourceRow, sourceAccountKey: 'default', sourceDescription: 'INVENTED OTHER ACCOUNT', normalizedDescription: 'invented other account', sourceFields: { Description: 'INVENTED OTHER ACCOUNT' }, rowOrdinal: 1, physicalLine: 2 },
      { ...sourceRow, sourceAccountKey: 'default', currency: 'EUR', sourceDescription: 'INVENTED EURO', normalizedDescription: 'invented euro', sourceFields: { Description: 'INVENTED EURO' }, rowOrdinal: 2, physicalLine: 3 }
    ] };
  const euro = parsed.records.pop(); parsed.rowsSeen = 2;
  ledger = canonical.prepareCanonicalImport(anotherAccount, { parsed, accountMappings: { default: accountId }, coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } }, syntheticOnly: true }).ledger;
  const otherTarget = ledger.activities.at(-1);
  parsed.records = [euro]; parsed.fileFingerprint = 'invented-other-currency';
  ledger = canonical.prepareCanonicalImport(ledger, { parsed, accountMappings: { default: original.accountId }, coverageByAccount: { [original.accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } }, syntheticOnly: true }).ledger;
  const euroTarget = ledger.activities.at(-1); assert.equal(euroTarget.accountId, original.accountId); assert.equal(euroTarget.currency, 'EUR');
  const h = await controller(ledger), row = fieldset(h, review.observationId), details = await openMatch(row), select = labelled(details, 'Match to activity');
  assert.ok(select.children.some(option => option.value === original.activityId));
  assert.ok(!select.children.some(option => option.value === otherTarget.activityId));
  assert.ok(!select.children.some(option => option.value === euroTarget.activityId));
  await enter(labelled(row, 'Decision rationale'), 'Invented invalid target test');
  await enter(select, otherTarget.activityId, 'change'); await button(row, 'match').emit('click');
  assert.match(h.get('result').textContent, /conflicting-match-requires-correction/);
  assert.equal(h.page.inspect().ledger.reviewDecisions.length, 0); assert.equal(h.page.inspect().dirty, false);
  assert.equal(labelled(row, 'Decision rationale').value, 'Invented invalid target test');
  await enter(select, '', 'change'); await button(row, 'match').emit('click');
  assert.match(h.get('result').textContent, /Choose an activity to match/);
  assert.equal(h.page.inspect().ledger.reviewDecisions.length, 0);
});

test('a previously selected target becoming inactive is preserved visibly but cannot be matched', async () => {
  let { ledger, options } = overlap(3);
  ledger = canonical.applyReviewDecision(ledger, { observationId: pending(ledger)[0].observationId, action: 'keep-separate', rationale: 'Invented temporary separate purchase' }, options);
  const targetDecision = ledger.reviewDecisions.at(-1), targetId = targetDecision.activityId, rowId = pending(ledger)[0].observationId;
  const h = await controller(ledger);
  let row = fieldset(h, rowId), details = await openMatch(row);
  await enter(labelled(details, 'Match to activity'), targetId, 'change');
  await enter(labelled(row, 'Decision rationale'), 'Keep this explicit target draft');
  const previous = history(h, targetDecision.reviewDecisionId);
  await enter(labelled(previous, 'Reason for returning to review'), 'Recheck temporary target'); await button(previous, 'Return to review').emit('click');
  row = fieldset(h, rowId); details = nodesOf(row, 'details')[0];
  assert.equal(labelled(details, 'Match to activity').value, targetId); assert.match(details.children[0].textContent, /unavailable/);
  await button(row, 'match').emit('click');
  assert.match(h.get('result').textContent, /inactive-match-target/);
  assert.equal(h.page.inspect().ledger.reviewDecisions.length, 2);
  assert.equal(labelled(row, 'Decision rationale').value, 'Keep this explicit target draft');
});

test('busy workbench lease blocks review and target navigation and restores boundary state', async () => {
  const { ledger } = overlap(60), h = await controller(ledger), row = nodesOf(h.get('reviews'), 'fieldset')[0], details = await openMatch(row);
  const nextReview = navigation(h.get('reviews'), 'Pending reviews next page'), nextTarget = navigation(details, 'Match activities next page');
  let release; const gate = new Promise(resolve => { release = resolve; });
  const lease = h.page.withAcceptanceWorkbench(async () => { await gate; });
  assert.equal(nextReview.disabled, true); assert.equal(nextTarget.disabled, true);
  // Even a programmatically invoked listener must respect the lease, independent of disabled UI.
  for (const callback of nextReview.events.get('click')) callback();
  for (const callback of nextTarget.events.get('click')) callback();
  assert.equal(nodesOf(h.get('reviews'), 'fieldset')[0], row);
  assert.match(details.textContent, /Match activities: 1–50 of 60/);
  release(); await lease;
  assert.equal(nextReview.disabled, false); assert.equal(nextTarget.disabled, false);
  assert.equal(navigation(h.get('reviews'), 'Pending reviews previous page').disabled, true);
  await nextReview.emit('click'); assert.match(h.focused().textContent, /Pending reviews: 11–20 of 60/);
});

test('failed and cancelled reopen keep drafts, while a successful different-copy load clears selection and search', async () => {
  const { ledger } = overlap(11), h = await controller(ledger), first = pending(ledger)[0];
  let row = fieldset(h, first.observationId), details = await openMatch(row);
  await enter(labelled(row, 'Decision rationale'), 'Retain until explicit successful discard');
  await enter(labelled(details, 'Match to activity'), ledger.activities[0].activityId, 'change');
  await enter(labelled(details, 'Search match activities by description, date or activity ID'), 'Unsubmitted search draft');
  h.state.onLoad = () => { throw new TypeError('invented-load-unavailable'); }; await h.click('reopen');
  assert.match(h.get('result').textContent, /Error code: unknown/);
  assert.doesNotMatch(h.get('result').textContent, /invented-load-unavailable/);
  assert.equal(labelled(row, 'Decision rationale').value, 'Retain until explicit successful discard');
  await enter(h.get('activity'), ledger.activities[0].activityId, 'change'); await enter(h.get('evidence'), 'Invented staged classification'); await h.click('event');
  h.state.answer = false; await h.click('reopen');
  row = fieldset(h, first.observationId); details = nodesOf(row, 'details')[0];
  assert.equal(labelled(details, 'Match to activity').value, ledger.activities[0].activityId);
  assert.equal(labelled(details, 'Search match activities by description, date or activity ID').value, 'Unsubmitted search draft');
  h.state.onLoad = null; h.state.answer = true;
  // Another synthetic copy can have identical logical IDs, so load itself, not
  // just a changed ledgerId, must discard the old copy's form intent.
  h.state.saved = structuredClone(ledger); await h.click('connect');
  row = fieldset(h, first.observationId); details = await openMatch(row);
  assert.equal(labelled(row, 'Decision rationale').value, '');
  assert.equal(labelled(details, 'Match to activity').value, '');
  assert.equal(labelled(details, 'Search match activities by description, date or activity ID').value, '');
  assert.equal(h.page.inspect().dirty, false);
});
