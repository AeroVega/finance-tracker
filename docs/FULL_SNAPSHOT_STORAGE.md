# Full-snapshot storage contract

Selected application storage format as of 2026-11-17. Dashboard and workspace use this full-snapshot store. Older-format copies are unsupported, not migrated or converted. The owner accepted the reported synthetic open/save workflow on `86d1f2b` and requested removal of obsolete format code/tests. This is not Alpha completeness or production approval. See [current state](CURRENT_STATE.md) for merge and deployment status. Historical measurement sections below apply only to their named revisions.

The new manifest/version selects a direct commit envelope, which binds one complete canonical logical-ledger snapshot by physical ID, SHA256 and byte length. Envelope binds copy/database/revision, exact parent and previous clean manifest hash. No catalog, three-index map, descriptor plan, deduplication or persisted derived projection is used. Financial reports are recomputed from a fully validated ledger. The application supports fresh synthetic seeding, opening, editing, saving, releasing and recovery. Legacy import and backup/restore are explicitly unavailable in this test build; their completion remains an Alpha gate.

Hard limits are 8 MiB per snapshot, 16 KiB per envelope/manifest and 10,000 commits. Save refuses a prospective revision beyond the full-audit bound before writing. No aggregate history-byte limit is imposed yet; worst-case history remains large. Full ledger serialization, parsing and base/candidate validation can retain multiple strings, byte buffers and ledger objects. The cap is not a constant-memory or Safari acceptance claim.

Fresh synthetic copy only. Full open and recovery audit the complete selected/pending ancestry, all snapshot hashes/metadata and append-only financial transitions. Routine save validates the current base and new candidate/transition, intentionally deferring historical-only corruption until a full audit. All old snapshots remain; no garbage collection or silent rollback.

Save creates two immutable files, then performs clean→published→clean using existing fixed-ID Drive creation/readback, native ownership and late-mutation tracking. Prepublication and final closure check exact selected manifest/ownership and all observed immutable metadata. Postpublication reads actual base/candidate bytes and revalidates the transition. Issued publication failures surface as write-unresolved with recoveryRequired=true; no failed/unknown save retains its baseline. Recovery never seeds a save certificate; explicit full open is required afterward.

Native immutable-create GET receipts are independently verified and bracketed with fresh metadata, avoiding duplicate prepublication body downloads without a persistent proof cache. A pending or late known mutation must settle before recovery/successor work. Provider processing after a rejected network promise remains the existing no-CAS limitation, not a newly solved guarantee.

Invented fixture measurements: representative full logical ledger 941,148 bytes; dense one-year 6,070,871 bytes. Entire snapshot is uploaded each save. Ten retained dense snapshots alone exceed 60 MB, so full cold open and bandwidth may regress despite fewer requests. Validation must report seed/save/full-open bytes and memory, not only object count or uniform-delay elapsed time.

## Receipt/construction refinement (local experiment)

Immutable writes use the captured native local ownership/expiry/operation and transport checks. Fresh remote ownership and exact selected-manifest checks remain at every authority publication attempt and closure. A remote change not yet observed may leave harmless immutable orphans, but does not authorize a manifest update.

The native create result includes detached bytes obtained by an actual exact-ID GET. The protocol independently binds its ID, kind, transaction, name, parent folder, size and digest, then compares fresh metadata against the receipt and enrolls that witness. It does not promote POST response fields or upload bytes to readback evidence. This replaces a redundant additional body download.

The already validated candidate ledger and transition, exact envelope construction, and verified immutable GET receipts establish the prepublication candidate. A duplicate reconstruction download is omitted. Fresh closure still checks every enrolled witness before publication. After publication the actual base and new snapshots are downloaded, validated and checked as a transition before finalization; uncertain outcomes and full recovery are unchanged. This is local experimental source, not a deployed performance claim.

## Scope and measured evidence

This build targets one user in one active session. Multi-user, multi-device and competing-tab coordination are not acceptance requirements for this experiment. Interrupted writes, explicit uncertain outcomes, integrity checks and full recovery remain requirements. It makes no atomic compare-and-swap claim. Use a fresh empty synthetic folder; do not point it at older copies or real financial records.

Matched synthetic actual-application measurements used 120 ms delay per provider request, excluding OAuth and Picker interaction. Conservative full-snapshot baseline `0760de1` versus receipt-refined `98bd68f`:

| Operation | Representative baseline → refined | Dense baseline → refined |
| --- | --- | --- |
| Seed plus UI verified readback | 12.700 → 10.059 s | 13.142 → 11.809 s |
| One-change save | 12.332 → 9.995 s | 13.766 → 11.187 s |

Changed saves fell from 98 to 80 requests. Response bytes fell from 5.690 to 3.799 MB for the representative fixture and from 36.468 to 24.318 MB for dense. Financial equality and full/cold reopen passed. These are controlled synthetic comparisons, not predicted or measured live Drive times. The dense process reached approximately 490 MiB maximum RSS, including the synthetic provider and application copies; this is not iPhone/iPad Safari memory acceptance. Full-history cold-open cost still grows with retained snapshots.

The frozen `98bd68f` runtime passed 39 protocol fault tests and 9 application bridge tests before the full aggregate gate. Full-suite and exact remote CI results must be recorded separately before calling this build ready for owner testing. No merge or deployment is implied.

## Release and recovery review

Release refuses an unresolved transaction both when requested and after admitted writes drain, retaining the owning session and heartbeat so recovery remains possible. Independent review reproduced an earlier release bug; the corrected path has regression tests for an already-failed save and a save that fails while release is waiting. These are synthetic HTTP/app tests, not live-provider acceptance.

## Integrated validation (2026-11-16)

The reviewed release-safe runtime and both release regressions passed the complete extended Node aggregate: **2,287 tests passed, zero failures, cancellations or skips**, including the pinned pre-experiment baseline checks. Local Node was v24.22.1; CI uses Node 26 and must pass independently on the published head. Browser-module syntax, registered diagnostic codes/generated reference, documentation checks and whitespace checks passed. The release-safe runtime has 39 focused protocol tests and 11 application tests. An earlier interrupted aggregate has no completion claim, and an earlier completed aggregate's two stale navigation/preflight assertions were corrected before this passing run.

No live Google Drive, Apple-device, deployment, import, backup/restore, or real-financial-data acceptance is claimed. The next owner test is a fresh local preview saved to a new empty synthetic folder, one staged edit/save, and release/reopen. Confirm the deployed source commit before collecting timings. Stop after any uncertain save and use recovery rather than retrying or deleting the folder.

## Fresh-copy creation entry point

The welcome panel now distinguishes Create new synthetic year from Open saved synthetic year. Create prepares invented data before the click, then uses the empty-folder-only save path. An existing local preview, including staged corrections, is reused unchanged. Open never initializes an empty folder. Cancelling folder selection leaves the preview available; retrying creation never overwrites a nonempty folder. These routes are covered through the shipped controller, Dashboard picker bridge, workspace session and actual protocol with invented HTTP responses. Google sign-in/Picker rendering and physical Safari remain live acceptance steps.

The creation-entry fix passed 54 focused protocol/application/controller tests and 87 adjacent workspace/navigation/seeder tests locally. It preserves unsaved drafts unless replacement is explicitly confirmed, keeps OAuth initiation in the click gesture, rejects nonempty destinations before writes, and respects navigation made during creation. Exact-head CI must separately validate the full extended suite before owner testing.

### Immutable Drive version convergence

Drive's file version includes server-side changes that do not necessarily change
content. Immutable verification now tolerates only a monotonically increasing
version with every other metadata field unchanged, and only after a fresh actual
media read matches the reference hash and length inside a stable metadata bracket.
Each convergence check allows at most three attempts. An operation allows at most
eight revalidation media reads and 24 MiB of cumulative revalidation bytes.
Identity, location, tags, size, content, backwards versions, persistent churn and
expired ownership/scope still fail closed. Manifest authority checks remain strict.
No create or publication is retried by this read-only convergence path.

This addresses a reproduced version-only failure consistent with the reported
fresh-seed diagnostic; the live diagnostic did not identify the changed field,
so that exact live cause is not proven. Changed-field diagnostics now contain
allowlisted field names, not file IDs or metadata values. Preserve any affected
folder and do not infer that a failed seed can be retried from HTTP success alone.

### Manifest version convergence

Manifest authority is still exact, but a version-only metadata change can now
settle without falsely reporting a changed manifest. The first actual manifest
body anchors the read. At most three additional media reads may establish an
unchanged byte-for-byte body inside a stable metadata bracket. All non-version
metadata must remain exact and versions must increase. A different body fails,
even if it is valid JSON or a plausible later revision. Each operation permits
at most eight extra manifest reads, each capped at 16 KiB. Ownership and scope
checks, expected-manifest comparisons and publication readback remain required.

Synthetic tests reproduce version-only failure after the clean publication and
prove recovery does not establish a verified save baseline. A successful recovery
or release does not prove the intended local preview was saved. Diagnostic request
counts cover the current connection lifecycle; an earlier released connection's
requests are not included. Do not infer folder content from PATCH counts.

## Overlapped verification reads (2026-11-26)

On 2026-11-26 the owner asked for average open and save wait times to be cut in half. Backup and restore were out of scope. Every check described above still runs. The time went to serial Drive round trips, so independent reads now run together, and requests that repeated the check just before them are removed. The code is `js/full-snapshot-storage.mjs`.

These reads now run together:

- An immutable read sends its opening metadata read with its media read, because the SHA-256 in its reference binds the content. The closing metadata read starts after both settle. A manifest read stays serial, because no hash binds a manifest body.
- A closing check reads witness metadata in groups of eight, together with the ownership check and the exact manifest read. When a witness needs version settling, the exact check runs again after the settling reads.
- A history audit walks the envelope chain from the head. It moves to the parent once an envelope body is hash-verified, and each closing metadata read finishes before the audit returns. Each snapshot read starts when its envelope names it. At most two snapshots are in flight or waiting for their transition check. Transitions are checked newest first.
- A save reads the base envelope and snapshot during its manifest check, because the verified baseline names them. A changed manifest still refuses the save. The save attempt is recorded before these reads, from the verified baseline.
- The snapshot and envelope uploads run together, because the envelope names the snapshot by its planned ID, digest and length. Mutation concurrency is two during these uploads. A failed upload can leave one more unpublished immutable orphan than before.
- After the first publication, its readback closing check runs together with the re-read of the actual base and new snapshots. That closing check is also the check before dispatch of the second publication, which follows it with no other request between.
- An Open that carries a read-only admission starts the folder listing, the manifest read and the history audit while the session is claimed. These reads use a context with no owner. It checks the transport and the epoch, and the mutation guard refuses it. `#run` adopts the context under ownership. The admission must still match the manifest, and the closing check reads every witness, ownership and the exact manifest again. A refused claim aborts these reads and settles them before it reports. Open, independent reopen and reclaiming this page's own stale session carry an admission. Other starts audit after the claim, as before.

These requests are removed:

- `publishManifest` no longer reads the manifest metadata before its PATCH or the body after it. The caller's closing check runs immediately before dispatch, and a closing check reads the published manifest back.
- `start` no longer repeats the ownership check that `withWrite` ran immediately before it.
- A changed save no longer runs a closing check before its immutable uploads. The closing check before the first publication covers the base. A save of an unchanged ledger still runs its closing check.

### Measured in the latency model

`tests/benchmark-drive-latency.mjs` runs the real workspace session, lifecycle and adapters against the invented-HTTP Drive. Each request waits a fixed latency, and all transfers share one link. A file's version moves on its first media read after a write. The phone profile assumes 180 ms per read, 700 ms per write, 1.5 MB/s upload and 6 MB/s download. These are assumptions, not measured Google or Safari performance. Reproduce a row with `node tests/benchmark-drive-latency.mjs --history=3 --profile=phone`, and on the base revision for comparison.

One run each, base `c5bdfcb` against this change. Retained saves are the revisions before the timed save, using the generated synthetic year of about 0.9 MB:

| Retained saves | Save, base | Save, now | Open, base | Open, now | Stale open, base | Stale open, now |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 19.36 s | 8.03 s | 9.24 s | 5.11 s | 9.68 s | 5.33 s |
| 3 | 19.35 s | 8.09 s | 12.45 s | 5.23 s | 12.84 s | 5.46 s |
| 10 | 19.34 s | 8.05 s | 23.75 s | 6.62 s | 24.10 s | 7.29 s |
| 30 | 19.49 s | 8.09 s | 56.05 s | 16.27 s | 56.43 s | 16.90 s |

Open is the open after release. Stale open is the open of a folder whose marker heartbeat expired without release.

With the slow profile of [the simulator guide](DRIVE_SIMULATOR.md#cost-reporting) and 3 retained saves, save went from 27.04 s to 11.58 s, open from 16.69 s to 7.01 s, and stale open from 17.27 s to 7.31 s. With the dense one-year ledger of about 6 MB and 5 retained saves, save went from 27.57 s to 16.18 s, open from 21.36 s to 10.14 s, and stale open from 21.69 s to 11.94 s.

A dense save is limited by bandwidth: it uploads one 6 MB snapshot and downloads about 30 MB. The download includes the base read, the create readback, a settling re-read and the post-publication re-read of both snapshots. Peak Node RSS for the dense run rose from 394 MB to 448 MB. That is not Safari memory evidence. A stale-marker open first tries a normal claim, so its early audit is aborted once and restarted. That costs up to one snapshot of extra download. Live Drive and iPhone timings are not measured.
