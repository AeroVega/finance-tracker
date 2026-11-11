import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalLedgerStore, CANONICAL_INDEX, serializeCanonicalLedger, serializeFragmentedCanonicalLedger, validateCanonicalSnapshot } from '../js/canonical-ledger-storage.mjs';
import { fragmentCanonicalObjects, reassembleCanonicalObjects } from '../js/canonical-fragments.mjs';
import { canonicalizeJcs } from '../js/transaction-protocol.mjs';
import { fixture, lifecycleFor, now, guard, gate, encode } from './helpers/canonical-storage-fixture.mjs';
import { setupCatalog, MemoryCatalogDrive } from './helpers/catalog-drive.mjs';
import { CatalogTransactionEngine } from '../js/catalog-transaction-engine.mjs';
import { exportCatalogArchive, verifyCatalogArchive, restoreCatalogArchive } from '../js/catalog-backup.mjs';
import { validateSyntheticApplicationSnapshot } from '../js/synthetic-application-structure.mjs';
import { verifyCatalogHistory } from '../js/catalog-storage.mjs';
import { resolveSnapshotLocators } from '../js/drive-locator-catalog.mjs';

const snapshot = objects => Object.fromEntries([...objects].map(([path, text]) => [path, encode(text)]));
const serializers = { 'records-v1': serializeCanonicalLedger, 'fragments-v3': serializeFragmentedCanonicalLedger };
async function appendBalance(ledger, number) {
  const { applyPositionEvent } = await import('../js/financial-position.mjs');
  return applyPositionEvent(ledger, { type: 'balance-snapshot', commandId: 'invented-position-' + number,
    accountId: ledger.accounts[0].accountId, effectiveDate: '2026-01-31', amountText: number === 1 ? '100.00' : '101.00',
    basis: 'statement', source: { kind: 'statement', reference: 'Invented statement ' + number } }, { now });
}

for (const [layout, serialize] of Object.entries(serializers)) {
  test(`${layout}: old six-collection ledger remains exact and position history is optional`, async () => {
    const { ledger } = await fixture(), setup = await setupCatalog();
    const store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup), layout });
    await store.load(); await store.save(ledger);
    const reopened = await new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) }).load();
    assert.equal(Object.hasOwn(reopened, 'positionEvents'), false);
    assert.equal(canonicalizeJcs(reopened), canonicalizeJcs(ledger));
    const indexed = { ...ledger, positionEvents: [] };
    await store.save(indexed);
    assert.deepEqual(await new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) }).load(), indexed);
    await assert.rejects(store.save(ledger), { code: 'history-removal-refused' });
  });

  test(`${layout}: malformed inventory and position history hidden in metadata fail closed`, async () => {
    const { ledger } = await fixture();
    for (const mutate of [
      index => { index.metadata.positionEvents = []; },
      index => { index.collections.unknownEvents = []; },
      index => { index.collections.positionEvents = {}; },
      index => { delete index.collections.events; index.collections.positionEvents = []; },
      index => { index.collections.positionEvents = ['invented-missing']; }
    ]) {
      const physical = serialize(ledger);
      const logical = layout === 'fragments-v3' ? reassembleCanonicalObjects(JSON.parse(physical.get(CANONICAL_INDEX)), physical) : physical;
      const index = JSON.parse(logical.get(CANONICAL_INDEX)); mutate(index);
      logical.set(CANONICAL_INDEX, canonicalizeJcs(index));
      const objects = snapshot(layout === 'fragments-v3' ? fragmentCanonicalObjects(logical) : logical);
      assert.throws(() => validateCanonicalSnapshot({ objects }));
    }
  });

  test(`${layout}: position amendments persist, reopen independently and restore portably without rewriting history`, async () => {
    const { ledger: original } = await fixture(), setup = await setupCatalog();
    const store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup), layout });
    await store.load(); await store.save(original);
    const first = await appendBalance(original, 1); await store.save(first);
    const amended = await appendBalance(first, 2); await store.save(amended);
    assert.deepEqual(amended.positionEvents[0], first.positionEvents[0]);
    assert.deepEqual(await new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) }).load(), amended);
    const mutations = setup.adapter.mutations;
    const rewrite = structuredClone(amended); rewrite.positionEvents[0].source.reference = 'Invented rewritten evidence';
    await assert.rejects(store.save(rewrite), { code: 'history-rewrite-refused' });
    const removed = structuredClone(amended); removed.positionEvents.pop();
    await assert.rejects(store.save(removed), { code: 'history-order-change-refused' });
    const omitted = structuredClone(amended); delete omitted.positionEvents;
    await assert.rejects(store.save(omitted), { code: 'history-removal-refused' });
    assert.equal(setup.adapter.mutations, mutations);
    const archive = await exportCatalogArchive({ adapter: setup.adapter, manifestFileId: setup.manifestFileId,
      withSourceLock: gate, validateStructure: validateSyntheticApplicationSnapshot, now });
    await verifyCatalogArchive(archive, { validateStructure: validateSyntheticApplicationSnapshot });
    const targetAdapter = new MemoryCatalogDrive('invented-position-restore');
    const restored = await restoreCatalogArchive({ archive, targetAdapter, withTargetLock: gate,
      assertTargetWritable: guard, validateStructure: validateSyntheticApplicationSnapshot });
    const engine = new CatalogTransactionEngine({ adapter: targetAdapter, assertWritable: guard, isOnline: () => true });
    assert.deepEqual(await new CanonicalLedgerStore({ lifecycle: lifecycleFor({ adapter: targetAdapter, engine,
      manifestFileId: restored.manifestFileId }) }).load(), amended);

    // A retained earlier position snapshot must still be checked, even when
    // newer selected objects no longer reference its exact physical bytes.
    const manifest = await setup.adapter.readJson(setup.manifestFileId);
    const { catalog } = await verifyCatalogHistory(setup.adapter, manifest);
    const selected = new Set(Object.values(resolveSnapshotLocators(manifest.snapshot, catalog)).map(ref => ref.fileId));
    const historical = [...setup.adapter.files].find(([id, file]) => !selected.has(id) &&
      file.metadata.appProperties?.financeTrackerKind === 'snapshot-object' &&
      new TextDecoder().decode(file.bytes).includes('positionEvents'));
    assert.ok(historical, 'retained position inventory exists outside the selected snapshot');
    const [id, file] = historical, bytes = file.bytes;
    file.bytes = encode('Invented corrupt retained position history');
    await assert.rejects(new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) }).load());
    file.bytes = bytes;
    setup.adapter.files.delete(id);
    await assert.rejects(new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) }).load());
  });
}

test('the multi-account position scenario survives fragmented save and independent reopen exactly', async () => {
  const { createSyntheticFinancialPosition } = await import('../js/synthetic-financial-position.mjs');
  const { ledger } = await createSyntheticFinancialPosition();
  const setup = await setupCatalog(), store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) });
  await store.load(); await store.save(ledger);
  const reopened = await new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) }).load();
  assert.deepEqual(reopened, ledger);
  assert.ok(reopened.positionEvents.some(event => event.eventType === 'reconciliation'));
  assert.ok(reopened.positionEvents.some(event => event.eventType === 'holdings-snapshot'));
});

test('position records cross the 64-record group boundary without losing identities or order', async () => {
  const { applyPositionEvent } = await import('../js/financial-position.mjs');
  let { ledger } = await fixture();
  for (let i = 0; i < 65; i++) ledger = applyPositionEvent(ledger, {
    type: 'balance-snapshot', commandId: 'invented-boundary-' + i, accountId: ledger.accounts[0].accountId,
    effectiveDate: '2026-01-31', amountText: '100.00', basis: 'statement',
    source: { kind: 'statement', reference: 'Invented repeated statement ' + i }
  }, { now });
  const physical = serializeFragmentedCanonicalLedger(ledger);
  const logical = reassembleCanonicalObjects(JSON.parse(physical.get(CANONICAL_INDEX)), physical);
  const index = JSON.parse(logical.get(CANONICAL_INDEX));
  assert.equal(index.groups.positionEvents.length, 2);
  assert.deepEqual(index.collections.positionEvents, ledger.positionEvents.map(event => event.eventId));
  assert.equal(Object.hasOwn(index.metadata, 'positionEvents'), false);
  assert.equal(validateCanonicalSnapshot({ objects: snapshot(physical) }), true);
  const setup = await setupCatalog(), store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) });
  await store.load(); await store.save(ledger);
  assert.deepEqual(await new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) }).load(), ledger);
});

for (const layout of Object.keys(serializers)) {
  test(`${layout}: full-month statement coverage and holdings resolution retain exact references through portable restore`, async () => {
    const { createSyntheticFinancialPosition } = await import('../js/synthetic-financial-position.mjs');
    const { applyPositionEvent } = await import('../js/financial-position.mjs');
    const scenario = await createSyntheticFinancialPosition();
    let ledger = scenario.ledger;
    const accountId = scenario.accounts.brokerage;
    const source = { kind: 'statement', reference: 'Invented complete January brokerage statement' };
    const closing = ledger.positionEvents.find(event => event.accountId === accountId && event.eventType === 'balance-snapshot');
    const originalHoldings = ledger.positionEvents.find(event => event.accountId === accountId && event.eventType === 'holdings-snapshot');
    const append = command => {
      ledger = applyPositionEvent(ledger, { accountId, ...command }, { now });
      return ledger.positionEvents.at(-1);
    };
    const opening = append({ type: 'balance-snapshot', commandId: 'invented-covered-opening',
      effectiveDate: '2024-12-31', amountText: '4900.00', basis: 'statement', source });
    const reconciliation = append({ type: 'reconciliation', commandId: 'invented-covered-january', month: '2025-01',
      openingBalanceEventId: opening.eventId, closingBalanceEventId: closing.eventId,
      method: 'statement-components', source, statementCoverage: { start: '2025-01-01', end: '2025-01-31' },
      components: [{ kind: 'market-value-change', amountText: '100.00', source }] });
    const correctedHoldings = append({ type: 'holdings-snapshot', commandId: 'invented-corrected-holdings',
      effectiveDate: '2025-01-31', scope: 'complete', source,
      holdings: [{ symbol: 'INVENTED', assetType: 'stock', quantity: '47', valueText: '4700.00' },
        { symbol: 'CASH', assetType: 'cash', quantity: '300', valueText: '300.00' }] });
    const setup = await setupCatalog(), store = new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup), layout });
    await store.load(); await store.save(ledger);
    const resolution = append({ type: 'holdings-resolution', commandId: 'invented-choose-corrected-holdings',
      effectiveDate: '2025-01-31', selectedEventId: correctedHoldings.eventId,
      candidateEventIds: [originalHoldings.eventId, correctedHoldings.eventId], reason: 'Invented corrected statement replaces allocation' });
    await store.save(ledger);
    const assertPreserved = actual => {
      assert.deepEqual(actual, ledger);
      const byId = new Map(actual.positionEvents.map(event => [event.eventId, event]));
      assert.deepEqual(byId.get(reconciliation.eventId), reconciliation);
      assert.deepEqual(byId.get(reconciliation.eventId).statementCoverage, { start: '2025-01-01', end: '2025-01-31' });
      assert.deepEqual(byId.get(reconciliation.openingBalanceEventId), opening);
      assert.deepEqual(byId.get(reconciliation.closingBalanceEventId), closing);
      assert.deepEqual(byId.get(resolution.eventId), resolution);
      assert.deepEqual(resolution.candidateEventIds.map(id => byId.get(id)), [originalHoldings, correctedHoldings]);
      assert.deepEqual(byId.get(resolution.selectedEventId), correctedHoldings);
    };
    assertPreserved(await new CanonicalLedgerStore({ lifecycle: lifecycleFor(setup) }).load());
    const archive = await exportCatalogArchive({ adapter: setup.adapter, manifestFileId: setup.manifestFileId,
      withSourceLock: gate, validateStructure: validateSyntheticApplicationSnapshot, now });
    await verifyCatalogArchive(archive, { validateStructure: validateSyntheticApplicationSnapshot });
    const targetAdapter = new MemoryCatalogDrive('invented-covered-position-restore');
    const restored = await restoreCatalogArchive({ archive, targetAdapter, withTargetLock: gate,
      assertTargetWritable: guard, validateStructure: validateSyntheticApplicationSnapshot });
    const engine = new CatalogTransactionEngine({ adapter: targetAdapter, assertWritable: guard, isOnline: () => true });
    assertPreserved(await new CanonicalLedgerStore({ lifecycle: lifecycleFor({ adapter: targetAdapter, engine,
      manifestFileId: restored.manifestFileId }) }).load());
  });
}
