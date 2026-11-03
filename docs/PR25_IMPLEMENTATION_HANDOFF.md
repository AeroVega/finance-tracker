# PR25 implementation and remaining ownership

**Reviewed:** 2026-11-03
**Status:** Synthetic implementation submitted for review. Production persistence remains **NO-GO**. No deployment, merge, real account operation, or production data write was performed.

## Outstanding-item assessment

| PR25 action item | AI coding work completed | What remains with the owner |
| --- | --- | --- |
| ADR §81 locator reconciliation | Version-2 hash-only commits, per-copy immutable catalogs, full retained ancestry verification, catalog-backed dashboard bootstrap/reads, and recovery finalization | Review the concrete schema/protocol below before deployment; accept its limitations |
| Backup, quarantine, portable export and restore | Real Drive adapters composed with both session gates; exact history copying; fresh-destination restore; durable preparation/quarantine gate; independent archive verifier; browser controls | Authorize a shared Pages branch deployment after review and green CI; run live synthetic Drive rehearsals |
| Original-source retention | Invented original upload, canonical import metadata fields, Drive deletion/absence adapter, reconnect/hourly active-page worker, failed-delete persistence, archive/restore clock preservation and expired-byte omission | Run live deletion/failure/retry acceptance; decide whether the active-page schedule is sufficient before production |
| Transaction interruption rehearsals | All 14 durable transaction writes fault-tested; interrupted recovery repairs fault-tested; real-adapter pause controls added | Fully terminate/reopen Safari on iPhone/iPad at each boundary and record results; explicit stale-session recovery remains required |
| OAuth failures and reconnect | Simulated 401/403 integration tests; read failures pause access; local token-expiry control and live failure test instructions | Actual account consent, expiry, revocation, wrong-account, missing-grant and denied-permission tests |
| Google quota/billing research | Official Drive limits rechecked on 2026-11-03; source review below | Inspect actual Cloud audience/scopes, key/API restrictions, assigned quotas, usage and billing; accept the $0 operating setup |
| Security/privacy acceptance | Synthetic-only API boundaries preserved; no CSV upload path enabled; no token storage added; page diagnostics use stable codes | Inspect the deployed artifact and browser storage/network on the actual devices; keep private test evidence out of this public repo |
| Final acceptance | Evidence and limits recorded; draft PR retained | Explicit owner acceptance, merge decision, and any later separate production authorization |

The live operations are technically automatable after an authorized account/device is connected, but this session did not have the owner's Google authorization or physical iOS devices. They are **Open**, not failures and not completed acceptance. AI can repair defects found by those rehearsals.

## Concrete synthetic protocol for owner review

The per-copy catalog retains the typed version-1 format in `DRIVE_LOCATOR_CATALOG_DESIGN.md`. New manifests use `manifestVersion: "2.0.0"`; new commits use `version: 2`, contain `logicalPath -> lowercase SHA-256`, and omit physical `copyId`. The manifest binds the physical folder/copy and carries `locatorCatalog: {fileId, sha256}` and `catalogFinalizationPending: transactionId | null`. Schema version 1 is the only application schema supported by this synthetic implementation.

`CatalogTransactionEngine` is used by the synthetic dashboard and PR25 page. The old `DriveTransactionEngine`, v1 portable helper and older prototype pages remain legacy test/reference paths. They are not silently upgraded or presented as ADR-compliant.

For one new object, the durable transaction writes are:

| Boundary | Durable write |
| --- | --- |
| 1 | Transaction-started event, including the exact base-manifest hash |
| 2 | Object-stage plan with its preallocated ID and hash |
| 3 | Immutable data object |
| 4 | Object-staged event |
| 5 | Commit-stage plan |
| 6 | Immutable logical commit |
| 7 | Commit-staged event |
| 8 | New immutable catalog covering staged objects, commit and journal prefix |
| 9 | Publication-intent event containing the exact intended manifest |
| 10 | Financial manifest publication with the pending-finalization marker |
| 11 | Manifest-published event |
| 12 | Transaction-committed event |
| 13 | Catalog generation adding publication intent and terminal events |
| 14 | Catalog-only manifest publication clearing the pending marker; financial revision is unchanged |

Every immutable write is read back by exact generated ID, folder, kind, transaction binding and raw-byte hash. Catalog updates preserve prior mappings. Manifest publication rechecks the exact base, revalidates the session and verifies exact read-back. Complete folder enumeration discovers journals not yet in a published catalog; names alone never establish identity. Malformed/duplicate/conflicting evidence stops recovery before mutation.

Recovery resumes a complete, verified staged commit at its exact base, or verifies the already-published intended commit and finishes the terminal catalog. An incomplete pre-commit stage can be aborted only at its exact base; visible staged objects are verified, unavailable planned IDs remain evidence, and nothing is deleted. A missing previously verified commit/object or an unrelated manifest blocks writes. All recovery repairs are restartable; the tests interrupt both the original transaction and its repair. A pending marker blocks application reads and new writes until recovery succeeds.

## Copy and migration behavior

Version-2 archives contain every catalog-referenced retained immutable object, not just the head snapshot. Logical commit bytes and hashes remain unchanged across backup/restore. Archive mappings have no physical Drive IDs. Historical journal bytes can still contain the original protocol's locators; treat exported archives as private recovery artifacts. The archive digest detects alteration; it is not authentication or encryption.

Both source and destination session gates stay held during copying, with independent heartbeats. A destination must contain only its verified session marker. A preparation marker starts quarantined, changes to ready after object/structure verification, and the database manifest is created last. Reopen checks that preparation marker as well as the full catalog/history. Failure attempts a durable quarantine update and reports whether it succeeded. Unavailable authorization can prevent quarantine confirmation; preserve that destination for inspection and retry in a fresh folder.

The explicit conversion tool supports complete PR24 synthetic dashboard history in a fresh destination. It verifies legacy bytes, object bindings and terminal journals; retains old manifests/commits/journals as migration evidence; converts snapshots to hashes; and records original commit hashes. PR24's empty revision-zero seed had no immutable commit record: this specific case is represented explicitly in migration provenance, attested by a verified journal base or the still-empty original bootstrap. Other missing history fails closed. Conversion changes record hashes with explicit provenance; ordinary v2 backup/restore does not. No source cutover, overwrite, history compaction, or deletion is performed.

## Retention limits to review

Original source bytes live outside the immutable financial catalog so their expiry can actually remove them. Retention metadata is linked to a completed synthetic import, separate from processing status. An original is deleted only after its exact import ID, source hash, object kind and folder are checked. A successful delete plus same-authorization absence/folder verification is required before clearing its locator. A bare 404, switched token, lost grant, or provider failure never proves deletion.

**Open:** a process loss after deletion but before a durable index update can lose the in-memory delete receipt. The next page conservatively preserves the old locator and records a retryable failure; it does not infer deletion from an access-ambiguous 404. Owner inspection/provider evidence is required for that case. This is a remaining deletion-recovery gate, not a claim of fully autonomous production deletion.

The static app runs maintenance on connection and hourly while the page is open with a verified session. It cannot execute while all devices are closed; exactly day 540 marks eligibility, not a guaranteed deletion time. The permanent financial CSV import still stays local. Only the acceptance page can generate/retain an invented original; no production import worker is enabled.

Backups/archives retain original timing, omit already expired/deleted originals, and restore only originals still unexpired at restore time. Local exported files cannot be remotely erased by this static app. The owner must manage their private copies and remove expired original bytes where applicable. Import provenance/status is preserved even when original bytes are omitted.

## Validation evidence

- **Verified:** original PR head `22c30f9a5a21a2335a6ba813fe10f8b148e9cdd6` already had two successful Node 26 CI checks. There were no PR conversation or inline review comments when assessed.
- **Verified:** local regression tests run on Node 24.22.1; exact final count and current-head CI are recorded in `PR25_ACCEPTANCE.md`.
- **Verified:** local browser loaded the new page with missing Google configuration and kept Drive controls disabled. A generated synthetic archive was opened and independently verified through the page with Google disconnected. Desktop, 390px phone portrait, 844px phone landscape, and 820px tablet layouts were inspected; landscape/tablet DOM widths did not overflow their viewports. These are desktop browser viewport checks, not real iOS Safari evidence.
- **Open:** current-head Node 26 GitHub CI until the implementation commit is pushed; no live Google Drive, actual Cloud project or real-device acceptance performed in this session.

## Google source review (2026-11-03)

**Verified:** the [official Drive limits page](https://developers.google.com/workspace/drive/api/guides/limits), updated 2026-10-30, still lists 1,000,000 units/minute/project, 325,000 units/minute/user/project, a 1 TB/day egress limit and a 400,000,000-unit/day billing threshold. It says standard use has no additional cost and planned over-threshold charges will receive at least 90 days' notice. Actual assigned quotas and billing status remain uninspected. This documentation alone does not establish that this project meets the owner's $0 requirement.

The [Drive deletion reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete) describes permanent deletion; it is why the live retention rehearsal asks the owner to confirm deletion of invented originals. No live deletion was performed here.

## Next owner steps, in order

1. Review the concrete protocol, migration behavior and retention limits above. Resolve the deletion-receipt recovery gate and account-access behavior before treating this as production-ready.
2. Review the implementation diff and require both Node 26 CI checks on that head. Only then decide whether to authorize manually deploying the PR branch to the single shared Pages URL. No deployment was requested or performed by this coding pass.
3. Open Prototype Tools → Backup and readiness acceptance. Use disposable synthetic folders and the page's controls to run all live acceptance in `PR25_ACCEPTANCE.md`. Use a fresh disposable source for each interruption boundary. Preserve failed folders; do not reset the existing PR24 folder.
4. Record only non-sensitive pass/fail summaries, tested SHA and device/browser versions publicly. Keep tokens, folder/file locators, account/project identifiers, raw archives and private screenshots outside GitHub.
5. Inspect actual Cloud configuration and billing, review evidence and remaining risks, and give explicit acceptance. Merging PR25 alone must not enable production persistence.
