// Invented in-memory catalogs only. No Drive or other network operations.
// node tests/benchmark-catalog-resolution.mjs --baseline-ref=c41448b
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as current from '../js/drive-locator-catalog.mjs';

const argument = process.argv[2];
if (process.argv.length > 3 || (argument && !/^--baseline-ref=[0-9a-f]{7,40}$/i.test(argument))) throw new Error('Use --baseline-ref=<hexadecimal commit>');
let scratch;
try {
  const variants = [];
  if (argument) {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const revision = execFileSync('git', ['rev-parse', '--verify', argument.slice('--baseline-ref='.length) + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
    const original = execFileSync('git', ['show', revision + ':js/drive-locator-catalog.mjs'], { cwd: root, encoding: 'utf8' });
    const source = original.replace(/from (["'])(\.\/[^"']+)\1/g,
      (_, quote, path) => 'from ' + quote + new URL('../js/' + path.slice(2), import.meta.url).href + quote);
    scratch = await mkdtemp(join(tmpdir(), 'finance-catalog-lookup-'));
    const path = join(scratch, 'baseline.mjs'); await writeFile(path, source);
    variants.push({ name: revision, module: await import(pathToFileURL(path).href) });
  }
  variants.push({ name: 'current', module: current });
  for (const count of [100, 1000]) {
    const additions = Array.from({ length: count }, (_, i) => {
      const hash = i.toString(16).padStart(64, '0');
      return { kind: 'data-object', identity: hash, sha256: hash, fileId: 'invented-file-' + i };
    });
    const catalog = current.createLocatorCatalog({ databaseId: 'invented-db', copyId: 'invented-copy', additions });
    const snapshot = Object.fromEntries(additions.map((entry, i) => ['invented/path-' + i, entry.sha256]));
    const expected = Object.fromEntries(additions.map((entry, i) => ['invented/path-' + i, { sha256: entry.sha256, fileId: entry.fileId }]));
    for (const { name, module } of variants) {
      const times = [];
      for (let trial = 0; trial < 3; trial++) {
        const start = performance.now();
        const result = module.resolveSnapshotLocators(snapshot, catalog);
        times.push(performance.now() - start); assert.deepEqual(result, expected);
      }
      let hashReads = 0;
      const instrumented = structuredClone(catalog);
      for (const entry of Object.values(instrumented.entries)) {
        const hash = entry.sha256;
        Object.defineProperty(entry, 'sha256', { enumerable: true, get() { hashReads++; return hash; } });
      }
      assert.deepEqual(module.resolveSnapshotLocators(snapshot, instrumented), expected);
      console.log(JSON.stringify({ node: process.version, variant: name, catalogEntries: count, snapshotPaths: count,
        medianMs: Number(times.sort((a, b) => a - b)[1].toFixed(3)), instrumentedHashReads: hashReads }));
    }
  }
} finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
