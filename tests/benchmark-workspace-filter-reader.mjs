import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

// Compare defensive readers on the same invented fixture and current canonical engines.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--baseline-ref' || !/^[a-f0-9]{7,40}$/.test(args[1])) {
  throw new TypeError('usage: node tests/benchmark-workspace-filter-reader.mjs --baseline-ref commit-sha');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const moduleUrl = new URL('../js/canonical-workspace-model.mjs', import.meta.url);
const {createWorkspaceViewReader:candidate} = await import(moduleUrl);
const {createLargeWorkspaceFixture} = await import('./helpers/workspace-large-fixture.mjs');
const baselineRef = args[1];
const source = execFileSync('git',['show',`${baselineRef}:js/canonical-workspace-model.mjs`],{cwd:root,encoding:'utf8'})
  .replaceAll(/from '(\.\/[^']+)'/g,(_,file)=>`from ${JSON.stringify(new URL(file,moduleUrl).href)}`);
const {createWorkspaceViewReader:baseline} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const summarize = values => {
  const sorted = [...values].sort((a,b)=>a-b);
  return {medianMs:sorted[Math.floor(sorted.length/2)],minMs:sorted[0],maxMs:sorted.at(-1),runsMs:values};
};
const repeats = 7, calls = 40;
const results = [];
for (const perAccount of [750,2016]) {
  const {ledger} = createLargeWorkspaceFixture({perAccount});
  const modes = {baseline,candidate};
  const readers = Object.fromEntries(Object.entries(modes).map(([name,create])=>[name,create(ledger)]));
  const cases = {
    allPages: Array.from({length:calls},(_,page)=>({page,pageSize:25})),
    searchPages: Array.from({length:calls},(_,page)=>({query:'invented scale shop 1',page,pageSize:25})),
    reviewPages: Array.from({length:calls},(_,page)=>({query:'invented scale shop 1',reviewOnly:true,page,pageSize:25})),
    changingSearch: Array.from({length:calls},(_,i)=>({query:`shop ${i%4}`,page:i%3,pageSize:25})),
  };
  const timings = Object.fromEntries(Object.keys(modes).map(name=>[name,Object.fromEntries(['cold',...Object.keys(cases)].map(k=>[k,[]]))]));
  // Full result parity is checked outside all timed regions, including empty/clamped pages.
  for (const selections of Object.values(cases)) for (const selection of selections) {
    assert.deepEqual(readers.candidate.view(selection),readers.baseline.view(selection));
  }
  let checksum = {baseline:0,candidate:0};
  for (let run=0;run<repeats;run++) {
    const order = run%2 ? ['candidate','baseline'] : ['baseline','candidate'];
    for (const mode of order) {
      const start = performance.now();
      const cold = modes[mode](ledger).view();
      timings[mode].cold.push(performance.now()-start);
      checksum[mode] += cold.totalCount;
    }
    for (const [name,selections] of Object.entries(cases)) for (const mode of order) {
      const reader=readers[mode];
      // Set the same scope and starting filter on both sides before a warm page batch.
      for (let warm=0;warm<3;warm++) reader.view(selections[0]);
      const start=performance.now();
      for (const selection of selections) {
        const view=reader.view(selection);
        checksum[mode] += view.filteredCount + view.page + view.rows.length;
      }
      timings[mode][name].push((performance.now()-start)/calls);
    }
  }
  assert.equal(checksum.candidate,checksum.baseline);
  results.push({activities:ledger.activities.length,events:ledger.events.length,unresolved:320,checksum,timings:Object.fromEntries(Object.entries(timings).map(([mode,cases])=>[mode,Object.fromEntries(Object.entries(cases).map(([name,values])=>[name,summarize(values)]))]))});
}
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,baselineRef,repeats,callsPerBatch:calls,description:'Invented 4-account USD/EUR histories. Alternating 7 runs, 3 untimed warmups, milliseconds per view. Cold includes reader creation and first view; other measurements are already-loaded scope. Full output parity checked outside timings; checksums consumed. Excludes fixture setup, DOM, Drive, real data and device validation.',results},null,2));
