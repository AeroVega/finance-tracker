import { canonicalizeJcs } from '../../js/transaction-protocol.mjs';
import { readFile } from 'node:fs/promises';
import { createLedger, registerAccount, prepareCanonicalImport, applyFinancialEvent } from '../../js/canonical-import.mjs';
import { parseProviderCsv } from '../../js/provider-csv.mjs';
import { verifyCatalogHistory, readVerified } from '../../js/catalog-storage.mjs';
import { resolveSnapshotLocators } from '../../js/drive-locator-catalog.mjs';

const now = '2026-11-06T12:00:00.000Z', guard = async () => {}, gate = operation => operation();
const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
function lifecycleFor({ adapter, manifestFileId, engine }) {
  return {
    manifestFileId,
    async readManifest() { const m = await adapter.readJson(manifestFileId); await verifyCatalogHistory(adapter, m); return m; },
    async readVerifiedSnapshot() {
      const manifest = await this.readManifest();
      const { catalog } = await verifyCatalogHistory(adapter, manifest);
      const objects = {};
      for (const [path, ref] of Object.entries(resolveSnapshotLocators(manifest.snapshot, catalog))) objects[path] = await readVerified(adapter, { ...ref, kind: 'snapshot-object' });
      return { manifest, objects };
    },
    async readObject(path) { return (await this.readVerifiedSnapshot()).objects[path]; },
    transact: transaction => engine.transact(transaction)
  };
}
async function fixture() {
  let ledger = registerAccount(createLedger({ now }), { institutionId: 'wells-fargo', name: 'Invented packed checking', currency: 'USD', accountType: 'checking' }, { now });
  const accountId = ledger.accounts[0].accountId;
  const input = parsed => ({ parsed, accountMappings: { default: accountId }, coverageByAccount: { [accountId]: { start: '2026-01-01', end: '2026-01-31', provenance: 'user-confirmed' } }, syntheticOnly: true });
  const parse = async name => parseProviderCsv({ bytes: await readFile(new URL('../../fixtures/pr28/' + name, import.meta.url)), sourceFormat: 'wells-fargo-csv-v1' });
  ledger = prepareCanonicalImport(ledger, input(await parse('wells-fargo-foundation.csv')), { now }).ledger;
  for (const [i, activity] of ledger.activities.entries()) ledger = applyFinancialEvent(ledger, { type: 'classification', commandId: 'packed-classify-' + i, activityId: activity.activityId, activityKind: activity.amountMinor < 0 ? 'spending' : 'income', categoryId: 'invented-default' }, { now });
  return { ledger, reviewInput: input(await parse('wells-fargo-review.csv')) };
}
const correct = ledger => applyFinancialEvent(ledger, { type: 'bank-correction', commandId: 'packed-correction', activityId: ledger.activities[0].activityId, amountText: '-90.00', evidence: 'Invented correction' }, { now });


export { fixture, lifecycleFor, correct, now, guard, gate, encode };

/** Frozen legacy fixture builder. Production code no longer creates or opens
 * standalone grouped-v2 copies; this exists only to prove fail-closed refusal.
 */
function serializeLegacyGroupedV2ForTest(ledger, { bounded = true } = {}) {
  const prefix = 'synthetic/canonical-v1/';
  const chunkRecords = 64, chunkBytes = 128 * 1024;
  const metadata = { ...ledger }, collections = {}, chunks = {}, objects = new Map();
  for (const name of ['accounts', 'imports', 'observations', 'activities', 'events', 'reviewDecisions']) {
    const idField = { accounts: 'accountId', imports: 'importRunId', observations: 'observationId',
      activities: 'activityId', events: 'eventId', reviewDecisions: 'reviewDecisionId' }[name];
    collections[name] = ledger[name].map(record => record[idField]);
    delete metadata[name];
    chunks[name] = [];
    for (let offset = 0; offset < ledger[name].length; offset += chunkRecords) {
      const path = prefix + 'chunks/' + name + '/' + String(offset / chunkRecords).padStart(6, '0') + '.json';
      const text = canonicalizeJcs({ format: 'finance-tracker-canonical-chunk', version: 1,
        collection: name, records: ledger[name].slice(offset, offset + chunkRecords) });
      if (bounded && new TextEncoder().encode(text).byteLength > chunkBytes) {
        throw Object.assign(new Error('canonical-chunk-too-large'), { code: 'canonical-chunk-too-large' });
      }
      chunks[name].push(path); objects.set(path, text);
    }
  }
  const index = { format: 'finance-tracker-canonical-index', version: 2, syntheticOnly: true, metadata, collections, chunks };
  objects.set(prefix + 'index.json', canonicalizeJcs(index));
  return objects;
}

export { serializeLegacyGroupedV2ForTest };
