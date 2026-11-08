import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { ApplicationStorageLifecycle } from '../../js/application-storage-lifecycle.mjs';
import { GoogleDriveTransactionAdapter } from '../../js/drive-transaction-engine.mjs';
import { CatalogTransactionEngine } from '../../js/catalog-transaction-engine.mjs';
import { initializeCatalogCopy } from '../../js/catalog-storage.mjs';
import { CanonicalLedgerStore } from '../../js/canonical-ledger-storage.mjs';
import { exportCatalogArchive, verifyCatalogArchive } from '../../js/catalog-backup.mjs';
import { validateSyntheticApplicationSnapshot } from '../../js/synthetic-application-structure.mjs';
import { HttpCatalogDrive } from './http-catalog-drive.mjs';

export const loadCanonicalFixtureBytes = path => readFile(new URL('../../prototype/' + path, import.meta.url));

export async function setupHttpCanonicalWorkbench() {
  const http = new HttpCatalogDrive();
  const adapter = new GoogleDriveTransactionAdapter({ folderId: http.folderId,
    accessToken: () => 'invented-test-token', fetchImpl: http.fetch, cryptoImpl: webcrypto });
  const { manifestFileId } = await initializeCatalogCopy({ adapter, guard: async () => {}, cryptoImpl: webcrypto });
  const lifecycle = new ApplicationStorageLifecycle({
    syntheticOnly: true, catalogProtocol: true, folderName: 'Invented synthetic HTTP test',
    folderId: http.folderId, manifestFileId, accessToken: () => 'invented-test-token',
    makeManifest: () => ({}), lifecycleTarget: new EventTarget(), fetchImpl: http.fetch,
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}, cryptoImpl: webcrypto
  });
  // Replacing only this fallback proves that all canonical reads exercise the
  // production pinned-snapshot path, unlike the older in-memory runner fixture.
  lifecycle.readObject = async () => { assert.fail('per-record fallback must not run'); };
  http.phase = 'connect';
  await lifecycle.start();
  assert.ok(lifecycle.transactionAdapter instanceof GoogleDriveTransactionAdapter);
  assert.ok(lifecycle.engine instanceof CatalogTransactionEngine);
  let store = new CanonicalLedgerStore({ lifecycle, cryptoImpl: webcrypto });
  let ledger = await store.load();
  let occupied = false, dirty = false;
  const calls = { saves: 0, opens: 0, archives: 0, releases: 0 };
  const ready = () => { assert.equal(lifecycle.state, 'ready'); assert.equal(lifecycle.acceptingWrites, true); };
  const driver = {
    get requestMetrics() { return lifecycle.requestMetrics; },
    async requireFresh() {
      ready();
      const manifest = await lifecycle.readManifest();
      assert.equal(manifest.syntheticOnly, true); assert.equal(manifest.revision, 0);
      assert.deepEqual(manifest.snapshot, {}); assert.equal(manifest.catalogFinalizationPending, null);
      assert.equal(await store.load(), null); assert.equal(store.base.revision, 0);
      assert.deepEqual(store.base.snapshot, {}); assert.equal(store.base.syntheticOnly, true);
      assert.equal(store.base.catalogFinalizationPending, null);
    },
    async identity() {
      ready(); const manifest = await lifecycle.readManifest();
      return { databaseId: manifest.databaseId, copyId: manifest.copyId, folderId: lifecycle.folderId };
    },
    stage(next) { ready(); ledger = structuredClone(next); dirty = true; },
    async save(next) {
      ready(); calls.saves++; ledger = await store.save(next); dirty = false;
      return structuredClone(ledger);
    },
    async reopen() {
      ready(); calls.opens++; store = new CanonicalLedgerStore({ lifecycle, cryptoImpl: webcrypto });
      ledger = await store.load(); dirty = false; return structuredClone(ledger);
    },
    async verifyPortable() {
      ready(); calls.archives++;
      const archive = await exportCatalogArchive({ adapter: lifecycle.transactionAdapter, manifestFileId,
        withSourceLock: operation => lifecycle.coordinator.withWrite(operation), validateStructure: validateSyntheticApplicationSnapshot });
      await verifyCatalogArchive(archive, { validateStructure: validateSyntheticApplicationSnapshot });
    },
    async revalidate() { ready(); await lifecycle.handleOnline(); ready(); },
    async release() {
      ready(); assert.equal(dirty, false); calls.releases++; await lifecycle.release();
      assert.equal(lifecycle.started, false); assert.equal(lifecycle.coordinator.canWrite, false);
      assert.equal(lifecycle.releasePending, false);
    }
  };
  const withWorkbench = async operation => {
    ready(); assert.equal(dirty, false); assert.equal(occupied, false); occupied = true;
    try { return await operation(driver); } finally { occupied = false; }
  };
  return { http, lifecycle, driver, withWorkbench, calls, manifestFileId,
    get store() { return store; }, get ledger() { return ledger; } };
}
