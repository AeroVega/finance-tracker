import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createLedger, registerAccount, prepareCanonicalImport } from '../js/canonical-import.mjs';
import { parseRecognizedProviderCsv } from '../js/provider-csv.mjs';
import { encodeFullSnapshotBackup, decodeFullSnapshotBackup } from '../js/full-snapshot-backup.mjs';

test('Fidelity account mapping keys never enter canonical records or backup payloads', async () => {
  const { parsed } = await parseRecognizedProviderCsv({ bytes: await readFile(new URL('../fixtures/fidelity.csv', import.meta.url)) });
  const before = structuredClone(parsed);
  let ledger = createLedger();
  for (let index = 0; index < parsed.sourceAccountKeys.length; index++) {
    ledger = registerAccount(ledger, { institutionId: 'fidelity', accountType: 'brokerage', currency: 'USD', displayName: `Invented brokerage ${index}` });
  }
  const accountMappings = Object.fromEntries(parsed.sourceAccountKeys.map((key, index) => [key, ledger.accounts[index].accountId]));
  const coverageByAccount = Object.fromEntries(ledger.accounts.map(account => [account.accountId, { start: '2026-03-01', end: '2026-03-31', provenance: 'user-confirmed' }]));
  const input = { parsed, accountMappings, coverageByAccount, syntheticOnly: true };
  const prepared = prepareCanonicalImport(ledger, input);
  for (const observation of prepared.ledger.observations) {
    assert.equal(Object.hasOwn(observation.candidate, 'sourceAccountKey'), false);
    assert.equal(observation.candidate.sourceFields['Account Number'], null);
    assert.equal(observation.candidate.sourceRowFingerprint, parsed.records.find(row => row.rowOrdinal === observation.rowOrdinal).sourceRowFingerprint);
  }
  for (const key of parsed.sourceAccountKeys) assert.equal(JSON.stringify(prepared.ledger).includes(key), false);
  assert.deepEqual(parsed, before, 'local account mapping remains available without mutating parser evidence');
  const retried = prepareCanonicalImport(prepared.ledger, input);
  assert.equal(retried.ledger.observations.length, prepared.ledger.observations.length);
  for (const key of parsed.sourceAccountKeys) assert.equal(JSON.stringify(retried.ledger).includes(key), false);
  const bytes = await encodeFullSnapshotBackup(retried.ledger, { cryptoImpl: webcrypto });
  const restored = await decodeFullSnapshotBackup(bytes, { cryptoImpl: webcrypto });
  assert.deepEqual(restored, retried.ledger);
  for (const key of parsed.sourceAccountKeys) assert.equal(JSON.stringify(restored).includes(key), false);
});

test('older Fidelity evidence retries only the approved redactions and remains byte-for-byte preserved across save/reopen/backup', async () => {
  const { FullSnapshotApplication } = await import('../js/full-snapshot-application.mjs');
  const { HttpFullSnapshotDrive } = await import('./helpers/http-full-snapshot-drive.mjs');
  const { validateLedger } = await import('../js/canonical-import.mjs');
  const { parsed } = await parseRecognizedProviderCsv({ bytes: await readFile(new URL('../fixtures/fidelity.csv', import.meta.url)) });
  let ledger = createLedger();
  for (let i = 0; i < parsed.sourceAccountKeys.length; i++) ledger = registerAccount(ledger, { institutionId: 'fidelity', accountType: 'brokerage', currency: 'USD', displayName: `Invented legacy account ${i}` });
  const accountMappings = Object.fromEntries(parsed.sourceAccountKeys.map((key, index) => [key, ledger.accounts[index].accountId]));
  const coverageByAccount = Object.fromEntries(ledger.accounts.map(account => [account.accountId, { start: '2026-03-01', end: '2026-03-31', provenance: 'user-confirmed' }]));
  const input = { parsed, accountMappings, coverageByAccount, syntheticOnly: true };
  for (const rawSourceFields of [false, true]) {
    // Recreate precisely the two historical representations from invented
    // parser evidence: PR53's key-only retention and the pre-redaction fields.
    const legacy = prepareCanonicalImport(ledger, input).ledger;
    for (const observation of legacy.observations) {
      const source = parsed.records.find(row => row.rowOrdinal === observation.rowOrdinal);
      observation.candidate.sourceAccountKey = source.sourceAccountKey;
      if (rawSourceFields) {
        observation.sourceFields['Account Number'] = source.sourceAccountKey;
        observation.candidate.sourceFields['Account Number'] = source.sourceAccountKey;
      }
    }
    validateLedger(legacy);
    assert.ok(legacy.imports.every(run => run.status === 'needs-review'));
    const before = structuredClone(legacy);
    const retried = prepareCanonicalImport(legacy, input).ledger;
    assert.deepEqual(legacy, before);
    assert.equal(retried.imports.length, legacy.imports.length);
    assert.ok(retried.imports.every(run => run.retryAttempts.length === 1));
    assert.deepEqual(retried.observations, legacy.observations, 'retained old evidence is not silently redacted');
    assert.deepEqual(retried.activities, legacy.activities);
    // Keep the unchanged file fingerprint deliberately: every other normalized
    // difference must still be rejected, not excused as a privacy migration.
    for (const mutate of [
      row => { row.amountText = '999.99'; },
      row => { row.effectiveDate = '2026-03-04'; },
      row => { row.sourceDescription = 'DIFFERENT INVENTED DESCRIPTION'; },
      row => { row.sourceRowFingerprint = 'changed-fingerprint'; },
      row => { row.sourceFields.Action = 'DIFFERENT ACTION'; },
    ]) {
      const changed = structuredClone(input); mutate(changed.parsed.records[0]);
      assert.throws(() => prepareCanonicalImport(legacy, changed), { code: 'retry-normalization-changed' });
    }
    for (const field of ['sourceAccountKey', 'Account Number']) {
      const changed = structuredClone(legacy);
      if (field === 'sourceAccountKey') changed.observations[0].candidate.sourceAccountKey = 'DIFFERENT INVENTED KEY';
      else changed.observations[0].candidate.sourceFields[field] = 'DIFFERENT INVENTED KEY';
      assert.throws(() => prepareCanonicalImport(changed, input), { code: 'retry-normalization-changed' });
    }
    const http = new HttpFullSnapshotDrive();
    const lifecycle = new FullSnapshotApplication({ folderId: http.folderId, accessToken: () => 'invented-test-token', fetchImpl: http.fetch, cryptoImpl: webcrypto, lifecycleTarget: null, isOnline: () => true, setIntervalImpl: () => 1, clearIntervalImpl: () => {}, visibilityDelayMs: 0 });
    await lifecycle.start({ initialize: true });
    const store = lifecycle.createLedgerStore(); await store.load(); await store.save(legacy);
    await store.save(retried);
    assert.deepEqual(await lifecycle.createLedgerStore().load(), retried);
    const bytes = await encodeFullSnapshotBackup(retried, { cryptoImpl: webcrypto });
    assert.deepEqual(await decodeFullSnapshotBackup(bytes, { cryptoImpl: webcrypto }), retried);
    await lifecycle.release();
  }
});
