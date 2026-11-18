import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createLedger, registerAccount, prepareCanonicalImport, validateLedger } from '../js/canonical-import.mjs';
import { parseRecognizedProviderCsv } from '../js/provider-csv.mjs';
import { encodeFullSnapshotBackup, decodeFullSnapshotBackup } from '../js/full-snapshot-backup.mjs';

async function setup(empty = false) {
  const fixture = await readFile(new URL('../fixtures/wells-fargo.csv', import.meta.url));
  const bytes = empty ? new TextEncoder().encode(new TextDecoder().decode(fixture).split('\n')[0] + '\n') : fixture;
  const { parsed } = await parseRecognizedProviderCsv({ bytes });
  const ledger = registerAccount(createLedger(), { institutionId: 'wells-fargo', displayName: 'Invented checking', accountType: 'checking', currency: 'USD' });
  const accountId = ledger.accounts[0].accountId;
  const coverage = { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed', confirmationEvidence: {
    kind: 'user-confirmed', coverageSource: 'user-declaration', confirmationMethod: 'explicit-component-confirmation', reviewedEmptyExport: empty,
    sourceMetadata: null, priorConfirmedCoverageEnd: '2025-12-31', contextKey: `${parsed.fileFingerprint}:${accountId}`,
  } };
  const input = { parsed, accountMappings: { default: accountId }, coverageByAccount: { [accountId]: coverage }, syntheticOnly: true };
  return { ledger, accountId, coverage, input };
}

test('explicit coverage evidence survives canonical and backup boundaries, without asserting completeness', async () => {
  for (const empty of [false, true]) {
    const { ledger, coverage, input } = await setup(empty);
    const result = prepareCanonicalImport(ledger, input).ledger;
    assert.deepEqual(result.imports[0].declaredCoverage, coverage);
    assert.equal(result.imports[0].coverageReconciled, false);
    const bytes = await encodeFullSnapshotBackup(result, { cryptoImpl: webcrypto });
    assert.deepEqual(await decodeFullSnapshotBackup(bytes, { cryptoImpl: webcrypto }), result);
    const legacy = structuredClone(input);
    delete legacy.coverageByAccount[ledger.accounts[0].accountId].confirmationEvidence;
    assert.equal(validateLedger(prepareCanonicalImport(ledger, legacy).ledger), true);
  }
});

test('coverage evidence fails closed for wrong file/account, spoofed method, malformed metadata and empty claims', async () => {
  const { ledger, input, accountId } = await setup();
  const mutations = [
    e => { e.contextKey = 'another-file:another-account'; },
    e => { e.kind = 'source-confirmed'; },
    e => { e.confirmationMethod = 'automatic'; },
    e => { e.reviewedEmptyExport = true; },
    e => { e.priorConfirmedCoverageEnd = '2025-02-30'; },
    e => { e.sourceMetadata = []; },
    e => { e.coverageSource = 'source-metadata'; },
    e => { e.sourceMetadata = { start: '2025-01-01', end: '2025-01-31' }; e.coverageSource = 'source-metadata'; },
    e => { e.extra = true; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(input); mutate(invalid.coverageByAccount[accountId].confirmationEvidence);
    assert.throws(() => prepareCanonicalImport(ledger, invalid), { code: 'confirmed-coverage-required' });
    const saved = prepareCanonicalImport(ledger, input).ledger;
    mutate(saved.imports[0].declaredCoverage.confirmationEvidence);
    assert.throws(() => validateLedger(saved), { code: 'invalid-import' });
  }
  const source = structuredClone(input);
  Object.assign(source.coverageByAccount[accountId].confirmationEvidence, { coverageSource: 'source-metadata', sourceMetadata: { start: '2026-01-01', end: '2026-01-31' } });
  assert.equal(validateLedger(prepareCanonicalImport(ledger, source).ledger), true);
});
