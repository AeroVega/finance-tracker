// Synthetic CPU-only measurement. No Drive calls, wall-clock pass threshold or device claim.
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createWorkspaceView, createWorkspaceViewReader} from '../js/canonical-workspace-model.mjs';
import {createLargeWorkspaceFixture} from './helpers/workspace-large-fixture.mjs';

// Optional exact historical model for a reproducible before/after comparison.
// Its imports resolve against unchanged canonical engines in the current checkout.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--baseline-ref' || !/^[a-f0-9]{7,40}$/.test(args[1]))) {
  throw new TypeError('usage: node tests/benchmark-canonical-workspace-view.mjs [--baseline-ref commit-sha]');
}
let baseline = createWorkspaceView;
if (args.length) {
  let source = execFileSync('git',['show',`${args[1]}:js/canonical-workspace-model.mjs`], {
    cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',
  });
  for (const filename of ['canonical-import.mjs','import-reconciliation.mjs']) {
    source = source.replaceAll(`'./${filename}'`,JSON.stringify(new URL(`../js/${filename}`,import.meta.url).href));
  }
  baseline = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).createWorkspaceView;
}
const {ledger} = createLargeWorkspaceFixture();
const cases = [
  ['all', {}], ['search', {query:'shop 1'}], ['page', {query:'shop 1',page:2}],
  ['month', {month:'2024-02'}], ['account', {accountId:ledger.accounts[0].accountId}],
];
const results = [];
for (let run = 0; run < 4; run++) for (const mode of ['baseline', 'snapshot-reader']) {
  const started = performance.now();
  const reader = mode === 'snapshot-reader' ? createWorkspaceViewReader(ledger) : null;
  const snapshotMs = performance.now() - started;
  for (const [name, selection] of cases) {
    const start = performance.now();
    const view = reader ? reader.view(selection) : baseline(ledger,selection);
    results.push({mode,run,case:name,snapshotMs,viewMs:performance.now()-start,rows:view.filteredCount});
  }
}
console.log(JSON.stringify({node:process.version,baselineRef:args[1] ?? 'current-one-shot',activities:ledger.activities.length,events:ledger.events.length,
  accounts:ledger.accounts.length,unresolved:320,description:'Model CPU only; excludes fixture setup, DOM and Drive. Include snapshotMs in cold-open cost.',results},null,2));
