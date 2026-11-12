import { diagnosticMessage } from '../js/app-diagnostics.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

async function dashboard() {
  const nodes = new Map(), events = new Map();
  const element = () => ({ value: '', textContent: '', dataset: {}, style: {}, hidden: false, disabled: false, children: [],
    addEventListener(name, handler) { this[name] = handler; },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); } });
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const context = { showDiagnostic: diagnosticMessage, clearDiagnostic() {},
    Intl, Date, TextEncoder, Set, Promise,
    fetch() { assert.fail("local preview must never use the network"); },
    addEventListener: (name, handler) => events.set(name, handler),
    document: { getElementById: get, createElement: element },
  };
  vm.createContext(context);
  const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')
    .replace(/^import .*app-diagnostics.*;\n/m, '')
    .replace('let pendingImports = 0;', 'globalThis.testState = state; let pendingImports = 0;');
  vm.runInContext(source, context);
  await new Promise(setImmediate);
  return { get, state: context.testState, events,
    import: (text, name = 'invented.csv') => get('csv-file').change({ target: { files: [{ name, type: 'text/csv', text: async () => text }] } }),
    search: value => { get('transaction-search').value = value; get('transaction-search').input(); } };
}

test('overview does not present missing or investment-only cash data as zero', async () => {
  const h = await dashboard();
  for (const id of ['income-total', 'expense-total', 'net-total']) assert.equal(h.get(id).textContent, 'Unavailable');
  await h.import('Run Date,Action,Amount\n2026-10-15,Invented investment dividend,10.00\n');
  for (const id of ['income-total', 'expense-total', 'net-total']) assert.equal(h.get(id).textContent, 'Unavailable');
  assert.equal(h.get('transaction-count').textContent, '1');
  assert.match(h.get('transaction-rows').children[0].children[1].children[0].textContent, /excluded from cash totals/);
});

test('search filters only display, including displayed and ISO dates, without changing totals or persistence', async () => {
  const h = await dashboard();
  await h.import('Date,Description,Amount\n2026-10-15,Invented pay,100.00\n2026-10-16,Invented groceries,-12.50\n');
  assert.equal(h.get('net-total').textContent, '$87.50');
  h.search('groceries');
  assert.equal(h.get('transaction-rows').children.length, 1);
  assert.equal(h.get('net-total').textContent, '$87.50');
  assert.equal(h.state.transactions.length, 2);
  assert.equal(h.get('transaction-count').textContent, '2');
  assert.equal(h.get('filter-count').textContent, 'Showing 1 of 2 transaction(s)');
  for (const query of ['Oct 15, 2026', '2026-10-15']) {
    h.search(query); assert.equal(h.get('transaction-rows').children.length, 1);
  }
  h.search('nothing matches');
  assert.equal(h.get('search-empty').hidden, false);
  assert.equal(h.get('empty-state').hidden, true);
  assert.equal(h.get('transaction-table-wrap').hidden, true);
  h.search('');
  assert.equal(h.get('search-empty').hidden, true);
  assert.equal(h.get('transaction-rows').children.length, 2);
});

test('local CSV and invented sample stay distinguishable when mixed', async () => {
  const h = await dashboard();
  await h.import('Date,Description,Amount\n2026-10-15,Invented local fixture,4.00\n');
  await h.get('load-sample').click();
  assert.equal(h.get('data-mode').textContent, 'Local CSV + invented sample');
  assert.match(h.get('data-summary').textContent, /1 local CSV row\(s\) · 4 invented sample row\(s\)/);
  const notes = h.get('transaction-rows').children.map(row => row.children[1].children[0].textContent);
  assert.equal(notes.filter(note => note.startsWith('Local CSV')).length, 1);
  assert.equal(notes.filter(note => note.startsWith('Invented sample')).length, 4);
  assert.equal(h.get('ledger-status').textContent, h.get('import-status').textContent);
});

test('leaving a local CSV preview requests a warning; clearing it removes the warning', async () => {
  const h = await dashboard();
  function warning() { let prevented = false; const event = { preventDefault() { prevented = true; } }; h.events.get('beforeunload')(event); return { prevented, event }; }
  assert.equal(warning().prevented, false);
  await h.import('Date,Description,Amount\n2026-10-15,Invented local fixture,4.00\n');
  assert.equal(warning().prevented, true);
  assert.equal(warning().event.returnValue, '');
  await h.get('clear-data').click();
  assert.equal(warning().prevented, false);
  assert.equal(h.get('net-total').textContent, 'Unavailable');
});

test('invented samples are replaceable local previews and clearing them needs no storage session', async () => {
  const h = await dashboard();
  await h.get('load-sample').click(); await h.get('load-sample').click();
  assert.equal(h.state.syntheticTransactions.length,4);
  assert.equal(h.get('clear-data').disabled,false);
  await h.get('clear-data').click();
  assert.equal(h.state.syntheticTransactions.length,0);
  assert.equal(h.get('net-total').textContent,'Unavailable');
});

test('workspace navigation follows hash and back/forward without intercepting clicks or reloading', () => {
  const links = ['#overview', '#import', '#transactions', '#storage'].map(href => ({ attrs: { href }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k,v) { this.attrs[k]=v; }, removeAttribute(k) { delete this.attrs[k]; } }));
  const events = new Map(), location = { hash: '' };
  const context = { showDiagnostic: diagnosticMessage, clearDiagnostic() {}, document: { querySelectorAll: () => links }, location, addEventListener: (name, callback) => events.set(name, callback) };
  vm.runInNewContext(readFileSync(new URL('../js/workspace-navigation.js', import.meta.url), 'utf8'), context);
  assert.equal(links[0].attrs['aria-current'], 'location');
  for (const hash of ['#transactions', '#import', '#transactions', '']) {
    location.hash = hash; events.get('hashchange')();
    assert.equal(links.filter(link => link.attrs['aria-current']).length, 1);
    assert.equal(links.find(link => link.attrs['aria-current']).attrs.href, hash || '#overview');
  }
  assert.deepEqual([...events.keys()], ['hashchange']);
});

test('shared static theme covers every retained tool and guarded navigation targets', () => {
  const root = readFileSync(new URL('../prototype/local-preview.html', import.meta.url), 'utf8');
  assert.match(root, /class="brand" href="#overview"/);
  assert.match(root, /Browser warnings may not appear/);
  assert.match(root, /not reconciled income, spending or account balances/);
  assert.match(root, /pr28-import.html/);
  for (const name of readdirSync(new URL('../prototype/', import.meta.url)).filter(name => name.endsWith('.html'))) {
    const html = readFileSync(new URL('../prototype/' + name, import.meta.url), 'utf8');
    assert.match(html, name === 'local-preview.html' ? /href="\.\.\/styles.css"/ : /href="\.\/tools.css"/, name);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, name + ' has unique IDs');
    assert.match(html, name === 'local-preview.html' ? /primary-nav/ : /tool-navigation/, name);
  }
  const hub = readFileSync(new URL('../prototype/index.html', import.meta.url), 'utf8');
  assert.match(hub, /pr25-acceptance.html\?guide=v5/);
  assert.match(hub, /acceptance.html/);
  assert.match(hub, /<details/);
  const acceptance = readFileSync(new URL('../prototype/pr25-acceptance.html', import.meta.url), 'utf8');
  assert.doesNotMatch(acceptance, /guide=pr28/);
  const acceptanceNavigation = acceptance.match(/<nav class="tool-navigation"[\s\S]*?<\/nav>/)[0];
  assert.match(acceptanceNavigation, /id="prototype-tools"/, 'keep the copy guide navigation guard hook');
  assert.doesNotMatch(acceptanceNavigation, /href="\.\.\/index.html"/, 'do not add an unguarded exit beside the copy guide');
  assert.equal(existsSync(new URL('../docs/archive/MODERN_UI_EXPLORATION.md', import.meta.url)), true);
  assert.match(readFileSync(new URL('../design-system.css', import.meta.url), 'utf8'), /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.doesNotMatch(root, /tailwind|fonts\.googleapis|analytics/);
});
