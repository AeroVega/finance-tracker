import { fail } from './app-error.mjs';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONEY_RE = /^-?(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;
export const HISTORICAL_INPUT_MAX_BYTES = 1024 * 1024;
export const MANUAL_HISTORY_MAPPING = 'manual-monthly-entry-v1';
const REQUIRED_TOTALS = ['incomeTotal', 'expenseTotal', 'netWorthSnapshot'];
const BREAKDOWN_FIELDS = [
  ['incomeSources', 'incomeTotal'],
  ['expenseCategories', 'expenseTotal'],
];

function monthIndex(value) {
  if (typeof value !== 'string') return null;
  const match = MONTH_RE.exec(value);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
}

function monthLabel(index) {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function parseMoney(value) {
  if (!value || typeof value !== 'object' || typeof value.amount !== 'string' ||
      !MONEY_RE.test(value.amount) || typeof value.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(value.currency)) return null;
  const negative = value.amount.startsWith('-');
  const unsigned = negative ? value.amount.slice(1) : value.amount;
  const [whole, fraction = ''] = unsigned.split('.');
  const coefficient = BigInt(whole + fraction) * (negative ? -1n : 1n);
  return { coefficient, scale: fraction.length, currency: value.currency };
}

function addExact(values) {
  const scale = Math.max(...values.map(value => value.scale));
  const currency = values[0].currency;
  if (values.some(value => value.currency !== currency)) return { mismatch: true };
  const coefficient = values.reduce((sum, value) =>
    sum + value.coefficient * (10n ** BigInt(scale - value.scale)), 0n);
  return { coefficient, scale, currency };
}

function sameExact(left, right) {
  const sum = addExact([left, right]);
  return !sum.mismatch && sum.coefficient === 0n;
}

function stable(value, ancestors = new WeakSet()) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return `boolean:${value}`;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'number:NaN';
    if (value === Infinity) return 'number:Infinity';
    if (value === -Infinity) return 'number:-Infinity';
    if (Object.is(value, -0)) return 'number:-0';
    return `number:${value}`;
  }
  if (typeof value === 'bigint') return `bigint:${value}`;
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`;

  if (ancestors.has(value)) return 'circular-reference';
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    const entries = Array.from({ length: value.length }, (_, index) =>
      Object.hasOwn(value, index) ? stable(value[index], ancestors) : 'array-hole');
    result = `array:[${entries.join(',')}]`;
  } else if (value instanceof Date) {
    result = `date:${Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString()}`;
  } else if (value instanceof RegExp) {
    result = `regexp:${value.toString()}`;
  } else if (value instanceof Map) {
    const entries = [...value].map(([key, entry]) =>
      `${stable(key, ancestors)}=>${stable(entry, ancestors)}`).sort();
    result = `map:{${entries.join(',')}}`;
  } else if (value instanceof Set) {
    result = `set:{${[...value].map(entry => stable(entry, ancestors)).sort().join(',')}}`;
  } else if (ArrayBuffer.isView(value)) {
    result = `view:${value.constructor.name}:[${Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).join(',')}]`;
  } else if (value instanceof ArrayBuffer) {
    result = `array-buffer:[${Array.from(new Uint8Array(value)).join(',')}]`;
  } else {
    const tag = Object.prototype.toString.call(value);
    const entries = Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stable(value[key], ancestors)}`);
    result = `object:${tag}:{${entries.join(',')}}`;
  }
  ancestors.delete(value);
  return result;
}

function finding(code, details = {}) {
  return { code, ...details };
}

function validateBreakdown(record, month, field, totalField, findings, recordIndex) {
  const breakdown = record.breakdowns[field];
  if (breakdown === undefined) return;
  if (!breakdown || typeof breakdown !== 'object' || typeof breakdown.complete !== 'boolean' ||
      !Array.isArray(breakdown.items)) {
    findings.push(finding('invalid-breakdown', { month, recordIndex, field }));
    return;
  }
  for (let index = 0; index < breakdown.items.length; index++) {
    const item = breakdown.items[index];
    if (!item || typeof item.label !== 'string' || !item.label.trim() || !parseMoney(item.amount)) {
      findings.push(finding('invalid-breakdown-item', { month, recordIndex, field, itemIndex: index }));
    }
  }
  // Partial source breakdowns are retained as supplied and are not expected to sum.
  if (!breakdown.complete) return;
  const total = parseMoney(record.summary?.[totalField]);
  if (!total) {
    findings.push(finding('complete-breakdown-total-unavailable', { month, recordIndex, field, totalField }));
    return;
  }
  const amounts = breakdown.items.map(item => parseMoney(item?.amount));
  if (amounts.some(value => !value)) return;
  const sum = amounts.length ? addExact(amounts) : { coefficient: 0n, scale: total.scale, currency: total.currency };
  if (sum.mismatch || sum.currency !== total.currency) {
    findings.push(finding('breakdown-currency-mismatch', { month, recordIndex, field, totalField }));
    return;
  }
  if (!sameExact(sum, { coefficient: -total.coefficient, scale: total.scale, currency: total.currency })) {
    findings.push(finding('inconsistent-breakdown-total', { month, recordIndex, field, totalField }));
  }
}

/**
 * Validate normalized historical monthly summaries without changing or persisting them.
 *
 * Each record uses:
 * { month: 'YYYY-MM', summary: { incomeTotal, expenseTotal, netCashFlow?,
 *   netWorthSnapshot }, breakdowns?: { incomeSources?, expenseCategories? },
 *   provenance: { workbook, worksheet, mapping } }
 * Monetary values are exact decimal strings: { amount: '123.45', currency: 'USD' }.
 *
 * @param {{records: object[], expectedMonthRange: {start: string, end: string}}} input
 * @returns {{readOnly: true, status: string, expectedMonthRange: object,
 *   records: object[], findings: object[], coverage: object}}
 */
export function validateHistoricalMonthlySummaries({ records, expectedMonthRange, version = 1 } = {}) {
  if (!Array.isArray(records)) fail('records-must-be-an-array');
  const start = monthIndex(expectedMonthRange?.start);
  const end = monthIndex(expectedMonthRange?.end);
  if (start === null || end === null || start > end) {
    fail('valid-expected-month-range-required');
  }

  const preservedRecords = structuredClone(records);
  const findings = [];
  const byMonth = new Map();

  for (let index = 0; index < preservedRecords.length; index++) {
    const record = preservedRecords[index];
    const month = record?.month;
    const current = monthIndex(month);
    if (current === null) {
      findings.push(finding('invalid-month', { recordIndex: index, month: month ?? null }));
    } else {
      if (current < start || current > end) {
        findings.push(finding('month-outside-expected-range', { recordIndex: index, month }));
      }
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push({ record, index });
    }

    const summary = record?.summary;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
      findings.push(finding('invalid-summary', { recordIndex: index, month: month ?? null }));
    }
    const summaryValues = summary && typeof summary === 'object' ? summary : {};
    const manual = version === 2;
    if (manual && (record?.provenance?.mapping !== MANUAL_HISTORY_MAPPING ||
        typeof record?.provenance?.sourceId !== 'string' || !record.provenance.sourceId.trim() ||
        (typeof month === 'string' && month < '2023-01') ||
        (month !== '2023-01' && summaryValues.netWorthSnapshot != null))) {
      findings.push(finding('invalid-historical-record-shape', { recordIndex: index, month }));
    }
    for (const field of REQUIRED_TOTALS) {
      if (manual && month !== '2023-01' && field === 'netWorthSnapshot') continue;
      if (summaryValues[field] === undefined || summaryValues[field] === null) {
        findings.push(finding('missing-summary-value', { recordIndex: index, month: month ?? null, field }));
      } else if (!parseMoney(summaryValues[field])) {
        findings.push(finding('invalid-summary-value', { recordIndex: index, month: month ?? null, field }));
      }
    }
    if (manual && (summaryValues.incomeTotal?.currency !== summaryValues.expenseTotal?.currency ||
        (month === '2023-01' && summaryValues.incomeTotal?.currency !== summaryValues.netWorthSnapshot?.currency))) {
      findings.push(finding('invalid-summary-value', { recordIndex: index, month, field: 'currency' }));
    }
    if (summaryValues.netCashFlow !== undefined && summaryValues.netCashFlow !== null &&
        !parseMoney(summaryValues.netCashFlow)) {
      findings.push(finding('invalid-summary-value', { recordIndex: index, month: month ?? null, field: 'netCashFlow' }));
    }

    const hasBreakdowns = record !== null && record !== undefined &&
      Object.prototype.hasOwnProperty.call(Object(record), 'breakdowns');
    const breakdowns = record?.breakdowns;
    const validBreakdowns = breakdowns !== null && typeof breakdowns === 'object' &&
      !Array.isArray(breakdowns);
    if (hasBreakdowns && !validBreakdowns) {
      findings.push(finding('invalid-breakdowns-container', { recordIndex: index, month: month ?? null }));
    }

    const provenance = record?.provenance;
    for (const field of ['workbook', 'worksheet', 'mapping']) {
      if (typeof provenance?.[field] !== 'string' || !provenance[field].trim()) {
        findings.push(finding('missing-provenance', { recordIndex: index, month, field }));
      }
    }
    if (validBreakdowns) {
      for (const [breakdownField, totalField] of BREAKDOWN_FIELDS) {
        validateBreakdown({ ...record, breakdowns }, month ?? null, breakdownField, totalField, findings, index);
      }
    }
  }

  for (const [month, entries] of byMonth) {
    if (entries.length < 2) continue;
    const equivalentGroups = new Map();
    for (const entry of entries) {
      const signature = stable({ summary: entry.record?.summary, breakdowns: entry.record?.breakdowns });
      if (!equivalentGroups.has(signature)) equivalentGroups.set(signature, []);
      equivalentGroups.get(signature).push(entry.index);
    }

    for (const recordIndices of equivalentGroups.values()) {
      if (recordIndices.length > 1) {
        findings.push(finding('duplicate-month-summary', { month, recordIndices: [...recordIndices] }));
      }
    }

    if (equivalentGroups.size > 1) {
      findings.push(finding('overlapping-month-summaries', {
        month, recordIndices: entries.map(item => item.index),
      }));
    }
  }

  const coveredMonths = [...byMonth.keys()].filter(month => {
    const index = monthIndex(month);
    return index !== null && index >= start && index <= end;
  }).sort();
  const missingMonths = [];
  for (let index = start; index <= end; index++) {
    const month = monthLabel(index);
    if (!byMonth.has(month)) {
      missingMonths.push(month);
      findings.push(finding('missing-month-summary', { month }));
    }
  }

  return {
    readOnly: true,
    status: findings.length ? 'review' : 'valid',
    expectedMonthRange: { start: expectedMonthRange.start, end: expectedMonthRange.end },
    records: preservedRecords,
    findings,
    coverage: {
      expectedMonthCount: end - start + 1,
      suppliedRecordCount: preservedRecords.length,
      coveredMonths,
      missingMonths,
    },
  };
}

// Read-time only. Never write these estimates back as financial snapshots.
export function manualNetWorthEstimates(sources) {
  const estimates = new Map();
  const anchor = sources.get('2023-01');
  if (anchor?.batchVersion !== 2) return estimates;
  const provenance = anchor.record.provenance;
  let value = parseMoney(anchor.record.summary.netWorthSnapshot);
  if (!value) return estimates;
  for (let i = monthIndex('2023-02'); ; i++) {
    const label = monthLabel(i);
    const source = sources.get(label);
    if (source?.batchVersion !== 2 ||
        source.record.provenance.sourceId !== provenance.sourceId) break;
    const {incomeTotal, expenseTotal} = source.record.summary;
    const income = parseMoney(incomeTotal), expense = parseMoney(expenseTotal);
    if (!income || !expense || income.currency !== value.currency || expense.currency !== value.currency) break;
    value = addExact([value, income, {...expense, coefficient:-expense.coefficient}]);
    const negative = value.coefficient < 0n;
    const digits = (negative ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, '0');
    const amount = (negative ? '-' : '') + (value.scale ? digits.slice(0, -value.scale)+'.'+digits.slice(-value.scale) : digits);
    estimates.set(label, {amount, currency:value.currency});
  }
  return estimates;
}
