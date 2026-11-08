import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseProviderCsv} from '../js/provider-csv.mjs';
import {createLedger,registerAccount,prepareCanonicalImport,applyReviewDecision,applyFinancialEvent,summarizeLedger,validateLedger,getEffectiveActivities,reverseReviewDecision} from '../js/canonical-import.mjs';
const options=()=>{let n=0;return {now:()=> '2026-11-06T00:00:00.000Z',idFactory:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`};};
function setup(){const opt=options();let ledger=createLedger(opt);ledger=registerAccount(ledger,{institutionId:'sofi',name:'Invented account',currency:'USD',accountType:'checking'},opt);return {ledger,opt,accountId:ledger.accounts[0].accountId};}
const row=(overrides={})=>({sourceAccountKey:'default',sourceFields:{Description:'EXAMPLE SHOP',Amount:'-12.34'},rowOrdinal:1,physicalLine:2,sourceDescription:'EXAMPLE SHOP',normalizedDescription:'example shop',sourceAction:'Card purchase',sourceRecordId:null,amountText:'-12.34',currency:null,effectiveDate:'2026-01-15',postedDate:null,settlementDate:null,lifecycleStatus:'posted',valid:true,errorCode:null,...overrides});
function input(accountId,records=[row()],fingerprint='invented-hash'){return {syntheticOnly:true,parsed:{sourceFormat:'sofi-csv-v1',institutionId:'sofi',fileFingerprint:fingerprint,rowsSeen:records.length+1,ignoredCount:0,records,sourceAccountKeys:['default'],sourceCoverage:null},accountMappings:{default:accountId},coverageByAccount:{[accountId]:{start:'2026-01-01',end:'2026-02-28',provenance:'user-confirmed'}}};}
const report=ledger=>summarizeLedger(ledger,{start:'2026-01-01',end:'2026-01-31',currency:'USD'});
const classify=(ledger,opt,activityId,activityKind,commandId=activityId)=>applyFinancialEvent(ledger,{type:'classification',activityId,activityKind,categoryId:'example-category',commandId},opt);
const correct=(ledger,opt,activityId,amountText,commandId)=>applyFinancialEvent(ledger,{type:'bank-correction',activityId,amountText,commandId,evidence:{reason:'Invented bank correction'}},opt);

test('immutable import has stable identities, original evidence, declared and observed dates',()=>{
 const {ledger,opt,accountId}=setup(); const result=prepareCanonicalImport(ledger,input(accountId),opt);
 assert.equal(ledger.activities.length,0); assert.equal(result.ledger.activities.length,1);
 assert.equal(result.ledger.imports[0].declaredCoverage.start,'2026-01-01');assert.equal(result.ledger.imports[0].observedStart,'2026-01-15');
 assert.equal(result.ledger.observations[0].sourceFields.Amount,'-12.34');assert.equal(result.ledger.activities[0].amountMinor,-1234);
 assert.equal(validateLedger(JSON.parse(JSON.stringify(result.ledger))),true);
 assert.deepEqual(prepareCanonicalImport(result.ledger,input(accountId),opt).ledger,result.ledger);
});
test('declared coverage is mandatory, inclusive and does not infer completeness',()=>{
 const {ledger,opt,accountId}=setup();let args=input(accountId);delete args.coverageByAccount;
 assert.throws(()=>prepareCanonicalImport(ledger,args,opt),/confirmed-coverage/);
 args=input(accountId,[row({effectiveDate:'2025-12-31'})]);assert.throws(()=>prepareCanonicalImport(ledger,args,opt),/outside-declared/);
 const next=prepareCanonicalImport(ledger,input(accountId,[]),opt).ledger;
 assert.equal(next.imports[0].status,'processed');assert.equal(next.imports[0].observedStart,null);
 assert.equal(report(next).complete,false);assert.ok(report(next).reasons.includes('coverage-not-reconciled'));
});
test('initial repeated rows remain separate; overlapping unique or multiple candidates require review',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2,physicalLine:3})]),opt).ledger;
 assert.equal(next.activities.length,2);assert.notEqual(next.activities[0].activityId,next.activities[1].activityId);
 next=prepareCanonicalImport(next,input(accountId,[row()],'overlap'),opt).ledger;assert.equal(next.observations.at(-1).disposition,'review');
 const one=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 const two=prepareCanonicalImport(one,input(accountId,[row(),row({rowOrdinal:2})],'other'),opt).ledger;
 assert.equal(two.activities.length,1);assert.equal(two.observations.filter(o=>o.disposition==='review').length,2);
});
test('partial retries retain accepted IDs and unresolved evidence without duplicate side effects',()=>{
 const {ledger,opt,accountId}=setup();const args=input(accountId,[row(),row({rowOrdinal:2,valid:false,errorCode:'bad-date',effectiveDate:null,sourceFields:{Date:'bad',Amount:'-9'}})]);
 const first=prepareCanonicalImport(ledger,args,opt).ledger, second=prepareCanonicalImport(first,args,opt).ledger;
 assert.deepEqual(second.activities,first.activities);assert.deepEqual(second.observations,first.observations);assert.equal(second.imports[0].retryAttempts.length,1);assert.equal(second.imports[0].status,'needs-review');assert.equal(second.observations[1].sourceFields.Date,'bad');
 assert.equal(second.imports[0].counts.created,1);assert.equal(second.imports[0].counts.rejected,1);
 assert.throws(()=>applyReviewDecision(second,{observationId:second.observations[1].observationId,action:'keep-separate'},opt),/invalid-row/);
 const resolved=applyReviewDecision(second,{observationId:second.observations[1].observationId,action:'reject',rationale:'Invented malformed row'},opt);
 assert.equal(resolved.imports[0].status,'processed');assert.equal(resolved.reviewDecisions.length,1);assert.equal(resolved.observations[1].sourceFields.Date,'bad');
});
test('review keep-separate and match persist scoped decisions',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 next=prepareCanonicalImport(next,input(accountId,[row(),row({rowOrdinal:2})],'overlap'),opt).ledger;
 const reviews=next.observations.filter(o=>o.disposition==='review');
 next=applyReviewDecision(next,{observationId:reviews[0].observationId,action:'keep-separate'},opt);
 next=applyReviewDecision(next,{observationId:reviews[1].observationId,action:'match',activityId:next.activities[0].activityId},opt);
 assert.equal(next.activities.length,2);assert.equal(next.reviewDecisions.length,2);assert.equal(next.imports[1].status,'processed');assert.equal(validateLedger(JSON.parse(JSON.stringify(next))),true);
});
test('stable provider IDs link pending to posted without mutating original source',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({sourceRecordId:'invented-id',lifecycleStatus:'pending'})]),opt).ledger;
 next=prepareCanonicalImport(next,input(accountId,[row({sourceRecordId:'invented-id'})],'posted-file'),opt).ledger;
 assert.equal(next.activities.length,1);assert.equal(next.activities[0].lifecycleStatus,'pending');assert.equal(next.events[0].eventType,'lifecycle-transition');
 next=classify(next,opt,next.activities[0].activityId,'spending');assert.equal(report(next).spending,'12.34');
});
test('bank and category corrections preserve originals and adjust original-period effective amounts',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 const activityId=next.activities[0].activityId;next=classify(next,opt,activityId,'spending');
 const command={type:'bank-correction',activityId,amountText:'-10.00',commandId:'correct-1',evidence:{reason:'Explicit invented bank correction'}};
 next=applyFinancialEvent(next,command,opt);const corrected=next;next=applyFinancialEvent(next,command,opt);assert.deepEqual(next,corrected);
 assert.equal(next.activities[0].amountMinor,-1234);assert.equal(report(next).spending,'10.00');
 next=applyFinancialEvent(next,{type:'category-correction',activityId,categoryId:'new-category',commandId:'category-1'},opt);assert.equal(next.events.at(-1).priorCategoryId,'example-category');
 assert.throws(()=>applyFinancialEvent(next,{...command,amountText:'-1.00'},opt),/command-conflict/);
});
test('bundled market overlap after a bank correction stays in review and cannot duplicate spending',async()=>{
 const opt=options();let next=registerAccount(createLedger(opt),{institutionId:'wells-fargo',name:'Invented checking',currency:'USD',accountType:'checking'},opt);
 const accountId=next.accounts[0].accountId;
 const fixture=async name=>({...input(accountId),parsed:await parseProviderCsv({bytes:await readFile(new URL('../fixtures/pr28/'+name,import.meta.url)),sourceFormat:'wells-fargo-csv-v1'})});
 next=prepareCanonicalImport(next,await fixture('wells-fargo-foundation.csv'),opt).ledger;
 const marketId=next.activities[0].activityId,originals=structuredClone(next.activities),source=structuredClone(next.observations);
 next=classify(next,opt,marketId,'spending');next=correct(next,opt,marketId,'-90.00','correct-bundled-market');
 const args=await fixture('wells-fargo-review.csv'),result=prepareCanonicalImport(next,args,opt);next=result.ledger;
 assert.equal(result.summary.created,2);assert.equal(result.summary.review,1);assert.equal(result.summary.rejected,1);
 assert.equal(next.activities.length,6);assert.equal(next.observations[4].reasonCode,'insufficient-composite-evidence');
 assert.equal(next.observations[4].activityId,null);assert.equal(report(next).spending,'90.00');
 assert.deepEqual(next.activities.slice(0,4),originals);assert.deepEqual(next.observations.slice(0,4),source);
 const retry=prepareCanonicalImport(next,args,opt).ledger;
 assert.deepEqual(retry.activities,next.activities);assert.deepEqual(retry.observations,next.observations);assert.deepEqual(retry.events,next.events);
 assert.equal(retry.imports.at(-1).retryAttempts.length,1);assert.equal(report(retry).spending,'90.00');
 assert.equal(validateLedger(retry),true);
});
test('original, intermediate and current corrected amounts each identify one review candidate on imports and retries',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 const activityId=next.activities[0].activityId;next=classify(next,opt,activityId,'spending');
 next=correct(next,opt,activityId,'-10.00','first-correction');next=correct(next,opt,activityId,'-8.00','second-correction');
 const args=input(accountId,['-12.34','-10.00','-8.00'].map((amountText,i)=>row({rowOrdinal:i+1,amountText})),'all-corrected-amounts');
 next=prepareCanonicalImport(next,args,opt).ledger;
 assert.equal(next.activities.length,1);assert.equal(next.imports.at(-1).counts.review,3);
 assert.ok(next.observations.slice(1).every(o=>o.reasonCode==='insufficient-composite-evidence'&&o.activityId===null));
 next=correct(next,opt,activityId,'-6.00','third-correction');const evidence=structuredClone(next.observations),events=structuredClone(next.events);
 const retry=prepareCanonicalImport(next,args,opt).ledger;
 assert.equal(retry.activities.length,1);assert.deepEqual(retry.observations,evidence);assert.deepEqual(retry.events,events);
 assert.equal(retry.imports.at(-1).counts.review,3);assert.equal(report(retry).spending,'6.00');
});
test('accepted source observations retain composite evidence after correction without becoming automatic identity',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({sourceRecordId:'invented-source'})]),opt).ledger;
 const alternate=row({sourceRecordId:'invented-source',sourceDescription:'ALTERNATE INVENTED SHOP',normalizedDescription:'alternate invented shop'});
 next=prepareCanonicalImport(next,input(accountId,[alternate],'accepted-description'),opt).ledger;
 assert.equal(next.observations.at(-1).disposition,'matched');
 next=correct(next,opt,next.activities[0].activityId,'-10.00','correct-accepted-source');
 next=prepareCanonicalImport(next,input(accountId,[{...alternate,sourceRecordId:null}],'idless-description'),opt).ledger;
 assert.equal(next.activities.length,1);assert.equal(next.observations.at(-1).reasonCode,'insufficient-composite-evidence');assert.equal(next.observations.at(-1).activityId,null);
});
test('historical composites preserve actual lifecycle states without inventing amount and date combinations',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({sourceRecordId:'invented-pending',lifecycleStatus:'pending'})]),opt).ledger;
 const activityId=next.activities[0].activityId;next=correct(next,opt,activityId,'-10.00','before-posting');
 const posted=row({sourceRecordId:'invented-pending',amountText:'-10.00',effectiveDate:'2026-02-01',postedDate:'2026-02-01'});
 next=prepareCanonicalImport(next,input(accountId,[posted],'posted-correction'),opt).ledger;
 next=correct(next,opt,activityId,'-8.00','after-posting');
 const observed=[row(),row({amountText:'-10.00'}),{...posted,sourceRecordId:null},{...posted,sourceRecordId:null,amountText:'-8.00'}];
 const overlap=prepareCanonicalImport(next,input(accountId,observed.map((r,i)=>({...r,rowOrdinal:i+1})),'historical-states'),opt).ledger;
 assert.equal(overlap.activities.length,1);assert.equal(overlap.imports.at(-1).counts.review,4);
 const invented=prepareCanonicalImport(next,input(accountId,[row({amountText:'-8.00'}),{...posted,sourceRecordId:null,amountText:'-12.34',rowOrdinal:2}],'unobserved-combinations'),opt).ledger;
 assert.equal(invented.imports.at(-1).counts.created,2);
 const stale=prepareCanonicalImport(next,input(accountId,[posted],'stale-provider-value'),opt).ledger;
 assert.equal(stale.observations.at(-1).reasonCode,'source-id-conflict');
 const current=prepareCanonicalImport(stale,input(accountId,[{...posted,amountText:'-8.00'}],'current-provider-value'),opt).ledger;
 assert.equal(current.observations.at(-1).disposition,'matched');assert.equal(current.activities.length,1);
 assert.equal(current.events.filter(e=>e.eventType==='lifecycle-transition').length,1);
});
test('reversing a matched observation removes its unique evidence while keeping the original active',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({sourceRecordId:'invented-source'})]),opt).ledger;
 const alternate=row({sourceRecordId:'invented-source',sourceDescription:'INVENTED ALIAS',normalizedDescription:'invented alias',effectiveDate:'2026-01-16'});
 next=prepareCanonicalImport(next,input(accountId,[alternate],'review-alias'),opt).ledger;
 const observationId=next.observations.at(-1).observationId,activityId=next.activities[0].activityId;
 next=applyReviewDecision(next,{observationId,action:'match',activityId},opt);
 const probe=input(accountId,[{...alternate,sourceRecordId:null}],'probe-alias');
 assert.equal(prepareCanonicalImport(next,probe,opt).ledger.observations.at(-1).disposition,'review');
 next=reverseReviewDecision(next,{reviewDecisionId:next.reviewDecisions.at(-1).reviewDecisionId},opt);
 const after=prepareCanonicalImport(next,probe,opt).ledger;
 assert.equal(after.observations.at(-1).disposition,'created');assert.equal(after.activities.length,2);
});
test('inactive retained activities and unresolved or rejected rows cannot supply overlap evidence',()=>{
 const {ledger,opt,accountId}=setup();const initial=prepareCanonicalImport(ledger,input(accountId,[row({sourceRecordId:'invented-source'})]),opt).ledger;
 const conflicting=row({sourceRecordId:'invented-source',amountText:'-10.00',sourceDescription:'INVENTED DIFFERENT SHOP',normalizedDescription:'invented different shop'});
 const unresolved=prepareCanonicalImport(initial,input(accountId,[conflicting],'conflicting-row'),opt).ledger;
 const observationId=unresolved.observations.at(-1).observationId,probe=input(accountId,[{...conflicting,sourceRecordId:null}],'idless-probe');
 const rejected=applyReviewDecision(unresolved,{observationId,action:'reject'},opt);
 let reversed=applyReviewDecision(unresolved,{observationId,action:'keep-separate'},opt);
 const inactiveId=reversed.activities.at(-1).activityId;
 reversed=reverseReviewDecision(reversed,{reviewDecisionId:reversed.reviewDecisions.at(-1).reviewDecisionId},opt);
 assert.equal(getEffectiveActivities(reversed).find(a=>a.activityId===inactiveId).active,false);
 for(const before of [unresolved,rejected,reversed]) {
  const after=prepareCanonicalImport(before,probe,opt).ledger;
  assert.equal(after.observations.at(-1).disposition,'created');assert.notEqual(after.observations.at(-1).activityId,inactiveId);
 }
});
test('corrected overlap evidence respects account and currency boundaries and keeps genuine multiplicity',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2})]),opt).ledger;
 next=correct(next,opt,next.activities[0].activityId,'-10.00','correct-first-twin');next=correct(next,opt,next.activities[1].activityId,'-8.00','correct-second-twin');
 const overlap=prepareCanonicalImport(next,input(accountId,[row(),row({rowOrdinal:2})],'two-overlaps'),opt).ledger;
 assert.equal(overlap.activities.length,2);assert.equal(overlap.imports.at(-1).counts.review,2);
 assert.ok(overlap.observations.slice(2).every(o=>o.reasonCode==='ambiguous-composite-match'));
 const separate=applyReviewDecision(overlap,{observationId:overlap.observations.at(-1).observationId,action:'keep-separate'},opt);
 assert.equal(separate.activities.length,3);assert.equal(separate.activities.at(-1).amountMinor,-1234);
 next=registerAccount(next,{institutionId:'sofi',name:'Other invented checking',currency:'USD',accountType:'checking'},opt);
 const other=prepareCanonicalImport(next,input(next.accounts[1].accountId,[row()],'other-account'),opt).ledger;
 assert.equal(other.observations.at(-1).disposition,'created');
 const currency=prepareCanonicalImport(next,input(accountId,[row({currency:'EUR'})],'other-currency'),opt).ledger;
 assert.equal(currency.observations.at(-1).disposition,'created');
});
test('explicit historical match preserves corrections through later source-ID imports and decision reversal',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({sourceRecordId:'invented-source'})]),opt).ledger;
 const activityId=next.activities[0].activityId;next=classify(next,opt,activityId,'spending');next=correct(next,opt,activityId,'-10.00','correct-before-match');
 next=prepareCanonicalImport(next,input(accountId,[row({sourceRecordId:'invented-source'})],'old-source-overlap'),opt).ledger;
 const observationId=next.observations.at(-1).observationId,events=structuredClone(next.events),activities=structuredClone(next.activities);
 assert.equal(next.observations.at(-1).reasonCode,'source-id-conflict');
 next=applyReviewDecision(next,{observationId,action:'match',activityId,rationale:'Same invented source before correction'},opt);
 assert.equal(next.observations.at(-1).disposition,'matched');assert.equal(report(next).spending,'10.00');
 assert.deepEqual(next.events,events);assert.deepEqual(next.activities,activities);assert.equal(next.reviewDecisions.at(-1).action,'match');
 const decisionId=next.reviewDecisions.at(-1).reviewDecisionId;
 next=prepareCanonicalImport(next,input(accountId,[row({sourceRecordId:'invented-source',amountText:'-10.00'})],'new-source-value'),opt).ledger;
 assert.equal(next.observations.at(-1).disposition,'matched');
 next=prepareCanonicalImport(next,input(accountId,[row({sourceRecordId:'invented-source'})],'old-source-again'),opt).ledger;
 assert.equal(next.observations.at(-1).reasonCode,'source-id-conflict');assert.equal(next.activities.length,1);
 next=reverseReviewDecision(next,{reviewDecisionId:decisionId},opt);
 assert.equal(next.observations.find(o=>o.observationId===observationId).disposition,'review');
 assert.deepEqual(next.events,events);assert.deepEqual(next.activities,activities);assert.equal(report(next).spending,'10.00');
});
test('explicit historical amount match needs the full retained composite and never infers posting',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({sourceRecordId:'invented-source',lifecycleStatus:'pending'})]),opt).ledger;
 const activityId=next.activities[0].activityId;next=correct(next,opt,activityId,'-10.00','pending-correction');
 const overlap=prepareCanonicalImport(next,input(accountId,[row({sourceRecordId:'invented-source'})],'old-posted-evidence'),opt).ledger;
 const linked=applyReviewDecision(overlap,{observationId:overlap.observations.at(-1).observationId,action:'match',activityId},opt);
 assert.deepEqual(linked.events,next.events);assert.equal(getEffectiveActivities(linked)[0].lifecycleStatus,'pending');assert.equal(getEffectiveActivities(linked)[0].amountMinor,-1000);
 for(const overrides of [{amountText:'-11.00'},{normalizedDescription:'unrelated invented shop'},{effectiveDate:'2026-01-16'},{sourceAction:'Other action'},{currency:'EUR'}]) {
  const conflict=prepareCanonicalImport(next,input(accountId,[row({sourceRecordId:'invented-source',...overrides})],'unrelated-conflict'),opt).ledger;
  assert.equal(conflict.observations.at(-1).disposition,'review');
  assert.throws(()=>applyReviewDecision(conflict,{observationId:conflict.observations.at(-1).observationId,action:'match',activityId},opt),/conflicting-match-requires-correction/);
 }
});
test('parsed decimal fallback overlaps survive correction scale differences without duplicate effects',async()=>{
 for(const [currency,originalAmount,intermediateAmount,currentAmount,expectedSpending] of [
  ['CHF','-100.00','-90.00','-80.000','80.000'],
  ['USD','-90071992547409.92','-90071992547409.9300','-90071992547409.940','90071992547409.940'],
 ]) {
  const opt=options();let next=registerAccount(createLedger(opt),{institutionId:'wells-fargo',name:'Invented decimal account',currency,accountType:'checking'},opt);
  const accountId=next.accounts[0].accountId;
  const csv=async amounts=>({...input(accountId),parsed:await parseProviderCsv({sourceFormat:'wells-fargo-csv-v1',bytes:new TextEncoder().encode('DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS\n'+amounts.map(amount=>'01/15/2026,INVENTED DECIMAL PURCHASE,'+amount+',,Posted\n').join(''))})});
  next=prepareCanonicalImport(next,await csv([originalAmount]),opt).ledger;
  const activityId=next.activities[0].activityId;next=classify(next,opt,activityId,'spending');
  next=correct(next,opt,activityId,intermediateAmount,'intermediate-decimal');next=correct(next,opt,activityId,currentAmount,'current-decimal');
  const events=structuredClone(next.events),args=await csv([originalAmount,intermediateAmount,currentAmount]);
  next=prepareCanonicalImport(next,args,opt).ledger;
  assert.equal(next.imports.at(-1).counts.review,3);assert.equal(next.activities.length,1);
  const old=next.observations.at(-2);assert.notEqual(old.candidate.amountDecimal,intermediateAmount);
  next=applyReviewDecision(next,{observationId:old.observationId,action:'match',activityId},opt);
  assert.deepEqual(next.events,events);assert.equal(next.activities.length,1);
  next=prepareCanonicalImport(next,args,opt).ledger;
  assert.equal(next.imports.at(-1).counts.review,2);assert.equal(next.imports.at(-1).counts.matched,1);assert.equal(next.activities.length,1);
  assert.equal(summarizeLedger(next,{start:'2026-01-01',end:'2026-01-31',currency}).spending,expectedSpending);
 }
});
test('linked partial refunds reduce posting month spending, never income or original month',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2,sourceDescription:'EXAMPLE REFUND',amountText:'5.00',effectiveDate:'2026-01-30',postedDate:'2026-02-02'})]),opt).ledger;
 const [purchase,refund]=next.activities;next=classify(next,opt,purchase.activityId,'spending');
 next=applyFinancialEvent(next,{type:'refund-link',activityId:refund.activityId,originalActivityId:purchase.activityId,commandId:'refund-1',evidence:{reason:'Explicit invented refund link'}},opt);
 assert.equal(report(next).spending,'12.34');
 const feb=summarizeLedger(next,{start:'2026-02-01',end:'2026-02-28',currency:'USD'});assert.equal(feb.spending,'-5.00');assert.equal(feb.income,'0');
 assert.equal(next.activities[1].activityKind,'unclassified');assert.equal(next.events.at(-1).originalActivityId,purchase.activityId);
});
test('refund bounds and same currency targets are enforced cumulatively',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2,amountText:'8.00'}),row({rowOrdinal:3,amountText:'8.00'})]),opt).ledger;
 const [purchase,r1,r2]=next.activities;next=classify(next,opt,purchase.activityId,'spending');
 next=applyFinancialEvent(next,{type:'refund-link',activityId:r1.activityId,originalActivityId:purchase.activityId,commandId:'r1',evidence:{reason:'Test'}},opt);
 assert.throws(()=>applyFinancialEvent(next,{type:'refund-link',activityId:r2.activityId,originalActivityId:purchase.activityId,commandId:'r2',evidence:{reason:'Test'}},opt),/exceeds-original/);
});
test('exact decimal fallback sums beyond safe integers without floating point',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({amountText:'90071992547409.92'}),row({rowOrdinal:2,amountText:'0.01'})]),opt).ledger;
 for(const a of next.activities) next=classify(next,opt,a.activityId,'income');
 assert.equal(report(next).income,'90071992547409.93');
});
test('pending, unknown lifecycle and unsupported unclassified rows are excluded honestly',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({lifecycleStatus:'pending'}),row({rowOrdinal:2,lifecycleStatus:'unknown'}),row({rowOrdinal:3})]),opt).ledger;
 for(const a of next.activities.slice(0,2)) next=classify(next,opt,a.activityId,'spending');
 const result=report(next);assert.equal(result.spending,'0');assert.equal(result.excluded.length,3);assert.ok(result.reasons.includes('unknown-lifecycle'));assert.ok(result.reasons.includes('unclassified-activity'));
});
test('synthetic gate, UUID identities and referential integrity fail closed',()=>{
 const {ledger,opt,accountId}=setup();assert.throws(()=>createLedger({idFactory:()=> 'synthetic-1'}),/uuid/);
 assert.throws(()=>prepareCanonicalImport(ledger,{...input(accountId),syntheticOnly:false},opt),/synthetic-only/);
 const next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;next.observations[0].activityId='missing';assert.throws(()=>validateLedger(next),/unknown-activity/);
});
test('needs-review retry reevaluates unresolved source-ID conflict after an auditable correction',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({sourceRecordId:'source-a'})]),opt).ledger;
 const args=input(accountId,[row({sourceRecordId:'source-a',amountText:'-10.00'})],'corrected-source');
 next=prepareCanonicalImport(next,args,opt).ledger;const observationId=next.observations.at(-1).observationId;
 assert.equal(next.imports.at(-1).status,'needs-review');
 next=applyFinancialEvent(next,{type:'bank-correction',activityId:next.activities[0].activityId,amountText:'-10.00',commandId:'correct-source',evidence:{reason:'Invented corrected source'}},opt);
 const retry=prepareCanonicalImport(next,args,opt);assert.equal(retry.summary.noOp,0);assert.equal(retry.ledger.imports.at(-1).status,'processed');assert.equal(retry.ledger.observations.at(-1).observationId,observationId);assert.equal(retry.ledger.activities.length,1);assert.equal(retry.ledger.events.length,1);
});
test('header-only import can establish its empty context from explicit mapping',()=>{
 const {ledger,opt,accountId}=setup();const args=input(accountId,[]);args.parsed.sourceAccountKeys=[];
 const result=prepareCanonicalImport(ledger,args,opt);assert.equal(result.ledger.imports[0].status,'processed');assert.equal(result.summary.rowsRecognized,0);
});
test('malformed persisted financial events fail validation rather than changing reports',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 next=applyFinancialEvent(next,{type:'bank-correction',activityId:next.activities[0].activityId,amountText:'-10.00',commandId:'correct',evidence:{reason:'Invented'}},opt);
 for(const mutate of [e=>e.eventType='arbitrary',e=>e.proposedValues.amountMinor=1.5,e=>e.proposedValues.amountDecimal='1.00',e=>e.proposedValues.currency='EUR',e=>e.proposedValues.lifecycleStatus='posted']) {
  const bad=structuredClone(next);mutate(bad.events[0]);assert.throws(()=>validateLedger(bad));
 }
});
test('pending-to-posted dates come from posted observation without overwriting pending evidence',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({sourceRecordId:'pending-id',lifecycleStatus:'pending',effectiveDate:'2026-01-31'})]),opt).ledger;
 next=classify(next,opt,next.activities[0].activityId,'spending');
 next=prepareCanonicalImport(next,input(accountId,[row({sourceRecordId:'pending-id',effectiveDate:'2026-02-02',postedDate:'2026-02-02'})],'posted-date'),opt).ledger;
 assert.equal(next.activities[0].effectiveDate,'2026-01-31');assert.equal(report(next).spending,'0');
 assert.equal(summarizeLedger(next,{start:'2026-02-01',end:'2026-02-28',currency:'USD'}).spending,'12.34');
 const repeated=prepareCanonicalImport(next,input(accountId,[row({sourceRecordId:'pending-id',effectiveDate:'2026-02-02',postedDate:'2026-02-02'})],'another-posted'),opt).ledger;
 assert.equal(repeated.events.filter(e=>e.eventType==='lifecycle-transition').length,1);
});
test('Fidelity blank currency stays unresolved rather than inheriting an unsupported assumption',()=>{
 const opt=options();let ledger=createLedger(opt);ledger=registerAccount(ledger,{institutionId:'fidelity',name:'Invented retirement',currency:'USD',accountType:'retirement'},opt);
 const accountId=ledger.accounts[0].accountId,args=input(accountId);args.parsed.institutionId='fidelity';args.parsed.sourceFormat='fidelity-accounts-history-csv-v1';
 const next=prepareCanonicalImport(ledger,args,opt).ledger;assert.equal(next.activities.length,0);assert.equal(next.observations[0].candidate.currency,null);assert.equal(next.imports[0].status,'needs-review');
});
test('explicit review match records a pending-to-posted transition with source dates',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({lifecycleStatus:'pending'})]),opt).ledger;
 next=prepareCanonicalImport(next,input(accountId,[row({postedDate:'2026-01-16'})],'review-posted'),opt).ledger;
 const observationId=next.observations.at(-1).observationId;assert.equal(next.observations.at(-1).disposition,'review');
 next=applyReviewDecision(next,{observationId,action:'match',activityId:next.activities[0].activityId},opt);
 next=classify(next,opt,next.activities[0].activityId,'spending');assert.equal(report(next).spending,'12.34');assert.equal(next.events[0].sourceObservationId,observationId);assert.equal(next.activities[0].lifecycleStatus,'pending');
});
test('restored unsupported precision and candidate amounts inconsistent with amount text are rejected',()=>{
 const {ledger,opt,accountId}=setup();const next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 const bad=structuredClone(next);bad.activities[0].amountMinor=null;bad.activities[0].amountDecimal='0.0001';assert.throws(()=>validateLedger(bad),/precision/);
 const candidate=structuredClone(next);candidate.observations[0].candidate.amountMinor=-99999;assert.throws(()=>validateLedger(candidate),/candidate-money/);
});
test('explicit currency review resolves only a missing-currency rejection and preserves blank source',()=>{
 const opt=options();let ledger=createLedger(opt);ledger=registerAccount(ledger,{institutionId:'fidelity',name:'Invented retirement',currency:'USD',accountType:'retirement'},opt);
 const accountId=ledger.accounts[0].accountId,args=input(accountId,[row({sourceFields:{Amount:'-12.34',Currency:''},lifecycleStatus:'unknown'})]);args.parsed.institutionId='fidelity';args.parsed.sourceFormat='fidelity-accounts-history-csv-v1';
 let next=prepareCanonicalImport(ledger,args,opt).ledger;const observationId=next.observations[0].observationId;
 assert.equal(next.observations[0].reasonCode,'missing-currency');
 assert.throws(()=>applyReviewDecision(next,{observationId,action:'keep-separate',currency:'USD'},opt),/explicit-currency/);
 next=applyReviewDecision(next,{observationId,action:'keep-separate',currency:'USD',rationale:'Explicit invented USD confirmation'},opt);
 assert.equal(next.activities[0].currency,'USD');assert.equal(next.activities[0].lifecycleStatus,'unknown');assert.equal(next.observations[0].sourceFields.Currency,'');assert.equal(next.reviewDecisions[0].currency,'USD');assert.equal(next.imports[0].status,'processed');
 const malformed=structuredClone(args);malformed.parsed.fileFingerprint='malformed';malformed.parsed.records[0].valid=false;malformed.parsed.records[0].errorCode='invalid-date';malformed.parsed.records[0].effectiveDate=null;
 const bad=prepareCanonicalImport(next,malformed,opt).ledger;
 assert.throws(()=>applyReviewDecision(bad,{observationId:bad.observations.at(-1).observationId,action:'keep-separate',currency:'USD',rationale:'Do not erase date error'},opt),/explicit-currency/);
});
test('reordered correction or classification events fail replay validation',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;const activityId=next.activities[0].activityId;
 next=classify(next,opt,activityId,'spending');
 next=applyFinancialEvent(next,{type:'bank-correction',activityId,amountText:'-10.00',commandId:'c1',evidence:{reason:'First'}},opt);
 next=applyFinancialEvent(next,{type:'bank-correction',activityId,amountText:'-20.00',commandId:'c2',evidence:{reason:'Second'}},opt);
 [next.events[1],next.events[2]]=[next.events[2],next.events[1]];assert.throws(()=>validateLedger(next),/history-mismatch/);
});
test('category corrections automatically create narrow prospective rules without rewriting imported peers',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2,effectiveDate:'2026-01-16'})]),opt).ledger;
 const [corrected,peer]=next.activities;next=classify(next,opt,corrected.activityId,'spending');
 next=applyFinancialEvent(next,{type:'category-correction',activityId:corrected.activityId,categoryId:'groceries',commandId:'rule-1'},opt);
 assert.deepEqual(next.events.at(-1).prospectiveRule.key,{accountId,institutionId:'sofi',currency:'USD',normalizedDescription:'example shop',sourceAction:'Card purchase'});
 let view=getEffectiveActivities(next);assert.equal(view.find(a=>a.activityId===corrected.activityId).categoryId,'groceries');assert.equal(view.find(a=>a.activityId===peer.activityId).categoryId,null);assert.equal(report(next).spending,'12.34');
 next=prepareCanonicalImport(next,input(accountId,[row({effectiveDate:'2026-01-17'}),row({rowOrdinal:2,effectiveDate:'2026-01-18',sourceAction:'Different action'}),row({rowOrdinal:3,effectiveDate:'2026-01-19',currency:'EUR'}),row({rowOrdinal:4,effectiveDate:'2026-01-20',normalizedDescription:'different merchant'})],'future-rule'),opt).ledger;
 view=getEffectiveActivities(next);assert.equal(view[2].categoryId,'groceries');assert.equal(view[2].activityKind,'unclassified');assert.equal(view[3].categoryId,null);assert.equal(view[4].categoryId,null);assert.equal(view[5].categoryId,null);
 const future=view[2];next=classify(next,opt,future.activityId,'spending','explicit-future-category');assert.equal(getEffectiveActivities(next)[2].categoryId,'example-category');
 next=applyFinancialEvent(next,{type:'category-correction',activityId:corrected.activityId,categoryId:'updated-groceries',commandId:'rule-2'},opt);
 assert.equal(getEffectiveActivities(next)[2].categoryId,'example-category');assert.equal(getEffectiveActivities(next)[1].categoryId,null);
 next=prepareCanonicalImport(next,input(accountId,[row({effectiveDate:'2026-01-21'})],'after-rule-update'),opt).ledger;
 assert.equal(getEffectiveActivities(next).at(-1).categoryId,'updated-groceries');assert.equal(next.activities.at(-1).categoryId,null);
 assert.equal(validateLedger(JSON.parse(JSON.stringify(next))),true);
});
test('prospective category rule cannot cross account boundaries',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 next=applyFinancialEvent(next,{type:'category-correction',activityId:next.activities[0].activityId,categoryId:'groceries',commandId:'rule'},opt);
 next=registerAccount(next,{institutionId:'sofi',name:'Other invented account',currency:'USD',accountType:'checking'},opt);
 next=prepareCanonicalImport(next,input(next.accounts[1].accountId,[row()],'other-account'),opt).ledger;
 assert.equal(getEffectiveActivities(next).at(-1).categoryId,null);
 const invalid=structuredClone(next);invalid.events[0].prospectiveRule.key.currency='EUR';assert.throws(()=>validateLedger(invalid),/prospective-category-rule/);
});
test('identity decisions reverse append-only, retaining inactive activity history and reopening review',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 next=prepareCanonicalImport(next,input(accountId,[row()],'overlap-reverse'),opt).ledger;
 const observationId=next.observations.at(-1).observationId;
 next=applyReviewDecision(next,{observationId,action:'keep-separate'},opt);
 const originalDecision=structuredClone(next.reviewDecisions[0]), retainedActivity=structuredClone(next.activities.at(-1));
 next=reverseReviewDecision(next,{reviewDecisionId:originalDecision.reviewDecisionId,rationale:'Invented mistaken split'},opt);
 assert.deepEqual(next.reviewDecisions[0],originalDecision);assert.deepEqual(next.activities.at(-1),retainedActivity);assert.equal(next.reviewDecisions.at(-1).supersedesDecisionId,originalDecision.reviewDecisionId);assert.equal(next.observations.at(-1).activityId,null);assert.equal(next.observations.at(-1).disposition,'review');assert.equal(next.imports.at(-1).status,'needs-review');
 assert.equal(report(next).excluded.length,1);assert.ok(report(next).reasons.includes('unresolved-observations'));
 next=applyReviewDecision(next,{observationId,action:'match',activityId:next.activities[0].activityId},opt);assert.equal(next.imports.at(-1).status,'processed');assert.equal(next.reviewDecisions.length,3);
});
test('identity reversal refuses later dependent financial events',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 next=prepareCanonicalImport(next,input(accountId,[row()],'dependent'),opt).ledger;
 next=applyReviewDecision(next,{observationId:next.observations.at(-1).observationId,action:'keep-separate'},opt);
 const decisionId=next.reviewDecisions[0].reviewDecisionId;next=classify(next,opt,next.activities.at(-1).activityId,'spending');
 assert.throws(()=>reverseReviewDecision(next,{reviewDecisionId:decisionId},opt),/reversal-dependency/);
});
test('reversing explicit currency resolution restores actionable original missing-currency review',()=>{
 const opt=options();let ledger=createLedger(opt);ledger=registerAccount(ledger,{institutionId:'fidelity',name:'Invented account',currency:'USD',accountType:'brokerage'},opt);
 const args=input(ledger.accounts[0].accountId,[row({sourceFields:{Amount:'-12.34',Currency:''},lifecycleStatus:'unknown'})]);args.parsed.institutionId='fidelity';args.parsed.sourceFormat='fidelity-accounts-history-csv-v1';
 ledger=prepareCanonicalImport(ledger,args,opt).ledger;const observationId=ledger.observations[0].observationId;
 ledger=applyReviewDecision(ledger,{observationId,action:'keep-separate',currency:'USD',rationale:'Explicit invented currency'},opt);
 const priorActivityId=ledger.activities[0].activityId;
 ledger=reverseReviewDecision(ledger,{reviewDecisionId:ledger.reviewDecisions[0].reviewDecisionId,rationale:'Recheck currency'},opt);
 assert.equal(ledger.observations[0].reasonCode,'missing-currency');assert.equal(ledger.observations[0].sourceFields.Currency,'');assert.equal(ledger.observations[0].candidate.currency,null);
 ledger=applyReviewDecision(ledger,{observationId,action:'keep-separate',currency:'USD',rationale:'Confirmed again'},opt);
 assert.equal(ledger.imports[0].status,'processed');assert.equal(ledger.reviewDecisions.length,3);assert.equal(getEffectiveActivities(ledger).find(a=>a.activityId===priorActivityId).active,false);assert.equal(getEffectiveActivities(ledger).at(-1).active,true);
});
test('posted refunds without verified posting dates are excluded rather than assigned source-date periods',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2,amountText:'5.00',effectiveDate:'2026-01-20',postedDate:null})]),opt).ledger;
 const [purchase,refund]=next.activities;next=classify(next,opt,purchase.activityId,'spending');
 next=applyFinancialEvent(next,{type:'refund-link',activityId:refund.activityId,originalActivityId:purchase.activityId,commandId:'unknown-posted-refund',evidence:{reason:'Link known, posting date unavailable'}},opt);
 assert.equal(report(next).spending,'12.34');assert.ok(report(next).reasons.includes('missing-refund-posted-date'));
 const feb=summarizeLedger(next,{start:'2026-02-01',end:'2026-02-28',currency:'USD'});assert.equal(feb.spending,'0');assert.ok(feb.reasons.includes('missing-refund-posted-date'));
});
test('refund-link can confirm posting date with evidence without rewriting original dates',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2,amountText:'5.00',effectiveDate:'2026-01-30',postedDate:null})]),opt).ledger;
 const [purchase,refund]=next.activities;next=classify(next,opt,purchase.activityId,'spending');
 const command={type:'refund-link',activityId:refund.activityId,originalActivityId:purchase.activityId,commandId:'confirmed-refund-date',confirmedPostedDate:'2026-02-02',evidence:{reason:'Explicit invented posting-date confirmation'}};
 next=applyFinancialEvent(next,command,opt);assert.equal(next.activities[1].postedDate,null);assert.equal(next.activities[1].effectiveDate,'2026-01-30');assert.equal(next.events.at(-1).confirmedPostedDate,'2026-02-02');
 const restored=JSON.parse(JSON.stringify(next));assert.equal(validateLedger(restored),true);assert.equal(report(restored).spending,'12.34');
 assert.equal(summarizeLedger(restored,{start:'2026-02-01',end:'2026-02-28',currency:'USD'}).spending,'-5.00');assert.deepEqual(applyFinancialEvent(restored,command,opt),restored);
});
test('refund posting-date confirmation rejects impossible dates, missing evidence and known-date conflicts',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2,amountText:'5.00',postedDate:'2026-01-20'})]),opt).ledger;
 const [purchase,refund]=next.activities;next=classify(next,opt,purchase.activityId,'spending');
 const command={type:'refund-link',activityId:refund.activityId,originalActivityId:purchase.activityId,commandId:'date-conflict',evidence:{reason:'Invented'}};
 for(const confirmedPostedDate of ['2026-02-30','2026-02-01','not-a-date']) assert.throws(()=>applyFinancialEvent(next,{...command,confirmedPostedDate},opt),/invalid-refund-posted-date/);
 assert.throws(()=>applyFinancialEvent(next,{...command,confirmedPostedDate:'2026-01-20',evidence:null},opt),/refund-evidence/);
 const valid=applyFinancialEvent(next,{...command,confirmedPostedDate:'2026-01-20'},opt);valid.events.at(-1).confirmedPostedDate='2026-02-01';assert.throws(()=>validateLedger(valid),/invalid-refund-posted-date/);
});
test('usable source dates must fit declared coverage even when money is malformed',()=>{
 const {ledger,opt,accountId}=setup();const args=input(accountId,[row({valid:false,errorCode:'invalid-amount',amountText:null,effectiveDate:'2025-12-31',sourceFields:{Date:'2025-12-31',Amount:'bad'}})]);
 assert.throws(()=>prepareCanonicalImport(ledger,args,opt),/outside-declared-coverage/);
 args.parsed.records[0].effectiveDate='2026-01-15';args.parsed.records[0].sourceFields.Date='2026-01-15';
 const next=prepareCanonicalImport(ledger,args,opt).ledger;assert.equal(next.imports[0].status,'needs-review');
 next.observations[0].candidate.effectiveDate='2025-12-31';assert.throws(()=>validateLedger(next),/observation-outside-declared-coverage/);
});
test('ordinary spending and bank corrections use original effective period, not later posted date',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row({amountText:'-100.00',effectiveDate:'2026-01-31',postedDate:'2026-02-02'})]),opt).ledger;
 const activityId=next.activities[0].activityId;next=classify(next,opt,activityId,'spending');assert.equal(report(next).spending,'100.00');
 next=applyFinancialEvent(next,{type:'bank-correction',activityId,amountText:'-90.00',commandId:'original-period-correction',evidence:{reason:'Invented bank correction'}},opt);
 assert.equal(report(next).spending,'90.00');assert.equal(summarizeLedger(next,{start:'2026-02-01',end:'2026-02-28',currency:'USD'}).spending,'0');assert.equal(next.activities[0].postedDate,'2026-02-02');
});
test('synthetic ledgers cannot claim retained originals or reconciled coverage',()=>{
 const {ledger,opt,accountId}=setup();const next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 for(const [field,value] of Object.entries({sourceFileRetentionStatus:'retained',privateSourceFileRef:'invented-locator',sourceFileRetainedAt:'2026-01-01T00:00:00Z',sourceFileRetentionExpiresAt:'2027-06-25T00:00:00Z',sourceFileDeletedAt:'2026-02-01T00:00:00Z',coverageReconciled:true})) {
  const altered=structuredClone(next);altered.imports[0][field]=value;assert.throws(()=>validateLedger(altered),/unsupported-synthetic-retention/);
 }
});
test('retry cannot reinterpret a stable source occurrence under an unchanged format and fingerprint',()=>{
 const {ledger,opt,accountId}=setup();const args=input(accountId,[row({valid:false,errorCode:'invalid-amount',amountText:null})]);
 const next=prepareCanonicalImport(ledger,args,opt).ledger;const changed=structuredClone(args);changed.parsed.records[0].valid=true;changed.parsed.records[0].amountText='-10.00';changed.parsed.records[0].errorCode=null;
 assert.throws(()=>prepareCanonicalImport(next,changed,opt),/retry-normalization-changed/);
 assert.deepEqual(prepareCanonicalImport(next,args,opt).ledger.observations[0].candidate,next.observations[0].candidate);
});
test('same-file posted repeats emit one transition while conflicting dates require review independent of order',()=>{
 const {ledger,opt,accountId}=setup();const initial=prepareCanonicalImport(ledger,input(accountId,[row({sourceRecordId:'lifecycle-repeat',lifecycleStatus:'pending'})]),opt).ledger;
 const posted=row({sourceRecordId:'lifecycle-repeat',effectiveDate:'2026-02-01',postedDate:'2026-02-01'});
 const same=prepareCanonicalImport(initial,input(accountId,[posted,{...posted,rowOrdinal:2}],'identical-posted'),opt).ledger;
 assert.equal(same.events.length,1);assert.equal(same.imports.at(-1).counts.matched,2);
 for(const records of [[posted,{...posted,rowOrdinal:2,effectiveDate:'2026-01-31',postedDate:'2026-01-31'}],[{...posted,rowOrdinal:2,effectiveDate:'2026-01-31',postedDate:'2026-01-31'},posted]]) {
  const conflict=prepareCanonicalImport(initial,input(accountId,records,'conflicting-posted'),opt).ledger;assert.equal(conflict.events.length,0);assert.equal(conflict.imports.at(-1).counts.review,2);
 }
 const invalid=structuredClone(same);invalid.events.push({...invalid.events[0],eventId:opt.idFactory(),commandId:'duplicate-transition'});assert.throws(()=>validateLedger(invalid),/invalid-lifecycle-event/);
});
test('resolved observation state cannot remove an activity without a matching retained review decision',()=>{
 const {ledger,opt,accountId}=setup();const next=prepareCanonicalImport(ledger,input(accountId),opt).ledger;
 next.observations[0].disposition='rejected';next.observations[0].activityId=null;next.observations[0].resolved=true;next.imports[0].counts.created=0;next.imports[0].counts.rejected=1;
 assert.throws(()=>validateLedger(next),/resolution-without-decision/);
});
test('JCS storage roundtrip preserves prospective rules, source evidence, command identity and partial retry',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2,valid:false,errorCode:'invalid-amount',amountText:null})]),opt).ledger;
 const command={type:'category-correction',activityId:next.activities[0].activityId,categoryId:'groceries',commandId:'jcs-rule',evidence:{z:'last',a:'first'}};
 next=applyFinancialEvent(next,command,opt);next=JSON.parse(canonicalizeJcs(next));assert.equal(validateLedger(next),true);
 assert.deepEqual(applyFinancialEvent(next,{...command,evidence:{a:'first',z:'last'}},opt),next);
 const retried=prepareCanonicalImport(next,input(accountId,[row(),row({rowOrdinal:2,valid:false,errorCode:'invalid-amount',amountText:null})]),opt).ledger;
 assert.equal(retried.imports[0].retryAttempts.length,1);assert.equal(retried.observations[1].candidate.amountText,null);
 const future=prepareCanonicalImport(retried,input(accountId,[row({effectiveDate:'2026-01-20'})],'jcs-future'),opt).ledger;
 assert.equal(getEffectiveActivities(future).at(-1).categoryId,'groceries');
 const reordered=structuredClone(future);reordered.observations[0].sourceFields={Amount:'-12.34',Description:'EXAMPLE SHOP'};assert.equal(validateLedger(reordered),true);
});
test('linked refunds inherit original effective category until explicitly overridden, including JCS restore',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2,amountText:'5.00',postedDate:'2026-02-02',sourceDescription:'EXAMPLE REFUND',normalizedDescription:'example refund'})]),opt).ledger;
 const [purchase,refund]=next.activities;next=classify(next,opt,purchase.activityId,'spending');
 next=applyFinancialEvent(next,{type:'classification',activityId:refund.activityId,activityKind:'refund',categoryId:'unrelated-before-link',commandId:'refund-old-category'},opt);
 next=applyFinancialEvent(next,{type:'refund-link',activityId:refund.activityId,originalActivityId:purchase.activityId,commandId:'category-inheriting-link',evidence:{reason:'Invented link'}},opt);
 assert.equal(getEffectiveActivities(next)[1].categoryId,'example-category');assert.equal(next.activities[1].categoryId,null);
 next=applyFinancialEvent(next,{type:'category-correction',activityId:purchase.activityId,categoryId:'corrected-original',commandId:'original-category-correction'},opt);
 assert.equal(getEffectiveActivities(next)[1].categoryId,'corrected-original');
 next=JSON.parse(canonicalizeJcs(next));assert.equal(validateLedger(next),true);assert.equal(getEffectiveActivities(next)[1].categoryId,'corrected-original');
 next=applyFinancialEvent(next,{type:'category-correction',activityId:refund.activityId,categoryId:'explicit-refund-category',commandId:'refund-category-override'},opt);
 next=applyFinancialEvent(next,{type:'category-correction',activityId:purchase.activityId,categoryId:'new-original-category',commandId:'original-later-category'},opt);
 const restored=JSON.parse(canonicalizeJcs(next));assert.equal(validateLedger(restored),true);assert.equal(getEffectiveActivities(restored)[0].categoryId,'new-original-category');assert.equal(getEffectiveActivities(restored)[1].categoryId,'explicit-refund-category');
});
test('invalid cyclic refund links fail safely rather than recursing indefinitely',()=>{
 const {ledger,opt,accountId}=setup();let next=prepareCanonicalImport(ledger,input(accountId,[row(),row({rowOrdinal:2,amountText:'5.00',postedDate:'2026-02-02'})]),opt).ledger;
 const [purchase,refund]=next.activities;next=classify(next,opt,purchase.activityId,'spending');
 next=applyFinancialEvent(next,{type:'refund-link',activityId:refund.activityId,originalActivityId:purchase.activityId,commandId:'acyclic-link',evidence:{reason:'Invented link'}},opt);
 next.events.push({...next.events.at(-1),eventId:opt.idFactory(),commandId:'invalid-cycle',activityId:purchase.activityId,originalActivityId:refund.activityId});
 assert.throws(()=>validateLedger(next),/cyclic-refund-link|invalid-effective-refund/);
});
