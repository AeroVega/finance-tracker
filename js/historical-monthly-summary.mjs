const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONEY_RE = /^-?(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;
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

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function finding(code, details = {}) {
  return { code, ...details };
}

function validateBreakdown(record, month, field, totalField, findings) {
  const breakdown = record.breakdowns?.[field];
  if (breakdown === undefined) return;
  if (!breakdown || typeof breakdown !== 'object' || typeof breakdown.complete !== 'boolean' ||
      !Array.isArray(breakdown.items)) {
    findings.push(finding('invalid-breakdown', { month, field }));
    return;
  }
  for (let index = 0; index < breakdown.items.length; index++) {
    const item = breakdown.items[index];
    if (!item || typeof item.label !== 'string' || !item.label.trim() || !parseMoney(item.amount)) {
      findings.push(finding('invalid-breakdown-item', { month, field, itemIndex: index }));
    }
  }
  // Partial source breakdowns are retained as supplied and are not expected to sum.
  if (!breakdown.complete) return;
  const total = parseMoney(record.summary?.[totalField]);
  if (!total) {
    findings.push(finding('complete-breakdown-total-unavailable', { month, field, totalField }));
    return;
  }
  const amounts = breakdown.items.map(item => parseMoney(item?.amount));
  if (amounts.some(value => !value)) return;
  const sum = amounts.length ? addExact(amounts) : { coefficient: 0n, scale: total.scale, currency: total.currency };
  if (sum.mismatch || sum.currency !== total.currency) {
    findings.push(finding('breakdown-currency-mismatch', { month, field, totalField }));
    return;
  }
  if (!sameExact(sum, { coefficient: -total.coefficient, scale: total.scale, currency: total.currency })) {
    findings.push(finding('inconsistent-breakdown-total', { month, field, totalField }));
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
export function validateHistoricalMonthlySummaries({ records, expectedMonthRange } = {}) {
  if (!Array.isArray(records)) throw new TypeError('records-must-be-an-array');
  const start = monthIndex(expectedMonthRange?.start);
  const end = monthIndex(expectedMonthRange?.end);
  if (start === null || end === null || start > end) {
    throw new TypeError('valid-expected-month-range-required');
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
      continue;
    }
    if (current < start || current > end) {
      findings.push(finding('month-outside-expected-range', { recordIndex: index, month }));
    }
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push({ record, index });

    if (!record.summary || typeof record.summary !== 'object' || Array.isArray(record.summary)) {
      findings.push(finding('invalid-summary', { recordIndex: index, month }));
    } else {
      for (const field of REQUIRED_TOTALS) {
        if (record.summary[field] === undefined || record.summary[field] === null) {
          findings.push(finding('missing-summary-value', { recordIndex: index, month, field }));
        } else if (!parseMoney(record.summary[field])) {
          findings.push(finding('invalid-summary-value', { recordIndex: index, month, field }));
        }
      }
      if (record.summary.netCashFlow !== undefined && record.summary.netCashFlow !== null &&
          !parseMoney(record.summary.netCashFlow)) {
        findings.push(finding('invalid-summary-value', { recordIndex: index, month, field: 'netCashFlow' }));
      }
      if (record.summary.netCashFlow === null) {
        findings.push(finding('missing-summary-value', { recordIndex: index, month, field: 'netCashFlow' }));
      }
    }

    const provenance = record.provenance;
    for (const field of ['workbook', 'worksheet', 'mapping']) {
      if (typeof provenance?.[field] !== 'string' || !provenance[field].trim()) {
        findings.push(finding('missing-provenance', { recordIndex: index, month, field }));
      }
    }
    for (const [breakdownField, totalField] of BREAKDOWN_FIELDS) {
      validateBreakdown(record, month, breakdownField, totalField, findings);
    }
  }

  for (const [month, entries] of byMonth) {
    if (entries.length < 2) continue;
    const first = entries[0].record;
    const signature = stable({ summary: first.summary, breakdowns: first.breakdowns });
    for (const entry of entries.slice(1)) {
      const duplicate = signature === stable({ summary: entry.record.summary, breakdowns: entry.record.breakdowns });
      findings.push(finding(duplicate ? 'duplicate-month-summary' : 'overlapping-month-summaries', {
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
