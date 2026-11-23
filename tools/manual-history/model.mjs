import {previewHistoricalMonthlySummaries} from '../../js/historical-monthly-summary.mjs';
import {HISTORICAL_INPUT_MAX_BYTES, MANUAL_HISTORY_MAPPING, manualNetWorthEstimates} from '../../js/historical-monthly-summary-validation.mjs';
import {fail} from '../../js/app-error.mjs';
import {utf8ByteLength} from '../../js/utf8-length.mjs';

const monthPattern = /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/;
const cents = value => {
  const match = /^(-?)([0-9]{1,18})(?:\.([0-9]{1,2}))?$/.exec(value.trim());
  if (!match) fail('invalid-historical-summary-input');
  return (match[1] ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0')));
};
const dollars = value => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${((value < 0n ? -value : value) % 100n).toString().padStart(2, '0')}`;

function categories(rows, explicitZero, confirmedComplete, currency) {
  const labels = new Set(), items = [];
  let total = 0n;
  for (const row of rows) {
    const label = row.label.trim();
    const amount = row.amount.trim();
    if (!label && !amount) continue;
    const key = label.toLowerCase();
    if (!label || !amount || labels.has(key) || explicitZero) fail('invalid-historical-summary-input');
    labels.add(key);
    const value = cents(amount);
    total += value;
    items.push({label, amount:{amount:dollars(value), currency}});
  }
  if (items.length && !confirmedComplete) fail('invalid-historical-summary-input');
  return {items, money: items.length || explicitZero ? {amount:dollars(total), currency} : undefined};
}

export function buildManualHistory({start, end, sourceId, months}) {
  if (start !== '2023-01' || !sourceId.trim() || sourceId.trim().length > 500 || !monthPattern.test(end) || start > end || !months.length) fail('invalid-historical-summary-input');
  const seen = new Set();
  const records = months.map(({month, workbook, worksheet, currency, income, expenses, zeroIncome, zeroExpenses, completeIncome, completeExpenses, netWorth}) => {
    if (!monthPattern.test(month) || month < start || month > end || seen.has(month) ||
        !workbook.trim() || !worksheet.trim() || !/^[A-Z]{3}$/.test(currency)) fail('invalid-historical-summary-input');
    seen.add(month);
    const receipts = categories(income, zeroIncome, completeIncome, currency), costs = categories(expenses, zeroExpenses, completeExpenses, currency);
    const summary = {}, breakdowns = {};
    for (const [totalKey, partKey, part] of [['incomeTotal','incomeSources',receipts], ['expenseTotal','expenseCategories',costs]]) {
      if (!part.money) continue;
      summary[totalKey] = part.money;
      breakdowns[partKey] = {complete:true, items:part.items};
    }
    if (month !== '2023-01' && netWorth.trim()) fail('invalid-historical-summary-input');
    if (netWorth.trim()) summary.netWorthSnapshot = {amount:dollars(cents(netWorth)), currency};
    return {month, summary, breakdowns, provenance:{workbook:workbook.trim(),worksheet:worksheet.trim(),mapping:MANUAL_HISTORY_MAPPING,sourceId:sourceId.trim()},scope:{kind:'unknown'}};
  }).sort((a,b) => a.month.localeCompare(b.month));
  const input = {format:'finance-tracker-historical-monthly-summaries',version:2,expectedMonthRange:{start,end},records};
  const preview = previewHistoricalMonthlySummaries(null, input);
  const serialized = JSON.stringify(input) + '\n';
  return {input, preview, trackerFile: utf8ByteLength(serialized) <= HISTORICAL_INPUT_MAX_BYTES ? serialized : null};
}

/** January closing balance is observed; later results are cash-flow estimates. */
export function estimateClosingNetWorth(records) {
  return manualNetWorthEstimates(new Map(records.map(record => [record.month,{record,batchVersion:2}])));
}
