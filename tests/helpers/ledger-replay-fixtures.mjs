import {createLedger,registerAccount,prepareCanonicalImport} from '../../js/canonical-import.mjs';
export const replayOptions=()=>{let n=0;return {now:()=> '2026-11-08T00:00:00.000Z',idFactory:()=>`c0de0001-0000-4000-8000-${String(++n).padStart(12,'0')}`};};
export const replayRow=(i=0,extra={})=>({sourceAccountKey:'default',sourceFields:{Description:`INVENTED SHOP ${i}`,Amount:'-12.34'},
  rowOrdinal:i+1,physicalLine:i+2,sourceDescription:`INVENTED SHOP ${i}`,normalizedDescription:`invented shop ${i}`,
  sourceAction:'Card purchase',sourceRecordId:null,amountText:'-12.34',currency:'USD',effectiveDate:'2026-01-15',
  postedDate:null,settlementDate:null,lifecycleStatus:'posted',valid:true,errorCode:null,...extra});
export const replayInput=(account,records,fingerprint='invented-replay')=>({syntheticOnly:true,
  parsed:{sourceFormat:'sofi-csv-v1',institutionId:account.institutionId,fileFingerprint:fingerprint,
    rowsSeen:records.length,ignoredCount:0,records,sourceAccountKeys:['default'],sourceCoverage:null},
  accountMappings:{default:account.accountId},coverageByAccount:{[account.accountId]:{start:'2026-01-01',end:'2026-12-31',provenance:'source-confirmed'}}});
export function replayFixture(size=1,records=Array.from({length:size},(_,i)=>replayRow(i))) {
  const options=replayOptions();
  let ledger=registerAccount(createLedger(options),{institutionId:'sofi',name:'Invented replay account',currency:'USD',accountType:'checking'},options);
  ledger=prepareCanonicalImport(ledger,replayInput(ledger.accounts[0],records),options).ledger;
  return {ledger,options};
}
