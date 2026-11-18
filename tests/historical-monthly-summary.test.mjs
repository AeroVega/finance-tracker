import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHistoricalMonthlySummaries } from '../js/historical-monthly-summary.mjs';

const range = { start: '2023-01', end: '2023-03' };
const provenance = { workbook: 'invented-history.xlsx', worksheet: 'Monthly Summary', mapping: 'mapping-v1' };
const money = (amount, currency = 'USD') => ({ amount, currency });
const record = (month, overrides = {}) => ({
  month,
  summary: {
    incomeTotal: money('100.00'),
    expenseTotal: money('60.00'),
    netCashFlow: money('40.00'),
    netWorthSnapshot: money('500.00'),
  },
  breakdowns: {
    incomeSources: { complete: true, items: [{ label: 'Invented wages', amount: money('100.00') }] },
    expenseCategories: { complete: true, items: [{ label: 'Invented living', amount: money('60.00') }] },
  },
  provenance: { ...provenance },
  ...overrides,
});
const codes = result => result.findings.map(item => item.code);

test('accepts normalized monthly summaries and preserves source provenance and breakdowns', () => {
  const input = [record('2023-01'), record('2023-02'), record('2023-03')];
  const result = validateHistoricalMonthlySummaries({ records: input, expectedMonthRange: range });
  assert.equal(result.status, 'valid');
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.records, input);
  assert.deepEqual(result.records[0].provenance, provenance);
  assert.deepEqual(result.records[0].breakdowns, input[0].breakdowns);
  assert.deepEqual(result.coverage.missingMonths, []);
});

test('distinguishes a valid zero from a missing summary value', () => {
  const zero = record('2023-01', { summary: {
    incomeTotal: money('0.00'), expenseTotal: money('0'), netWorthSnapshot: money('0.00'),
  } });
  const missing = record('2023-02', { summary: {
    incomeTotal: null, expenseTotal: money('0.00'), netWorthSnapshot: money('0.00'),
  } });
  const result = validateHistoricalMonthlySummaries({ records: [zero, missing], expectedMonthRange: range });
  assert.ok(!codes(result).includes('missing-summary-value') || result.findings.some(f => f.month === '2023-02' && f.field === 'incomeTotal'));
  assert.ok(result.findings.some(f => f.code === 'missing-summary-value' && f.month === '2023-02' && f.field === 'incomeTotal'));
  assert.ok(!result.findings.some(f => f.month === '2023-01' && f.field === 'incomeTotal'));
  assert.equal(result.records[0].summary.incomeTotal.amount, '0.00');
});

test('reports invalid months without dropping the original record', () => {
  const invalid = record('2023-13');
  const result = validateHistoricalMonthlySummaries({ records: [invalid], expectedMonthRange: range });
  assert.ok(codes(result).includes('invalid-month'));
  assert.equal(result.records[0].month, '2023-13');
  assert.equal(result.records.length, 1);
});

test('distinguishes exact duplicate summaries from conflicting overlapping summaries', () => {
  const first = record('2023-01');
  const duplicate = record('2023-01', { provenance: { ...provenance, worksheet: 'Copy' } });
  const conflicting = record('2023-01', { summary: {
    incomeTotal: money('101.00'), expenseTotal: money('60.00'),
    netCashFlow: money('41.00'), netWorthSnapshot: money('500.00'),
  } });
  const result = validateHistoricalMonthlySummaries({ records: [first, duplicate, conflicting], expectedMonthRange: range });
  assert.ok(result.findings.some(f => f.code === 'duplicate-month-summary' && f.month === '2023-01'));
  assert.ok(result.findings.some(f => f.code === 'overlapping-month-summaries' && f.month === '2023-01'));
  assert.equal(result.records.length, 3);
});

test('reports every gap in the explicit expected month range', () => {
  const result = validateHistoricalMonthlySummaries({ records: [record('2023-01'), record('2023-03')], expectedMonthRange: range });
  assert.deepEqual(result.coverage.missingMonths, ['2023-02']);
  assert.ok(result.findings.some(f => f.code === 'missing-month-summary' && f.month === '2023-02'));
});

test('only a declared-complete breakdown is checked against its total', () => {
  const partial = record('2023-01', { breakdowns: {
    incomeSources: { complete: false, items: [{ label: 'Known wages', amount: money('40.00') }] },
  } });
  const complete = record('2023-02', { breakdowns: {
    incomeSources: { complete: true, items: [{ label: 'Known wages', amount: money('40.00') }] },
  } });
  const result = validateHistoricalMonthlySummaries({ records: [partial, complete, record('2023-03')], expectedMonthRange: range });
  assert.ok(!result.findings.some(f => f.code === 'inconsistent-breakdown-total' && f.month === '2023-01'));
  assert.ok(result.findings.some(f => f.code === 'inconsistent-breakdown-total' && f.month === '2023-02'));
});

test('uses exact decimal arithmetic rather than binary floating point', () => {
  const exact = record('2023-01', { summary: {
    incomeTotal: money('0.30'), expenseTotal: money('0.10'), netWorthSnapshot: money('0.00'),
  }, breakdowns: {
    incomeSources: { complete: true, items: [
      { label: 'A', amount: money('0.10') }, { label: 'B', amount: money('0.20') },
    ] },
    expenseCategories: { complete: true, items: [{ label: 'C', amount: money('0.10') }] },
  } });
  const result = validateHistoricalMonthlySummaries({ records: [exact, record('2023-02'), record('2023-03')], expectedMonthRange: range });
  assert.ok(!codes(result).includes('inconsistent-breakdown-total'));
});

test('preserves net-worth snapshots separately and never derives cash flow from them', () => {
  const source = record('2023-01', { summary: {
    incomeTotal: money('100.00'), expenseTotal: money('60.00'),
    netWorthSnapshot: money('900.00'),
  } });
  const result = validateHistoricalMonthlySummaries({ records: [source, record('2023-02'), record('2023-03')], expectedMonthRange: range });
  assert.equal(result.records[0].summary.netWorthSnapshot.amount, '900.00');
  assert.equal(result.records[0].summary.netCashFlow, undefined);
  assert.ok(!result.findings.some(f => f.code === 'invalid-summary-value' && f.field === 'netCashFlow'));
});

test('retains invalid values and reports missing provenance fields', () => {
  const source = record('2023-01', { summary: { incomeTotal: money('NaN'), expenseTotal: money('1.00'), netWorthSnapshot: money('1.00') }, provenance: { workbook: 'invented.xlsx' } });
  const result = validateHistoricalMonthlySummaries({ records: [source, record('2023-02'), record('2023-03')], expectedMonthRange: range });
  assert.ok(codes(result).includes('invalid-summary-value'));
  assert.equal(result.records[0].summary.incomeTotal.amount, 'NaN');
  assert.equal(result.records[0].provenance.workbook, 'invented.xlsx');
  assert.ok(result.findings.some(f => f.code === 'missing-provenance' && f.field === 'worksheet'));
  assert.ok(result.findings.some(f => f.code === 'missing-provenance' && f.field === 'mapping'));
});

test('empty input is preserved and reports the entire expected range as missing', () => {
  const result = validateHistoricalMonthlySummaries({ records: [], expectedMonthRange: range });
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.coverage.missingMonths, ['2023-01', '2023-02', '2023-03']);
  assert.equal(result.coverage.expectedMonthCount, 3);
});

test('requires a valid explicit expected month range', () => {
  assert.throws(() => validateHistoricalMonthlySummaries({ records: [], expectedMonthRange: { start: '2023-02', end: '2023-01' } }), /valid-expected-month-range-required/);
  assert.throws(() => validateHistoricalMonthlySummaries({ records: [] }), /valid-expected-month-range-required/);
});
