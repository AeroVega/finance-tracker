import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticFinancialYear } from '../js/synthetic-financial-year.mjs';
import { applyFinancialEvent } from '../js/canonical-import.mjs';
import { CanonicalLedgerStore, CANONICAL_INDEX, validateCanonicalSnapshot } from '../js/canonical-ledger-storage.mjs';
import { reassembleCanonicalObjects, fragmentCanonicalObjects } from '../js/canonical-fragments.mjs';
import { serializeLegacyGroupedV2ForTest } from './helpers/canonical-storage-fixture.mjs';

const recipe = await createSyntheticFinancialYear();
const encode = value => new TextEncoder().encode(value);
const decode = value => new TextDecoder().decode(value);

test('standalone grouped-v2 copies are rejected by both validators and never initialized or rewritten', async () => {
  const legacy = serializeLegacyGroupedV2ForTest(recipe.ledger);
  const objects = Object.fromEntries([...legacy].map(([path, value]) => [path, encode(value)]));
  const manifest = { syntheticOnly: true, revision: 1, snapshot: Object.fromEntries(Object.keys(objects).map(path => [path, 'invented-hash'])) };
  const lifecycle = {
    async readManifest() { return structuredClone(manifest); },
    async readVerifiedSnapshot() { return { manifest: structuredClone(manifest), objects: structuredClone(objects) }; },
    async readObject(path) { return objects[path]; },
    async transact() { assert.fail('A deprecated v2 copy must never be written.'); }
  };
  assert.throws(() => validateCanonicalSnapshot({ objects }), { code: 'deprecated-canonical-layout' });
  await assert.rejects(new CanonicalLedgerStore({ lifecycle }).load(), { code: 'deprecated-canonical-layout' });
  assert.throws(() => new CanonicalLedgerStore({ lifecycle, layout: 'chunks-v2' }), { code: 'unsupported-canonical-layout' });
});

test('new canonical stores default to fragmented v3 with a version-3 logical group index', async () => {
  const manifest = { syntheticOnly: true, revision: 0, snapshot: {} };
  const objects = {};
  const lifecycle = {
    async readManifest() { return structuredClone(manifest); },
    async readVerifiedSnapshot() { return { manifest: structuredClone(manifest), objects: structuredClone(objects) }; },
    async readObject(path) { return objects[path]; },
    async transact({ objects: changes }) {
      for (const { logicalPath, content } of changes) {
        objects[logicalPath] = encode(content);
        manifest.snapshot[logicalPath] = 'invented-hash';
      }
      manifest.revision++;
    }
  };
  const store = new CanonicalLedgerStore({ lifecycle });
  assert.equal(store.layout, 'fragments-v3');
  assert.equal(await store.load(), null);
  await store.save(recipe.ledger);
  const root = JSON.parse(decode(objects[CANONICAL_INDEX]));
  assert.equal(root.version, 3);
  const physical = new Map(Object.entries(objects).map(([path, bytes]) => [path, decode(bytes)]));
  const logical = reassembleCanonicalObjects(root, physical);
  const logicalIndex = JSON.parse(logical.get(CANONICAL_INDEX));
  assert.equal(logicalIndex.version, 3);
  assert.ok(logicalIndex.groups);
  const reopened = new CanonicalLedgerStore({ lifecycle });
  assert.deepEqual(await reopened.load(), recipe.ledger);
  assert.equal(reopened.layout, 'fragments-v3');
});

test('existing fragmented-v3 copies with the earlier logical envelope remain readable and upgrade only on save', async () => {
  const legacyLogical = serializeLegacyGroupedV2ForTest(recipe.ledger);
  const physical = fragmentCanonicalObjects(legacyLogical);
  const objects = Object.fromEntries([...physical].map(([path, value]) => [path, encode(value)]));
  const manifest = { syntheticOnly: true, revision: 1, snapshot: Object.fromEntries(Object.keys(objects).map(path => [path, 'invented-hash'])) };
  const lifecycle = {
    async readManifest() { return structuredClone(manifest); },
    async readVerifiedSnapshot() { return { manifest: structuredClone(manifest), objects: structuredClone(objects) }; },
    async readObject(path) { return objects[path]; },
    async transact({ objects: changes }) {
      for (const { logicalPath, content } of changes) {
        objects[logicalPath] = encode(content);
        manifest.snapshot[logicalPath] = 'invented-hash';
      }
      manifest.revision++;
    }
  };
  assert.equal(validateCanonicalSnapshot({ objects }), true);
  const store = new CanonicalLedgerStore({ lifecycle });
  assert.deepEqual(await store.load(), recipe.ledger);
  assert.equal(store.layout, 'fragments-v3');
  const target = recipe.ledger.activities.find(activity => activity.amountMinor < 0);
  const corrected = applyFinancialEvent(recipe.ledger, {
    type: 'bank-correction', commandId: 'invented-upgrade-correction',
    activityId: target.activityId, amountText: '-1.00', evidence: 'Invented compatibility verification'
  });
  await store.save(corrected);
  assert.deepEqual(await store.load(), corrected);
  const upgradedRoot = JSON.parse(decode(objects[CANONICAL_INDEX]));
  const upgradedPhysical = new Map(Object.entries(objects).map(([path, value]) => [path, decode(value)]));
  const upgradedLogical = reassembleCanonicalObjects(upgradedRoot, upgradedPhysical);
  assert.equal(JSON.parse(upgradedLogical.get(CANONICAL_INDEX)).version, 3);
  assert.equal(validateCanonicalSnapshot({ objects }), true);
});
