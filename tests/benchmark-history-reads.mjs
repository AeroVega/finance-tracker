// Invented HTTP only. No credentials, external requests, or real Drive files.
// node tests/benchmark-history-reads.mjs --baseline-ref=e55faec --saves=30
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent } from '../js/canonical-import.mjs';
import { CanonicalLedgerStore } from '../js/canonical-ledger-storage.mjs';
import { setupHttpCanonicalWorkbench } from './helpers/pr28-http-workbench.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(baseline-ref|saves)=(.+)$/.exec(arg);
  if (!match) throw new Error('Use --baseline-ref=<hexadecimal commit> and --saves=<2..100>');
  return [match[1], match[2]];
}));
const saves = Number(args.saves || 30);
if (!Number.isSafeInteger(saves) || saves < 2 || saves > 100) throw new Error('Use 2..100 saves');
const now = '2026-11-08T00:00:00.000Z';
let sequence = 0;
const options = { now: () => now, idFactory: () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0') };
let ledger = registerAccount(createLedger(options), { institutionId: 'sofi', name: 'Invented audit account', currency: 'USD', accountType: 'checking' }, options);
const accountId = ledger.accounts[0].accountId;
const record = { sourceAccountKey: 'default', sourceFields: { Description: 'INVENTED SHOP 0', Amount: '-12.34' },
  rowOrdinal: 1, physicalLine: 2, sourceDescription: 'INVENTED SHOP 0', normalizedDescription: 'invented shop 0',
  sourceAction: 'Card purchase', sourceRecordId: null, amountText: '-12.34', currency: null,
  effectiveDate: '2026-01-15', postedDate: null, settlementDate: null, lifecycleStatus: 'posted', valid: true, errorCode: null };
ledger = prepareCanonicalImport(ledger, { syntheticOnly: true,
  parsed: { sourceFormat: 'sofi-csv-v1', institutionId: 'sofi', fileFingerprint: 'invented-1', rowsSeen: 1,
    ignoredCount: 0, records: [record], sourceAccountKeys: ['default'], sourceCoverage: null },
  accountMappings: { default: accountId },
  coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } } }, options).ledger;
assert.equal(ledger.activities.length, 1);
const checkpoints = [ledger];
for (let save = 2; save <= saves; save++) checkpoints.push(applyFinancialEvent(checkpoints.at(-1), {
  type: 'classification', commandId: 'invented-save-' + save, activityId: ledger.activities[0].activityId,
  activityKind: 'spending', categoryId: 'invented-' + save }, options));

const variants = [];
let scratch;
try {
  if (args['baseline-ref']) {
    if (!/^[0-9a-f]{7,40}$/i.test(args['baseline-ref'])) throw new Error('Use a hexadecimal baseline commit');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const revision = execFileSync('git', ['rev-parse', '--verify', args['baseline-ref'] + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
    scratch = await mkdtemp(join(tmpdir(), 'finance-history-benchmark-'));
    const archive = execFileSync('git', ['archive', '--format=tar', revision, 'js', 'tests/helpers'], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', scratch], { input: archive });
    variants.push({ name: revision, setup: (await import(pathToFileURL(join(scratch, 'tests/helpers/pr28-http-workbench.mjs')).href)).setupHttpCanonicalWorkbench,
      Store: (await import(pathToFileURL(join(scratch, 'js/canonical-ledger-storage.mjs')).href)).CanonicalLedgerStore });
  }
  variants.push({ name: 'current', setup: setupHttpCanonicalWorkbench, Store: CanonicalLedgerStore });
  for (const { name, setup, Store } of variants) {
    const h = await setup(), store = new Store({ lifecycle: h.lifecycle, layout: 'chunks-v2' });
    assert.equal(await store.load(), null);
    const samples = [];
    for (const [index, checkpoint] of checkpoints.entries()) {
      const phase = 'save-' + (index + 1); h.http.phase = phase;
      await store.save(checkpoint);
      const saveRequests = h.http.summary(phase).requests;
      assert.deepEqual(await new Store({ lifecycle: h.lifecycle }).load(), checkpoint);
      const summary = h.http.summary(phase);
      samples.push({ save: index + 1, requests: summary.requests, saveRequests, reopenRequests: summary.requests - saveRequests, media: summary.categories.media, lists: summary.categories.list });
    }
    const manifest = h.http.json(h.manifestFileId), catalog = h.http.json(manifest.locatorCatalog.fileId);
    assert.equal(manifest.revision, saves);
    await h.driver.verifyPortable();
    console.log(JSON.stringify({ variant: name, node: process.version, activities: 1, saves,
      samples, retainedEntries: Object.keys(catalog.entries).length,
      retainedBytes: Object.values(catalog.entries).reduce((total, entry) => total + h.http.files.get(entry.fileId).bytes.byteLength, 0),
      peakConcurrency: h.http.peakConcurrency, peakMutations: h.http.peakMutations,
      note: 'Synthetic HTTP counts include save and exact reopen; exclude initial connection, periodic heartbeat, retries, OAuth and browser CORS.' }));
    await h.lifecycle.release();
  }
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
