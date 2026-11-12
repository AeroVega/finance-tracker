// Invented HTTP only. No credentials, external requests, or real Drive files.
// node tests/benchmark-history-reads.mjs --saves=30
// Measures the current v5 writer only; historical layout adapters are retired.
import assert from 'node:assert/strict';
import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent } from '../js/canonical-import.mjs';
import { CanonicalLedgerStore } from '../js/canonical-ledger-storage.mjs';
import { setupHttpCanonicalWorkbench } from './helpers/pr28-http-workbench.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(saves)=(.+)$/.exec(arg);
  if (!match) throw new Error('Use --saves=<2..100>');
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

// Inspect already verified synthetic files without adding benchmark HTTP reads.
function retainedEntries(http, manifest) {
  const catalog=http.json(manifest.locatorRoot.fileId), entries=[];
  const visit=ref=>{
    if(ref===null)return;
    const page=http.json(ref.fileId);
    if(page.nodeType==='branch')for(const child of page.children)visit(child);
    else for(const [,entry] of page.entries)entries.push(entry);
  };
  visit(catalog.objects);
  return entries;
}
const h=await setupHttpCanonicalWorkbench();
try {
  const store=new CanonicalLedgerStore({lifecycle:h.lifecycle});
  assert.equal(await store.load(),null);
  const samples=[];
  for(const [index,checkpoint] of checkpoints.entries()) {
    const phase='save-'+(index+1);h.http.phase=phase;
    const priorFiles=new Set(h.http.files.keys());
    await store.save(checkpoint);
    const saveRequests=h.http.summary(phase).requests;
    const manifest=h.http.json(h.manifestFileId),entries=retainedEntries(h.http,manifest);
    const root=entries.find(entry=>entry.kind==='data-object'&&entry.sha256===manifest.root);
    assert.ok(root);assert.equal(h.http.json(root.fileId).version,5);
    const catalogWriteBytes=[...h.http.files].filter(([id,file])=>!priorFiles.has(id)&&file.metadata.appProperties?.financeTrackerKind.startsWith('locator-catalog'))
      .reduce((sum,[,file])=>sum+file.bytes.byteLength,0);
    assert.deepEqual(await h.driver.reopen(),checkpoint);
    const summary=h.http.summary(phase);
    samples.push({save:index+1,requests:summary.requests,saveRequests,catalogWriteBytes,
      reopenRequests:summary.requests-saveRequests,media:summary.categories.media,lists:summary.categories.list});
  }
  h.http.phase='inspection';
  const manifest=h.http.json(h.manifestFileId),entries=retainedEntries(h.http,manifest);
  assert.equal(manifest.revision,String(saves));
  await h.driver.verifyPortable();
  console.log(JSON.stringify({variant:'current',layout:'partitions-v5',node:process.version,activities:1,saves,samples,
    folderFiles:h.http.files.size,
    totalFolderBytes:[...h.http.files.values()].reduce((sum,file)=>sum+file.bytes.byteLength,0),
    catalogPageFiles:[...h.http.files.values()].filter(file=>file.metadata.appProperties?.financeTrackerKind==='locator-catalog-page').length,
    catalogFiles:[...h.http.files.values()].filter(file=>file.metadata.appProperties?.financeTrackerKind==='locator-catalog').length,
    retainedEntries:entries.length,retainedBytes:entries.reduce((sum,entry)=>sum+h.http.files.get(entry.fileId).bytes.byteLength,0),
    peakConcurrency:h.http.peakConcurrency,peakMutations:h.http.peakMutations,
    note:'Synthetic HTTP counts include save and exact same-session reopen, not cold reconnect; exclude initial connection, periodic heartbeat, archive verification, OAuth and browser CORS. Expected exact-ID absence probes are counted. Catalog write bytes include roots and pages. Local format inspection adds no requests. Folder bytes count stored content only. Full retained-history verification remains; no bounded-memory, live latency or device-capacity claim.'}));
} finally {await h.lifecycle.release();}
