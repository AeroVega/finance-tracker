import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const prototypes = readdirSync(resolve(root, 'prototype')).filter(name => name.endsWith('.html')).map(name => 'prototype/' + name);
const pagePaths = ['index.html', ...prototypes];
const retained = ['local-preview.html', 'session-coordination-test.html'];

function localTarget(owner, link) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(link)) return null;
  const target = resolve(root, dirname(owner), decodeURIComponent(link.split(/[?#]/)[0]));
  assert.ok(target.startsWith(root), `${owner}: target remains inside repository`);
  return existsSync(target) && statSync(target).isDirectory() ? resolve(target, 'index.html') : target;
}

test('every active HTML navigation and asset target exists', () => {
  for (const owner of pagePaths) {
    for (const [, link] of read(owner).matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = localTarget(owner, link);
      if (target) assert.ok(existsSync(target), `${owner}: missing ${relative(root, target)}`);
    }
  }
});

test('active browser modules and CSS imports reference existing local files', () => {
  for (const directory of ['js', 'prototype']) {
    for (const name of readdirSync(resolve(root, directory)).filter(name => /\.(?:m?js|css)$/.test(name))) {
      const owner = directory + '/' + name;
      const source = read(owner);
      const links = [...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g), ...source.matchAll(/@import\s+url\(['"]?([^'"\)]+)['"]?\)/g)];
      for (const [, link] of links) {
        if (!link.startsWith('.')) continue;
        const target = localTarget(owner, link);
        assert.ok(existsSync(target), `${owner}: missing ${link}`);
      }
    }
  }
});

test('specialist diagnostics remain reachable without crowding the main checklist', () => {
  const hub = read('prototype/index.html');
  assert.doesNotMatch(hub, /pr28-import|pr25-acceptance|synthetic-year.html/);
  for (const page of retained) {
    assert.ok(hub.includes(page), page + ' remains discoverable');
    assert.ok(existsSync(resolve(root, 'prototype', page)));
  }
  const workspace=read('index.html');
  // The retired acceptance tooling is neither linked nor shown as a dead placeholder in the app.
  assert.doesNotMatch(workspace, /href="prototype\/acceptance.html"|Legacy acceptance tooling/);
  assert.match(workspace, /href="prototype\/local-preview.html"/, 'the live CSV diagnostic stays reachable from More');
});

test('superseded runtime is removed while historical design remains', () => {
  for (const path of ['prototype/drive-probe.html', 'prototype/drive-probe.mjs', 'prototype/modern-stack-exploration', 'js/drive-probe-core.mjs']) {
    assert.equal(existsSync(resolve(root, path)), false, path);
  }
  assert.equal(existsSync(resolve(root, 'tests/helpers/legacy-drive-probe-core.mjs')),false);
  assert.ok(existsSync(resolve(root, 'docs/archive/MODERN_UI_EXPLORATION.md')));
  for (const page of pagePaths) {
    assert.doesNotMatch(read(page), /drive-probe\.html|modern-stack-exploration|tailwindcss\/browser/);
  }
});
