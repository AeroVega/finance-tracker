// Invented planning fixtures: accounts, imported monthly rows, classifications,
// transfer links and reconciled months. Every name and amount is made up.
import {createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvents} from '../../js/canonical-import.mjs';
import {applyPositionEvent} from '../../js/financial-position.mjs';

const formats = {'wells-fargo':'wells-fargo-csv-v1', sofi:'sofi-csv-v1'};
const cents = text => { const [w, f = ''] = text.replace('-', '').split('.'); return (text.startsWith('-') ? -1 : 1) * (Number(w) * 100 + Number((f + '00').slice(0, 2))); };
const text = value => `${value < 0 ? '-' : ''}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, '0')}`;
export const monthEnd = month => { const [y, m] = month.split('-').map(Number); return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const previousEnd = month => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1, 0)); return d.toISOString().slice(0, 10); };

/**
 * accounts: [{key, type, institution, opening}]
 * coverage: {key: {month: endDate}}; a month listed imports [month-01, endDate].
 * rows: [{account, date, amount, kind, category, description, transferTo}]
 * reconcile: {key: [month, ...]} reconciles those months with derived balances.
 */
export function planningLedger({accounts, coverage, rows, reconcile = {}, now = '2026-11-20T12:00:00.000Z'}) {
  let n = 0;
  const options = {now:() => now, idFactory:() => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`};
  let ledger = createLedger(options);
  const ids = {};
  for (const account of accounts) {
    ledger = registerAccount(ledger, {institutionId:account.institution ?? 'sofi', displayName:`Invented ${account.key}`, currency:'USD', accountType:account.type}, options);
    ids[account.key] = ledger.accounts.at(-1).accountId;
  }
  const activityFor = new Map();
  for (const account of accounts) {
    for (const [month, end] of Object.entries(coverage[account.key] ?? {})) {
      const monthRows = rows.filter(row => row.account === account.key && row.date.slice(0, 7) === month);
      const institutionId = account.institution ?? 'sofi';
      const parsed = {sourceFormat:formats[institutionId], institutionId, fileFingerprint:`invented-${account.key}-${month}`,
        rowsSeen:monthRows.length, ignoredCount:0, sourceAccountKeys:['default'],
        records:monthRows.map((row, i) => ({sourceAccountKey:'default', sourceFields:{Amount:row.amount, Row:`${account.key}-${month}-${i}`}, rowOrdinal:i + 1, physicalLine:i + 2,
          sourceDescription:row.description ?? `INVENTED ${row.category ?? row.kind} ${i}`.toUpperCase(),
          normalizedDescription:(row.description ?? `invented ${row.category ?? row.kind} ${i}`).toLowerCase(),
          sourceAction:'Payment', sourceRecordId:null, amountText:row.amount, currency:'USD', effectiveDate:row.date, postedDate:row.date,
          settlementDate:null, lifecycleStatus:'posted', valid:true, errorCode:null}))};
      ledger = prepareCanonicalImport(ledger, {syntheticOnly:true, parsed, accountMappings:{default:ids[account.key]},
        coverageByAccount:{[ids[account.key]]:{start:`${month}-01`, end, provenance:'user-confirmed'}}}, options).ledger;
      const created = ledger.activities.slice(-monthRows.length);
      monthRows.forEach((row, i) => activityFor.set(row, created[i].activityId));
    }
  }
  const commands = [];
  for (const row of rows) {
    const activityId = activityFor.get(row);
    if (!activityId || !row.kind) continue;
    commands.push({type:'classification', activityId, activityKind:row.kind, categoryId:row.category ?? null,
      commandId:`classify-${activityId}`, evidence:{reason:'Invented fixture classification.'}});
  }
  ledger = applyFinancialEvents(ledger, commands, options);
  const links = [];
  for (const row of rows.filter(row => row.transferTo)) {
    links.push({type:'transfer-link', activityId:activityFor.get(row), counterpartyActivityId:activityFor.get(row.transferTo),
      commandId:`link-${activityFor.get(row)}`, evidence:{rationale:'Invented transfer pair.'}});
  }
  if (links.length) ledger = applyFinancialEvents(ledger, links, options);
  let command = 0;
  for (const account of accounts) {
    let balance = cents(account.opening ?? '1000.00');
    const byDate = new Map();
    const snapshot = (date, amount) => {
      if (byDate.has(date)) return byDate.get(date);
      ledger = applyPositionEvent(ledger, {type:'balance-snapshot', commandId:`balance-${++command}`, accountId:ids[account.key], effectiveDate:date,
        amountText:text(amount), basis:'statement', source:{kind:'statement', reference:'Invented statement'}}, options);
      byDate.set(date, ledger.positionEvents.at(-1).eventId);
      return byDate.get(date);
    };
    const months = Object.keys(coverage[account.key] ?? {}).sort();
    for (const month of months) {
      const opening = balance;
      for (const row of rows.filter(row => row.account === account.key && row.date.slice(0, 7) === month)) balance += cents(row.amount);
      if (!(reconcile[account.key] ?? []).includes(month)) continue;
      const openingBalanceEventId = snapshot(previousEnd(month), opening), closingBalanceEventId = snapshot(monthEnd(month), balance);
      ledger = applyPositionEvent(ledger, {type:'reconciliation', commandId:`reconcile-${++command}`, accountId:ids[account.key], month,
        openingBalanceEventId, closingBalanceEventId, source:{kind:'statement', reference:'Invented statement'}}, options);
    }
  }
  return {ledger, ids, options, activityFor};
}
