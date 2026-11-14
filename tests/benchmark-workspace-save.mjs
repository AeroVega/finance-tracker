// Invented HTTP only. Uses the active workspace session and fragmented-v3 path.
// node tests/benchmark-workspace-save.mjs --baseline-ref=5e9c896 --saves=6 --repeats=3 --delay-ms=0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(baseline-ref|saves|repeats|delay-ms)=(.+)$/.exec(arg);
  if (!match) throw new Error('Use --baseline-ref=<commit>, --saves=<1..100>, --repeats=<1..10>, --delay-ms=<0..1000>');
  return [match[1], match[2]];
}));
const saves = Number(args.saves || 6), repeats = Number(args.repeats || 3), delayMs = Number(args['delay-ms'] || 0);
if (!Number.isSafeInteger(saves) || saves < 1 || saves > 100 || !Number.isSafeInteger(repeats) || repeats < 1 || repeats > 10 ||
    !Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 1000) throw new Error('Invalid benchmark limits');
const root = fileURLToPath(new URL('../', import.meta.url));
async function variant(path, name) {
  const module = relative => import(pathToFileURL(join(path, relative)).href);
  return { name, ...(await module('tests/helpers/pr28-http-workbench.mjs')),
    ...(await module('js/synthetic-financial-year.mjs')), ...(await module('js/canonical-ledger-storage.mjs')),
    ...(await module('js/canonical-workspace-session.mjs')), ...(await module('js/canonical-import.mjs')),
    ...(await module('js/catalog-storage.mjs')) };
}
let scratch;
try {
  const variants = [];
  if (args['baseline-ref']) {
    if (!/^[0-9a-f]{7,40}$/i.test(args['baseline-ref'])) throw new Error('Use a hexadecimal baseline commit');
    const commit = execFileSync('git', ['rev-parse', '--verify', args['baseline-ref'] + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
    scratch = await mkdtemp(join(tmpdir(), 'finance-workspace-benchmark-'));
    const archive = execFileSync('git', ['archive', '--format=tar', commit, 'js', 'tests/helpers'], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', scratch], { input: archive });
    variants.push(await variant(scratch, commit));
  }
  variants.push(await variant(root, 'current'));
  // Alternate variant order so repeated timing samples do not favor one side.
  for (let repeat = 0; repeat < repeats; repeat++) for (const v of repeat % 2 ? [...variants].reverse() : variants) {
    const recipe = await v.createSyntheticFinancialYear();
    const h = await v.setupHttpCanonicalWorkbench();
    const store = new v.CanonicalLedgerStore({ lifecycle: h.lifecycle });
    await store.load(); await store.save(recipe.ledger);
    const session = new v.CanonicalWorkspaceSession({ storage: { lifecycle: h.lifecycle } });
    await session.loadVerified();
    const activity = v.getEffectiveActivities(session.ledger).find(a => a.sourceDescription === 'INVENTED BROKERAGE FEE');
    const samples = [];
    for (let revision = 0; revision < saves; revision++) {
      session.correct({ activityId: activity.activityId, type: 'classification', activityKind: 'spending', rationale: 'Invented correction ' + revision });
      session.correct({ activityId: activity.activityId, type: 'category-correction', categoryId: revision % 2 ? 'other' : 'fees', rationale: 'Invented category ' + revision });
      const expected = structuredClone(session.ledger);
      h.http.latencyMs = delayMs; h.http.phase = 'save-' + revision;
      const start = performance.now(); await session.save(); const saveMs = performance.now() - start;
      const metrics = h.http.summary(h.http.phase);
      assert.deepEqual(session.ledger, expected); assert.deepEqual(session.ledger.observations, recipe.ledger.observations);
      h.http.latencyMs = 0; h.http.phase = 'reopen';
      await session.reopen(); assert.deepEqual(session.ledger, expected);
      samples.push({ revision: revision + 1, saveMs, ...metrics });
    }
    h.http.phase = 'full-export'; await h.driver.verifyPortable();
    const catalog = await v.readCatalog(h.lifecycle.transactionAdapter, h.http.json(h.manifestFileId));
    console.log(JSON.stringify({ variant: v.name, repeat: repeat + 1, node: process.version, activities: recipe.ledger.activities.length,
      delayMs, samples, retainedEntries: Object.keys(catalog.entries).length, folderFiles: h.http.files.size,
      note: 'Save includes internal verified readback. Separate exact reopen/full export are checked but not timed. Injected per-request delay is not Drive latency. Excludes OAuth, periodic heartbeat, retries and browser CORS; no real data or network.' }));
    await h.lifecycle.release();
  }
} finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
