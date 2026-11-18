import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSyntheticFinancialYear } from '../js/synthetic-financial-year.mjs';
import { parseRecognizedProviderCsv } from '../js/provider-csv.mjs';
import { prepareCanonicalImport } from '../js/canonical-import.mjs';
import { CanonicalWorkspaceSession } from '../js/canonical-workspace-session.mjs';

test('canonical import staging is local, reversible across every ledger collection, and requires an append-only proposal', async () => {
  const recipe = await createSyntheticFinancialYear();
  const session = new CanonicalWorkspaceSession({ storage: { lifecycle: null }, online: () => true });
  session.preview(recipe.ledger);
  const before = structuredClone(session.ledger);
  const bytes = await readFile(new URL('../fixtures/wells-fargo.csv', import.meta.url));
  const { parsed } = await parseRecognizedProviderCsv({ bytes: new Uint8Array(bytes) });
  const accountId = recipe.accounts.checking;
  const prepared = prepareCanonicalImport(before, {
    parsed,
    syntheticOnly: true,
    accountMappings: { default: accountId },
    coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } },
  });
  assert.equal(session.storage.lifecycle, null);
  assert.equal(prepared.ledger.imports.length, before.imports.length + 1);
  session.stageCanonicalImport(prepared.ledger);
  assert.equal(session.dirty, true);
  assert.equal(session.ledger.observations.length, before.observations.length + 2);
  assert.equal(session.ledger.activities.length, before.activities.length + 2);
  assert.equal(session.storage.lifecycle, null);
  session.undoLastStagedChange();
  assert.deepEqual(session.ledger, before);
  assert.equal(session.dirty, false);

  const altered = structuredClone(prepared.ledger);
  altered.accounts[0].displayName += ' changed';
  assert.throws(() => session.stageCanonicalImport(altered), { code: 'invalid-parsed-import' });
  assert.deepEqual(session.ledger, before);
});

test('import staging rejects a no-op proposal and keeps the current draft untouched', async () => {
  const recipe = await createSyntheticFinancialYear();
  const session = new CanonicalWorkspaceSession({ storage: { lifecycle: null }, online: () => true });
  session.preview(recipe.ledger);
  assert.throws(() => session.stageCanonicalImport(structuredClone(recipe.ledger)), { code: 'invalid-parsed-import' });
  assert.deepEqual(session.ledger, recipe.ledger);
  assert.equal(session.dirty, false);
});
