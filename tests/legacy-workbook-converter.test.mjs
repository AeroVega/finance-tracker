import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createLedger} from '../js/canonical-import.mjs';
import {previewHistoricalMonthlySummaries} from '../js/historical-monthly-summary.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));
const converter = path('../scripts/legacy-workbook-converter.py');
const fixture = path('../fixtures/legacy-workbook-invented.py');
const example = path('../fixtures/legacy-workbook-mapping.synthetic.json');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function run(pythonFile, ...args) {
  const r = spawnSync('python3', [pythonFile, ...args], {encoding:'utf8', timeout:20000});
  assert.ifError(r.error);
  return r;
}

function setup(t, variant = 'ok') {
  const directory = mkdtempSync(join(tmpdir(), 'invented-legacy-test-'));
  t.after(() => rmSync(directory, {recursive:true,force:true}));
  const workbook = join(directory, 'invented-legacy.xlsx');
  const output = join(directory, 'invented-normalized.json');
  assert.equal(run(fixture, workbook, variant).status, 0);
  return {workbook, output, directory};
}
function convert({workbook, output, mapping=example}) {
  const r = run(converter, workbook, '--mapping', mapping, ...(output ? ['--output',output] : []));
  assert.equal(r.stderr, '');
  return {status:r.status, report:JSON.parse(r.stdout)};
}

test('converter preserves exact saved decimal tokens, gaps, zeroes, decisions-ready provenance, and app admission',t=>{
  const paths=setup(t), original=sha(paths.workbook);
  const {status,report}=convert(paths);
  assert.equal(status,0);
  assert.equal(report.status,'ready-for-review');
  assert.equal(report.appAdmission,'passed');
  assert.equal(report.outputWritten,true);
  assert.equal(report.workbookSha256,original);
  assert.deepEqual(report.missingMonths,['2023-02']);
  assert.deepEqual(report.findings,[{severity:'warning',code:'optional-amount-unavailable',cell:'E2'},
                                  {severity:'warning',code:'optional-amount-unavailable',cell:'F4'}]);
  const input=JSON.parse(readFileSync(paths.output,'utf8'));
  const [jan,mar]=input.records;
  assert.deepEqual(jan.summary.netWorthSnapshot,{amount:'12345678901234567890.000000000000000001',currency:'USD'});
  assert.deepEqual(mar.summary.netWorthSnapshot,{amount:'250.00',currency:'USD'});
  assert.equal(mar.summary.netCashFlow.amount,'0.000000000000000001');
  assert.equal(mar.summary.incomeTotal.amount,'0');
  assert.equal(Object.hasOwn(jan.summary,'netCashFlow'),false);
  assert.equal(mar.breakdowns.incomeSources.complete,false);
  assert.deepEqual(mar.breakdowns.incomeSources.items,[]);
  assert.equal(mar.breakdowns.expenseCategories.complete,true);
  assert.deepEqual(jan.provenance,{
    workbook:'invented-legacy.xlsx',sourceId:'invented-original-revision-1',worksheet:'Invented Monthly',
    mapping:'invented-layout-v1',converterVersion:'1.0.0',cell:'A2',range:'A2:H2',
    cells:{incomeTotal:'B2',expenseTotal:'C2',netWorthSnapshot:'D2',netCashFlow:'E2'},
    ranges:{incomeSources:'F2:F2',expenseCategories:'G2:G2'},snapshotAsOf:'2023-01-31'
  });
  const ledger=createLedger();
  const review=previewHistoricalMonthlySummaries(ledger,input);
  assert.deepEqual(review.rows.map(row=>row.eligible),[true,true]);
  const session=new CanonicalWorkspaceSession({storage:{lifecycle:null},online:()=>true});
  session.preview(ledger);
  const staged=session.stageHistoricalSummaries({expectedLedger:session.ledger,input,
    decisions:[0,1].map(recordIndex=>({recordIndex,action:'accept',reason:'Invented source confirmed'}))});
  assert.equal(staged.version,2);
  assert.deepEqual(staged.historicalSummaryBatches[0].entries.map(r=>r.record),input.records);
  assert.equal(sha(paths.workbook),original);
});

test('dry run is deterministic and an existing output is never replaced',t=>{
  const paths=setup(t);
  const dry={...paths,output:undefined};
  assert.deepEqual(convert(dry),convert(dry));
  assert.equal(existsSync(paths.output),false);
  writeFileSync(paths.output,'sentinel');
  const {status,report}=convert(paths);
  assert.equal(status,2);
  assert.equal(report.appAdmission,'passed');
  assert.equal(report.outputWritten,false);
  assert.ok(report.findings.some(item=>item.code==='output-already-exists'));
  assert.equal(readFileSync(paths.output,'utf8'),'sentinel');
});

for(const [variant,code,cell] of [
  ['formula','formula-cell-not-admitted','C2'],['error-cell','worksheet-error-cell','C2'],
  ['required-blank','required-amount-unavailable','D2'],['duplicate','duplicate-workbook-month','A4'],
  ['serial','missing-or-invalid-month','A2'],['wrong-header','mapped-header-mismatch','C1'],
  ['invalid-date','invalid-snapshot-date','H2'],['duplicate-cell','duplicate-mapped-cell','C2'],
  ['hidden-col','mapped-column-hidden'],['hidden-sheet','worksheet-not-visible'],
  ['hidden-row','mapped-row-hidden'],['merge','mapped-range-contains-merged-cells'],
  ['external','unsupported-workbook-relationship'],['unsupported-xml','unsupported-workbook-xml'],
  ['cell-metadata','unsupported-cell-metadata','B2'],
  ['total-mismatch','app-inconsistent-breakdown-total']
])test('converter blocks '+variant+' without creating output',t=>{
  const paths=setup(t,variant), original=sha(paths.workbook);
  const {status,report}=convert(paths);
  assert.equal(status,2);
  assert.equal(report.status,'blocked');
  assert.equal(report.outputWritten,false);
  if(variant==='total-mismatch'){
    assert.equal(report.appAdmission,'rejected');
    assert.ok(report.findings.some(item=>item.range==='G2:G2'));
  }
  else assert.equal(report.appAdmission,'not-run');
  assert.ok(report.findings.some(item=>item.code===code&&(!cell||item.cell===cell)),JSON.stringify(report.findings));
  assert.equal(existsSync(paths.output),false);
  assert.equal(sha(paths.workbook),original);
});

test('mapping hash binding prevents converting the wrong workbook revision',t=>{
  const paths=setup(t),mapping=join(paths.directory,'mapping.json');
  const m=JSON.parse(readFileSync(example,'utf8'));
  m.source.workbookSha256='0'.repeat(64);
  writeFileSync(mapping,JSON.stringify(m));
  assert.ok(convert({...paths,mapping}).report.findings.some(item=>item.code==='workbook-hash-binding-mismatch'));
  assert.equal(existsSync(paths.output),false);
  m.source.workbookSha256=sha(paths.workbook);
  writeFileSync(mapping,JSON.stringify(m));
  assert.equal(convert({...paths,mapping}).status,0);
});

test('ambiguous mapping is rejected before any workbook work',t=>{
  const paths=setup(t),mapping=join(paths.directory,'mapping.json');
  const m=JSON.parse(readFileSync(example,'utf8'));
  m.summary.expenseTotal.column='B';
  writeFileSync(mapping,JSON.stringify(m));
  assert.ok(convert({...paths,mapping}).report.findings.some(item=>item.code==='duplicate-mapped-column'));
  writeFileSync(mapping,'{"version":1,"version":2}');
  assert.ok(convert({...paths,mapping}).report.findings.some(item=>item.code==='duplicate-mapping-key'));
  assert.equal(existsSync(paths.output),false);
});

test('a formula anchored outside the mapped row band cannot supply numeric caches inside it',t=>{
  const paths=setup(t,'array-spill'),mapping=join(paths.directory,'mapping.json');
  const m=JSON.parse(readFileSync(example,'utf8'));
  m.rows.first=3;
  writeFileSync(mapping,JSON.stringify(m));
  const {status,report}=convert({...paths,mapping});
  assert.equal(status,2);
  assert.deepEqual(report.findings,[{severity:'error',code:'formula-range-not-admitted',cell:'A2',range:'A2:B4'}]);
  assert.equal(existsSync(paths.output),false);
});
