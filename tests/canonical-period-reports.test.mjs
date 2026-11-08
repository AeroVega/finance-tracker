import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../js/canonical-import.mjs';
import {pathToFileURL} from 'node:url';
const reference=process.env.PERIOD_BASELINE?await import(pathToFileURL(process.env.PERIOD_BASELINE).href):api;
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {replayFixture,replayRow,replayInput} from './helpers/ledger-replay-fixtures.mjs';
const period={start:'2026-01-01',end:'2026-01-31',currency:'USD'};
function equalReports(ledger,scopes) {
  const before=JSON.stringify(ledger);
  assert.deepEqual(api.summarizeLedgerPeriods(ledger,scopes),scopes.map(scope=>reference.summarizeLedger(ledger,scope)));
  assert.equal(JSON.stringify(ledger),before);
}
test('explicit periods preserve overlapping scopes, account subsets/duplicates, currencies and output order',async()=>{
  const {ledger}=await createSyntheticFinancialYear();
  const all={start:'2025-01-01',end:'2025-12-31',currency:'USD'};
  equalReports(ledger,[all,{...all,end:'2025-06-30'},{...all,start:'2025-06-01'},
    {...all,accountIds:[]},{...all,accountIds:[ledger.accounts[0].accountId,ledger.accounts[0].accountId]},
    {...all,accountIds:ledger.accounts.slice(1).map(a=>a.accountId)}, {...all,currency:'EUR'},
    {...all,start:'2024-01-01'},{...all,start:'2027-01-01',end:'2027-12-31'}]);
  assert.deepEqual(api.summarizeLedgerPeriods(ledger,[]),[]);
});
test('pending, unknown lifecycle/currency, unresolved review and inactive rows keep exclusions',()=>{
  const rows=[replayRow(0),replayRow(1,{lifecycleStatus:'pending'}),replayRow(2,{lifecycleStatus:'unknown'}),
    replayRow(3,{currency:'EUR'}),replayRow(4,{currency:null}),replayRow(5,{valid:false,errorCode:'bad-date',effectiveDate:null})];
  let {ledger,options}=replayFixture(6,rows);
  ledger=api.prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],[rows[0]],'overlap'),options).ledger;
  equalReports(ledger,[period,{...period,start:'2026-02-01',end:'2026-02-28'}]);
  const observationId=ledger.observations.at(-1).observationId;
  ledger=api.applyReviewDecision(ledger,{observationId,action:'keep-separate'},options);
  ledger=api.reverseReviewDecision(ledger,{reviewDecisionId:ledger.reviewDecisions.at(-1).reviewDecisionId,rationale:'Invented reversal'},options);
  equalReports(ledger,[period,{...period,currency:'EUR'}]);
});
test('missing refund posting remains excluded from every period and call sees later edits',()=>{
  let {ledger,options}=replayFixture(2,[replayRow(0),replayRow(1,{amountText:'1.00'})]);
  ledger=api.applyFinancialEvents(ledger,[{type:'classification',activityId:ledger.activities[0].activityId,activityKind:'spending',commandId:'spend'},
    {type:'classification',activityId:ledger.activities[1].activityId,activityKind:'refund',categoryId:'invented',commandId:'refund'}],options);
  const scopes=[period,{...period,start:'2027-01-01',end:'2027-01-31'}];
  equalReports(ledger,scopes);
  for(const report of api.summarizeLedgerPeriods(ledger,scopes)) assert.ok(report.excluded.some(a=>a.reason==='missing-refund-posted-date'));
  const before=api.summarizeLedgerPeriods(ledger,[period]);
  const next=api.applyFinancialEvent(ledger,{type:'bank-correction',activityId:ledger.activities[0].activityId,commandId:'correct',amountText:'-10.00',evidence:{reason:'Invented'}},options);
  assert.notDeepEqual(api.summarizeLedgerPeriods(next,[period]),before);
});
test('batch retains validation and scope failures instead of partial reports',()=>{
  const {ledger}=replayFixture();
  assert.throws(()=>api.summarizeLedgerPeriods(ledger,null),/invalid-report-scopes/);
  for(const scope of [{...period,start:'bad'},{...period,accountIds:['missing']},{...period,currency:'usd'},...['bad',null,{},new Set([ledger.accounts[0].accountId]),{forEach:()=>{}}].map(accountIds=>({...period,accountIds}))]) {
    let expected;try{reference.summarizeLedger(ledger,scope);}catch(error){expected=error.message;}
    assert.throws(()=>api.summarizeLedgerPeriods(ledger,[period,scope]),error=>error.message===expected);
    assert.throws(()=>api.summarizeLedger(ledger,scope),error=>error.message===expected);
  }
  const broken=structuredClone(ledger);broken.activities[0].accountId='missing';
  assert.throws(()=>api.summarizeLedgerPeriods(broken,[]));
});
test('event inspection is once per explicit list, not once per period',async()=>{
  const {ledger}=await createSyntheticFinancialYear();let reads=0;
  const counted={...ledger,events:ledger.events.map(event=>{const copy={...event};Object.defineProperty(copy,'eventType',{enumerable:true,get(){reads++;return event.eventType;}});return copy;})};
  const scope={start:'2025-01-01',end:'2025-12-31',currency:'USD'};
  api.summarizeLedgerPeriods(counted,[scope]);const once=reads;reads=0;
  api.summarizeLedgerPeriods(counted,Array(13).fill(scope));assert.equal(reads,once);
  reads=0;Array.from({length:13},()=>api.summarizeLedger(counted,scope));assert.equal(reads,13*once);
});
