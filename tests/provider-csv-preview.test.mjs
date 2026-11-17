import test from 'node:test';
import assert from 'node:assert/strict';
import { previewProviderCsv } from '../js/provider-csv-preview.mjs';
import { createLedger, registerAccount } from '../js/canonical-import.mjs';

const wf = 'DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS';
const sofi = 'Date,Description,Type,Amount,Current balance,Status';
const fidelity = 'Run Date,Account,Account Number,Action,Symbol,Description,Type,Exchange Quantity,Exchange Currency,Currency,Price,Quantity,Exchange Rate,Commission,Fees,Accrued Interest,Amount,Settlement Date';
const bytes = text => new TextEncoder().encode(text);
const accountId = '00000000-0000-4000-8000-000000000001';
const ledgerId = '00000000-0000-4000-8000-000000000002';
const accountOptions = { idFactory: () => accountId, now: '2026-01-01T00:00:00.000Z' };

test('recognizes each supported header and parses each format into a read-only summary', async () => {
  const cases = [
    [`${wf}\n01/02/2026,INVENTED SHOP,-1,,Posted`, 'wells-fargo-csv-v1', 'default'],
    [`${sofi}\n2026-02-03,INVENTED SHOP,Card Purchase,-2,98,Posted`, 'sofi-csv-v1', 'default'],
    [`${fidelity}\n02/04/2026,INVENTED ACCOUNT,ACCT-FAKE-01,Contribution,,,,,,,USD,,,,,,,10,02/05/2026`, 'fidelity-accounts-history-csv-v1', 'ACCT-FAKE-01'],
  ];
  for (const [csv, format, key] of cases) {
    const result = await previewProviderCsv({ bytes: bytes(csv) });
    assert.equal(result.status, 'preview');
    assert.equal(result.sourceFormat, format);
    assert.equal(result.accounts[0].sourceAccountKey, key);
    assert.equal(result.rows.parsedRows, 1);
    assert.equal(result.readOnly, true);
    assert.equal(result.canonicalValidation.status, 'not-run');
  }
});

test('unrecognized and empty input are reported without guessing a provider', async () => {
  for (const csv of ['', '\n,,\n', 'Date,Description,Amount,Status\n2026-01-01,X,1,Posted', 'DATE,DESCRIPTION,AMOUNT,STATUS,EXTRA']) {
    const result = await previewProviderCsv({ bytes: bytes(csv) });
    assert.equal(result.status, 'unrecognized');
    assert.equal(result.sourceFormat, undefined);
    assert.equal(result.canonicalValidation.status, 'not-run');
  }
  const empty = await previewProviderCsv({ bytes: bytes('') });
  assert.equal(empty.reason, 'empty-input');
});

test('recognized header with no data reports zero rows and still requires mapping and coverage', async () => {
  const result = await previewProviderCsv({ bytes: bytes(wf) });
  assert.equal(result.status, 'preview');
  assert.deepEqual(result.rows, { sourceRowsSeen: 1, parsedRows: 0, ignoredRows: 1, validRows: 0, rowsRequiringReview: 0 });
  assert.deepEqual(result.accounts, [{ sourceAccountKey: 'default', rows: 0, validRows: 0, rowsRequiringReview: 0, validDateRows: 0, observedValidDateStart: null, observedValidDateEnd: null }]);
  assert.deepEqual(result.requirements.accountMappings, ['default']);
});

test('malformed rows remain visible as review rows and valid dates are summarized independently', async () => {
  const csv = `${wf}\n01/02/2026,INVENTED A,1,,Posted\n02/30/2026,INVENTED B,2,,Posted\n01/04/2026,INVENTED C,not-money,,Posted\n`;
  const result = await previewProviderCsv({ bytes: bytes(csv) });
  assert.equal(result.rows.parsedRows, 3);
  assert.equal(result.rows.validRows, 1);
  assert.equal(result.rows.rowsRequiringReview, 2);
  assert.equal(result.accounts[0].observedValidDateStart, '2026-01-02');
  assert.equal(result.accounts[0].observedValidDateEnd, '2026-01-04');
  assert.equal(result.accounts[0].validDateRows, 2);
  assert.match(result.requirements.note, /do not establish complete or declared coverage/);
});

test('mixed Fidelity accounts retain separate row counts and observed date ranges', async () => {
  const row = (date, key, amount) => [date, 'INVENTED ACCOUNT', key, 'Contribution', '', 'INVENTED DESCRIPTION', '', '', '', 'USD', '', '', '', '', '', '', amount, ''].join(',');
  const csv = `${fidelity}\n${row('01/03/2026', 'ACCT-FAKE-01', '10')}\n${row('03/09/2026', 'ACCT-FAKE-02', '20')}\n${row('02/05/2026', 'ACCT-FAKE-01', 'bad')}`;
  const result = await previewProviderCsv({ bytes: bytes(csv) });
  assert.deepEqual(result.accounts.map(account => [account.sourceAccountKey, account.rows, account.validRows, account.rowsRequiringReview, account.observedValidDateStart, account.observedValidDateEnd]), [
    ['ACCT-FAKE-01', 2, 1, 1, '2026-01-03', '2026-02-05'],
    ['ACCT-FAKE-02', 1, 1, 0, '2026-03-09', '2026-03-09'],
  ]);
  assert.deepEqual(result.requirements.accountMappings, ['ACCT-FAKE-01', 'ACCT-FAKE-02']);
});

test('canonical validation is reused in memory when mapping and declared coverage are supplied; input ledger is unchanged', async () => {
  const base = createLedger({ idFactory: () => ledgerId, now: '2026-01-01T00:00:00.000Z' });
  const ledger = registerAccount(base, { institutionId: 'wells-fargo', displayName: 'Invented Checking', currency: 'USD', accountType: 'checking' }, accountOptions);
  const before = structuredClone(ledger);
  const result = await previewProviderCsv({
    bytes: bytes(`${wf}\n01/02/2026,INVENTED SHOP,-1,,Posted`),
    ledger,
    accountMappings: { default: accountId },
    coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } },
  });
  assert.equal(result.canonicalValidation.status, 'passed');
  assert.equal(result.canonicalValidation.summary.rowsRecognized, 1);
  assert.deepEqual(ledger, before);
});

test('missing account mapping and declared coverage are surfaced rather than inferred', async () => {
  const base = createLedger({ idFactory: () => ledgerId, now: '2026-01-01T00:00:00.000Z' });
  const ledger = registerAccount(base, { institutionId: 'wells-fargo', displayName: 'Invented Checking', currency: 'USD', accountType: 'checking' }, accountOptions);
  const result = await previewProviderCsv({ bytes: bytes(`${wf}\n01/02/2026,INVENTED SHOP,-1,,Posted`), ledger });
  assert.deepEqual(result.requirements.accountMappings, ['default']);
  assert.equal(result.canonicalValidation.status, 'not-run');
});

test('header recognition is conservative and never drops repeated-looking transactions', async () => {
  const csv = `${wf}\n01/02/2026,INVENTED COFFEE,-4,,Posted\n01/02/2026,INVENTED COFFEE,-4,,Posted`;
  const result = await previewProviderCsv({ bytes: bytes(csv) });
  assert.equal(result.rows.parsedRows, 2);
  assert.equal(result.accounts[0].rows, 2);
  assert.equal(result.accounts[0].validRows, 2);
});
