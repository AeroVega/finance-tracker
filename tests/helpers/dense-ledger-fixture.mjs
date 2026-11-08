import * as canonical from '../../js/canonical-import.mjs';
import {replayRow} from './ledger-replay-fixtures.mjs';
const money = cents => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
export const denseOptions = () => { let i=0; return {now:()=> '2026-11-08T00:00:00.000Z',idFactory:()=>`de050001-0000-4000-8000-${String(++i).padStart(12,'0')}`}; };
/** Deliberately invented parsed rows, not real exports or claims about provider adapters. */
export function denseLedgerFixture(years=1, api=canonical) {
  if (![1,5,10].includes(years)) throw new TypeError('unsupported-fixture-years');
  const options=denseOptions(), start='2015-01-01', end=`${2014+years}-12-31`;
  let ledger=api.createLedger(options);
  const definitions=[['checking','sofi','checking'],['savings','sofi','savings'],['card','sofi','credit-card'],['investment','fidelity','brokerage']];
  const rows=Object.fromEntries(definitions.map(([key])=>[key,[]]));
  const add=(key,date,label,cents,kind,category,extra={})=>rows[key].push({date,label:`INVENTED ${label}`,cents,kind,category,...extra});
  for(let year=2015;year<2015+years;year++) for(let month=1;month<=12;month++) {
    const date=day=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    add('checking',date(1),'SALARY FIRST',450000,'income','salary');
    add('checking',date(15),'SALARY SECOND',450000,'income','salary');
    add('checking',date(2),'RENT',-190000,'spending','housing');
    add('checking',date(5),'UTILITY',-15575,'spending','utilities',{correction:-15075});
    add('checking',date(16),'SAVINGS OUT',-50000,'transfer','internal-transfer');
    add('savings',date(16),'SAVINGS IN',50000,'transfer','internal-transfer');
    add('savings',date(28),'INTEREST',1250+month,'income','interest');
    let purchases=0;
    for(let i=0;i<180;i++) {
      const cents=123+i*17+month;
      add('card',date(1+i%27),`SHOP ${i}`, -cents,'spending',['groceries','dining','transport','household'][i%4]); purchases+=cents;
    }
    add('card',date(28),'PARTIAL REFUND',51,'refund','groceries',{refund:true,originalDate:date(1)});
    add('checking',date(28),'CARD PAYMENT SENT',-(purchases-51),'transfer','card-payment');
    add('card',date(28),'CARD PAYMENT RECEIVED',purchases-51,'transfer','card-payment');
    add('checking',date(17),'INVESTMENT OUT',-40000,'transfer','investment-contribution');
    for(const [label,cents] of [['CONTRIBUTION',40000],['BUY',-40000],['DIVIDEND',1200],['FEE',-200]]) add('investment',date(18),label,cents,null,null);
  }
  const plans=[];
  for(const [key,institutionId,accountType] of definitions) {
    ledger=api.registerAccount(ledger,{institutionId,accountType,displayName:`Invented dense ${key}`,currency:'USD'},options);
    const accountId=ledger.accounts.at(-1).accountId;
    const records=rows[key].map((row,i)=>replayRow(i,{sourceDescription:row.label,normalizedDescription:row.label.toLowerCase(),sourceFields:{Description:row.label,Amount:money(row.cents)},sourceRecordId:`invented:${key}:${i}`,sourceAction:key==='investment'?row.label:'posted',amountText:money(row.cents),effectiveDate:row.date,lifecycleStatus:key==='investment'?'unknown':'posted'}));
    const input={syntheticOnly:true,parsed:{sourceFormat:key==='investment'?'fidelity-accounts-history-csv-v1':'sofi-csv-v1',institutionId,fileFingerprint:`dense:${years}:${key}`,rowsSeen:records.length,ignoredCount:0,records,sourceAccountKeys:['default'],sourceCoverage:null},accountMappings:{default:accountId},coverageByAccount:{[accountId]:{start,end,provenance:'source-confirmed'}}};
    ledger=api.prepareCanonicalImport(ledger,input,options).ledger;
    plans.push({key,accountId});
  }
  const commands=[];
  for(const {key,accountId} of plans) {
    const activities=ledger.activities.filter(a=>a.accountId===accountId);
    const originals=new Map(activities.filter(a=>a.sourceDescription==='INVENTED SHOP 0').map(a=>[a.effectiveDate,a.activityId]));
    rows[key].forEach((row,i)=>{
      if(!row.kind) return;
      const activityId=activities[i].activityId;
      commands.push({type:'classification',activityId,activityKind:row.kind,categoryId:row.category,commandId:`dense:${activityId}:classify`});
      if(row.correction) commands.push({type:'bank-correction',evidence:{reason:'Invented utility correction'},activityId,amountText:money(row.correction),commandId:`dense:${activityId}:correct`});
      if(row.refund) commands.push({type:'refund-link',evidence:{reason:'Invented partial refund'},activityId,originalActivityId:originals.get(row.originalDate),confirmedPostedDate:row.date,commandId:`dense:${activityId}:refund`});
    });
  }
  ledger=api.applyFinancialEvents(ledger,commands,options);
  api.validateLedger(ledger);
  return {ledger,range:{start,end,currency:'USD'},syntheticOnly:true};
}
