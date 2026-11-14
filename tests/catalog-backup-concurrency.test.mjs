import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick, setTimeout as delay } from "node:timers/promises";
import { setupCatalog, MemoryCatalogDrive } from "./helpers/catalog-drive.mjs";
import { exportCatalogArchive, verifyCatalogArchive, restoreCatalogArchive, backupCatalogCopy } from "../js/catalog-backup.mjs";
import { encode, verifyCatalogHistory } from "../js/catalog-storage.mjs";
import { SessionCoordinator } from "../js/session-coordination.mjs";

const gate = (operation) => operation();
const guard = async () => {};
const validateStructure = ({ objects }) => Object.values(objects).every((bytes) => JSON.parse(new TextDecoder().decode(bytes)).syntheticOnly === true);
const COPY_KINDS = new Set(["snapshot-object", "commit-record", "journal-event", "migration-record", "protocol-object"]);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function until(condition) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (condition()) return;
    await delay(1);
  }
  assert.fail("Invented operation did not reach the expected boundary");
}
async function fixture() {
  const setup = await setupCatalog();
  await setup.engine.transact(setup.transaction);
  const archive = await exportCatalogArchive({ adapter: setup.adapter, manifestFileId: setup.manifestFileId, withSourceLock: gate, validateStructure });
  return { ...setup, archive };
}
function options(archive, targetAdapter, extra = {}) {
  return { archive, targetAdapter, withTargetLock: gate, assertTargetWritable: guard, validateStructure, ...extra };
}
async function session() {
  const adapter = { record: null,
    async read() { return structuredClone(this.record); },
    async write(record) { this.record = structuredClone(record); } };
  const coordinator = new SessionCoordinator({ adapter });
  await coordinator.start();
  return { adapter, coordinator };
}
function controlledTarget(archive) {
  const target = new MemoryCatalogDrive("invented-concurrent-copy");
  const controls = Array.from({ length: 4 }, deferred);
  const indexByHash = new Map(archive.objects.map((entry, index) => [entry.sha256, index]));
  const started = [], finished = [], publications = [];
  let active = 0, peak = 0;
  const create = target.createImmutable.bind(target);
  target.createImmutable = async (request) => {
    if (!COPY_KINDS.has(request.kind)) {
      assert.equal(active, 0, "marker, catalog and manifest writes cannot overlap copies");
      publications.push(request.kind);
      return create(request);
    }
    const index = indexByHash.get(request.expectedSha256);
    assert.notEqual(index, undefined);
    started.push(index);
    peak = Math.max(peak, ++active);
    try {
      if (index < controls.length) await controls[index].promise;
      else await tick();
      return await create(request);
    } finally { active--; finished.push(index); }
  };
  const publish = target.publishManifest.bind(target);
  target.publishManifest = async (...args) => {
    assert.equal(active, 0, "quarantine and readiness updates must wait for admitted copies");
    publications.push(args[1].state);
    return publish(...args);
  };
  return { target, controls, started, finished, publications, get active() { return active; }, get peak() { return peak; } };
}

test("retained copies overlap at most four operations and retain exact mappings after out-of-order completion", async () => {
  const { archive } = await fixture();
  const copy = controlledTarget(archive);
  const progress = [];
  const operation = restoreCatalogArchive(options(archive, copy.target, { onProgress: (event) => progress.push(event) }));
  await until(() => copy.started.length === 4);
  assert.deepEqual([...copy.started].sort(), [0, 1, 2, 3]);
  assert.deepEqual(copy.publications, ["copy-preparation"]);
  copy.controls[3].resolve();
  await until(() => copy.finished.includes(3));
  copy.controls[2].resolve();
  copy.controls[1].resolve();
  copy.controls[0].resolve();
  const restored = await operation;
  assert.equal(copy.peak, 4);
  assert.equal(copy.active, 0);
  assert.equal(copy.finished[0], 3);
  assert.equal(new Set(copy.started).size, archive.objects.length);
  assert.equal(restored.objectCount, archive.objects.length);
  assert.deepEqual(copy.publications, ["copy-preparation", "locator-catalog-segment", "locator-catalog", "ready", "dashboard-synthetic-manifest"]);
  const verified = await verifyCatalogHistory(copy.target, restored.manifest);
  const portable = await verifyCatalogArchive(archive, { validateStructure });
  assert.deepEqual(new Set(verified.objects.keys()), new Set(portable.objects.keys()));
  for (const [key, bytes] of portable.objects) assert.deepEqual(verified.objects.get(key), bytes);
  assert.deepEqual(progress.filter((event) => event.phase === "copying-objects").map((event) => event.completed),
    Array.from({ length: archive.objects.length + 1 }, (_, index) => index));
});

test("backup stops copy admission on failure and drains all started work before quarantine or either gate releases", async () => {
  const { adapter, manifestFileId, archive } = await fixture();
  const copy = controlledTarget(archive);
  const first = new Error("Invented first input failure");
  const later = new Error("Invented later input fails sooner");
  let sourceLocked = false, targetLocked = false, settled = false;
  const sourceGate = async (operation) => { sourceLocked = true; try { return await operation(); } finally { sourceLocked = false; } };
  const targetGate = async (operation) => { targetLocked = true; try { return await operation(); } finally { targetLocked = false; } };
  const operation = backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId,
    withSourceLock: sourceGate, assertSourceWritable: guard, targetAdapter: copy.target,
    withTargetLock: targetGate, assertTargetWritable: guard, validateStructure });
  const rejected = assert.rejects(operation, (error) => error.code === "copy-quarantined" && error.cause === first && error.quarantineConfirmed === true)
    .then(() => { settled = true; });
  await until(() => copy.started.length === 4);
  copy.controls[2].reject(later);
  await until(() => copy.finished.includes(2));
  await tick(); await tick();
  assert.equal(copy.started.length, 4);
  assert.equal(sourceLocked, true); assert.equal(targetLocked, true); assert.equal(settled, false);
  assert.deepEqual(copy.publications, ["copy-preparation"]);
  copy.controls[0].reject(first);
  copy.controls[1].resolve();
  await until(() => copy.finished.includes(1));
  assert.equal(settled, false);
  assert.equal(sourceLocked, true); assert.equal(targetLocked, true);
  copy.controls[3].resolve();
  await rejected;
  assert.equal(copy.active, 0);
  assert.equal(sourceLocked, false); assert.equal(targetLocked, false);
  assert.equal(copy.started.length, 4);
  assert.deepEqual(copy.publications, ["copy-preparation", "quarantined"]);
  const marker = (await copy.target.listChildren()).find((entry) => entry.appProperties.financeTrackerKind === "copy-preparation");
  assert.equal((await copy.target.readJson(marker.id)).state, "quarantined");
});

test("failure drainage includes pending exact-ID read-back after an upload has finished", async () => {
  const { archive } = await fixture();
  const copy = controlledTarget(archive);
  const readback = deferred();
  const read = copy.target.readBytes.bind(copy.target);
  let waitingForReadback = false, settled = false;
  copy.target.readBytes = async (id) => {
    if (copy.target.files.get(id)?.metadata.appProperties.financeTrackerHash === archive.objects[0].sha256) {
      waitingForReadback = true;
      await readback.promise;
    }
    return read(id);
  };
  const failure = new Error("Invented rejected copy");
  const operation = restoreCatalogArchive(options(archive, copy.target));
  const rejected = assert.rejects(operation, (error) => error.cause === failure).then(() => { settled = true; });
  await until(() => copy.started.length === 4);
  copy.controls[0].resolve();
  await until(() => waitingForReadback);
  copy.controls[2].reject(failure);
  await until(() => copy.finished.includes(2));
  await tick(); await tick();
  copy.controls[1].resolve(); copy.controls[3].resolve();
  await until(() => copy.active === 0);
  assert.equal(settled, false);
  assert.equal(copy.started.length, 4);
  assert.deepEqual(copy.publications, ["copy-preparation"]);
  readback.resolve();
  await rejected;
  assert.deepEqual(copy.publications, ["copy-preparation", "quarantined"]);
});

test("real session release waits for failed copies and quarantine while independent heartbeats remain active", async () => {
  const { adapter, manifestFileId, archive } = await fixture();
  const copy = controlledTarget(archive);
  const source = await session(), target = await session();
  const readback = deferred();
  const read = copy.target.readBytes.bind(copy.target);
  let waitingForReadback = false;
  copy.target.readBytes = async (id) => {
    if (copy.target.files.get(id)?.metadata.appProperties.financeTrackerHash === archive.objects[0].sha256) {
      waitingForReadback = true;
      await readback.promise;
    }
    return read(id);
  };
  const heartbeatTicks = [];
  let stoppedTimers = 0;
  for (const { coordinator } of [source, target]) {
    coordinator.startHeartbeat({ setIntervalImpl: (callback) => { heartbeatTicks.push(callback); return callback; },
      clearIntervalImpl: () => { stoppedTimers++; }, onError: (error) => assert.fail(error.message) });
  }
  const operation = backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId,
    withSourceLock: (work) => source.coordinator.withWrite(work), assertSourceWritable: () => source.coordinator.assertCanWrite(),
    targetAdapter: copy.target, withTargetLock: (work) => target.coordinator.withWrite(work),
    assertTargetWritable: () => target.coordinator.assertCanWrite(), validateStructure });
  const rejected = assert.rejects(operation, (error) => error.code === "copy-quarantined" && error.quarantineConfirmed);
  await until(() => copy.started.length === 4);
  copy.controls[0].resolve();
  await until(() => waitingForReadback);
  let released = false;
  const releasing = Promise.all([source.coordinator.release(), target.coordinator.release()]).then(() => { released = true; });
  copy.controls[2].reject(new Error("Invented rejected copy during release"));
  await until(() => copy.finished.includes(2));
  await tick(); await tick();
  copy.controls[1].resolve(); copy.controls[3].resolve();
  await until(() => copy.active === 0);
  for (const heartbeat of heartbeatTicks) await heartbeat();
  assert.equal(stoppedTimers, 0);
  assert.equal(source.adapter.record.state, "active"); assert.equal(target.adapter.record.state, "active");
  assert.equal(source.coordinator.activeWrites, 1); assert.equal(target.coordinator.activeWrites, 1);
  assert.equal(released, false);
  assert.deepEqual(copy.publications, ["copy-preparation"]);
  readback.resolve();
  await rejected; await releasing;
  assert.deepEqual(copy.publications, ["copy-preparation", "quarantined"]);
  assert.equal(copy.active, 0);
  assert.equal(stoppedTimers, 2);
  assert.equal(source.adapter.record.state, "released"); assert.equal(target.adapter.record.state, "released");
});

for (const mode of ["offline", "ownership-lost"]) {
  test(`an admitted copy rechecks real session ${mode} before mutation`, async () => {
    const { archive } = await fixture();
    const target = new MemoryCatalogDrive("invented-session-refusal");
    const owner = await session();
    const allocate = target.allocateFileId.bind(target);
    let online = true;
    target.allocateFileId = async () => {
      const id = await allocate();
      if (target.nextId > 1) {
        if (mode === "offline") online = false;
        else owner.adapter.record.sessionId = "invented-other-owner";
      }
      return id;
    };
    await assert.rejects(restoreCatalogArchive(options(archive, target, {
      withTargetLock: (work) => owner.coordinator.withWrite(work),
      assertTargetWritable: () => owner.coordinator.assertCanWrite({ online })
    })), (error) => error.code === "copy-quarantined" && [mode, "not-owner"].includes(error.cause.code) && error.quarantineConfirmed === false);
    assert.equal(target.files.size, 1, "only the initial quarantined marker may have been written");
    assert.ok(target.nextId > 1, "an admitted object allocated its exact ID before the ownership check");
    assert.equal((await target.readJson([...target.files.keys()][0])).state, "quarantined");
    assert.equal(owner.coordinator.activeWrites, 0);
  });
}

test("each concurrent copy keeps its ownership guard and denied writes never create their allocated IDs", async () => {
  const { archive } = await fixture();
  const target = new MemoryCatalogDrive("invented-ownership-loss");
  let guards = 0, creates = 0;
  const failure = Object.assign(new Error("Invented ownership loss"), { code: "ownership-lost" });
  const create = target.createImmutable.bind(target);
  target.createImmutable = async (request) => { creates++; return create(request); };
  await assert.rejects(restoreCatalogArchive(options(archive, target, { assertTargetWritable: async () => {
    if (++guards >= 3) throw failure;
  } })), (error) => error.code === "copy-quarantined" && error.cause === failure && error.quarantineConfirmed === false);
  assert.ok(guards >= 3);
  assert.ok(target.nextId > creates, "denied admitted copies may allocate IDs, but must not create them");
  assert.equal(creates, 2, "only the marker and the copy guarded before ownership loss can be created");
  const files = await target.listChildren();
  assert.equal(files.some((file) => ["locator-catalog", "dashboard-synthetic-manifest"].includes(file.appProperties.financeTrackerKind)), false);
});

test("ambiguous copied creates use their original exact IDs without reuploading", async () => {
  const { archive } = await fixture();
  const target = new MemoryCatalogDrive("invented-ambiguous-copy");
  const create = target.createImmutable.bind(target);
  const copies = [];
  target.createImmutable = async (request) => {
    const result = await create(request);
    if (COPY_KINDS.has(request.kind)) {
      copies.push(request.fileId);
      throw new TypeError("Invented lost create response");
    }
    return result;
  };
  const restored = await restoreCatalogArchive(options(archive, target));
  assert.equal(copies.length, archive.objects.length);
  assert.equal(new Set(copies).size, copies.length);
  const verified = await verifyCatalogHistory(target, restored.manifest);
  assert.deepEqual(new Set(Object.values(verified.catalog.entries).map((entry) => entry.fileId)), new Set(copies));
});

test("an unresolved ambiguous create drains sibling read-back before quarantine without replacing its ID", async () => {
  const { archive } = await fixture();
  const copy = controlledTarget(archive);
  const failure = new TypeError("Invented unknown create outcome");
  const readback = deferred();
  const read = copy.target.readBytes.bind(copy.target);
  const create = copy.target.createImmutable.bind(copy.target);
  let waitingForReadback = false, settled = false, failedId;
  const createdIds = [];
  copy.target.createImmutable = async (request) => {
    createdIds.push(request.fileId);
    const result = await create(request);
    if (request.expectedSha256 === archive.objects[2].sha256) {
      failedId = request.fileId;
      copy.target.files.get(request.fileId).bytes = encode("invented wrong stored bytes");
      throw failure;
    }
    return result;
  };
  copy.target.readBytes = async (id) => {
    if (copy.target.files.get(id)?.metadata.appProperties.financeTrackerHash === archive.objects[0].sha256) {
      waitingForReadback = true;
      await readback.promise;
    }
    return read(id);
  };
  const rejected = assert.rejects(restoreCatalogArchive(options(archive, copy.target)),
    (error) => error.code === "copy-quarantined" && error.cause === failure && error.quarantineConfirmed === true)
    .then(() => { settled = true; });
  await until(() => copy.started.length === 4);
  copy.controls[0].resolve();
  await until(() => waitingForReadback);
  copy.controls[2].resolve();
  await until(() => failedId);
  copy.controls[1].resolve(); copy.controls[3].resolve();
  await until(() => copy.active === 0);
  assert.equal(settled, false);
  assert.deepEqual(copy.publications, ["copy-preparation"]);
  readback.resolve();
  await rejected;
  assert.equal(createdIds.filter((id) => id === failedId).length, 1);
  assert.deepEqual(copy.publications, ["copy-preparation", "quarantined"]);
});

test("corrupted exact-ID receipts stop publication and preserve quarantine evidence", async () => {
  const { archive } = await fixture();
  const target = new MemoryCatalogDrive("invented-corrupt-copy");
  const create = target.createImmutable.bind(target);
  let corrupted = false;
  target.createImmutable = async (request) => {
    const result = await create(request);
    if (!corrupted && COPY_KINDS.has(request.kind)) {
      corrupted = true;
      return { ...result, readback: { metadata: await target.readMetadata(request.fileId), bytes: encode("invented corruption") } };
    }
    return result;
  };
  await assert.rejects(restoreCatalogArchive(options(archive, target)),
    (error) => error.code === "copy-quarantined" && error.cause.code === "immutable-hash-mismatch" && error.quarantineConfirmed === true);
  const files = await target.listChildren();
  assert.equal(files.some((file) => ["locator-catalog", "dashboard-synthetic-manifest"].includes(file.appProperties.financeTrackerKind)), false);
  assert.equal((await target.readJson(files.find((file) => file.appProperties.financeTrackerKind === "copy-preparation").id)).state, "quarantined");
});

for (const phase of ["destination-verification", "final-verification"]) {
  test(`fresh ${phase} catches corruption of copied historical bytes`, async () => {
    const { archive } = await fixture();
    const target = new MemoryCatalogDrive("invented-fresh-copy-verification");
    const historical = archive.objects.find((entry) => entry.kind === "commit-record" && entry.identity !== archive.manifest.commitId);
    let corrupted = false;
    await assert.rejects(restoreCatalogArchive(options(archive, target, { onProgress: (event) => {
      if (event.phase !== phase) return;
      const retained = [...target.files.values()].find((file) => file.metadata.appProperties.financeTrackerHash === historical.sha256);
      retained.bytes = encode("invented changed historical bytes");
      corrupted = true;
    } })), (error) => error.code === "copy-quarantined" && error.cause.code === "immutable-hash-mismatch" && error.quarantineConfirmed === true);
    assert.equal(corrupted, true);
    const files = await target.listChildren();
    const manifest = files.find((file) => file.appProperties.financeTrackerKind === "dashboard-synthetic-manifest");
    assert.equal(Boolean(manifest), phase === "final-verification");
    const marker = files.find((file) => file.appProperties.financeTrackerKind === "copy-preparation");
    assert.equal((await target.readJson(marker.id)).state, "quarantined");
    if (manifest) await assert.rejects(verifyCatalogHistory(target, await target.readJson(manifest.id)), { code: "copy-quarantined" });
  });
}

test("copy progress contains only frozen scalar records in gate order and never reports overall success", async () => {
  const { adapter, manifestFileId, archive } = await fixture();
  const target = new MemoryCatalogDrive("invented-progress-target");
  const progress = [];
  await backupCatalogCopy({ sourceAdapter: adapter, sourceManifestFileId: manifestFileId, withSourceLock: gate,
    assertSourceWritable: guard, targetAdapter: target, withTargetLock: gate, assertTargetWritable: guard,
    validateStructure, onProgress: (event) => progress.push(event) });
  assert.deepEqual([...new Set(progress.map((event) => event.phase))], ["source-verification", "source-recheck",
    "destination-preparation", "copying-objects", "destination-verification", "publishing-manifest", "final-verification"]);
  assert.equal(new Set(progress).size, progress.length);
  for (const event of progress) {
    assert.equal(Object.isFrozen(event), true);
    assert.deepEqual(Object.keys(event), ["phase", "completed", "total"]);
    if (event.phase === "copying-objects") {
      assert.equal(Number.isInteger(event.completed), true);
      assert.equal(event.total, archive.objects.length);
    } else { assert.equal(event.completed, null); assert.equal(event.total, null); }
    assert.throws(() => { event.phase = "invented mutation"; }, TypeError);
  }
});

test("malformed, throwing, rejecting and pending progress observers cannot change copy outcomes", async () => {
  const { adapter, manifestFileId, archive } = await fixture();
  const observers = [null, 7, {}, () => { throw new Error("Invented observer failure"); },
    () => Promise.reject(new Error("Invented async observer failure")), () => new Promise(() => {}),
    () => ({ get then() { throw new Error("Invented thenable failure"); } })];
  for (const onProgress of observers) {
    const exported = await exportCatalogArchive({ adapter, manifestFileId, withSourceLock: gate, validateStructure, onProgress });
    await verifyCatalogArchive(exported, { validateStructure, onProgress });
    const target = new MemoryCatalogDrive("invented-observer-target");
    const restored = await restoreCatalogArchive(options(archive, target, { onProgress }));
    assert.equal(restored.objectCount, archive.objects.length);
  }
  await tick(); // Rejected observers must have handlers, not unhandled rejections.
});
