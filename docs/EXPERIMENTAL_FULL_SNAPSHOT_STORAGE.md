# Experimental fresh-copy full-snapshot storage

Fresh-copy synthetic test build. The actual Dashboard and workspace route now use the new full-snapshot store. Existing copies are not migrated or converted. Legacy storage modules remain for regression coverage, not as supported copies in this new application route. This is not Alpha acceptance or a deployment claim.

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
