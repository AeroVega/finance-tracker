import test from 'node:test';
import assert from 'node:assert/strict';
import {createLedger,registerAccount,prepareCanonicalImport} from '../js/canonical-import.mjs';
import {applyPositionEvent,buildFinancialPosition,buildAccountMonthCoverage} from '../js/financial-position.mjs';

const source={kind:'statement',reference:'Invented adversarial statement'};
function setup(accountType='checking') {
  let n=0;
  const options={now:()=> '2026-03-01T00:00:00.000Z',idFactory:()=>`10000000-0000-4000-8000-${String(++n).padStart(12,'0')}`};
  let ledger=registerAccount(createLedger(options),{institutionId:'sofi',displayName:'Invented review account',currency:'USD',accountType},options);
  const apply=(type,fields)=> {ledger=applyPositionEvent(ledger,{type,accountId:ledger.accounts[0].accountId,commandId:'review-'+n,...fields},options);return ledger.positionEvents.at(-1).eventId;};
  const balance=(effectiveDate,amountText)=>apply('balance-snapshot',{effectiveDate,amountText,basis:'statement',source});
  return {get ledger(){return ledger;},options,apply,balance,declare(){const accountId=ledger.accounts[0].accountId;ledger=prepareCanonicalImport(ledger,{syntheticOnly:true,parsed:{sourceFormat:'sofi-csv-v1',institutionId:'sofi',fileFingerprint:'invented-empty-review',rowsSeen:0,ignoredCount:0,sourceAccountKeys:['default'],records:[]},accountMappings:{default:accountId},coverageByAccount:{[accountId]:{start:'2026-01-01',end:'2026-01-31',provenance:'user-confirmed'}}},options).ledger;}};
}
const position=(s,asOf)=>buildFinancialPosition(s.ledger,{asOf});

test('corroborating balance snapshots preserve an evidenced reconciliation, but contradictions revoke it',()=>{
  const s=setup();s.declare();
  const openingBalanceEventId=s.balance('2025-12-31','100'),closingBalanceEventId=s.balance('2026-01-31','100');
  s.apply('reconciliation',{month:'2026-01',openingBalanceEventId,closingBalanceEventId,source});
  s.balance('2025-12-31','100');s.balance('2026-01-31','100');
  assert.equal(buildAccountMonthCoverage(s.ledger,{month:'2026-01'}).complete,true);
  s.balance('2026-01-31','101');
  assert.equal(buildAccountMonthCoverage(s.ledger,{month:'2026-01'}).complete,false);
});

test('closure applies on its effective date and survives corroborating zero evidence',()=>{
  const s=setup();const balanceEventId=s.balance('2026-01-31','0');
  s.apply('account-closure',{effectiveDate:'2026-01-31',balanceEventId,source});
  assert.equal(position(s,'2026-01-31').accounts[0].status,'closed');
  s.balance('2026-01-31','0');
  assert.equal(position(s,'2026-06-01').accounts[0].status,'closed');
});

test('backfilled older closure cannot replace a later closure after account reuse',()=>{
  const s=setup();const older=s.balance('2026-01-01','0');
  s.balance('2026-01-15','100');const newer=s.balance('2026-01-31','0');
  s.apply('account-closure',{effectiveDate:'2026-01-31',balanceEventId:newer,source});
  s.apply('account-closure',{effectiveDate:'2026-01-01',balanceEventId:older,source});
  assert.equal(position(s,'2026-06-01').accounts[0].status,'closed');
});

test('holdings row order and equivalent exact quantities do not manufacture conflicts',()=>{
  const s=setup('brokerage');s.balance('2026-01-31','100');
  const holdings=[{symbol:'INVENTED-A',assetType:'stock',quantity:'01.0',valueText:'60'},{symbol:'INVENTED-B',assetType:'bond',quantity:'2',valueText:'40'}];
  s.apply('holdings-snapshot',{effectiveDate:'2026-01-31',scope:'complete',source,holdings});
  s.apply('holdings-snapshot',{effectiveDate:'2026-01-31',scope:'complete',source,holdings:[holdings[1],{...holdings[0],quantity:'1.00'}]});
  assert.equal(position(s,'2026-01-31').complete,true);
  s.apply('holdings-snapshot',{effectiveDate:'2026-01-31',scope:'complete',source,holdings:[holdings[1],{...holdings[0],quantity:'2'}]});
  assert.equal(position(s,'2026-01-31').accounts[0].holdings.status,'conflict');
});


test('unresolved post-closure source evidence cannot suppress stale-balance warnings as a closed account',()=>{
  const s=setup();const balanceEventId=s.balance('2026-01-31','0');
  s.apply('account-closure',{effectiveDate:'2026-01-31',balanceEventId,source});
  const accountId=s.ledger.accounts[0].accountId;
  const ledger=prepareCanonicalImport(s.ledger,{syntheticOnly:true,parsed:{sourceFormat:'sofi-csv-v1',institutionId:'sofi',fileFingerprint:'invented-post-closure-error',rowsSeen:1,ignoredCount:0,sourceAccountKeys:['default'],records:[{sourceAccountKey:'default',sourceFields:{Amount:'invalid'},rowOrdinal:1,physicalLine:2,sourceDescription:'INVENTED UNREADABLE ACTIVITY',normalizedDescription:'invented unreadable activity',sourceAction:'Payment',sourceRecordId:null,amountText:'invalid',currency:'USD',effectiveDate:'2026-02-15',postedDate:null,settlementDate:null,lifecycleStatus:'posted',valid:false,errorCode:'invalid-money'}]},accountMappings:{default:accountId},coverageByAccount:{[accountId]:{start:'2026-02-01',end:'2026-02-28',provenance:'user-confirmed'}}},s.options).ledger;
  assert.equal(ledger.activities.length,0);
  const report=buildFinancialPosition(ledger,{asOf:'2026-06-01'});
  assert.equal(report.complete,false);
  assert.ok(report.accounts[0].reasons.includes('closure-contradicted'));
  assert.ok(report.accounts[0].reasons.includes('stale-balance'));
  assert.equal(buildFinancialPosition(ledger,{asOf:'2026-01-31'}).accounts[0].status,'closed');
});

test('holdings that contradict zero closure cannot be hidden by closed-account exclusion',()=>{
  for(const effectiveDate of ['2026-01-31','2026-02-01']) {
    const s=setup('brokerage');const balanceEventId=s.balance('2026-01-31','0');
    s.apply('account-closure',{effectiveDate:'2026-01-31',balanceEventId,source});
    s.apply('holdings-snapshot',{effectiveDate,scope:'complete',source,holdings:[{symbol:'INVENTED',assetType:'stock',quantity:'1',valueText:'100'}]});
    const report=position(s,'2026-06-01');
    assert.equal(report.complete,false);
    assert.ok(report.accounts[0].reasons.includes('closure-contradicted'));
  }
});

test('new reconciliation can explicitly retain an older corroborating source identity',()=>{
  const s=setup();s.declare();
  const openingBalanceEventId=s.balance('2025-12-31','100'),closingBalanceEventId=s.balance('2026-01-31','100');
  s.balance('2025-12-31','100');s.balance('2026-01-31','100');
  s.apply('reconciliation',{month:'2026-01',openingBalanceEventId,closingBalanceEventId,source});
  assert.equal(s.ledger.positionEvents.at(-1).openingBalanceEventId,openingBalanceEventId);
  assert.equal(s.ledger.positionEvents.at(-1).closingBalanceEventId,closingBalanceEventId);
  assert.equal(buildAccountMonthCoverage(s.ledger,{month:'2026-01'}).complete,true);
  s.balance('2026-01-31','101');
  assert.throws(()=>s.apply('reconciliation',{month:'2026-01',openingBalanceEventId,closingBalanceEventId,source}),/selected-anchors/);
  const candidateEventIds=s.ledger.positionEvents.filter(e=>e.eventType==='balance-snapshot'&&e.effectiveDate==='2026-01-31').map(e=>e.eventId);
  s.apply('balance-resolution',{effectiveDate:'2026-01-31',candidateEventIds,selectedEventId:candidateEventIds.at(-1),reason:'Invented changed value'});
  assert.throws(()=>s.apply('reconciliation',{month:'2026-01',openingBalanceEventId,closingBalanceEventId,source}),/selected-anchors/);
});

test('new closure can explicitly retain an older equal zero source but requires the exact date',()=>{
  const s=setup();const balanceEventId=s.balance('2026-01-31','0');s.balance('2026-01-31','0');
  s.apply('account-closure',{effectiveDate:'2026-01-31',balanceEventId,source});
  assert.equal(s.ledger.positionEvents.at(-1).balanceEventId,balanceEventId);
  assert.equal(position(s,'2026-01-31').accounts[0].status,'closed');
  assert.throws(()=>s.apply('account-closure',{effectiveDate:'2026-02-01',balanceEventId,source}),/zero-balance/);
  s.balance('2026-01-31','1');
  assert.throws(()=>s.apply('account-closure',{effectiveDate:'2026-01-31',balanceEventId,source}),/zero-balance/);
});
