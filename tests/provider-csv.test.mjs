import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseProviderCsv } from '../js/provider-csv.mjs';
import { canonicalizeJcs } from '../js/transaction-protocol.mjs';
const wf = 'wells-fargo-csv-v1', sofi = 'sofi-csv-v1', fidelity = 'fidelity-accounts-history-csv-v1';
const header = 'DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS';
const parse = (text, sourceFormat = wf) => parseProviderCsv({ bytes: new TextEncoder().encode(text), sourceFormat });

test('all existing deliberately invented fixtures parse; account split and no guessed dates/currency/status', async () => {
  for (const [name, format] of [['wells-fargo', wf], ['sofi', sofi], ['fidelity', fidelity]]) {
    const bytes = await readFile(new URL(`../fixtures/${name}.csv`, import.meta.url));
    const result = await parseProviderCsv({ bytes, sourceFormat: format });
    assert.equal(result.records.length, 2); assert.ok(result.records.every(r => r.valid));
    assert.equal(result.sourceCoverage, null);
    assert.equal(result.fileFingerprint, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.rowsSeen, result.records.length + result.ignoredCount);
    assert.ok(result.records.every(r => r.postedDate === null && r.sourceRecordId === null));
    if (format === fidelity) {
      assert.deepEqual(result.sourceAccountKeys, ['000000000', '000000001']);
      assert.equal(result.records[0].lifecycleStatus, 'unknown');
      assert.equal(result.records[1].quantityDecimal, '1.5');
    } else assert.deepEqual(result.sourceAccountKeys, ['default']);
    assert.ok(result.records.every(r => r.currency === null));
  }
});
test('BOM, CRLF, quoted comma, escaped quotes, multiline cell, exact source preservation and ordinals', async () => {
  const result = await parse('\uFEFF\r\n' + header + '\r\n03/02/2026,"  Invented, ""shop""\r\n second line  ",-0012.3400,,Posted\r\n03/03/2026,Next,0,,Pending\r\n');
  const first = result.records[0];
  assert.equal(first.sourceDescription, '  Invented, "shop"\r\n second line  ');
  assert.equal(first.sourceFields.AMOUNT, '-0012.3400'); assert.equal(first.amountText, '-12.34');
  assert.equal(first.rowOrdinal, 3); assert.equal(first.physicalLine, 3);
  assert.equal(result.records[1].rowOrdinal, 4); assert.equal(result.records[1].physicalLine, 5);
  assert.equal(result.records[1].lifecycleStatus, 'pending');
});
test('documented optional column variants, blank status remains unknown', async () => {
  assert.equal((await parse('DATE,DESCRIPTION,AMOUNT,STATUS\n03/02/2026,Invented,+1.00,')).records[0].lifecycleStatus, 'unknown');
  const r = (await parse('Date,Description,Type,Amount,Status\n2026-03-02,Invented,Transfer,-1,Posted', sofi)).records[0];
  assert.equal(r.sourceBalance, null); assert.equal(r.sourceAction, 'Transfer'); assert.ok(r.valid);
});
test('valid empty means recognized header, never missing/unknown schema', async () => {
  const result = await parse(header + '\n'); assert.equal(result.records.length, 0); assert.equal(result.sourceCoverage, null);
  for (const text of ['', '\n,,\n', 'date,description,amount,status', header + ',Extra']) {
    await assert.rejects(parse(text), /missing-csv-header|unsupported-csv-header/);
  }
});
test('strict money grammar preserves exact huge values and canonicalizes signed zero', async () => {
  for (const [input, expected] of [['-0.000', '0'], ['+0001.2300', '1.23'], ['900719925474099312345.123456789', '900719925474099312345.123456789'], ['-0.00001', '-0.00001']]) {
    const record = (await parse(`${header}\n03/02/2026,Invented,${input},,Posted`)).records[0];
    assert.ok(record.valid); assert.equal(record.amountText, expected); assert.equal(record.sourceFields.AMOUNT, input);
  }
  for (const input of ['1e2', 'NaN', 'Infinity', '$12', '(12)', '1.', '.5', ' 1', '1 ', '--1', '']) {
    const r = (await parse(`${header}\n03/02/2026,Invented,${input},,Posted`)).records[0];
    assert.equal(r.valid, false); assert.equal(r.errorCode, 'invalid-amount'); assert.equal(r.amountText, null);
  }
});
test('invalid dates, statuses, row widths and arbitrary footer-like text remain rejected data', async () => {
  const result = await parse(`${header}\n02/29/2025,Invented,1,,Posted\n02/29/2024,Invented,1,,Posted\n03/01/2026,Invented,1,,Maybe\n03/02/2026,Invented,1,,Posted,extra\nUnrecognized footer\n`);
  assert.deepEqual(result.records.map(r => r.errorCode), ['invalid-effective-date', null, 'invalid-status', 'invalid-row-width', 'invalid-row-width']);
  assert.deepEqual(result.records[3].sourceFields.__extraCells, ['extra']);
  assert.equal(result.records[4].sourceFields.DATE, 'Unrecognized footer');
});
test('malformed CSV syntax fails whole file with safe codes and no source values', async () => {
  for (const row of ['03/02/2026,"secret', '03/02/2026,sec"ret,1,,Posted', '03/02/2026,"secret"suffix,1,,Posted', '03/02/2026,"secret" ,1,,Posted']) {
    await assert.rejects(parse(header + '\n' + row), error => error.code === 'invalid-csv-quoting' && !error.message.includes('secret'));
  }
  await assert.rejects(parseProviderCsv({ bytes: new Uint8Array([255]), sourceFormat: wf }), /invalid-source-encoding/);
  await assert.rejects(parseProviderCsv({ bytes: 'text', sourceFormat: wf }), /invalid-source-bytes/);
  await assert.rejects(parse(header, 'arbitrary'), /unsupported-source-format/);
});
test('Fidelity preserves optional investment strings, explicit currency and separate settlement', async () => {
  const source = await readFile(new URL('../fixtures/fidelity.csv', import.meta.url), 'utf8');
  const h = source.split('\n')[2];
  const row = ['03/02/2026', 'INVENTED ACCOUNT', 'INVENTED-KEY', 'Invented action', '', '  Example fund  ', '', '', '', 'USD', '0001.2300', '0.5000', '', '0.000', '', '', '', '03/04/2026'];
  const r = (await parse(`${h}\n${row.join(',')}`, fidelity)).records[0];
  assert.ok(r.valid); assert.equal(r.amountText, null); assert.equal(r.currency, 'USD');
  assert.equal(r.unitPriceDecimal, '0001.2300'); assert.equal(r.quantityDecimal, '0.5000');
  assert.equal(r.settlementDate, '2026-03-04'); assert.equal(r.postedDate, null);
  row[17] = '02/30/2026'; assert.equal((await parse(`${h}\n${row.join(',')}`, fidelity)).records[0].errorCode, 'invalid-settlement-date');
});
test('fingerprints track original bytes, not decoded equivalence; records preserve multiplicity', async () => {
  const text = `${header}\n03/02/2026,Invented,1,,Posted\n03/02/2026,Invented,1,,Posted`;
  const a = await parse(text), b = await parse(text), c = await parse('\uFEFF' + text);
  assert.equal(a.fileFingerprint, b.fileFingerprint); assert.notEqual(a.fileFingerprint, c.fileFingerprint);
  assert.equal(a.records.length, 2); assert.notEqual(a.records[0].rowOrdinal, a.records[1].rowOrdinal);
});

test('workbench invented Jan 2026 acceptance files retain duplicates and rejected rows', async () => {
  const load = async name => parseProviderCsv({ bytes: await readFile(new URL(`../fixtures/pr28/${name}.csv`, import.meta.url)), sourceFormat: wf });
  const foundation = await load('wells-fargo-foundation');
  const review = await load('wells-fargo-review');
  assert.equal(foundation.records.length, 4); assert.ok(foundation.records.every(r => r.valid));
  assert.deepEqual(foundation.records.map(r => r.amountText), ['-100', '1000', '-5', '-5']);
  assert.equal(foundation.records[2].sourceDescription, foundation.records[3].sourceDescription);
  assert.equal(foundation.records[2].effectiveDate, foundation.records[3].effectiveDate);
  assert.notEqual(foundation.records[2].rowOrdinal, foundation.records[3].rowOrdinal);
  assert.equal(review.records.length, 4);
  assert.equal(review.records[0].sourceDescription, foundation.records[0].sourceDescription);
  assert.equal(review.records[1].amountText, '40');
  assert.equal(review.records[2].errorCode, 'invalid-amount');
  assert.equal(review.records[2].sourceFields.AMOUNT, 'not-a-number');
  assert.equal(review.records[3].lifecycleStatus, 'pending');
  for (const r of [...foundation.records, ...review.records]) {
    assert.match(r.sourceDescription, /INVENTED/); assert.match(r.effectiveDate, /^2026-01-/);
  }
});

test('header-only banks retain explicit default mapping context; Fidelity never fabricates account', async () => {
  assert.deepEqual((await parse(header)).sourceAccountKeys, ['default']);
  assert.deepEqual((await parse('Date,Description,Type,Amount,Status', sofi)).sourceAccountKeys, ['default']);
  const source = await readFile(new URL('../fixtures/fidelity.csv', import.meta.url), 'utf8');
  assert.deepEqual((await parse(source.split('\n')[2], fidelity)).sourceAccountKeys, []);
});

test('leading malformed text cannot hide behind later header; footer-like text never drops data', async () => {
  await assert.rejects(parse('Unknown leading text\n' + header), /unsupported-csv-header/);
  const source = await readFile(new URL('../fixtures/fidelity.csv', import.meta.url), 'utf8');
  const h = source.split('\n')[2];
  const result = await parse(`${h}\nThis is invented explanatory footer text, not a transaction row.,unexpected\nAccount summary\n`, fidelity);
  assert.equal(result.records.length, 2); assert.ok(result.records.every(r => !r.valid));
});

test('quoted money commas reject, exact extra precision survives boundary without rounding', async () => {
  const grouped = (await parse(`${header}\n01/01/2026,INVENTED,"1,000.00",,Posted`)).records[0];
  assert.equal(grouped.errorCode, 'invalid-amount'); assert.equal(grouped.sourceFields.AMOUNT, '1,000.00');
  const precision = (await parse(`${header}\n01/01/2026,INVENTED,1.000000000000000000001,,Posted`)).records[0];
  assert.ok(precision.valid); assert.equal(precision.amountText, '1.000000000000000000001');
});


test('row fingerprints bind exact canonical source evidence, never multiplicity or identity', async () => {
  const text = `${header}\n01/05/2026,  INVENTED SHOP  ,-001.000,,Posted\n01/05/2026,  INVENTED SHOP  ,-001.000,,Posted\n01/06/2026,INVENTED BAD,not-money,,Posted,extra`;
  const parsed = await parse(text);
  assert.equal(parsed.records[0].sourceRowFingerprint, parsed.records[1].sourceRowFingerprint);
  assert.notEqual(parsed.records[0].rowOrdinal, parsed.records[1].rowOrdinal);
  for (const record of parsed.records) {
    const expected = createHash('sha256').update(canonicalizeJcs(record.sourceFields), 'utf8').digest('hex');
    assert.equal(record.sourceRowFingerprint, expected);
    assert.match(record.sourceRowFingerprint, /^[a-f0-9]{64}$/);
  }
  assert.equal(parsed.records[2].valid, false);
  const changedSource = await parse(text.replace('-001.000', '-1'));
  assert.equal(changedSource.records[0].amountText, parsed.records[0].amountText);
  assert.notEqual(changedSource.records[0].sourceRowFingerprint, parsed.records[0].sourceRowFingerprint);
  const crlf = await parse(text.replaceAll('\n', '\r\n'));
  assert.notEqual(crlf.fileFingerprint, parsed.fileFingerprint);
  assert.equal(crlf.records[0].sourceRowFingerprint, parsed.records[0].sourceRowFingerprint);
  assert.deepEqual(parsed.records, (await parse(text)).records);
});
