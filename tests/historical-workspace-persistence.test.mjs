import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createLedger, registerAccount, prepareCanonicalImport, summarizeLedger, validateLedger } from '../js/canonical-import.mjs';
import { assertCanonicalLedgerTransition } from '../js/canonical-history.mjs';
import { CanonicalWorkspaceSession } from '../js/canonical-workspace-session.mjs';
import { FullSnapshotApplication } from '../js/full-snapshot-application.mjs';
import { parseRecognizedProviderCsv } from '../js/provider-csv.mjs';
import { getHistoricalMonthlySummaryView, previewHistoricalMonthlySummaries } from '../js/historical-monthly-summary.mjs';
import { replayFixture, replayInput, replayOptions, replayRow } from './helpers/ledger-replay-fixtures.mjs';
import { ScenarioFullSnapshotDrive } from './helpers/scenario-full-snapshot-drive.mjs';

const money = (amount, currency = 'USD') => ({amount,currency});
const record = (month = '2023-01', extra = {}) => ({month,summary:{
  incomeTotal:money('0.30'),expenseTotal:money('0'),netWorthSnapshot:money('12000000000000000000000000.000000000000000001')
},breakdowns:{incomeSources:{complete:true,items:[
  {label:'Invented A',amount:money('0.10')},{label:'Invented B',amount:money('0.20')}
]},expenseCategories:{complete:false,items:[{label:'Invented C',amount:money('2')}] }},
  provenance:{workbook:'invented.xlsx',worksheet:'Invented monthly data',mapping:'invented mapping v1',
    sourceId:'invented revision',converterVersion:'0.1',cell:'B12',range:'A12:C12',cells:{incomeTotal:'B12'}},...extra});
const input = (records, start = '2023-01', end = '2023-03') => ({
  format:'finance-tracker-historical-monthly-summaries',version:1,expectedMonthRange:{start,end},records
});
const accept = recordIndex => ({recordIndex,action:'accept',reason:'Reviewed the invented source'});
const exclude = recordIndex => ({recordIndex,action:'exclude',reason:'This alternative is not the verified source'});
const stage = (session, value, decisions = [accept(0)]) =>
  session.stageHistoricalSummaries({expectedLedger:session.ledger,input:value,decisions});
const reconcile = (session, month = '2026-01') => session.stageHistoricalReconciliation({
  expectedLedger:session.ledger,month,reason:'Reviewed the whole month',evidence:'Verified invented source coverage and classification'
});
function setup() {
  const http = new ScenarioFullSnapshotDrive();
  const create = () => new FullSnapshotApplication({folderId:http.folderId, accessToken:()=> 'invented-test-token',
    fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},
    lifecycleTarget:null,isOnline:()=>true});
  const storage = {
    lifecycle:null,
    async connect(options = {}) { this.lifecycle=create(); await this.lifecycle.start({initialize:!options.requireExisting}); },
    createLedgerStore(){ return this.lifecycle.createLedgerStore(); },
    async release(){ const result=await this.lifecycle.release(); this.lifecycle=null; return result; },
    async reopenIndependent(){await this.release(); await this.connect({requireExisting:true}); return this.lifecycle;}
  };
  return {http,storage,session:new CanonicalWorkspaceSession({storage})};
}
function previewSession(ledger) {
  const session = new CanonicalWorkspaceSession({storage:{lifecycle:null},online:()=>true});
  session.preview(ledger);
  return session;
}

test('preview preserves exact amounts, missing versus zero, conflict indexes, provenance and gaps without mutating input', () => {
  const a=record(), b=record('2023-03'), invalid=record('2023-01');
  delete invalid.summary.expenseTotal;
  const malformed = record('2023-03'); malformed.breakdowns.incomeSources.items[0].amount.currency='CAD';
  const candidate=input([a,structuredClone(a),b,invalid,malformed,{month:'2023-13'}]);
  const original=structuredClone(candidate);
  const result=previewHistoricalMonthlySummaries(createLedger(),candidate);
  assert.deepEqual(result.rows.map(row=>row.eligible),[true,true,true,false,false,false]);
  assert.deepEqual(result.coverage.missingMonths,['2023-02']);
  assert.ok(result.findings.some(f=>f.code==='missing-summary-value' && f.recordIndex===3));
  assert.ok(result.findings.some(f=>f.code==='duplicate-month-summary'));
  assert.ok(result.findings.some(f=>f.code==='overlapping-month-summaries'));
  assert.ok(result.findings.some(f=>f.code==='breakdown-currency-mismatch' && f.recordIndex===4));
  assert.deepEqual(result.rows[0].record,a);
  assert.notEqual(result.rows[0].record,a);
  assert.deepEqual(candidate,original);
});

test('staging requires explicit eligible decisions, preserves evidence of supersession, and same accepted data replays as a no-op', async () => {
  const session=previewSession(createLedger()), a=record(), b=record();
  b.summary.netWorthSnapshot=money('111');
  assert.throws(()=>stage(session,input([a,b]),[accept(0),accept(1)]), {code:'invalid-historical-summary-review'});
  assert.throws(()=>stage(session,input([a,b]),[accept(0)]), {code:'invalid-historical-summary-review'});
  const v1=session.ledger;
  stage(session,input([a,b]),[accept(0),exclude(1)]);
  assert.deepEqual(session.ledger.historicalSummaryBatches[0].entries[1].record,b);
  assert.equal(session.ledger.activities.length,0);
  assert.equal(session.ledger.version,2);
  const first=session.ledger;
  stage(session,input([a,b]),[accept(0),exclude(1)]);
  assert.equal(session.ledger,first);
  stage(session,input([a,b], '2023-01', '2023-02'),[accept(0),{...exclude(1),reason:'Different review evidence'}]);
  assert.equal(session.ledger.historicalSummaryBatches.length,2);
  assert.equal(session.ledger.historicalSummaryBatches.at(-1).entries[1].reason,'Different review evidence');
  assert.equal((await getHistoricalMonthlySummaryView(session.ledger))[0].batchId,first.historicalSummaryBatches[0].batchId);
  session.undoLastStagedChange();
  const candidate=previewHistoricalMonthlySummaries(first,input([b]));
  assert.equal(candidate.rows[0].current.record.summary.netWorthSnapshot.amount,a.summary.netWorthSnapshot.amount);
  stage(session,input([b]));
  assert.equal(session.ledger.historicalSummaryBatches.length,2);
  assert.deepEqual(session.ledger.historicalSummaryBatches[0].entries[0].record,a);
  assert.deepEqual((await getHistoricalMonthlySummaryView(session.ledger))[0].netWorthSnapshot,money('111'));
  session.undoLastStagedChange();
  assert.deepEqual(session.ledger,first);
  session.undoLastStagedChange();
  assert.deepEqual(session.ledger,v1);
  assert.equal(session.dirty,false);
});

test('unknown workbook scope, currency mismatch, and unresolved source observations cannot substitute transaction totals', async () => {
  const {ledger}=replayFixture(), account=ledger.accounts[0];
  const summary=record('2026-01',{scope:{kind:'aggregate'}});
  const session=previewSession(ledger);
  stage(session,input([summary],'2026-01','2026-01'));
  await assert.rejects(reconcile(session),{code:'historical-detail-not-reconciled'});
  assert.equal((await getHistoricalMonthlySummaryView(session.ledger))[0].source,'workbook');
  const mismatched=record('2026-01',{scope:{kind:'accounts',accountIds:[account.accountId]}});
  mismatched.summary.incomeTotal=money('100','CAD');
  delete mismatched.breakdowns.incomeSources;
  stage(session,input([mismatched],'2026-01','2026-01'));
  await assert.rejects(reconcile(session),{code:'historical-detail-not-reconciled'});

  const unresolved=replayFixture(1,[replayRow(0,{amountText:'invalid',valid:false,errorCode:'invalid-amount'})]).ledger;
  const withUnresolved=previewSession(unresolved), eligible=record('2026-01',{scope:{kind:'accounts',accountIds:[account.accountId]}});
  stage(withUnresolved,input([eligible],'2026-01','2026-01'));
  const [persisted]=await getHistoricalMonthlySummaryView(withUnresolved.ledger);
  assert.ok(persisted.reasons.includes('unresolved-observations'));
  assert.equal(persisted.source,'workbook');
  await assert.rejects(reconcile(withUnresolved),{code:'historical-detail-not-reconciled'});
});

test('real supported CSV path, explicit history staging, save, cold reopen, plain and encrypted backup/restore', async () => {
  const options=replayOptions();
  const initial=registerAccount(createLedger(options),{institutionId:'wells-fargo',name:'Invented checking',currency:'USD',accountType:'checking'},options);
  const h=setup();
  h.session.preview(initial); await h.session.savePreviewToNewCopy();
  try {
    const accountId=initial.accounts[0].accountId;
    const bytes = new Uint8Array(await readFile(new URL('../fixtures/wells-fargo.csv', import.meta.url)));
    const {parsed}=await parseRecognizedProviderCsv({bytes});
    const stageCsv=prepareCanonicalImport(h.session.ledger,{parsed,syntheticOnly:true,accountMappings:{default:accountId},
      coverageByAccount:{[accountId]:{start:'2026-01-01',end:'2026-01-31',provenance:'user-confirmed'}}});
    assert.equal(stageCsv.ledger.imports.at(-1).coverageReconciled,false);
    const forged=structuredClone(stageCsv.ledger);
    const summary=record('2026-01',{scope:{kind:'accounts',accountIds:[accountId]}});
    const invented=input([summary],'2026-01','2026-01');
    const expectedV1=h.session.ledger;
    const before=h.http.mutations;
    previewHistoricalMonthlySummaries(h.session.ledger,invented);
    stage(h.session,invented);
    forged.version=2;
    forged.historicalSummaryBatches=structuredClone(h.session.ledger.historicalSummaryBatches);
    forged.historicalReconciliations=[];
    h.session.undoLastStagedChange();
    assert.throws(()=>h.session.stageCanonicalImport(forged),{code:'invalid-parsed-import'});
    h.session.stageCanonicalImport(stageCsv.ledger);
    const stagedCsv=h.session.ledger;
    assert.throws(()=>h.session.stageHistoricalSummaries({expectedLedger:expectedV1,input:invented,decisions:[accept(0)]}),
      {code:'stale-historical-summary-review'});
    for (const item of stagedCsv.activities) h.session.correct({activityId:item.activityId,type:'classification',
      activityKind:item.amountMinor<0?'spending':'income',rationale:'Reviewed invented CSV classification'});
    stage(h.session,invented);
    const [workbook]=await getHistoricalMonthlySummaryView(h.session.ledger);
    assert.equal(workbook.source,'workbook');
    assert.equal(workbook.report,null);
    const transactionTotals=summarizeLedger(h.session.ledger,{start:'2026-01-01',end:'2026-01-31',currency:'USD',accountIds:[accountId]});
    assert.equal(transactionTotals.income,'1250.00','transaction-only report excludes workbook totals');
    assert.equal(workbook.record.summary.incomeTotal.amount,'0.30');
    await reconcile(h.session);
    const [effective]=await getHistoricalMonthlySummaryView(h.session.ledger);
    assert.equal(effective.source,'transactions');
    assert.equal(effective.report.income,transactionTotals.income,'the source-selected view does not add workbook income');
    assert.equal(effective.report.spending,transactionTotals.spending);
    assert.deepEqual(effective.netWorthSnapshot,summary.summary.netWorthSnapshot);
    assert.equal(h.http.mutations,before);
    await h.session.save();
    const saved=structuredClone(h.session.ledger);
    await h.session.release();
    assert.equal(h.session.ledger,null);
    await h.session.open();
    assert.deepEqual(h.session.ledger,saved);
    assert.equal((await getHistoricalMonthlySummaryView(h.session.ledger))[0].source,'transactions');

    for (const password of [undefined,'invented-only-password']) {
      const raw=await h.session.exportBackup({password});
      const copy=setup();
      try {
        await copy.session.importBackup(raw,{password});
        assert.equal(copy.http.mutations,0);
        await copy.session.restoreBackupToNewCopy();
        assert.deepEqual(copy.session.ledger,saved);
        assert.equal((await getHistoricalMonthlySummaryView(copy.session.ledger))[0].source,'transactions');
      } finally { if(copy.storage.lifecycle) await copy.session.release(); }
    }
    const old=h.session.ledger.activities.find(item=>item.amountMinor<0);
    h.session.correct({activityId:old.activityId,type:'bank-correction',amountText:'-98.76',rationale:'Changed invented evidence'});
    const [stale]=await getHistoricalMonthlySummaryView(h.session.ledger);
    assert.equal(stale.source,'workbook');
    assert.ok(stale.reasons.includes('reconciliation-evidence-stale'));
    assert.deepEqual(h.session.ledger.historicalReconciliations,saved.historicalReconciliations);
    h.session.undoLastStagedChange();
  } finally { if(h.storage.lifecycle) await h.session.release(); }
});

test('history is append-only and only valid versions cross storage validation', () => {
  const original=createLedger(), session=previewSession(original);
  stage(session,input([record()]));
  const ledger=session.ledger;
  assert.equal(validateLedger(ledger),true);
  assert.doesNotThrow(()=>assertCanonicalLedgerTransition(original,ledger));
  assert.throws(()=>assertCanonicalLedgerTransition(ledger,original),{code:'unsupported-ledger-version-transition'});
  const changed=structuredClone(ledger);changed.historicalSummaryBatches[0].entries[0].reason+=' changed';
  assert.throws(()=>assertCanonicalLedgerTransition(ledger,changed),{code:'history-rewrite-refused'});
  assert.throws(()=>validateLedger({...ledger,version:3}),{code:'invalid-canonical-ledger'});
  assert.throws(()=>validateLedger({...ledger,version:1}),{code:'invalid-historical-summary-ledger'});
});

test('reconciliation completion is stale after draft/session change and cannot modify a new ledger', async () => {
  const {ledger,options}=replayFixture();
  const activity=ledger.activities[0], session=previewSession(ledger);
  session.correct({activityId:activity.activityId,type:'classification',activityKind:'spending',rationale:'Invented evidence'});
  const scope={kind:'accounts',accountIds:[ledger.accounts[0].accountId]};
  stage(session,input([record('2026-01',{scope})],'2026-01','2026-01'));
  const pending=reconcile(session);
  session.preview(createLedger(options));
  const replacement=session.ledger;
  await assert.rejects(pending,{code:'stale-historical-summary-review'});
  assert.equal(session.ledger,replacement);
  assert.equal(session.dirty,false);
});

test('a new import with differing coverage does not masquerade as completeness', async () => {
  const {ledger,options}=replayFixture(0);
  const account=ledger.accounts[0];
  const narrowed=replayInput(account,[replayRow(0)],'invented-short-run');
  narrowed.coverageByAccount[account.accountId].start='2026-01-14';
  narrowed.coverageByAccount[account.accountId].end='2026-01-20';
  const noFullRun={...ledger,imports:[]};
  const session=previewSession(prepareCanonicalImport(noFullRun,narrowed,options).ledger);
  session.correct({activityId:session.ledger.activities[0].activityId,type:'classification',activityKind:'spending',rationale:'Invented evidence'});
  stage(session,input([record('2026-01',{scope:{kind:'accounts',accountIds:[account.accountId]}})],'2026-01','2026-01'));
  await assert.rejects(reconcile(session),{code:'historical-detail-not-reconciled'});
});

test('pending data blocks completeness, and cancellation before digest settles leaves staged history unchanged',async()=>{
  const pending=replayFixture(1,[replayRow(0,{lifecycleStatus:'pending'})]).ledger;
  const sample=record('2026-01',{scope:{kind:'accounts',accountIds:[pending.accounts[0].accountId]}});
  const monthInput=input([sample],'2026-01','2026-01');
  const pendingSession=previewSession(pending);
  stage(pendingSession,monthInput);
  assert.ok((await getHistoricalMonthlySummaryView(pendingSession.ledger))[0].reasons.includes('pending-activity'));
  await assert.rejects(reconcile(pendingSession),{code:'historical-detail-not-reconciled'});

  const {ledger}=replayFixture(), session=previewSession(ledger);
  session.correct({activityId:ledger.activities[0].activityId,type:'classification',activityKind:'spending',rationale:'Invented evidence'});
  stage(session,monthInput);
  const base=session.ledger, controller=new AbortController();
  const attempt=session.stageHistoricalReconciliation({month:'2026-01',expectedLedger:base,reason:'Invented check',
    evidence:'Invented statement checked',signal:controller.signal});
  controller.abort();
  await assert.rejects(attempt,{code:'stale-historical-summary-review'});
  assert.equal(session.ledger,base);
  assert.deepEqual(session.ledger.historicalReconciliations,[]);
});
