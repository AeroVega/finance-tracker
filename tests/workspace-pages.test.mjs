import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWorkspacePages} from '../js/workspace-pages.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const primary = ['overview', 'transactions', 'position', 'storage'];
const routes = [...primary, 'import', 'reconciliation', 'activity-detail'];
const sectionOf = page => page === 'account' ? 'position' : page;
const activityViews = ['transactions', 'reconciliation'];

// A deliberately small DOM/history substitute: real HTML IDs and initial hidden
// states, native hash navigation events, and pushState's lack of events. This
// exercises routing, not browser layout, Safari focus, or controller rendering.
function fixture(hash = '', {onAlias} = {}) {
  const nodes = new Map();
  const documentListeners = new Map();
  const document = {title:'', activeElement:null, getElementById:id => nodes.get(id) || null,
    addEventListener(type, callback) { if (!documentListeners.has(type)) documentListeners.set(type, []); documentListeners.get(type).push(callback); }};
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
  const router = createWorkspacePages({document, window, onAlias});
  function clickLink(id, options = {}) {
    const event = {button:0, target:{closest:() => nodes.get(id)}, defaultPrevented:false,
      preventDefault() { this.defaultPrevented = true; }, ...options};
    for (const callback of documentListeners.get('click') || []) callback(event);
    return event;
  }
  return {document, window, router, followHash, clickLink, get:id => {
    assert.ok(nodes.has(id), `HTML must contain ${id}`);
    return nodes.get(id);
  }};
}

test('ordinary route links preserve scroll, active-tab clicks return to the header, and modified clicks stay native', () => {
  const f = fixture('#overview');
  f.window.scrollY = 300;
  assert.equal(f.clickLink('nav-transactions').defaultPrevented, true);
  assertPage(f, 'transactions'); assert.equal(f.window.scrollY, 0);
  f.window.scrollY = 120; f.clickLink('nav-overview');
  assertPage(f, 'overview'); assert.equal(f.window.scrollY, 300);
  const length = f.window.history.length;
  f.clickLink('nav-overview'); assert.equal(f.window.scrollY, 0);
  assert.equal(f.window.history.length, length);
  f.window.history.back(); assertPage(f, 'transactions'); assert.equal(f.window.scrollY, 120);
  f.window.history.forward(); assertPage(f, 'overview'); assert.equal(f.window.scrollY, 0);
  for (const options of [{ctrlKey:true}, {metaKey:true}, {button:1}, {shiftKey:true}]) {
    assert.equal(f.clickLink('nav-position', options).defaultPrevented, false);
    assertPage(f, 'overview'); assert.equal(f.window.history.length, length);
  }
});

const groups = {reconciliation:'transactions', account:'position', import:'overview', 'activity-detail':'transactions'};
function assertPage(f, page, group = groups[page] ?? page) {
  assert.equal(f.router.current, page);
  assert.equal(f.window.location.hash, '#' + page);
  assert.deepEqual(routes.filter(id => !f.get(id).hidden), [sectionOf(page)]);
  assert.deepEqual(primary.filter(id => f.get('nav-' + id).getAttribute('aria-current') === 'page'), [group]);
  assert.deepEqual(activityViews.filter(id => f.get('sub-' + id).getAttribute('aria-current') === 'page'), activityViews.includes(page) ? [page] : []);
  assert.equal(f.get('position').getAttribute('data-view'), page === 'account' ? 'detail' : 'list');
  assert.equal(f.get('activity-navigation').hidden, !activityViews.includes(page));
}

for (const [page, group, title, mode] of [
  ['overview','overview','Home','period'], ['transactions','transactions','Activity','period'],
  ['position','position','Accounts','date'],
  ['reconciliation','transactions','Reconcile','period'],
  ['import','overview','Import',null], ['storage','storage','More',null]
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
  const f = fixture('#reconciliation');
  f.router.go('not-a-page');
  assertPage(f, 'overview');
  f.followHash('#activity-detail');
  assertPage(f, 'transactions');
});

test('native hash links and pushState routes both survive Back and Forward without duplicate entries', () => {
  const f = fixture('#overview');
  f.followHash('#position');
  f.router.go('storage');
  f.followHash('#reconciliation');
  assert.equal(f.window.history.length, 4);
  for (const [page, group] of [['storage','storage'], ['position','position'], ['overview','overview']]) {
    f.window.history.back(); assertPage(f, page, group);
  }
  for (const [page, group] of [['position','position'], ['storage','storage'], ['reconciliation','transactions']]) {
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
  const f = fixture('#position');
  f.followHash('#main-content');
  assert.equal(f.router.current, 'position');
  assert.equal(f.document.activeElement, f.get('main-content'));
  assert.deepEqual(routes.filter(id => !f.get(id).hidden), ['position']);
});

test('navigation preserves mounted editor identity, unsaved values, and conditional child states', () => {
  const f = fixture('#transactions');
  const editors = ['correction-rationale', 'category', 'amount', 'holdings-source', 'transaction-search'];
  const references = editors.map(id => f.get(id));
  references.forEach((node, i) => { node.value = `invented unsaved value ${i}`; });
  const conditions = ['category-field', 'amount-field', 'classification-field', 'transfer-link-panel', 'overview-loaded'];
  conditions.forEach((id, i) => { f.get(id).hidden = i % 2 === 0; });
  f.router.openDetail();
  f.router.setAccountAvailable(true);
  for (const page of [...primary, 'account', 'reconciliation', 'activity-detail']) f.router.go(page);
  editors.forEach((id, i) => {
    assert.equal(f.get(id), references[i]);
    assert.equal(f.get(id).value, `invented unsaved value ${i}`);
  });
  conditions.forEach((id, i) => assert.equal(f.get(id).hidden, i % 2 === 0, id));
});

test('detail opens in the activity group, resumes across pages, and closes to its origin', () => {
  for (const origin of ['overview', 'transactions']) {
    const f = fixture('#' + origin);
    f.router.openDetail();
    assertPage(f, 'activity-detail', 'transactions');
    assert.equal(f.get('resume-detail').hidden, false);
    f.router.go('position');
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
  const f = fixture('#reconciliation');
  f.window.scrollY = 456;
  f.router.openDetail({navigate:false});
  assertPage(f, 'reconciliation');
  assert.equal(f.window.scrollY, 456);
  assert.equal(f.document.activeElement, null);
  assert.equal(f.window.history.length, 1);
  assert.equal(f.get('resume-detail').hidden, false);
  f.followHash('#activity-detail');
  assertPage(f, 'activity-detail', 'transactions');
});

test('clearDetail invalidates resume and replaces an open detail route without navigating other pages', () => {
  const f = fixture('#reconciliation');
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
  const f = fixture('#position');
  f.router.setLoaded(true);
  assert.equal(f.get('workspace-scope').hidden, false);
  f.router.go('storage');
  assert.equal(f.get('workspace-scope').hidden, true);
  f.router.go('reconciliation');
  assert.equal(f.get('workspace-scope').hidden, false);
  const focusCount = f.get('page-title').focusCalls.length;
  f.router.setLoaded(false);
  assertPage(f, 'reconciliation', 'transactions');
  assert.equal(f.get('workspace-scope').hidden, true);
  assert.equal(f.get('no-ledger-notice').hidden, false);
  assert.equal(f.get('page-title').focusCalls.length, focusCount);
});

test('retired #review links open Activity with the review filter and keep one history entry', () => {
  const calls = [];
  const f = fixture('#review', {onAlias:name => calls.push(name)});
  assertPage(f, 'transactions');
  assert.deepEqual(calls, ['review']);
  assert.equal(f.window.history.length, 1);
  f.router.go('storage');
  f.router.go('review');
  assertPage(f, 'transactions');
  assert.deepEqual(calls, ['review', 'review']);
  f.followHash('#review');
  assertPage(f, 'transactions');
  assert.equal(calls.length, 3);
  assert.doesNotMatch(html, /id="sub-review"/, 'the retired Review tab is gone');
});

test('account detail exists only while an account is selected and shares the Accounts section', () => {
  const f = fixture('#account');
  assertPage(f, 'position');
  assert.equal(f.window.history.length, 1);
  f.router.openAccount();
  assertPage(f, 'position');
  f.router.setAccountAvailable(true);
  f.router.openAccount();
  assertPage(f, 'account');
  assert.equal(f.get('page-title').textContent, 'Accounts');
  assert.equal(f.document.activeElement, f.get('account-title'), 'detail focus starts on the account heading');
  f.window.history.back(); assertPage(f, 'position');
  f.window.history.forward(); assertPage(f, 'account');
  const length = f.window.history.length;
  f.router.setAccountAvailable(false);
  assertPage(f, 'position');
  assert.equal(f.window.history.length, length, 'losing the account replaces the route');
  f.followHash('#account');
  assertPage(f, 'position');
  assert.doesNotMatch(html, /id="(?:holdings|sub-holdings|sub-position|position-navigation)"/, 'holdings are part of account detail');
});

test('retired #holdings links open the selected investment account', () => {
  const calls = [];
  let f;
  f = fixture('#holdings', {onAlias:name => { calls.push(name); f?.router.setAccountAvailable(true); }});
  assertPage(f, 'position', 'position');
  assert.deepEqual(calls, ['holdings']);
  f.router.go('storage');
  f.router.go('holdings');
  assertPage(f, 'account');
  assert.deepEqual(calls, ['holdings', 'holdings']);
});
