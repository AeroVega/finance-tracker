// Synthetic transport-growth evidence. Disk-backed staging avoids retaining the
// object inventory or full archive in a JavaScript Map. This is not a heap test,
// financial semantic audit, browser capacity measurement, or Drive benchmark.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { encodeFramedBackup, restoreFramedBackup } from "../js/framed-backup-stream.mjs";

const sizes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [32, 256, 2048];
assert(sizes.every(size => Number.isSafeInteger(size) && size > 0));
const encoder = new TextEncoder();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const top = encoder.encode('{"kind":"invented-backup-growth-root","version":3}');
const root = { databaseId: "synthetic-growth-database", sourceCopyId: "synthetic-growth-copy", revision: "0",
  canonical: null, catalog: { version: 3, sha256: hash(top) }, protocol: null };
const frameBytes = 16384;
function payload(index) {
  const bytes = new Uint8Array(frameBytes).fill(index % 251);
  bytes.set(encoder.encode("deliberately-invented-object-" + index + "\0"));
  return bytes;
}

for (const size of sizes) {
  const temporary = await mkdtemp(join(tmpdir(), "ft-framed-synthetic-"));
  const destination = join(temporary, "quarantine");
  let count = 0n, streamBytes = 0n, stagedBytes = 0n, activeWrites = 0, peakWrites = 0, largestWrite = 0;
  const started = performance.now();
  try {
    const staging = {
      async begin({ state }) {
        assert.equal(state, "incomplete");
        await mkdir(destination); // Existing namespaces are rejected.
        await writeFile(join(destination, "incomplete.json"), '{"state":"incomplete"}', { flag: "wx" });
      },
      async write(bytes) {
        activeWrites++; peakWrites = Math.max(peakWrites, activeWrites);
        largestWrite = Math.max(largestWrite, bytes.length);
        try {
          const id = hash(bytes);
          await writeFile(join(destination, id), bytes, { flag: "wx" });
          count++; stagedBytes += BigInt(bytes.length);
          return id;
        } finally { activeWrites--; }
      },
      async read(id, { maxBytes }) {
        const bytes = await readFile(join(destination, id));
        assert(bytes.length <= maxBytes);
        return bytes;
      }
    };
    async function* objects() {
      yield { hash: hash(top), bytes: top };
      for (let i = 1; i < size; i++) { const bytes = payload(i); yield { hash: hash(bytes), bytes }; }
    }
    async function* stream() {
      for await (const chunk of encodeFramedBackup({ root, objects: objects(), limits: { maxObjectBytes: frameBytes } })) {
        streamBytes += BigInt(chunk.length); yield chunk;
      }
    }
    const result = await restoreFramedBackup({ source: stream(), staging, limits: { maxObjectBytes: frameBytes },
      verifyStructure: async ({ store, root: pinned }) => {
        assert.deepEqual(await store.read(pinned.catalog.sha256), top);
        // Independent deterministic exact-content oracle for this invented
        // benchmark schema, one expected/restored object at a time.
        for (let i = 1; i < size; i++) {
          const expected = payload(i);
          assert.deepEqual(await store.read(hash(expected)), expected);
        }
        return true;
      }
    });
    assert.equal(result.objectCount, String(size));
    assert.equal(result.objectCount, String(count));
    assert.equal(result.totalObjectBytes, String(stagedBytes));
    assert.equal(peakWrites, 1);
    assert.equal(JSON.parse(await readFile(join(destination, "incomplete.json"), "utf8")).state, "incomplete");
    console.log(JSON.stringify({ objects: size, archiveBytes: String(streamBytes), objectBytes: String(stagedBytes),
      largestWriteBytes: largestWrite, maxParserBlockBytes: result.maxParserBlockBytes, peakStagedWrites: peakWrites,
      exactRestore: true, state: result.state, elapsedMs: Math.round(performance.now() - started) }));
  } finally {
    // Only this benchmark removes its own disposable, invented fixture files.
    await rm(temporary, { recursive: true, force: true });
  }
}
