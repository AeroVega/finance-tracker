import {isCalendarDate, parseMoney, exactSignedDecimal} from './import-reconciliation.mjs';
import {canonicalizeJcs} from './transaction-protocol.mjs';

const fail = message => { throw new TypeError(message); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LIABILITY_TYPES = ['credit-card','mortgage','auto-loan'];
export const INVESTMENT_TYPES = ['brokerage','retirement'];
export const SUPPORTED_HOLDINGS = ['stock','bond','mutual-fund','etf','cash'];
const common = ['eventId','eventType','commandId','recordedAt','accountId','appendOnly'];
const fields = {
  'balance-snapshot':['effectiveDate','amountText','currency','basis','source'],
  'balance-resolution':['effectiveDate','selectedEventId','candidateEventIds','reason'],
  'holdings-resolution':['effectiveDate','selectedEventId','candidateEventIds','reason'],
  'holdings-snapshot':['effectiveDate','currency','scope','holdings','source'],
  'account-closure':['effectiveDate','balanceEventId','source'],
  reconciliation:['month','openingBalanceEventId','closingBalanceEventId','source','method','scope','components','statementCoverage']
};
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
export function exactAmount(text, currency) { return exactSignedDecimal(parseMoney(text,currency)); }
function decimal(text) { const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text); if (!m) fail('invalid-position-amount'); return {n:BigInt(m[1]+m[2]+(m[3]??'')),s:(m[3]??'').length}; }
export function addExact(a,b) { const x=decimal(a), y=decimal(b), s=Math.max(x.s,y.s); const n=x.n*10n**BigInt(s-x.s)+y.n*10n**BigInt(s-y.s); const digits=(n<0n?-n:n).toString().padStart(s+1,'0'); return (n<0n?'-':'')+(s?digits.slice(0,-s)+'.'+digits.slice(-s):digits); }
export const negateExact = a => a.startsWith('-') ? a.slice(1) : '-'+a;
export const equalExact = (a,b) => decimal(addExact(a,negateExact(b))).n===0n;
export const negativeExact = a => decimal(a).n<0n;
export function monthBounds(month) {
  if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||!isCalendarDate(month+'-01')) fail('invalid-position-month');
  const start=month+'-01', date=new Date(start+'T00:00:00.000Z');
  date.setUTCMonth(date.getUTCMonth()+1);date.setUTCDate(0);
  const end=date.toISOString().slice(0,10);const previous=new Date(start+'T00:00:00.000Z');previous.setUTCDate(0);
  return {start,end,opening:previous.toISOString().slice(0,10)};
}
function source(value,ledger,accountId) {
  if(!keys(value,['kind','reference','importRunId']) || !['statement','manual','import'].includes(value.kind) || !nonempty(value.reference)) fail('invalid-position-source');
  if(value.kind==='import' && !ledger.imports.some(run=>run.importRunId===value.importRunId&&run.accountId===accountId)) fail('invalid-position-source-import');
  if(value.kind!=='import'&&value.importRunId!==undefined) fail('invalid-position-source-import');
}
function money(text,currency) {if(typeof text!=='string'||text!==exactAmount(text,currency)) fail('invalid-position-money');}
export function selectBalance(events,accountId,asOf) {
  const candidates=events.filter(e=>e.eventType==='balance-snapshot'&&e.accountId===accountId&&e.effectiveDate<=asOf);
  const date=candidates.map(e=>e.effectiveDate).sort().at(-1);
  const onDate=candidates.filter(e=>e.effectiveDate===date);
  if(!onDate.length)return {selected:null,candidates:[],conflict:false};
  const resolution=events.filter(e=>e.eventType==='balance-resolution'&&e.accountId===accountId&&e.effectiveDate===date).at(-1);
  const covered=resolution && onDate.every(e=>resolution.candidateEventIds.includes(e.eventId)) && resolution.candidateEventIds.length===onDate.length;
  const conflict=!covered&&onDate.some(e=>!equalExact(e.amountText,onDate[0].amountText));
  return {selected:conflict?null:covered?onDate.find(e=>e.eventId===resolution.selectedEventId):onDate.at(-1),candidates:onDate,conflict};
}

// Corroborating records add provenance without invalidating an anchor's value.
// A changed date, unresolved conflict, or selected different amount still revokes it.
export function supportsBalanceAnchor(selection,eventId) {
  const anchor=selection.candidates.find(e=>e.eventId===eventId);
  return Boolean(anchor&&selection.selected&&equalExact(anchor.amountText,selection.selected.amountText));
}

// This boundary has no dependency on canonical replay. References are validated
// in append order. Completeness is always derived, never trusted from a record.
export function validatePositionEvents(ledger, existingIds=new Set(), existingCommands=new Map()) {
  if(ledger.positionEvents===undefined)return true;
  if(!Array.isArray(ledger.positionEvents))fail('invalid-position-events');
  const seen=[], ids=new Set(existingIds), commands=new Set(existingCommands.keys());
  for(const e of ledger.positionEvents) {
    if(!e || !fields[e.eventType] || !keys(e,[...common,...fields[e.eventType]]) || !uuid.test(e.eventId)||ids.has(e.eventId)||!nonempty(e.commandId)||commands.has(e.commandId)||e.appendOnly!==true||typeof e.recordedAt!=='string'||!Number.isFinite(Date.parse(e.recordedAt)))fail('invalid-position-event');
    const account=ledger.accounts.find(a=>a.accountId===e.accountId);if(!account)fail('unknown-position-account');
    ids.add(e.eventId);commands.add(e.commandId);
    if(e.eventType!=='reconciliation'&&!isCalendarDate(e.effectiveDate))fail('invalid-position-date');
    if(e.source)source(e.source,ledger,e.accountId);
    if(['balance-snapshot','holdings-snapshot','account-closure','reconciliation'].includes(e.eventType)&&!e.source)fail('position-source-required');
    if(e.eventType==='balance-snapshot') {
      if(e.currency!==account.currency||!['statement','manual','provider'].includes(e.basis))fail('invalid-position-basis');
      money(e.amountText,e.currency);
      if(LIABILITY_TYPES.includes(account.accountType)&&negativeExact(e.amountText))fail('liability-balance-must-be-positive');
    } else if(['balance-resolution','holdings-resolution'].includes(e.eventType)) {
      const snapshotType=e.eventType==='balance-resolution'?'balance-snapshot':'holdings-snapshot';
      const candidates=seen.filter(x=>x.accountId===e.accountId&&x.eventType===snapshotType&&x.effectiveDate===e.effectiveDate).map(x=>x.eventId);
      if(!nonempty(e.reason)||!Array.isArray(e.candidateEventIds)||new Set(e.candidateEventIds).size!==e.candidateEventIds.length||candidates.length<2||canonicalizeJcs([...candidates].sort())!==canonicalizeJcs([...e.candidateEventIds].sort())||!candidates.includes(e.selectedEventId))fail('invalid-balance-resolution');
    } else if(e.eventType==='holdings-snapshot') {
      if(!INVESTMENT_TYPES.includes(account.accountType)||e.currency!==account.currency||!['complete','partial'].includes(e.scope)||!Array.isArray(e.holdings))fail('invalid-holdings-snapshot');
      const symbols=new Set();
      for(const h of e.holdings) {
        if(!keys(h,['symbol','assetType','quantity','valueText'])||!nonempty(h.symbol)||symbols.has(h.symbol)||!nonempty(h.assetType)||typeof h.quantity!=='string'||!/^\d+(?:\.\d+)?$/.test(h.quantity))fail('invalid-holding');
        symbols.add(h.symbol);money(h.valueText,e.currency);if(negativeExact(h.valueText))fail('negative-holding-value');
      }
    } else if(e.eventType==='account-closure') {
      const selection=selectBalance(seen,e.accountId,e.effectiveDate),selected=selection.selected;
      if(!supportsBalanceAnchor(selection,e.balanceEventId)||selected.effectiveDate!==e.effectiveDate||!equalExact(selected.amountText,'0'))fail('closure-requires-selected-zero-balance');
    } else if(e.eventType==='reconciliation') {
      const bounds=monthBounds(e.month);
      const anchor=(id,date)=>seen.find(x=>x.eventId===id&&x.eventType==='balance-snapshot'&&x.accountId===e.accountId&&x.effectiveDate===date);
      if(!anchor(e.openingBalanceEventId,bounds.opening)||!anchor(e.closingBalanceEventId,bounds.end))fail('invalid-reconciliation-anchors');
      if(!supportsBalanceAnchor(selectBalance(seen,e.accountId,bounds.opening),e.openingBalanceEventId)||!supportsBalanceAnchor(selectBalance(seen,e.accountId,bounds.end),e.closingBalanceEventId))fail('reconciliation-requires-selected-anchors');
      if(!['cash-rollforward','statement-components'].includes(e.method)||e.scope!=='account-total'||!Array.isArray(e.components))fail('invalid-reconciliation-method');
      if(e.method==='cash-rollforward'&&e.components.length)fail('cash-reconciliation-cannot-add-components');
      if(e.method==='statement-components'&&e.source.kind!=='statement')fail('statement-reconciliation-evidence-required');
      if(e.statementCoverage!==undefined) {
        if(e.method!=='statement-components'||e.source.kind!=='statement'||![...INVESTMENT_TYPES,'mortgage','auto-loan'].includes(account.accountType)||!keys(e.statementCoverage,['start','end'])||e.statementCoverage.start!==bounds.start||e.statementCoverage.end!==bounds.end)fail('invalid-statement-coverage');
      }
      for(const c of e.components) {
        if(!keys(c,['kind','amountText','source'])||!['principal-change','market-value-change','cash-flow','fees','other'].includes(c.kind)||c.source?.kind!=='statement')fail('invalid-reconciliation-component');
        source(c.source,ledger,e.accountId);money(c.amountText,account.currency);
      }
    }
    seen.push(e);
  }
  return true;
}
