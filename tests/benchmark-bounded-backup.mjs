import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setupCatalog, MemoryCatalogDrive } from './helpers/catalog-drive.mjs';
import { backupCatalogCopy } from '../js/catalog-backup.mjs';
import { verifyCatalogHistory } from '../js/catalog-storage.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const match = /^--(saves|payload-bytes)=(\d+)$/.exec(value);
  if (!match) throw new Error('Use --saves=<count> and --payload-bytes=<bytes>');
  return [match[1], Number(match[2])];
}));
const saves = args.saves ?? 20, payloadBytes = args['payload-bytes'] ?? 65536;
if (!Number.isSafeInteger(saves) || saves < 1 || saves > 200 || !Number.isSafeInteger(payloadBytes) || payloadBytes < 1 || payloadBytes > 1024 * 1024) {
  throw new Error('Benchmark fixture bounds: 1–200 saves, 1–1048576 payload bytes');
}
const source = await setupCatalog();
for (let revision = 1; revision <= saves; revision++) {
  await source.engine.transact({ ...source.transaction,
    expectedBase: await source.adapter.readJson(source.manifestFileId),
    objects: [{ logicalPath: 'synthetic/ledger.json', content: JSON.stringify({ syntheticOnly: true, revision, padding: 'x'.repeat(payloadBytes) }) }] });
}
const manifest = await source.adapter.readJson(source.manifestFileId);
const full = await verifyCatalogHistory(source.adapter, manifest);
const lean = await verifyCatalogHistory(source.adapter, manifest, globalThis.crypto, { retainDataObjects: false });
const retainedDataBytes = [...full.objects].filter(([key]) => key.startsWith('data-object:')).reduce((sum, [, value]) => sum + value.byteLength, 0);
assert.equal([...lean.objects.keys()].some(key => key.startsWith('data-object:')), false);
const targetAdapter = new MemoryCatalogDrive('invented-bounded-backup');
let sourceReadBytes = 0, sourceReads = 0, snapshots = 0;
const read = source.adapter.readBytes.bind(source.adapter);
source.adapter.readBytes = async (...args) => { const bytes = await read(...args); sourceReads++; sourceReadBytes += bytes.byteLength; return bytes; };
const started = performance.now();
const result = await backupCatalogCopy({ sourceAdapter: source.adapter, sourceManifestFileId: source.manifestFileId,
  targetAdapter, withSourceLock: work => work(), withTargetLock: work => work(), assertSourceWritable: async () => {}, assertTargetWritable: async () => {},
  validateStructure: ({ objects }) => {
    snapshots++;
    return Object.values(objects).every(bytes => JSON.parse(new TextDecoder().decode(bytes)).syntheticOnly === true);
  } });
const elapsedMs = performance.now() - started;
const restored = await verifyCatalogHistory(targetAdapter, result.manifest);
assert.deepEqual(restored.objects, full.objects);
console.log(JSON.stringify({ node: process.version, saves, payloadBytes, retainedObjects: full.objects.size,
  retainedDataBytes, retainedDataBytesDuringLeanVerification: 0, validatedSnapshots: snapshots,
  sourceReads, sourceReadBytes, copiedObjects: result.objectCount, elapsedMs: Number(elapsedMs.toFixed(1)),
  note: 'Single invented in-memory adapter run. Exact retained bytes verified after copy. Not Google latency or device memory evidence. Catalog and protocol metadata and one historical snapshot remain resident.' }, null, 2));
