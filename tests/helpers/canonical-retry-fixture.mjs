import * as current from '../../js/canonical-import.mjs';
export const options=(start=0)=>{let n=start;return {now:()=> '2026-11-06T00:00:00.000Z',idFactory:()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`};};
export function fixture(size,api=current) {
  const opt=options();
  let ledger=api.createLedger(opt);
  ledger=api.registerAccount(ledger,{institutionId:'sofi',displayName:'Invented retry account',currency:'USD',accountType:'checking'},opt);
  const accountId=ledger.accounts[0].accountId;
  const records=Array.from({length:size},(_,i)=>({sourceAccountKey:'default',sourceFields:{Description:`INVENTED ${i}`,Amount:'-12.34'},rowOrdinal:i+1,physicalLine:i+2,sourceDescription:`INVENTED ${i}`,normalizedDescription:`invented ${i}`,sourceAction:'Card purchase',sourceRecordId:null,amountText:'-12.34',currency:null,effectiveDate:'2026-01-15',postedDate:null,settlementDate:null,lifecycleStatus:'posted',valid:true,errorCode:null}));
  const input={syntheticOnly:true,parsed:{sourceFormat:'sofi-csv-v1',institutionId:'sofi',fileFingerprint:'invented-base',records,sourceAccountKeys:['default']},accountMappings:{default:accountId},coverageByAccount:{[accountId]:{start:'2026-01-01',end:'2026-02-28',provenance:'user-confirmed'}}};
  ledger=api.prepareCanonicalImport(ledger,input,opt).ledger;
  input.parsed.fileFingerprint='invented-overlap';
  // Include an accepted row and a malformed row alongside the overlap reviews.
  input.parsed.records=[...records,{...records[0],rowOrdinal:size+1,sourceDescription:'INVENTED NEW',normalizedDescription:'invented new'}, {...records[0],rowOrdinal:size+2,valid:false,errorCode:'bad-date',effectiveDate:null}];
  ledger=api.prepareCanonicalImport(ledger,input,opt).ledger;
  return {ledger,input};
}
export function lifecycleFixture(size,api=current) {
  const {input}=fixture(1,api),opt=options();
  let ledger=api.createLedger(opt);
  ledger=api.registerAccount(ledger,{institutionId:'sofi',displayName:'Invented lifecycle account',currency:'USD',accountType:'checking'},opt);
  const template=input.parsed.records[0];
  input.parsed.fileFingerprint='invented-pending';
  input.parsed.records=Array.from({length:size},(_,i)=>({...template,rowOrdinal:i+1,sourceRecordId:`invented-source-${i}`,sourceDescription:`INVENTED ${i}`,normalizedDescription:`invented ${i}`,sourceFields:{Description:`INVENTED ${i}`},amountText:'-12.34',effectiveDate:'2026-01-15',valid:true,errorCode:null,lifecycleStatus:'pending'}));
  ledger=api.prepareCanonicalImport(ledger,input,opt).ledger;
  input.parsed.fileFingerprint='invented-posted';
  input.parsed.records=input.parsed.records.map(r=>({...r,lifecycleStatus:'posted',effectiveDate:'2026-01-17',postedDate:'2026-01-17'}));
  return {ledger,input};
}
