import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWorkspacePages} from '../js/workspace-pages.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const primary = ['overview', 'transactions', 'position', 'review', 'storage'];
const routes = [...primary, 'holdings', 'reconciliation', 'activity-detail'];

// A deliberately small DOM/history substitute: real HTML IDs and initial hidden
// states, native hash navigation events, and pushState's lack of events. This
// exercises routing, not browser layout, Safari focus, or controller rendering.
function fixture(hash = '') {
  const nodes = new Map();
  const document = {title:'', activeElement:null, getElementById:id => nodes.get(id) || null};
  for (const match of html.matchAll(/<[^!][^>]*\bid="([^"]+)"[^>]*>/g)) {
    const tag = match[0];
    const attributes = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const node = {
      id:match[1], hidden:/\shidden(?:\s|>)/.test(tag), value:'', textContent:'', focusCalls:[],
      setAttribute:(key, value) => attributes.set(key, value),
      removeAttribute:key => attributes.delete(key),
      getAttribute:key => attributes.get(key) ?? null,
      focus(options) { document.activeElement = this; this.focusCalls.push(options); }
    };
    nodes.set(node.id, node);
  }
  let entries = [hash], cursor = 0;
  const listeners = new Map();
  const dispatch = type => { for (const callback of listeners.get(type) || []) callback({type}); };
  const window = {
    location:{hash}, scrollY:0, scrollCalls:[],
    addEventListener(type, callback) { listeners.set(type, [...listeners.get(type) || [], callback]); },
    scrollTo(options) { this.scrollY = options.top; this.scrollCalls.push(options); },
    history:{
      scrollRestoration:'auto',
      get length() { return entries.length; },
      pushState(_state, _title, url) { entries = entries.slice(0, ++cursor); entries.push(url); window.location.hash = url; },
      replaceState(_state, _title, url) { entries[cursor] = url; window.location.hash = url; },
      back() { traverse(-1); }, forward() { traverse(1); }
    }
  };
  function traverse(delta) {
    const next = cursor + delta;
    if (next < 0 || next >= entries.length) return;
    const oldHash = window.location.hash;
    window.location.hash = entries[cursor = next];
    dispatch('popstate');
    if (oldHash !== window.location.hash) dispatch('hashchange');
  }
  function followHash(value) {
    if (value === window.location.hash) return;
    window.history.pushState(null, '', value);
    dispatch('hashchange');
  }
  const router = createWorkspacePages({document, window});
  return {document, window, router, followHash, get:id => {
    assert.ok(nodes.has(id), `HTML must contain ${id}`);
    return nodes.get(id);
  }};
}

function assertPage(f, page, group = page) {
  assert.equal(f.router.current, page);
  assert.equal(f.window.location.hash, '#' + page);
  assert.deepEqual(routes.filter(id => !f.get(id).hidden), [page]);
  assert.deepEqual(primary.filter(id => f.get('nav-' + id).getAttribute('aria-current') === 'page'), [group]);
  const secondary = ['position', 'holdings', 'review', 'reconciliation'];
  assert.deepEqual(secondary.filter(id => f.get('sub-' + id).getAttribute('aria-current') === 'page'), secondary.includes(page) ? [page] : []);
  assert.equal(f.get('position-navigation').hidden, group !== 'position');
  assert.equal(f.get('review-navigation').hidden, group !== 'review');
}

for (const [page, group, title, mode] of [
  ['overview','overview','Home','period'], ['transactions','transactions','Activity','period'],
  ['position','position','Accounts','date'], ['holdings','position','Holdings','date'],
  ['review','review','Review','period'], ['reconciliation','review','Reconciliation','period'],
  ['storage','storage','Storage',null]
]) {
  test(`deep link and navigation: ${page}`, () => {
    const f = fixture('#' + page);
    assertPage(f, page, group);
    assert.equal(f.get('page-title').textContent, title);
    assert.equal(f.document.title, `${title} · Finance Tracker`);
    assert.equal(f.document.activeElement, null, 'initial route must not steal focus');
    assert.equal(f.get('workspace-scope').hidden, true, 'unloaded scope stays hidden');
    assert.equal(f.get('no-ledger-notice').hidden, ['overview', 'storage'].includes(page));
    f.router.setLoaded(true);
    assert.equal(f.get('workspace-scope').hidden, !mode);
    assert.equal(f.get('no-ledger-notice').hidden, true);
    assert.equal(f.get('month-scope').hidden, mode !== 'period');
    assert.equal(f.get('position-date-scope').hidden, mode !== 'date');
    f.router.go(page === 'overview' ? 'storage' : 'overview');
    f.followHash('#' + page);
    assertPage(f, page, group);
    assert.equal(f.document.activeElement, f.get('page-title'));
  });
}

test('empty, malformed, unknown and unavailable detail hashes have safe canonical fallbacks', () => {
  for (const hash of ['', '#unknown', '#__proto__', '#constructor', '#%ZZ', '#position?account=example', '#activity-detail']) {
    const f = fixture(hash);
    assertPage(f, hash === '#activity-detail' ? 'transactions' : 'overview');
    assert.equal(f.window.history.length, 1);
  }
  const f = fixture('#review');
  f.router.go('not-a-page');
  assertPage(f, 'overview');
  f.followHash('#activity-detail');
  assertPage(f, 'transactions');
});

test('native hash links and pushState routes both survive Back and Forward without duplicate entries', () => {
  const f = fixture('#overview');
  f.followHash('#holdings');
  f.router.go('storage');
  f.followHash('#reconciliation');
  assert.equal(f.window.history.length, 4);
  for (const [page, group] of [['storage','storage'], ['holdings','position'], ['overview','overview']]) {
    f.window.history.back(); assertPage(f, page, group);
  }
  for (const [page, group] of [['holdings','position'], ['storage','storage'], ['reconciliation','review']]) {
    f.window.history.forward(); assertPage(f, page, group);
  }
  assert.equal(f.window.history.length, 4);
  f.router.go('reconciliation');
  assert.equal(f.window.history.length, 4, 'same route must not add history');
  f.router.go('transactions', {replace:true});
  assert.equal(f.window.history.length, 4);
  f.window.history.back(); assertPage(f, 'storage');
});

test('routes restore per-page scroll and focus once even when history emits both events', () => {
  const f = fixture('#overview');
  assert.equal(f.window.history.scrollRestoration, 'manual');
  f.window.scrollY = 320;
  f.router.go('transactions');
  assert.equal(f.window.scrollY, 0);
  assert.deepEqual(f.get('page-title').focusCalls.at(-1), {preventScroll:true});
  f.window.scrollY = 890;
  const before = f.get('page-title').focusCalls.length;
  f.window.history.back();
  assert.equal(f.window.scrollY, 320);
  assert.equal(f.get('page-title').focusCalls.length, before + 1);
  f.window.history.forward();
  assert.equal(f.window.scrollY, 890);
  f.router.go('storage', {focus:false});
  assert.equal(f.get('page-title').focusCalls.length, before + 2);
});

test('skip link focuses main content without changing the visible workspace page', () => {
  const f = fixture('#holdings');
  f.followHash('#main-content');
  assert.equal(f.router.current, 'holdings');
  assert.equal(f.document.activeElement, f.get('main-content'));
  assert.deepEqual(routes.filter(id => !f.get(id).hidden), ['holdings']);
});

test('navigation preserves mounted editor identity, unsaved values, and conditional child states', () => {
  const f = fixture('#transactions');
  const editors = ['correction-rationale', 'category', 'amount', 'holdings-source', 'transaction-search'];
  const references = editors.map(id => f.get(id));
  references.forEach((node, i) => { node.value = `invented unsaved value ${i}`; });
  const conditions = ['category-field', 'amount-field', 'classification-field', 'transfer-link-panel', 'overview-loaded'];
  conditions.forEach((id, i) => { f.get(id).hidden = i % 2 === 0; });
  f.router.openDetail();
  for (const page of [...primary, 'holdings', 'reconciliation', 'activity-detail']) f.router.go(page);
  editors.forEach((id, i) => {
    assert.equal(f.get(id), references[i]);
    assert.equal(f.get(id).value, `invented unsaved value ${i}`);
  });
  conditions.forEach((id, i) => assert.equal(f.get(id).hidden, i % 2 === 0, id));
});

test('detail opens in the activity group, resumes across pages, and closes to its origin', () => {
  for (const origin of ['overview', 'transactions', 'review']) {
    const f = fixture('#' + origin);
    f.router.openDetail();
    assertPage(f, 'activity-detail', 'transactions');
    assert.equal(f.get('resume-detail').hidden, false);
    f.router.go('holdings');
    f.followHash('#activity-detail');
    assertPage(f, 'activity-detail', 'transactions');
    const count = f.window.history.length;
    f.router.closeDetail();
    assertPage(f, origin);
    assert.equal(f.window.history.length, count);
    assert.equal(f.get('resume-detail').hidden, true);
    f.followHash('#activity-detail');
    assertPage(f, 'transactions');
  }
});

test('non-navigating detail refresh preserves the current page, focus, scroll and history', () => {
  const f = fixture('#review');
  f.window.scrollY = 456;
  f.router.openDetail({navigate:false});
  assertPage(f, 'review');
  assert.equal(f.window.scrollY, 456);
  assert.equal(f.document.activeElement, null);
  assert.equal(f.window.history.length, 1);
  assert.equal(f.get('resume-detail').hidden, false);
  f.followHash('#activity-detail');
  assertPage(f, 'activity-detail', 'transactions');
});

test('clearDetail invalidates resume and replaces an open detail route without navigating other pages', () => {
  const f = fixture('#review');
  f.router.openDetail();
  const length = f.window.history.length;
  f.router.clearDetail();
  assertPage(f, 'transactions');
  assert.equal(f.window.history.length, length);
  assert.equal(f.get('resume-detail').hidden, true);
  f.router.openDetail();
  f.router.go('position');
  f.router.clearDetail();
  assertPage(f, 'position');
  assert.equal(f.get('resume-detail').hidden, true);
  f.window.history.back();
  assertPage(f, 'transactions');
});

test('loaded state updates scope and empty notice without changing route or stealing focus', () => {
  const f = fixture('#holdings');
  f.router.setLoaded(true);
  assert.equal(f.get('workspace-scope').hidden, false);
  f.router.go('storage');
  assert.equal(f.get('workspace-scope').hidden, true);
  f.router.go('reconciliation');
  assert.equal(f.get('workspace-scope').hidden, false);
  const focusCount = f.get('page-title').focusCalls.length;
  f.router.setLoaded(false);
  assertPage(f, 'reconciliation', 'review');
  assert.equal(f.get('workspace-scope').hidden, true);
  assert.equal(f.get('no-ledger-notice').hidden, false);
  assert.equal(f.get('page-title').focusCalls.length, focusCount);
});
