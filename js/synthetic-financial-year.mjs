import {parseProviderCsv} from './provider-csv.mjs';
import {createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvents, summarizeLedgerPeriods, validateLedger} from './canonical-import.mjs';

export const DEFAULT_SYNTHETIC_YEAR = 2025;
export const SYNTHETIC_YEAR_DESCRIPTOR = Object.freeze({
  id: 'invented-financial-year-v1', version: 1, syntheticOnly: true,
  defaultYear: DEFAULT_SYNTHETIC_YEAR, minimumYear: 2000, maximumYear: 2099,
});
const money = cents => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csv = rows => new TextEncoder().encode(rows.map(row => row.map(cell).join(',')).join('\n') + '\n');
const pad = n => String(n).padStart(2, '0');

/** Pure, versioned invented fixture. No files, private inputs, network or storage.
 * Fixed timestamps are fixture metadata, not a claim about actual import time.
 * Deterministic UUID-shaped fixture IDs must never be used for production data.
 */
export async function createSyntheticFinancialYear({year = DEFAULT_SYNTHETIC_YEAR, ...unknown} = {}) {
  if (Object.keys(unknown).length || !Number.isInteger(year) || year < 2000 || year > 2099) throw new TypeError('invalid-synthetic-year-options');
  let sequence = 0;
  const options = {now: () => `${year + 1}-01-01T00:00:00.000Z`,
    idFactory: () => `f17e0001-${year}-4000-8000-${String(++sequence).padStart(12, '0')}`};
  const start = `${year}-01-01`, end = `${year}-12-31`;
  const definitions = [
    ['checking', 'wells-fargo', 'checking', 'wells-fargo-csv-v1'],
    ['savings', 'sofi', 'savings', 'sofi-csv-v1'],
    ['card', 'wells-fargo', 'credit-card', 'wells-fargo-csv-v1'],
    ['investment', 'fidelity', 'brokerage', 'fidelity-accounts-history-csv-v1'],
  ];
  const rows = Object.fromEntries(definitions.map(([key]) => [key, []]));
  const expectedMonthly = [];
  const add = (account, month, day, label, cents, kind, category, extra = {}) => rows[account].push({
    date: `${year}-${pad(month)}-${pad(day)}`, label: `INVENTED ${label}`, cents, kind, category, ...extra,
  });
  for (let month = 1; month <= 12; month++) {
    const salary = month === 12 ? 380000 : 300000;
    const utility = 12000 + (month <= 2 || month >= 11 ? 4000 : month >= 6 && month <= 8 ? 2500 : 0);
    const interest = 1000 + month * 25;
    add('checking', month, 1, 'PAYROLL FIRST', salary, 'income', 'salary');
    add('checking', month, 15, 'PAYROLL SECOND', salary, 'income', 'salary');
    add('checking', month, 2, 'RENT', -180000, 'spending', 'housing');
    add('checking', month, 5, 'UTILITY', -(utility + (month === 1 ? 500 : 0)), 'spending', 'utilities', {correctedCents: month === 1 ? -utility : null});
    add('checking', month, 6, 'INSURANCE', -14500, 'spending', 'insurance');
    add('checking', month, 16, 'SAVINGS TRANSFER OUT', -60000, 'transfer', 'internal-transfer');
    add('savings', month, 16, 'SAVINGS TRANSFER IN', 60000, 'transfer', 'internal-transfer');
    add('savings', month, 28, 'SAVINGS INTEREST', interest, 'income', 'interest');
    add('checking', month, 17, 'BROKERAGE CONTRIBUTION OUT', -40000, 'transfer', 'investment-contribution');
    let cardSpending = 0;
    const purchase = (day, label, cents, category) => { add('card', month, day, label, -cents, 'spending', category); cardSpending += cents; };
    for (let week = 0; week < 2; week++) purchase(3 + week * 6, `GROCER ${week + 1}`, 8500 + month * 100 + week * 75, 'groceries');
    for (let visit = 0; visit < 1; visit++) {
      purchase(7 + visit * 12, `CAFE ${visit + 1}`, 3200 + month * 50, 'dining');
      purchase(8 + visit * 12, `TRANSIT ${visit + 1}`, 2400, 'transport');
    }
    purchase(10, 'MEDIA SUBSCRIPTION', 1500, 'subscriptions');
    purchase(22, 'SEASONAL PURCHASE', month === 6 ? 60000 : month === 12 ? 45000 : 12000 + month * 200, month === 6 ? 'travel' : 'household');
    const refund = month === 7 ? 10000 : 0;
    if (refund) add('card', month, 4, 'PARTIAL TRAVEL REFUND', refund, 'refund', 'travel', {refund: true});
    add('card', month, 28, 'CARD PAYMENT RECEIVED', cardSpending - refund, 'transfer', 'card-payment');
    add('checking', month, 28, 'CARD PAYMENT SENT', -(cardSpending - refund), 'transfer', 'card-payment');
    add('investment', month, 17, 'BROKERAGE CONTRIBUTION IN', 40000, null, null, {action: 'CONTRIBUTION'});
    add('investment', month, 18, 'FICTIONAL FUND BUY', -40000, null, null, {action: 'YOU BOUGHT', symbol: 'SYNTH', quantity: '4', price: '100'});
    add('investment', month, 25, 'FICTIONAL FUND DIVIDEND', 1200, null, null, {action: 'DIVIDEND RECEIVED', symbol: 'SYNTH'});
    add('investment', month, 26, 'BROKERAGE FEE', -200, null, null, {action: 'FEE'});
    expectedMonthly.push({month: `${year}-${pad(month)}`, income: money(2 * salary + interest),
      spending: money(180000 + utility + 14500 + cardSpending - refund),
      cash: money(2 * salary + interest - 180000 - utility - 14500)});
  }
  let ledger = createLedger(options);
  const sources = [], accounts = {};
  for (const [key, institutionId, accountType, sourceFormat] of definitions) {
    ledger = registerAccount(ledger, {institutionId, accountType, displayName: `Invented ${key}`, currency: 'USD'}, options);
    const accountId = ledger.accounts.at(-1).accountId;
    accounts[key] = accountId;
    rows[key].sort((a, b) => a.date.localeCompare(b.date));
    const sourceKey = key === 'investment' ? 'INVENTED-YEAR-BROKERAGE' : 'default';
    const headers = key === 'investment'
      ? ['Run Date','Account','Account Number','Action','Symbol','Description','Type','Exchange Quantity','Exchange Currency','Currency','Price','Quantity','Exchange Rate','Commission','Fees','Accrued Interest','Amount','Settlement Date']
      : key === 'savings' ? ['Date','Description','Type','Amount','Status'] : ['DATE','DESCRIPTION','AMOUNT','STATUS'];
    const us = date => `${date.slice(5, 7)}/${date.slice(8)}/${date.slice(0, 4)}`;
    const bytes = csv([headers, ...rows[key].map(row => key === 'investment'
      ? [us(row.date),'Invented brokerage',sourceKey,row.action,row.symbol,row.label,'Cash','','','USD',row.price,row.quantity,'','','','',money(row.cents),us(row.date)]
      : key === 'savings' ? [row.date,row.label,row.kind,money(row.cents),'Posted'] : [row.date,row.label,money(row.cents),'Posted'])]);
    const parsed = await parseProviderCsv({bytes, sourceFormat});
    ledger = prepareCanonicalImport(ledger, {parsed, syntheticOnly: true, accountMappings: {[sourceKey]: accountId},
      coverageByAccount: {[accountId]: {start, end, provenance: 'source-confirmed'}}}, options).ledger;
    sources.push({syntheticOnly: true, accountId, sourceFormat, fileFingerprint: parsed.fileFingerprint, bytes});
    const activities = ledger.activities.filter(activity => activity.accountId === accountId);
    const commands=[];
    for (const [i, row] of rows[key].entries()) {
      if (!row.kind) continue; // Fidelity does not provide a supported posted lifecycle.
      const activityId = activities[i].activityId;
      commands.push({type: 'classification', activityId, activityKind: row.kind,
        categoryId: row.category, commandId: `synthetic-year:${activityId}:classify`,
        evidence: {reason: 'Explicit classification from the invented version-1 scenario; not inferred from a real merchant.'}});
      if (row.correctedCents !== null && row.correctedCents !== undefined) commands.push({
        type: 'bank-correction', activityId, amountText: money(row.correctedCents), commandId: `synthetic-year:${activityId}:correct`,
        evidence: {reason: 'Invented utility provider corrected a five-dollar overcharge.'}});
      if (row.refund) {
        const original = activities.find(activity => activity.effectiveDate === `${year}-06-22` && activity.sourceDescription === 'INVENTED SEASONAL PURCHASE');
        commands.push({type: 'refund-link', activityId, originalActivityId: original.activityId,
          confirmedPostedDate: row.date, commandId: `synthetic-year:${activityId}:refund`,
          evidence: {reason: 'Invented partial refund of the June travel purchase, posted July 4.'}});
      }
    }
    ledger=applyFinancialEvents(ledger,commands,options);
  }
  validateLedger(ledger);
  const [summary,...monthly] = summarizeLedgerPeriods(ledger, [{start,end,currency:'USD'},...expectedMonthly.map(({month}) => ({start: `${month}-01`,
    end: `${month}-${new Date(Date.UTC(year, Number(month.slice(5)), 0)).getUTCDate()}`, currency: 'USD'}))]);
  return {syntheticOnly: true, descriptor: {...SYNTHETIC_YEAR_DESCRIPTOR}, year, ledger, accounts, sources,
    summary, monthly, expectedMonthly,
    limitations: ['Known subtotals only; declared fixture coverage is not reconciled financial completeness.',
      'No opening balances, historical balances, valuations, net worth or investment performance are supplied.',
      'Fidelity actions and amounts are preserved, but unknown lifecycle and unsupported investment classification exclude them from income and spending.',
      'Cash is the existing engine subtotal excluding transfers and card activity, not total bank movement.',
      'CSV source bytes are returned in memory; canonical import records honestly remain not-retained.']};
}
