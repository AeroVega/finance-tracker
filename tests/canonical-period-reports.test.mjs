import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../js/canonical-import.mjs';
import {pathToFileURL} from 'node:url';
const reference=process.env.PERIOD_BASELINE?await import(pathToFileURL(process.env.PERIOD_BASELINE).href):api;
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {replayFixture,replayRow,replayInput,replayOptions} from './helpers/ledger-replay-fixtures.mjs';
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

// Independent, hand-worked oracle. Amounts and report qualifications below are
// literals, never obtained from another reporting implementation or reducer.
function literalReportFixture() {
  const options=replayOptions();
  let ledger=api.createLedger(options);
  const accounts={};
  for(const [name,currency,accountType] of [['cash','USD','checking'],['card','USD','credit-card'],['euro','EUR','savings'],['empty','USD','checking']]) {
    ledger=api.registerAccount(ledger,{institutionId:'sofi',name:`Invented oracle ${name}`,currency,accountType},options);
    accounts[name]=ledger.accounts.at(-1);
  }
  const ids={};
  const rows=[
    ['income','100.10','2026-01-01','income',{}],
    ['purchase','-30.25','2026-01-31','spending',{}],
    ['postedRefund','5.05','2026-01-31','refund',{postedDate:'2026-02-01'}],
    ['undatedRefund','2.00','2026-02-20','refund',{}],
    ['pending','-9.00','2026-01-31','spending',{lifecycleStatus:'pending'}],
    ['unknown','-8.00','2026-01-31','spending',{lifecycleStatus:'unknown'}],
    ['unclassified','-4.00','2026-01-31',null,{}],
    ['unmatched','3.00','2026-01-31','refund',{postedDate:'2026-01-31'}],
    ['transfer','-11.00','2026-01-31','transfer',{}]
  ];
  function importRows(account,specs,fingerprint) {
    const before=ledger.activities.length;
    ledger=api.prepareCanonicalImport(ledger,replayInput(account,specs.map(([name,amountText,effectiveDate,kind,extra],i)=>replayRow(i,{
      sourceDescription:`INVENTED ORACLE ${name}`,normalizedDescription:`invented oracle ${name}`,amountText,effectiveDate,currency:account.currency,...extra
    })),fingerprint),options).ledger;
    specs.forEach(([name,, ,kind],i)=>{
      const activityId=ledger.activities[before+i].activityId;ids[name]=activityId;
      if(kind) ledger=api.applyFinancialEvent(ledger,{type:'classification',activityId,activityKind:kind,
        ...(kind==='refund'&&name!=='unmatched'?{categoryId:'invented-oracle'}:{}),commandId:`oracle-${name}`},options);
    });
  }
  importRows(accounts.cash,rows,'invented-oracle-cash');
  importRows(accounts.card,[['cardPurchase','-20.00','2026-01-31','spending',{}]],'invented-oracle-card');
  importRows(accounts.euro,[['euroPurchase','-7.00','2026-01-31','spending',{}]],'invented-oracle-euro');
  // An invalid, unresolved observation qualifies every period, but is not an activity.
  ledger=api.prepareCanonicalImport(ledger,replayInput(accounts.cash,[replayRow(0,{valid:false,errorCode:'bad-date',effectiveDate:null})],'invented-oracle-rejected'),options).ledger;
  return {ledger,accounts,ids};
}

test('literal financial oracle covers boundaries, overlaps, selection, currency and refund posting in all report APIs',()=>{
  const {ledger,accounts:a,ids}=literalReportFixture();
  const omitted=(name,reason)=>({activityId:ids[name],reason});
  const coverage='coverage-not-reconciled';
  const missingRefund=omitted('undatedRefund','missing-refund-posted-date');
  const januaryExclusions=[missingRefund,omitted('pending','pending'),omitted('unknown','unknown-lifecycle'),
    omitted('unclassified','unclassified-activity'),omitted('unmatched','unmatched-refund'),omitted('euroPurchase','different-currency')];
  const januaryReasons=[coverage,'missing-declared-coverage','unresolved-observations','missing-refund-posted-date',
    'unknown-lifecycle','unclassified-activity','unmatched-refund','different-currency'];
  const report=(start,end,currency,income,spending,cash,reasons,excluded)=>({start,end,currency,income,spending,cash,complete:false,reasons,excluded});
  const cases=[
    // Jan: 100.10 income; 30.25 cash purchase + 20 card = 50.25
    // spending; cash = 100.10 - 30.25 = 69.85. Transfers do not count.
    [{...period},report('2026-01-01','2026-01-31','USD','100.10','50.25','69.85',januaryReasons,januaryExclusions)],
    // Jan 31 alone includes the end-boundary purchase, not Jan 1 income.
    [{...period,start:'2026-01-31'},report('2026-01-31','2026-01-31','USD','0','50.25','-30.25',januaryReasons,januaryExclusions)],
    // Refund belongs to Feb 1, not its Jan 31 effective date. Across both
    // days: 30.25 + 20 - 5.05 = 45.20; cash = -30.25 + 5.05 = -25.20.
    [{...period,start:'2026-01-31',end:'2026-02-01'},report('2026-01-31','2026-02-01','USD','0','45.20','-25.20',januaryReasons,januaryExclusions)],
    [{...period,start:'2026-02-01',end:'2026-02-01',accountIds:[a.cash.accountId]},
      report('2026-02-01','2026-02-01','USD','0','-5.05','5.05',[coverage,'unresolved-observations','missing-refund-posted-date'],[missingRefund])],
    // Unknown refund posting qualifies even a period before its source date.
    [{...period,start:'2025-12-31',end:'2025-12-31',accountIds:[a.cash.accountId]},
      report('2025-12-31','2025-12-31','USD','0','0','0',[coverage,'missing-declared-coverage','unresolved-observations','missing-refund-posted-date'],[missingRefund])],
    [{...period,accountIds:[a.card.accountId,a.card.accountId]},
      report('2026-01-01','2026-01-31','USD','0','20.00','0',[coverage],[])],
    [{...period,accountIds:[]},report('2026-01-01','2026-01-31','USD','0','0','0',[coverage],[])],
    [{...period,accountIds:[a.empty.accountId]},report('2026-01-01','2026-01-31','USD','0','0','0',[coverage,'missing-declared-coverage'],[])],
    [{...period,currency:'EUR',accountIds:[a.euro.accountId]},report('2026-01-01','2026-01-31','EUR','0','7.00','-7.00',[coverage],[])],
    [{...period,accountIds:[a.euro.accountId]},report('2026-01-01','2026-01-31','USD','0','0','0',[coverage,'different-currency'],[omitted('euroPurchase','different-currency')])]
  ];
  const scopes=cases.map(([scope])=>scope),expected=cases.map(([,value])=>value);
  for(const [scope,value] of cases) assert.deepEqual(api.summarizeLedger(ledger,scope),value);
  assert.deepEqual(api.summarizeLedgerPeriods(ledger,scopes),expected);
  const owner=api.createLedgerSessionOwner();
  const session=owner.open(JSON.stringify(ledger),'invented-literal-oracle');
  try { assert.deepEqual(session.summarizePeriodsJson(JSON.stringify(scopes)),expected); }
  finally { owner.invalidate(); }
});
