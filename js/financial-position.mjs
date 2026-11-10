import {validateLedger,getEffectiveActivities} from './canonical-import.mjs';
import {isCalendarDate,exactSignedDecimal} from './import-reconciliation.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';
import {LIABILITY_TYPES,INVESTMENT_TYPES,SUPPORTED_HOLDINGS,exactAmount,addExact,negateExact,equalExact,monthBounds,selectBalance} from './financial-position-contract.mjs';

const fail=message=>{throw new TypeError(message);};
const eventsFor=ledger=>ledger.positionEvents??[];
// Posted evidence owns balance movement; refund activity dates cannot substitute
// for missing posting evidence. Other source-effective dates remain the fallback.
const movementDate=activity=>activity.activityKind==='refund'?activity.postedDate:activity.postedDate??activity.effectiveDate;
function selectedAccounts(ledger,accountIds) {
  if(accountIds===undefined)return ledger.accounts;
  if(!Array.isArray(accountIds)||new Set(accountIds).size!==accountIds.length)fail('invalid-position-account-scope');
  return accountIds.map(id=>ledger.accounts.find(a=>a.accountId===id)??fail('unknown-position-account'));
}
function commandPayload(command,account) {
  const {type,commandId,accountId,...data}=structuredClone(command);
  if(type==='balance-snapshot') {data.currency=account.currency;data.amountText=exactAmount(data.amountText,account.currency);}
  if(type==='holdings-snapshot') {data.currency=account.currency;data.scope??='partial';data.holdings=data.holdings.map(h=>({...h,valueText:exactAmount(h.valueText,account.currency)}));}
  if(type==='reconciliation') {data.method??='cash-rollforward';data.scope??='account-total';data.components=(data.components??[]).map(c=>({...c,amountText:exactAmount(c.amountText,account.currency)}));}
  return {eventType:type,commandId,accountId,...data};
}
export function applyPositionEvent(ledger,command,options={}) {
  validateLedger(ledger);
  if(!command||typeof command!=='object')fail('invalid-position-command');
  const account=ledger.accounts.find(a=>a.accountId===command.accountId)??fail('unknown-position-account');
  const payload=commandPayload(command,account);
  const prior=eventsFor(ledger).find(e=>e.commandId===command.commandId);
  if(prior) {
    const {eventId,recordedAt,appendOnly,...oldPayload}=prior;
    if(canonicalizeJcs(payload)!==canonicalizeJcs(oldPayload))fail('position-command-conflict');
    return structuredClone(ledger);
  }
  const next=structuredClone(ledger);
  const event={...payload,eventId:(options.idFactory??(()=>globalThis.crypto.randomUUID()))(),recordedAt:typeof options.now==='function'?options.now():options.now??new Date().toISOString(),appendOnly:true};
  (next.positionEvents??=[]).push(event);
  validateLedger(next);
  return next;
}
function holdingsAt(events,account,asOf,balance) {
  if(!INVESTMENT_TYPES.includes(account.accountType))return null;
  const all=events.filter(e=>e.eventType==='holdings-snapshot'&&e.accountId===account.accountId&&e.effectiveDate<=asOf);
  const latest=all.map(e=>e.effectiveDate).sort().at(-1);
  const candidates=all.filter(e=>e.effectiveDate===latest);
  const resolution=events.filter(e=>e.eventType==='holdings-resolution'&&e.accountId===account.accountId&&e.effectiveDate===latest).at(-1);
  const resolved=resolution&&candidates.length===resolution.candidateEventIds.length&&candidates.every(e=>resolution.candidateEventIds.includes(e.eventId));
  const selected=resolved?candidates.find(e=>e.eventId===resolution.selectedEventId):candidates.at(-1);
  if(!selected)return null;
  const reasons=[];
  if(!resolved&&candidates.some(e=>canonicalizeJcs(e.holdings)!==canonicalizeJcs(selected.holdings)||e.scope!==selected.scope))reasons.push('conflicting-holdings');
  if(selected.scope!=='complete')reasons.push('partial-holdings');
  if(selected.holdings.some(h=>!SUPPORTED_HOLDINGS.includes(h.assetType)))reasons.push('unsupported-holding-type');
  const total=selected.holdings.reduce((sum,h)=>addExact(sum,h.valueText),'0');
  if(balance&&selected.scope==='complete'&&selected.effectiveDate===balance.effectiveDate&&!equalExact(total,balance.amountText))reasons.push('holdings-balance-discrepancy');
  const ageDays=(Date.parse(asOf)-Date.parse(selected.effectiveDate))/86400000;
  return {eventId:selected.eventId,selectedEventId:reasons.includes('conflicting-holdings')?null:selected.eventId,status:reasons.includes('conflicting-holdings')?'conflict':'known',candidateEventIds:candidates.map(e=>e.eventId),effectiveDate:selected.effectiveDate,scope:selected.scope,source:structuredClone(selected.source),holdings:structuredClone(selected.holdings),total,ageDays,stale:ageDays>35,reasons};
}
export function buildFinancialPosition(ledger,{asOf,accountIds}={}) {
  validateLedger(ledger);if(!isCalendarDate(asOf))fail('invalid-position-as-of');
  const selected=selectedAccounts(ledger,accountIds), events=eventsFor(ledger), activities=getEffectiveActivities(ledger);
  const accounts=selected.map(account=>{
    const selection=selectBalance(events,account.accountId,asOf), balance=selection.selected;
    const role=LIABILITY_TYPES.includes(account.accountType)?'liability':['checking','savings',...INVESTMENT_TYPES].includes(account.accountType)?'asset':'unknown';
    const reasons=[];
    if(!balance)reasons.push(selection.conflict?'conflicting-balances':'missing-balance');
    if(role==='unknown')reasons.push('unknown-account-scope');
    const ageDays=balance?(Date.parse(asOf)-Date.parse(balance.effectiveDate))/86400000:null;
    const stale=ageDays!==null&&ageDays>35;if(stale)reasons.push('stale-balance');
    let status=selection.conflict?'conflict':balance?'known':'missing';
    const closure=events.filter(e=>e.eventType==='account-closure'&&e.accountId===account.accountId&&e.effectiveDate<asOf).at(-1);
    if(closure) {
      const closureSelection=selectBalance(events,account.accountId,closure.effectiveDate);
      const laterActivity=activities.some(a=>a.accountId===account.accountId&&a.active&&(movementDate(a)===null||(movementDate(a)>closure.effectiveDate&&movementDate(a)<=asOf)));
      const laterNonzero=events.some(e=>e.eventType==='balance-snapshot'&&e.accountId===account.accountId&&e.effectiveDate>closure.effectiveDate&&e.effectiveDate<=asOf&&!equalExact(e.amountText,'0'));
      if(balance&&equalExact(balance.amountText,'0')&&closureSelection.selected?.eventId===closure.balanceEventId&&!laterActivity&&!laterNonzero) {status='closed';reasons.splice(0,reasons.length);}
      else reasons.push('closure-contradicted');
    }
    const holdings=holdingsAt(events,account,asOf,balance);
    if(status!=='closed'&&holdings)reasons.push(...holdings.reasons.filter(r=>r!=='partial-holdings'));
    return {accountId:account.accountId,displayName:account.displayName,accountType:account.accountType,currency:account.currency,role,status,balance:balance?.amountText??null,balanceDate:balance?.effectiveDate??selection.candidates[0]?.effectiveDate??null,basis:balance?.basis??null,source:balance?structuredClone(balance.source):null,selectedEventId:balance?.eventId??null,candidateEventIds:selection.candidates.map(e=>e.eventId),ageDays,stale,reasons,holdings};
  });
  const currencies=[...new Set(accounts.map(a=>a.currency))].sort().map(currency=>{
    const subset=accounts.filter(a=>a.currency===currency&&a.status!=='closed');
    const reasons=[...new Set(subset.flatMap(a=>a.reasons))];
    const knownAssets=subset.filter(a=>a.role==='asset'&&a.balance!==null).reduce((sum,a)=>addExact(sum,a.balance),'0');
    const knownLiabilities=subset.filter(a=>a.role==='liability'&&a.balance!==null).reduce((sum,a)=>addExact(sum,a.balance),'0');
    const knownNetWorth=addExact(knownAssets,negateExact(knownLiabilities)),complete=reasons.length===0;
    return {currency,knownAssets,knownLiabilities,knownNetWorth,netWorth:complete?knownNetWorth:null,complete,reasons};
  });
  const reasons=[...new Set(accounts.flatMap(a=>a.reasons))];if(!accounts.length)reasons.push('empty-account-scope');
  return {asOf,accounts,currencies,complete:reasons.length===0,reasons};
}
function declaredMonth(runs,start,end) {
  let next=start;
  for(const run of [...runs].sort((a,b)=>a.declaredCoverage.start.localeCompare(b.declaredCoverage.start))) {
    const interval=run.declaredCoverage;if(interval.end<next)continue;if(interval.start>next)return false;
    if(interval.end>=end)return true;
    const date=new Date(interval.end+'T00:00:00.000Z');date.setUTCDate(date.getUTCDate()+1);next=date.toISOString().slice(0,10);
  }
  return false;
}
export function buildAccountMonthCoverage(ledger,{month,accountIds}={}) {
  validateLedger(ledger);const {start,end,opening}=monthBounds(month),selected=selectedAccounts(ledger,accountIds),events=eventsFor(ledger),activities=getEffectiveActivities(ledger);
  const accounts=selected.map(account=>{
    const runs=ledger.imports.filter(r=>r.accountId===account.accountId&&r.declaredCoverage.start<=end&&r.declaredCoverage.end>=start);
    const request=events.filter(e=>e.eventType==='reconciliation'&&e.accountId===account.accountId&&e.month===month).at(-1);
    const declared=declaredMonth(runs,start,end)||request?.statementCoverage!==undefined;
    const unknownSourceDate=o=>!isCalendarDate(o.candidate.effectiveDate)||(o.candidate.postedDate!=null&&!isCalendarDate(o.candidate.postedDate));
    const sourceDatesInMonth=o=>[o.candidate.effectiveDate,o.candidate.postedDate].some(date=>isCalendarDate(date)&&date>=start&&date<=end);
    const observations=ledger.observations.filter(o=>o.accountId===account.accountId&&(unknownSourceDate(o)||sourceDatesInMonth(o)));
    const accountActivities=activities.filter(a=>a.accountId===account.accountId&&a.active);
    const inMonth=accountActivities.filter(a=>movementDate(a)!==null&&movementDate(a)>=start&&movementDate(a)<=end);
    const observed=observations.some(sourceDatesInMonth);
    const reasons=[];
    if(!declared)reasons.push('missing-declared-coverage');
    if(accountActivities.some(a=>a.activityKind==='refund'&&a.postedDate===null))reasons.push('missing-refund-posted-date');
    if(observations.some(unknownSourceDate))reasons.push('unknown-source-date');
    if(observations.some(o=>!o.resolved&&['review','rejected'].includes(o.disposition)))reasons.push('unresolved-source-observation');
    if(inMonth.some(a=>['unknown','reversed'].includes(a.lifecycleStatus)))reasons.push('unresolved-activity-lifecycle');
    if(inMonth.some(a=>a.lifecycleStatus==='pending'))reasons.push('pending-activity');
    if(inMonth.some(a=>['posted','corrected'].includes(a.lifecycleStatus)&&(exactSignedDecimal(a)===null||a.currency!==account.currency)))reasons.push('unknown-activity-amount');
    let discrepancy=null;
    if(!request)reasons.push('reconciliation-required');
    else {
      const open=selectBalance(events,account.accountId,opening),close=selectBalance(events,account.accountId,end);
      if(open.conflict||close.conflict)reasons.push('conflicting-balance-anchors');
      if(open.selected?.eventId!==request.openingBalanceEventId||close.selected?.eventId!==request.closingBalanceEventId)reasons.push('superseded-balance-anchors');
      const first=events.find(e=>e.eventId===request.openingBalanceEventId),last=events.find(e=>e.eventId===request.closingBalanceEventId);
      let movement='0';
      if(request.method==='cash-rollforward') {
        if(!['checking','savings','credit-card'].includes(account.accountType))reasons.push('unsupported-reconciliation-method');
        for(const a of inMonth) {
          if(!['posted','corrected'].includes(a.lifecycleStatus))continue;
          const value=exactSignedDecimal(a);
          if(value===null||a.currency!==account.currency) {reasons.push('unknown-activity-amount');continue;}
          movement=addExact(movement,account.accountType==='credit-card'?negateExact(value):value);
        }
      } else {
        if(![...INVESTMENT_TYPES,'mortgage','auto-loan'].includes(account.accountType))reasons.push('unsupported-reconciliation-method');
        movement=request.components.reduce((sum,c)=>addExact(sum,c.amountText),'0');
      }
      discrepancy=addExact(addExact(first.amountText,movement),negateExact(last.amountText));
      if(!equalExact(discrepancy,'0'))reasons.push('balance-discrepancy');
      const holdings=holdingsAt(events,account,end,last);
      if(holdings)reasons.push(...holdings.reasons.filter(r=>r!=='partial-holdings'));
    }
    const unique=[...new Set(reasons)],complete=unique.length===0;
    const blocking=unique.some(r=>!['reconciliation-required','missing-declared-coverage'].includes(r));
    return {accountId:account.accountId,state:complete?'reconciled-complete':blocking||request?'incomplete':observed?'observed':declared?'declared':'incomplete',declared,observed,complete,reasons:unique,openingBalanceEventId:request?.openingBalanceEventId??null,closingBalanceEventId:request?.closingBalanceEventId??null,discrepancy};
  });
  const reasons=[...new Set(accounts.flatMap(a=>a.reasons))];if(!accounts.length)reasons.push('empty-account-scope');
  return {month,accounts,complete:reasons.length===0,reasons};
}
