// Invented data, Node CPU only. No device, network, cold-open or capacity claim.
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {createLargeWorkspaceFixture} from './helpers/workspace-large-fixture.mjs';
import {createCanonicalMonthIndex} from '../js/canonical-month-index.mjs';
import {createWorkspaceView,createWorkspaceViewReader} from '../js/canonical-workspace-model.mjs';
import {summarizeLedger} from '../js/canonical-import.mjs';
const repeats = Number(process.env.INDEX_REPEATS || 3);
const sizes = (process.env.INDEX_PER_ACCOUNT || '252,1008,2016').split(',').map(Number);
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 20 || sizes.some(n => !Number.isSafeInteger(n) || n < 1 || n > 2688)) throw new TypeError('invalid benchmark workload');
const measure = fn => { const start = performance.now(); const result = fn(); return {ms:performance.now()-start,result}; };
const summarize = values => { const sorted = [...values].sort((a,b) => a-b); return {medianMs:sorted[Math.floor(sorted.length/2)],minMs:sorted[0],maxMs:sorted.at(-1)}; };
const results = [];
for (const perAccount of sizes) {
  const {ledger} = createLargeWorkspaceFixture({perAccount,corrections:Math.floor(perAccount / 2),unresolvedPerAccount:4});
  const scope = {start:'2023-01-01',end:'2030-12-31',currency:'USD'};
  const reference = summarizeLedger(ledger,scope);
  const timings = {buildIndex:[],fullCanonicalReport:[],indexedFullReport:[],monthlySynopsis:[],buildWorkspaceReader:[],warmMonthView:[],oneShotMonthView:[]};
  let work;
  for (let run = 0; run < repeats; run++) {
    const built = measure(() => createCanonicalMonthIndex(ledger)); timings.buildIndex.push(built.ms);
    const reader = measure(() => createWorkspaceViewReader(ledger,{monthlyIndex:built.result})); timings.buildWorkspaceReader.push(reader.ms);
    const index = built.result;
    // Prime account metadata and the preceding month; the timed selection changes.
    const accountId = ledger.accounts[0].accountId;
    reader.result.view({accountId,month:'2023-02'});
    const operations = {
      fullCanonicalReport:() => summarizeLedger(ledger,scope),indexedFullReport:() => index.report(scope).report,
      monthlySynopsis:() => index.report(scope,{includeExcluded:false}),
      warmMonthView:() => reader.result.view({accountId,month:'2023-01'}),
      oneShotMonthView:() => createWorkspaceView(ledger,{accountId,month:'2023-01'})
    };
    for (const name of (run % 2 ? Object.keys(operations).reverse() : Object.keys(operations))) {
      const value = measure(operations[name]); timings[name].push(value.ms);
      if (name === 'monthlySynopsis') { assert.deepEqual(value.result.report,{...reference,excluded:[]}); work = value.result.work; }
      else if (name.endsWith('Report')) assert.deepEqual(value.result,reference);
      else assert.equal(value.result.rows.length,25);
    }
  }
  results.push({activities:ledger.activities.length,events:ledger.events.length,repeats,work,timings:Object.fromEntries(Object.entries(timings).map(([name,values]) => [name,{...summarize(values),runsMs:values}]))});
}
console.log(JSON.stringify({node:process.version,description:'Synthetic Node CPU. Complete report outputs match. Synopsis omits per-activity exclusion detail; current canonical reference constructs it. Build costs are separate. Warm workspace timing changes month after account metadata is prepared. Excludes Drive, DOM, source hashing and persisted summary verification.',results},null,2));
