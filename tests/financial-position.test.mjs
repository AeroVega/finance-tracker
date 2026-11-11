import test from 'node:test';
import assert from 'node:assert/strict';
import {createLedger,registerAccount,prepareCanonicalImport,applyFinancialEvent,validateLedger} from '../js/canonical-import.mjs';
import {applyPositionEvent,buildFinancialPosition,buildAccountMonthCoverage} from '../js/financial-position.mjs';

function setup(types=['checking'],currencies=[]) {
  let n=0;const options={now:()=> '2026-02-01T00:00:00.000Z',idFactory:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`};
  let ledger=createLedger(options);
  for(const [i,accountType] of types.entries())ledger=registerAccount(ledger,{institutionId:'sofi',displayName:'Invented '+accountType,currency:currencies[i]??'USD',accountType},options);
  return {ledger,options};
}
const source={kind:'statement',reference:'Invented statement'};
function event(ledger,options,type,fields={},index=0) {return applyPositionEvent(ledger,{type,commandId:'position-'+(ledger.positionEvents?.length??0),accountId:ledger.accounts[index].accountId,...fields},options);}
function balance(ledger,options,date,amount,index=0) {return event(ledger,options,'balance-snapshot',{effectiveDate:date,amountText:amount,basis:'statement',source},index);}
const position=(ledger,date='2026-01-31')=>buildFinancialPosition(ledger,{asOf:date});
const coverage=ledger=>buildAccountMonthCoverage(ledger,{month:'2026-01'});
function addImport(ledger,options,amounts=[],index=0,extra={},range={start:'2026-01-01',end:'2026-01-31'}) {
  const accountId=ledger.accounts[index].accountId;
  return prepareCanonicalImport(ledger,{syntheticOnly:true,parsed:{sourceFormat:'sofi-csv-v1',institutionId:'sofi',fileFingerprint:'invented-'+ledger.imports.length,rowsSeen:amounts.length,ignoredCount:0,sourceAccountKeys:['default'],records:amounts.map((amountText,i)=>({sourceAccountKey:'default',sourceFields:{Amount:amountText},rowOrdinal:i+1,physicalLine:i+2,sourceDescription:'INVENTED ACTIVITY '+i,normalizedDescription:'invented activity '+i,sourceAction:'Payment',sourceRecordId:null,amountText,currency:'USD',effectiveDate:'2026-01-15',postedDate:null,settlementDate:null,lifecycleStatus:'posted',valid:true,errorCode:null,...extra}))},accountMappings:{default:accountId},coverageByAccount:{[accountId]:{...range,provenance:'user-confirmed'}}},options).ledger;
}
function reconcile(ledger,options,index=0,extra={}) {
  const anchors=ledger.positionEvents.filter(e=>e.accountId===ledger.accounts[index].accountId&&e.eventType==='balance-snapshot');
  return event(ledger,options,'reconciliation',{month:'2026-01',openingBalanceEventId:anchors.find(e=>e.effectiveDate==='2025-12-31').eventId,closingBalanceEventId:anchors.find(e=>e.effectiveDate==='2026-01-31').eventId,source,...extra},index);
}

test('dated balances, never transaction sums, determine exact position and freshness boundary',()=>{
  let {ledger,options}=setup();ledger=addImport(ledger,options,['900.00']);
  assert.equal(position(ledger).accounts[0].balance,null);assert.equal(position(ledger).currencies[0].netWorth,null);
  ledger=balance(ledger,options,'2025-12-27','100.01');ledger=balance(ledger,options,'2026-02-01','900.00');
  assert.equal(position(ledger).accounts[0].balance,'100.01');assert.equal(position(ledger).complete,true);
  assert.equal(position(ledger,'2026-01-31').accounts[0].ageDays,35);
  // Future evidence does not make an earlier snapshot current.
  const older=structuredClone(ledger);older.positionEvents.pop();
  assert.equal(position(older,'2026-02-01').accounts[0].stale,true);assert.equal(position(older,'2026-02-01').currencies[0].netWorth,null);
});
test('same-date contradictions require append-only exact-candidate resolution, and new evidence reopens conflict',()=>{
  let {ledger,options}=setup();ledger=balance(ledger,options,'2026-01-31','100');ledger=balance(ledger,options,'2026-01-31','101');
  const originals=structuredClone(ledger.positionEvents),candidateEventIds=originals.map(e=>e.eventId);
  assert.equal(position(ledger).accounts[0].status,'conflict');assert.equal(position(ledger).accounts[0].balanceDate,'2026-01-31');
  ledger=event(ledger,options,'balance-resolution',{effectiveDate:'2026-01-31',selectedEventId:candidateEventIds[1],candidateEventIds,reason:'Invented corrected statement'});
  assert.equal(position(ledger).currencies[0].netWorth,'101.00');assert.deepEqual(ledger.positionEvents.slice(0,2),originals);
  ledger=balance(ledger,options,'2026-01-31','102');assert.equal(position(ledger).accounts[0].status,'conflict');
  assert.throws(()=>event(ledger,options,'balance-resolution',{effectiveDate:'2026-01-31',selectedEventId:candidateEventIds[1],candidateEventIds,reason:'Incomplete candidates'}),/resolution/);
});
test('identical same-date amounts are corroborating evidence; historical views ignore future snapshots',()=>{
  let {ledger,options}=setup();ledger=balance(ledger,options,'2026-01-31','100');ledger=balance(ledger,options,'2026-01-31','100.00');ledger=balance(ledger,options,'2026-02-01','200');
  assert.equal(position(ledger).accounts[0].status,'known');assert.equal(position(ledger).accounts[0].balance,'100.00');
});
test('all liability types are positive balances and exact currencies are never converted or combined',()=>{
  let {ledger,options}=setup(['checking','credit-card','mortgage','auto-loan','savings'],['USD','USD','USD','USD','EUR']);
  for(const [i,value] of ['1000','100','500','200','250'].entries())ledger=balance(ledger,options,'2026-01-31',value,i);
  const result=position(ledger);assert.equal(result.currencies.find(c=>c.currency==='USD').netWorth,'200.00');assert.equal(result.currencies.find(c=>c.currency==='EUR').netWorth,'250.00');
  assert.throws(()=>balance(ledger,options,'2026-02-01','-1',1),/positive/);
  const before=JSON.stringify(ledger);ledger=balance(ledger,options,'2026-02-01','900719925474099312345.67',0);
  assert.equal(position(ledger,'2026-02-01').currencies.find(c=>c.currency==='USD').netWorth,'900719925474099311545.67');assert.ok(before.length>0);
});
test('missing and unknown scopes withhold total while preserving known subtotals; empty and duplicate scopes fail safely',()=>{
  let {ledger,options}=setup(['checking','savings','other']);ledger=balance(ledger,options,'2026-01-31','10');ledger=balance(ledger,options,'2026-01-31','20',2);
  const result=position(ledger);assert.equal(result.currencies[0].knownAssets,'10.00');assert.equal(result.currencies[0].netWorth,null);assert.ok(result.reasons.includes('unknown-account-scope'));
  assert.equal(buildFinancialPosition(ledger,{asOf:'2026-01-31',accountIds:[]}).complete,false);
  assert.throws(()=>buildFinancialPosition(ledger,{asOf:'2026-01-31',accountIds:[ledger.accounts[0].accountId,ledger.accounts[0].accountId]}),/scope/);
});
test('holdings are independent dated evidence, flagged when unsupported, and never added to account total',()=>{
  let {ledger,options}=setup(['brokerage']);ledger=balance(ledger,options,'2026-01-31','1000');
  assert.equal(position(ledger).accounts[0].holdings,null);
  ledger=event(ledger,options,'holdings-snapshot',{effectiveDate:'2026-01-31',scope:'complete',source,holdings:[{symbol:'INVENTED',assetType:'stock',quantity:'10',valueText:'900'},{symbol:'CASH',assetType:'cash',quantity:'100',valueText:'100'}]});
  assert.equal(position(ledger).currencies[0].netWorth,'1000.00');
  ledger=event(ledger,options,'holdings-snapshot',{effectiveDate:'2026-02-01',scope:'partial',source,holdings:[{symbol:'INVENTED OPTION',assetType:'option',quantity:'1',valueText:'50'}]});
  assert.equal(position(ledger,'2026-02-01').currencies[0].knownAssets,'1000.00');assert.ok(position(ledger,'2026-02-01').reasons.includes('unsupported-holding-type'));
});
test('archiving does not exclude balances; explicit zero closure preserves historical liability',()=>{
  let {ledger,options}=setup(['auto-loan']);ledger=balance(ledger,options,'2026-01-01','100');ledger.accounts[0].archivedAt='2026-01-02T00:00:00Z';
  assert.equal(position(ledger).currencies[0].knownLiabilities,'100.00');
  assert.throws(()=>event(ledger,options,'account-closure',{effectiveDate:'2026-01-01',balanceEventId:ledger.positionEvents[0].eventId,source}),/zero/);
  ledger=balance(ledger,options,'2026-01-31','0');ledger=event(ledger,options,'account-closure',{effectiveDate:'2026-01-31',balanceEventId:ledger.positionEvents.at(-1).eventId,source});
  assert.equal(position(ledger,'2026-02-01').accounts[0].status,'closed');assert.equal(position(ledger,'2026-01-15').accounts[0].balance,'100.00');
  ledger=balance(ledger,options,'2026-02-02','1');assert.ok(position(ledger,'2026-02-02').reasons.includes('closure-contradicted'));
});
test('coverage distinguishes declaration, observation, and evidence-backed zero-activity reconciliation',()=>{
  let {ledger,options}=setup();assert.equal(coverage(ledger).accounts[0].state,'incomplete');
  ledger=addImport(ledger,options);assert.equal(coverage(ledger).accounts[0].state,'declared');
  ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','100');ledger=reconcile(ledger,options);
  assert.equal(coverage(ledger).accounts[0].state,'reconciled-complete');assert.equal(coverage(ledger).accounts[0].discrepancy,'0.00');
});
test('bank rollforward includes transfer/refund cash and effective corrections; correction revokes completeness',()=>{
  let {ledger,options}=setup();ledger=addImport(ledger,options,['-20','10','5']);assert.equal(coverage(ledger).accounts[0].state,'observed');
  ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','95');ledger=reconcile(ledger,options);
  assert.equal(coverage(ledger).complete,true);
  ledger=applyFinancialEvent(ledger,{type:'bank-correction',commandId:'correct',activityId:ledger.activities[0].activityId,amountText:'-21',evidence:{reason:'Invented correction'}},options);
  assert.equal(coverage(ledger).complete,false);assert.equal(coverage(ledger).accounts[0].discrepancy,'-1.00');assert.equal(validateLedger(ledger),true);
});
test('card rollforward inverts signed purchase/payment movements, independent of classification',()=>{
  let {ledger,options}=setup(['credit-card']);ledger=addImport(ledger,options,['-50','20']);ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','130');ledger=reconcile(ledger,options);
  assert.equal(coverage(ledger).complete,true);
});
test('pending, unknown dates, and unreviewed observations cannot produce complete coverage',()=>{
  for(const extra of [{lifecycleStatus:'pending'},{lifecycleStatus:'unknown'},{valid:false,errorCode:'bad-date',effectiveDate:null}]) {
    let {ledger,options}=setup();ledger=addImport(ledger,options,['0'],0,extra);ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','100');ledger=reconcile(ledger,options);
    assert.equal(coverage(ledger).complete,false);assert.ok(coverage(ledger).accounts[0].reasons.some(r=>['pending-activity','unresolved-activity-lifecycle','unknown-source-date'].includes(r)));
  }
});
test('investment and loan changes require explicit statement components, never invented splits or cash rollforward',()=>{
  for(const type of ['brokerage','mortgage','auto-loan']) {
    let {ledger,options}=setup([type]);ledger=addImport(ledger,options);ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','110');ledger=reconcile(ledger,options);
    assert.ok(coverage(ledger).reasons.includes('unsupported-reconciliation-method'));
    ledger=reconcile(ledger,options,0,{method:'statement-components',components:[{kind:type==='brokerage'?'market-value-change':'principal-change',amountText:'10',source}]});
    assert.equal(coverage(ledger).complete,true);
  }
});
test('position commands are idempotent and stored events reject malformed references and invented completeness',()=>{
  let {ledger,options}=setup();const original=structuredClone(ledger);const command={type:'balance-snapshot',commandId:'stable',accountId:ledger.accounts[0].accountId,effectiveDate:'2026-01-31',amountText:'100',basis:'manual',source:{kind:'manual',reference:'Invented update'}};
  ledger=applyPositionEvent(ledger,command,options);assert.deepEqual(original.positionEvents,undefined);assert.deepEqual(applyPositionEvent(ledger,command,options),ledger);
  assert.throws(()=>applyPositionEvent(ledger,{...command,amountText:'101'},options),/command-conflict/);
  for(const mutate of [e=>e.complete=true,e=>e.effectiveDate='2026-02-30',e=>e.amountText='1.001',e=>e.source={kind:'import',reference:'Missing import',importRunId:'no'},e=>e.appendOnly=false]) {
    const tampered=structuredClone(ledger);mutate(tampered.positionEvents[0]);assert.throws(()=>validateLedger(tampered));
  }
  assert.equal(validateLedger(JSON.parse(JSON.stringify(ledger))),true);
});

test('reconciliation validates anchors in append order and later contradictory evidence revokes completeness',()=>{
  let {ledger,options}=setup();ledger=addImport(ledger,options);ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','100');ledger=reconcile(ledger,options);
  assert.equal(coverage(ledger).complete,true);
  ledger=balance(ledger,options,'2026-01-31','101');assert.equal(validateLedger(ledger),true);assert.equal(coverage(ledger).complete,false);
  assert.ok(coverage(ledger).reasons.includes('conflicting-balance-anchors'));
  assert.throws(()=>reconcile(ledger,options),/selected-anchors/);
  const tampered=structuredClone(ledger);tampered.positionEvents[2].openingBalanceEventId=tampered.positionEvents[1].eventId;assert.throws(()=>validateLedger(tampered),/anchors/);
});
test('holdings contradictions and complete-holdings discrepancies never change the known account total',()=>{
  let {ledger,options}=setup(['brokerage']);ledger=balance(ledger,options,'2026-01-31','100');
  ledger=event(ledger,options,'holdings-snapshot',{effectiveDate:'2026-01-31',scope:'complete',source,holdings:[{symbol:'INVENTED',assetType:'stock',quantity:'1',valueText:'90'}]});
  assert.ok(position(ledger).reasons.includes('holdings-balance-discrepancy'));assert.equal(position(ledger).currencies[0].knownAssets,'100.00');assert.equal(position(ledger).currencies[0].netWorth,null);
  ledger=event(ledger,options,'holdings-snapshot',{effectiveDate:'2026-01-31',scope:'complete',source,holdings:[{symbol:'INVENTED',assetType:'stock',quantity:'1',valueText:'100'}]});
  assert.ok(position(ledger).reasons.includes('conflicting-holdings'));
});
test('old ledgers remain byte-shape compatible and malformed optional collections fail validation',()=>{
  const {ledger}=setup();const before=JSON.stringify(ledger);position(ledger);coverage(ledger);assert.equal(JSON.stringify(ledger),before);assert.equal(Object.hasOwn(ledger,'positionEvents'),false);
  for(const bad of [null,{},true])assert.throws(()=>validateLedger({...ledger,positionEvents:bad}),/position-events/);
});

test('holdings conflict selection preserves originals and new same-date evidence reopens review',()=>{
  let {ledger,options}=setup(['brokerage']);ledger=balance(ledger,options,'2026-01-31','100');
  for(const valueText of ['90','100'])ledger=event(ledger,options,'holdings-snapshot',{effectiveDate:'2026-01-31',scope:'complete',source,holdings:[{symbol:'INVENTED',assetType:'stock',quantity:'1',valueText}]});
  const originals=structuredClone(ledger.positionEvents),candidateEventIds=originals.slice(1).map(e=>e.eventId);
  ledger=event(ledger,options,'holdings-resolution',{effectiveDate:'2026-01-31',candidateEventIds,selectedEventId:candidateEventIds[1],reason:'Corrected invented statement'});
  assert.deepEqual(ledger.positionEvents.slice(0,3),originals);assert.equal(position(ledger).complete,true);
  ledger=event(ledger,options,'holdings-snapshot',{effectiveDate:'2026-01-31',scope:'complete',source,holdings:[{symbol:'INVENTED',assetType:'stock',quantity:'1',valueText:'110'}]});
  assert.equal(position(ledger).complete,false);assert.ok(position(ledger).reasons.includes('conflicting-holdings'));
});
test('statement components cannot hide posted source activities with unsupported monetary evidence',()=>{
  let {ledger,options}=setup(['mortgage']);ledger=addImport(ledger,options,[null]);ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','100');ledger=reconcile(ledger,options,0,{method:'statement-components',components:[]});
  assert.equal(coverage(ledger).complete,false);assert.ok(coverage(ledger).reasons.includes('unknown-activity-amount'));
});

test('cash reconciliation uses confirmed refund posting month, never its original activity month',()=>{
  let {ledger,options}=setup();ledger=addImport(ledger,options,['-10','10']);
  ledger=applyFinancialEvent(ledger,{type:'classification',commandId:'spending',activityId:ledger.activities[0].activityId,activityKind:'spending'},options);
  ledger=applyFinancialEvent(ledger,{type:'refund-link',commandId:'refund',activityId:ledger.activities[1].activityId,originalActivityId:ledger.activities[0].activityId,confirmedPostedDate:'2026-02-01',evidence:{reason:'Invented February posting'}},options);
  ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','100');ledger=reconcile(ledger,options);
  assert.equal(coverage(ledger).complete,false);assert.equal(coverage(ledger).accounts[0].discrepancy,'-10.00');
  const january=ledger.positionEvents.find(e=>e.eventType==='balance-snapshot'&&e.effectiveDate==='2026-01-31').eventId;
  ledger=balance(ledger,options,'2026-02-28','110');
  ledger=event(ledger,options,'reconciliation',{month:'2026-02',openingBalanceEventId:january,closingBalanceEventId:ledger.positionEvents.at(-1).eventId,source});
  assert.equal(buildAccountMonthCoverage(ledger,{month:'2026-02'}).accounts[0].discrepancy,'0.00');
});
test('refunds with no posting date block all periods, even when transaction arithmetic would balance',()=>{
  let {ledger,options}=setup();ledger=addImport(ledger,options,['10']);
  ledger=applyFinancialEvent(ledger,{type:'classification',commandId:'refund',activityId:ledger.activities[0].activityId,activityKind:'refund',categoryId:'invented'},options);
  ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','110');ledger=reconcile(ledger,options);
  assert.equal(coverage(ledger).complete,false);assert.ok(coverage(ledger).reasons.includes('missing-refund-posted-date'));
  assert.ok(buildAccountMonthCoverage(ledger,{month:'2026-02'}).reasons.includes('missing-refund-posted-date'));
});
test('distinct posted date moves bank movement out of its pending/source effective month',()=>{
  let {ledger,options}=setup();ledger=addImport(ledger,options,['-10'],0,{postedDate:'2026-02-01'});
  ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','100');ledger=reconcile(ledger,options);
  assert.equal(coverage(ledger).complete,true);assert.equal(coverage(ledger).accounts[0].discrepancy,'0.00');
  const january=ledger.positionEvents.find(e=>e.eventType==='balance-snapshot'&&e.effectiveDate==='2026-01-31').eventId;
  ledger=balance(ledger,options,'2026-02-28','90');ledger=event(ledger,options,'reconciliation',{month:'2026-02',openingBalanceEventId:january,closingBalanceEventId:ledger.positionEvents.at(-1).eventId,source});
  assert.equal(buildAccountMonthCoverage(ledger,{month:'2026-02'}).accounts[0].discrepancy,'0.00');
});

test('an intervening nonzero balance cannot silently reinstate an earlier closure',()=>{
  let {ledger,options}=setup();ledger=balance(ledger,options,'2026-01-31','0');ledger=event(ledger,options,'account-closure',{effectiveDate:'2026-01-31',balanceEventId:ledger.positionEvents.at(-1).eventId,source});
  ledger=balance(ledger,options,'2026-02-01','100');ledger=balance(ledger,options,'2026-02-02','0');
  const report=position(ledger,'2026-06-01');assert.equal(report.complete,false);assert.ok(report.reasons.includes('closure-contradicted'));assert.ok(report.reasons.includes('stale-balance'));
  ledger=event(ledger,options,'account-closure',{effectiveDate:'2026-02-02',balanceEventId:ledger.positionEvents.at(-1).eventId,source});assert.equal(position(ledger,'2026-06-01').accounts[0].status,'closed');
});
test('pending January activity transitioning to posted February is counted exactly once in February',()=>{
  let {ledger,options}=setup();ledger=addImport(ledger,options,['-10'],0,{sourceRecordId:'invented-stable',lifecycleStatus:'pending'});
  ledger=addImport(ledger,options,['-10'],0,{sourceRecordId:'invented-stable',lifecycleStatus:'posted',effectiveDate:'2026-02-01',postedDate:'2026-02-01'},{start:'2026-02-01',end:'2026-02-28'});
  assert.equal(ledger.activities.length,1);assert.equal(ledger.activities[0].lifecycleStatus,'pending');
  ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','100');ledger=reconcile(ledger,options);assert.equal(coverage(ledger).complete,true);
  const january=ledger.positionEvents.find(e=>e.eventType==='balance-snapshot'&&e.effectiveDate==='2026-01-31').eventId;
  ledger=balance(ledger,options,'2026-02-28','90');ledger=event(ledger,options,'reconciliation',{month:'2026-02',openingBalanceEventId:january,closingBalanceEventId:ledger.positionEvents.at(-1).eventId,source});
  const february=buildAccountMonthCoverage(ledger,{month:'2026-02'});assert.equal(february.complete,true);assert.equal(february.accounts[0].discrepancy,'0.00');
});

test('unresolved source observations block both their effective and known posting months',()=>{
  let {ledger,options}=setup();ledger=addImport(ledger,options,['invalid'],0,{valid:false,errorCode:'invalid-money',postedDate:'2026-02-01'},{start:'2026-01-01',end:'2026-02-28'});
  ledger=balance(ledger,options,'2026-01-31','100');ledger=balance(ledger,options,'2026-02-28','100');
  ledger=event(ledger,options,'reconciliation',{month:'2026-02',openingBalanceEventId:ledger.positionEvents[0].eventId,closingBalanceEventId:ledger.positionEvents[1].eventId,source});
  const february=buildAccountMonthCoverage(ledger,{month:'2026-02'});assert.equal(february.complete,false);assert.equal(february.accounts[0].observed,true);assert.ok(february.reasons.includes('unresolved-source-observation'));
  assert.ok(coverage(ledger).reasons.includes('unresolved-source-observation'));
});

test('explicit full-month statement coverage supports manual investments and loans without fabricated imports',()=>{
  for(const type of ['brokerage','retirement','mortgage','auto-loan']) {
    let {ledger,options}=setup([type]);ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','110');
    const original=structuredClone(ledger);
    ledger=reconcile(ledger,options,0,{method:'statement-components',statementCoverage:{start:'2026-01-01',end:'2026-01-31'},components:[{kind:type==='brokerage'||type==='retirement'?'market-value-change':'principal-change',amountText:'10',source}]});
    assert.equal(ledger.imports.length,0);assert.equal(coverage(ledger).accounts[0].declared,true);assert.equal(coverage(ledger).complete,true);
    assert.deepEqual(ledger.positionEvents.slice(0,2),original.positionEvents);assert.equal(validateLedger(JSON.parse(JSON.stringify(ledger))),true);
    assert.equal(ledger.positionEvents[0].statementCoverage,undefined);
  }
});
test('statement coverage must be the exact month and cannot authorize other reconciliation methods or account types',()=>{
  let {ledger,options}=setup(['mortgage']);ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','100');
  for(const statementCoverage of [null,{},true,{start:'2026-01-02',end:'2026-01-31'},{start:'2026-01-01',end:'2026-02-01'},{start:'2026-01-01',end:'2026-01-31',complete:true}])assert.throws(()=>reconcile(ledger,options,0,{method:'statement-components',statementCoverage}),/statement-coverage/);
  assert.throws(()=>reconcile(ledger,options,0,{statementCoverage:{start:'2026-01-01',end:'2026-01-31'}}),/statement-coverage/);
  let bank=setup();bank.ledger=balance(bank.ledger,bank.options,'2025-12-31','100');bank.ledger=balance(bank.ledger,bank.options,'2026-01-31','100');
  assert.throws(()=>reconcile(bank.ledger,bank.options,0,{method:'statement-components',statementCoverage:{start:'2026-01-01',end:'2026-01-31'}}),/statement-coverage/);
});
test('statement declaration cannot hide discrepancies or unresolved source evidence; empty components only reconcile no movement',()=>{
  let {ledger,options}=setup(['mortgage']);ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','110');
  const extra={method:'statement-components',statementCoverage:{start:'2026-01-01',end:'2026-01-31'}};
  ledger=reconcile(ledger,options,0,extra);assert.equal(coverage(ledger).complete,false);assert.equal(coverage(ledger).accounts[0].discrepancy,'-10.00');
  ledger=reconcile(ledger,options,0,{...extra,components:[{kind:'principal-change',amountText:'10',source}]});assert.equal(coverage(ledger).complete,true);
  ledger=addImport(ledger,options,['invalid'],0,{valid:false,errorCode:'invalid-money'});assert.equal(coverage(ledger).complete,false);assert.ok(coverage(ledger).reasons.includes('unresolved-source-observation'));
  let unchanged=setup(['mortgage']);unchanged.ledger=balance(unchanged.ledger,unchanged.options,'2025-12-31','100');unchanged.ledger=balance(unchanged.ledger,unchanged.options,'2026-01-31','100');unchanged.ledger=reconcile(unchanged.ledger,unchanged.options,0,extra);assert.equal(coverage(unchanged.ledger).complete,true);
});
test('holdings resolution projection exposes selected identity and explicit conflict status',()=>{
  let {ledger,options}=setup(['brokerage']);
  for(const valueText of ['90','100'])ledger=event(ledger,options,'holdings-snapshot',{effectiveDate:'2026-01-31',scope:'complete',source,holdings:[{symbol:'INVENTED',assetType:'stock',quantity:'1',valueText}]});
  let holdings=position(ledger).accounts[0].holdings;assert.equal(holdings.status,'conflict');assert.equal(holdings.selectedEventId,null);assert.equal(holdings.candidateEventIds.length,2);
  ledger=event(ledger,options,'holdings-resolution',{effectiveDate:'2026-01-31',candidateEventIds:holdings.candidateEventIds,selectedEventId:holdings.candidateEventIds[1],reason:'Corrected invented statement'});
  holdings=position(ledger).accounts[0].holdings;assert.equal(holdings.status,'known');assert.equal(holdings.selectedEventId,holdings.candidateEventIds[1]);
});

test('latest reconciliation owns the optional statement declaration and malformed persisted coverage fails replay',()=>{
  let {ledger,options}=setup(['mortgage']);ledger=balance(ledger,options,'2025-12-31','100');ledger=balance(ledger,options,'2026-01-31','100');
  ledger=reconcile(ledger,options,0,{method:'statement-components',statementCoverage:{start:'2026-01-01',end:'2026-01-31'}});assert.equal(coverage(ledger).complete,true);
  const persisted=JSON.parse(JSON.stringify(ledger));persisted.positionEvents.at(-1).statementCoverage.end='2026-01-30';assert.throws(()=>validateLedger(persisted),/statement-coverage/);
  ledger=reconcile(ledger,options,0,{method:'statement-components'});assert.equal(coverage(ledger).accounts[0].declared,false);assert.equal(coverage(ledger).complete,false);assert.ok(coverage(ledger).reasons.includes('missing-declared-coverage'));
});
