# Finance Tracker — next steps and handoff

**Last updated:** 2026-11-02
**Current phase:** PRs #22–#24 are merged. PR #25 is active on `feat/production-readiness-acceptance`, adding synthetic-only backup/restore portability and 540-day retention primitives plus an explicit acceptance record. Production financial-data persistence remains **not approved**.

## PR #24 status — merged 2026-11-02

**Branch:** `feat/application-storage-integration`  
**Merge commit:** `fed48fb2f4863c3be6715f4951b17dedf6b7904d`  
**Final review head:** `0c514fd39a13537adc21a648f4d031ad36088318`  
**Live dashboard acceptance source:** `c6c9f93f54e888a721bcdf78c6d6cb09b829cbf4`

**Verified CI:** both PR workflows passed on the reviewed source head. The complete Node contract suite reported **199 passed, 0 failed**; dashboard/browser module syntax checks passed. The CI workflow action pins were upgraded from the Node-20-runtime v4 actions to Node-24-runtime v7 releases. Both workflows passed again on final review head `b2b86d901fa98d5b90ecccd836b97ed348653e1a`, with 199/199 tests and no Node 20 action-runtime deprecation warning.

**Owner-confirmed live acceptance:** four synthetic rows were saved and verified; release/reconnect restored all four; Clear plus an empty-snapshot Save succeeded; a second release/reconnect restored zero rows. CSV imports remained local. The diagnostic trace showed successful recovery to `ready` and two completed trusted dashboard handoffs.

**Performance baseline:** initial recovery approximately 50 seconds; subsequent recoveries approximately 53–55 seconds; orderly release approximately 4 seconds. Investigate latency separately using request-level timings. Do not weaken transaction verification, session ownership or recovery guarantees.

**Residual investigations:** the original Drive metadata HTTP 404 and the initiating event behind an earlier unsolicited-release symptom do not have definitive root causes. Neither was reproduced in the final owner-confirmed acceptance cycle. Keep both documented as residual risks; do not claim they are conclusively explained. The historical unconfigured dynamic Pages artifact was not the build used for final live acceptance, which was stamped with the tested source SHA. Future branch deployments still require the configured artifact workflow and explicit deployment authorization.

**PR #24 exit criteria met:** actual dashboard synthetic fixture save/read-back/reconnect/clear/reconnect passed; CSV import isolation is covered by tests and owner observation; exact-head CI passed. PR #24 remains synthetic-only and does not authorize production ledger reads/writes.

## Current workstream and PR sequence

The owner has selected Google Drive as the intended private storage provider, subject to completing all storage-readiness gates. The app remains hosted as public static content on GitHub Pages. The permanent CSV import path and $0 recurring-cost constraint remain mandatory.

The next four PRs have deliberately separated responsibilities:

### PR #22 — Transaction protocol foundation (merged 2026-11-01)

Branch: `feat/transaction-staging-crash-recovery`

- Define transaction invariants, journal event format, commit ordering, recovery classifications, and acceptance criteria.
- Implement the pure protocol core: canonical serialization, SHA-256 journal event creation, hash-chain and transition verification, and deterministic recovery classification.
- Add synthetic tests for canonicalization, event integrity, invalid transitions, and recovery decisions.
- Record the requirement that session management is automatic background behavior.

**Exit:** merged to `main` on 2026-11-01. The protocol core and tests do not perform Drive persistence.

### PR #23 — Durable Google Drive transaction engine (merged 2026-11-01)

Branch: `feat/durable-drive-transaction-engine`

- Implement Drive adapter operations for durable append-only journal events, immutable content-addressed object staging, immutable commit records, and manifest publication last.
- Use pre-generated Drive file IDs and exact read-back verification to make retries idempotent after lost responses.
- Enforce expected base revision/commit checks, serialized mutations, and verified session ownership before every mutation and immediately before manifest publication.
- Implement deterministic crash recovery from the authoritative manifest, journal, commit records, and referenced objects.
- Retry transient HTTP 404 responses when a newly created Drive file's metadata is not yet visible, using a bounded ~22.5-second default window; preserve immediate failure for authorization and integrity errors and include timeout diagnostics.
- Add deterministic lost-response injection after all 11 durable mutation boundaries, including manifest publication and terminal journal append.
- Provide a browser-driven synthetic Drive transaction smoke test in the existing feasibility page and a concise owner test guide.
- Use synthetic data and a dedicated synthetic Drive folder only; never inspect or modify the canonical manifest or ledger.

**Exit:** Node fault-injection CI passes; the owner-confirmed live synthetic Drive transaction/reopen/recovery smoke test and cleanup passed on 2026-11-01; repeated recovery and ambiguous-outcome preservation are covered by synthetic tests. Real Drive interruption/reload rehearsals at every boundary remain open. No real financial data.

### PR #24 — Application integration and automatic lifecycle (merged 2026-11-02)

Branch: `feat/application-storage-integration`

- Integrates the session coordinator, Drive session adapter and durable transaction engine behind a synthetic-only application storage lifecycle controller.
- Wires the actual dashboard for dedicated synthetic-folder connection, startup recovery, heartbeat, reconnect revalidation, verified snapshot reads, synthetic sample writes, explicit Save, Clear via a verified empty snapshot, and orderly release.
- Preserves local-only CSV imports. Only invented rows explicitly tagged `syntheticOnly: true` can be written to Drive. No production ledger read/write path is enabled.
- Adds deterministic lifecycle, transaction, diagnostics and dashboard-handler regression tests; PR CI runs the complete Node contract suite.
- Owner-confirmed live dashboard cycle passed: save four rows, release/reconnect and restore four, clear and save empty, release/reconnect and restore zero.
- Exact-head CI passed with 199/199 Node tests and dashboard/browser syntax checks.

**Exit:** met for PR #24's synthetic-only application integration. Residual historical 404/release-event root-cause investigations and performance profiling remain documented follow-ups; they do not authorize production persistence or expand PR #24's scope.

### PR #25 — End-to-end acceptance and production-readiness gates (active)

Branch: `feat/production-readiness-acceptance`

**Implemented in the current branch:**
- `js/portable-backup.mjs`: adapter-driven immutable snapshot-copy helper with a required serialized source-operation gate, source-stability check, exact destination bytes/metadata read-back, new backup identity, manifest-last publication, and explicit quarantine callback.
- `js/original-retention-policy.mjs`: `processOriginalRetentionBatch` orchestrates provider deletion plus independent absence verification; failure preserves the locator and is retryable.
- `js/portable-backup.mjs`: portable archive envelope, SHA-256 verification, exact snapshot-object set, structural-validation hook, provider-independent export without Drive file locators, and inert restore planning.
- `js/original-retention-policy.mjs`: exact 540-day clock, deletion eligibility versus confirmed deletion, retryable failures, and backup/restore rules that do not restart or resurrect expired originals.
- Synthetic tests in `tests/portable-backup.test.mjs` and `tests/original-retention-policy.test.mjs`.
- `docs/PR25_ACCEPTANCE.md`: current Google OAuth/quota/cost review, evidence labels, and owner-run acceptance protocol.

**Still required before PR #25 can close:**
- **Verified on previous tested code head:** GitHub Actions runs #224 and #338 passed on Node.js 26 with 222/222 tests. One later genesis-parent-null test, plus a restore copy-ID collision assertion, bring the current branch to 223 tests; a fresh run is pending. Trigger the existing Finance Tracker contract-tests workflow manually from Actions if needed.
- Wire retention state into original-import metadata and actual Drive deletion/read-back; the current state machine is not an end-to-end deletion worker.
- Wire the backup helper to the actual Drive adapters and complete live synthetic backup, quarantine, portability, and restore rehearsals. Restore planning alone is not a completed restore.
- Perform browser termination/reload rehearsals against live Drive at all transaction boundaries; existing PR #23's 11-boundary in-memory suite remains the automated baseline.
- Test OAuth expiry, revocation, wrong account, permission denial, and reconnect live.
- Inspect the actual Cloud project's OAuth publishing status, scope declarations, API restrictions, quotas, usage, and billing configuration. Recheck Google's announced 2026 quota/billing changes.

- **Owner decision recorded (2026-11-02):** database history describes what the data is (logical paths and content hashes); separate per-copy information describes where objects are physically stored. This principle is accepted; the concrete locator-catalog format and publication protocol remain undecided.


- **Owner decision recorded (2026-11-02):** each per-copy locator catalog covers every object required by that copy's retained commit history, not merely the latest snapshot.


- **Owner decision recorded (2026-11-02):** publish locator catalogs copy-on-write and manifest-last: create and verify the complete new immutable catalog before updating the authoritative manifest pointer. A crash before publication leaves the prior manifest/catalog authoritative.

- **Owner confirmation recorded (2026-11-02):** the locator catalog is a per-copy lookup index from logical object identity (path plus SHA-256) to physical Drive location. The owner recognizes that a verified catalog can avoid repeated Drive searches and may improve latency/API efficiency; this is an expected benefit, not a measured result. Exact schema and cache/invalidation rules remain open.

- **Owner decision recorded (2026-11-02):** the per-copy locator catalog covers all immutable objects needed for normal operation and recovery: data objects, commit records, journal events, and other immutable protocol objects. The catalog does not locate itself; its identity/integrity are anchored directly in the manifest. Exact schema and implementation remain open.

- **Owner decision recorded (2026-11-02): preserve ADR §81.** Redesign commit snapshots as logicalPath → SHA-256 only; resolve Drive IDs separately per physical copy. Next choose the durable per-copy locator representation and publication/recovery contract, then update the PR #23 transaction engine, recovery verifier, backup/restore flow, and synthetic fault-injection suite together. The current PR #25 helper's fileId-plus-hash compatibility shape is transitional and not ADR-compliant.
- Obtain explicit owner acceptance of evidence and remaining limitations.

**Exit:** all evidence reviewed and explicit owner acceptance recorded. Production financial-data persistence remains disabled until the owner separately authorizes it.

## Temporary prototype navigation and MVP1 cleanup

A temporary [Prototype Tools hub](../prototype/) is available from the app footer during development. It indexes the browser-based Drive and session experiments so validation does not depend on memorizing URLs. This hub is developer-only and must not become a product feature.

**MVP1 completion gate:** remove the app-footer entry point and exclude all browser prototype pages under `prototype/` from the user-facing GitHub Pages deployment. Keep automated tests and useful engineering documentation; do not ship prototype pages, test controls, or prototype navigation as part of the MVP1 app. Verify the deployed artifact contains no prototype hub or prototype HTML pages before calling MVP1 complete.

## PR #24 integration lessons learned

- **Google Drive session-adapter token providers must be synchronous.** The folder-enumeration helper builds its Authorization header synchronously. Passing an async token-provider wrapper produces a Promise where the bearer-token string is expected, which Drive rejects as an authorization failure. The dashboard must pass `() => this.token()`, not `async () => this.token()`. A regression test in `tests/dashboard-synthetic-storage.test.mjs` protects this boundary.
- **Do not treat `authorization-required` as an empty folder or recover by writing.** Keep the existing session and data untouched, keep writes disabled, obtain a fresh Google token through the explicit user-initiated reconnect flow, and then re-inspect the existing marker before resuming.
- **A journaled file ID is an intent, not proof that the Drive object was created.** If recovery finds the manifest still at its verified base and no publication intent exists, a planned object or commit record that remains 404 after the bounded visibility window can be treated as absent: append a terminal abort, retain all journal evidence and unavailable IDs, and leave any late-arriving object untouched as an orphan. Once the commit is recorded as staged or publication is planned, missing data remains unresolved and writes stay disabled. Regression coverage exercises interruption immediately after object-stage-planned and commit-stage-planned.

## Cross-cutting product requirement: session management is automatic

Session claiming, heartbeats, ownership inspection, reconnect revalidation, stale-session recovery, and orderly release are internal application lifecycle behavior—not chores for the user. The app should perform them automatically and unobtrusively. Manual intervention is reserved for genuinely ambiguous or unsafe conditions, such as conflicting ownership, malformed/duplicate markers, authorization requiring sign-in, failed verification, or an unknown transaction outcome.

The accepted operating model is single-user/single-active-device. Simultaneous use on two devices is unsupported. Drive session coordination is best-effort detection, not a server-enforced mutex; simultaneous starts and network partitions remain limitations. The app must fail closed whenever it cannot verify ownership or transaction outcome.

## Current handoff

PR #22 merged on 2026-11-01. Its protocol specification is `docs/TRANSACTION_STAGING_AND_RECOVERY.md`; the pure implementation is `js/transaction-protocol.mjs`; tests are in `tests/transaction-protocol.test.mjs`. PR #23 adds `js/drive-transaction-engine.mjs`, `tests/drive-transaction-engine.test.mjs`, and `docs/DRIVE_TRANSACTION_ENGINE_TESTING.md`; the Drive feasibility page includes a live synthetic transaction smoke test.

PR #23 owns the durable Drive adapter, staged transaction engine, and synthetic recovery validation; its automated suites and owner-run live synthetic smoke test/cleanup have passed. PR #24 owns application integration and automatic session lifecycle; its synthetic-only lifecycle controller and dashboard are implemented, with corrective review changes and remaining live acceptance tracked in `PR24_REVIEW_HANDOFF.md`. Do not enable real ledger reads/writes or production financial-data persistence in either workstream.

Do not enable real ledger reads/writes or production financial-data persistence during these workstreams. Use invented fixtures and the dedicated synthetic Drive folder only.

## Completed checkpoints

- [x] PR #11 merged: canonical ledger/import-run contract and pure synthetic reconciliation reference module are on `main`. The full 41-test suite passed on the final reviewed PR head before merge.
- [x] PR #16 merged: Google authorization/configuration and Drive Experiments A+B integration.
- [x] PR #17 merged: typed folder-discovery outcomes, explicit Picker fallback, safe authorization/error handling, and synthetic regression coverage.
- [x] PR #17 final-head Node contract-test workflow passed (run #72).
- [x] PR #17 merge commit: `d2b941cbc10d9c3ca96c8beb7989b82ff3eef83e`.

**Verification note (confirmed 2026-10-30):** PR #17's final-head Node contract-test workflow passed (run #72), and the owner has now confirmed that the post-merge `main` workflow also succeeded. Both pre-merge and post-merge CI verification are complete. No new Pages deployment is implied by merging PR #17.

## Completed checkpoint: PR #19 merged

[PR #19 — Database identity, lifecycle, storage, and recovery architecture](https://github.com/AeroVega/finance-tracker/pull/19) merged the 108 accepted decisions. It is a documentation-only architecture baseline; it does not authorize production persistence or real financial-data storage.

The design now specifies:
- Logical database identity versus physical copies, primary/backup roles, lifecycle and derived health.
- Single-user, single-active-device operation; simultaneous use on two devices is unsupported, and the app must refuse writes when another active session is detected (best-effort detection, not a server lock).
- Required versioned manifest, UUIDs, timestamps, storage binding, and strict validation.
- Immutable content-addressed objects, complete commit snapshots, hash-chained commit history, and append-only transaction/migration records.
- Staged commits, interruption recovery, explicit initialization, verified backups/restores, copy registration, promotion, retirement, and forward-only MVP1 migrations.
- Conservative integrity gates, no offline writes, and no silent fallback to backups.

**Concurrency decision (owner-confirmed 2026-10-31):** retain Google Drive and adopt single-user, single-active-device operation. Simultaneous use on two devices is explicitly unsupported. The owner will not edit Drive files outside Finance Tracker and will end the active session before switching devices. The app must refuse writes when it detects another active session. The live raw REST probe showed that the tested Drive v3 `files.update` path accepts a deliberately stale `If-Match` value, so do not use it as a lock or spend time on the same two-session race. App-level session detection is best-effort, not a server-enforced mutex; simultaneous starts/network partitions may defeat it. Production writes remain blocked until the app demonstrates safe serialized writes, session-conflict handling, and crash recovery within this explicit operating constraint.

## Completed task: synthetic-only Google Drive feasibility spike ([PR #20](https://github.com/AeroVega/finance-tracker/pull/20))

See [Drive Feasibility Spike](DRIVE_FEASIBILITY_SPIKE.md) for the implemented Phase 1 harness, live test steps, pass/fail interpretation, and evidence log. PR #20's owner-confirmed live synthetic checks are complete. Final-head Node contract tests passed in GitHub Actions run #129 (73/73), and PR #20 merged to `main` at `1e4fc1f86948f2892b5ab88a85d6f73d632719b8`.

The merged PR #20 adds `prototype/drive-feasibility-spike.html`, its browser module, and `tests/drive-feasibility-spike.test.mjs` for the first feasibility gates. It must not read or write a real ledger. Use only a dedicated test folder and synthetic records.

**Live validation update (owner-confirmed 2026-10-31):** complete folder enumeration passed; pre-generated-ID retry returned HTTP 409; exact SHA-256 read-back passed; cleanup was confirmed. The original browser metadata response did not expose an ETag. The raw REST probe returned HTTP 200 despite a deliberately stale `If-Match`; read-back confirmed the probe description was written and Drive version advanced to 4. **The tested conditional-update mechanism failed.** The owner then accepted the single-active-device policy described above; the project is continuing with Google Drive under that explicit operating constraint.

1. **Folder visibility:** prove complete child enumeration, pagination, and safe empty-folder detection under the existing drive.file scope after Picker selection and reauthorization. The harness implements enumeration and fails closed on incomplete results.
2. **Immutable objects:** upload invented bytes, read them back, and verify raw SHA-256. This first iteration covers one isolated object, not the complete snapshot layout.
3. **Idempotent creation:** test pre-generated Drive file IDs, including a deliberately discarded successful response, same-ID retry, expected 409, and read-back verification.
4. **Session coordination:** implement best-effort active-session detection and refuse writes when another session is detected. Simultaneous use on two devices is unsupported by owner decision. Do not claim the session marker is a server-enforced lock; fail closed on ambiguous session state and document that simultaneous starts/network partitions remain a limitation.
5. **Recovery:** implement fault-injection coverage for every staged transaction boundary, including before/after manifest publication and before the final journal event. Recovery must be safe under the single-active-device operating model and must block further writes while an outcome is ambiguous.
6. **Backup/restore:** after session coordination and interruption recovery are validated, implement a synthetic snapshot copy/restore test with new `copyId`, object/hash verification, and preserved lineage.
7. **Cost and terms:** verify current Drive API terms, quotas, OAuth requirements, and the complete $0 recurring-cost path before production.

Record each result as **Verified**, **User-confirmed**, **Hypothesis**, or **Open**. A successful synthetic file round trip does not satisfy the session-coordination or recovery gates.

Phase 1 established folder enumeration, pre-generated-ID retry, exact synthetic-object hashing, and the failure of the tested raw REST stale-`If-Match` path. The owner accepted single-active-device use as the operating constraint. After PR #20 merges, implement and test session-conflict handling, serialized writes, and interruption recovery using synthetic data in a separate PR. Snapshot backup/restore and production storage remain gated until those safeguards, security, authorization, and $0-cost terms pass. No production ledger reads/writes, real financial records, or production storage implementation are in scope for this spike. Original CSV retention is 540 days (18 months) from successful private retention; backup copies must not reset that clock or resurrect expired originals.

### Historical discovery requirements retained from PR #17

A unique folder name, an earlier Picker selection, and a remembered comparison reference are not proof that a folder is the canonical Finance Tracker database. Safe onboarding and recovery must continue to respect these constraints:

1. **First connection:** authorize with Google and explicitly select the intended folder with Picker when discovery cannot safely establish identity.
2. **One exact-name match:** treat it only as a candidate until the app-owned manifest and storage binding are verified.
3. **Zero matches:** explain that no accessible match was returned; offer Picker. Never infer absence or auto-create a replacement.
4. **Multiple matches:** stop and ask the owner to select the intended folder.
5. **Missing, malformed, unsupported-version, or mismatched manifest:** stop without modifying files and explain the recovery path.

## Parallel MVP1 work: provider parsers and reporting semantics

The Drive prototype must not block the permanent file-import path.

- [ ] Add strict provider-specific parser tests for verified Wells Fargo, SoFi, and Fidelity CSV formats using fully invented fixtures.
- [ ] Implement the adapters against the merged canonical contract; preserve source dates, source descriptions, exact monetary values, account mapping, and provenance.
- [ ] Exercise repeat imports and overlapping exports through parser output, including pending-to-posted transitions, ambiguous matches, corrections/reversals, and partial-import recovery.
- [ ] Define and test report-level effective-state calculations for reversals, corrections, and explicit transfer links before reports rely on those events.
- [ ] Define investment reporting treatment for contributions, distributions, trades, dividends, fees, and market-value changes.
- [ ] Keep coverage/freshness explicit; unavailable data must never appear as zero or current.
- [ ] Keep sanitized real samples outside this public repository; never commit statements, exports, account identifiers, balances, tokens, or secrets.

## Remaining storage-readiness gates

These are required before any real ledger data may be stored in Drive. Successful synthetic folder discovery or a synthetic file round trip does not satisfy them.

- [ ] **Authorization and account handling:** verify account choice is clear; test expiry, revocation, wrong account, denied permissions, reconnect, and 401/403 recovery.
- [ ] **Session coordination and correctness:** demonstrate that the app detects an existing active session and refuses writes, serializes operations within the active session, prohibits offline writes, and recovers ambiguous outcomes. Simultaneous two-device use is explicitly unsupported; session detection is best-effort rather than a server-enforced mutex.
- [ ] **Crash/interruption recovery:** implement and test the documented staged-transaction, journal, retry, and ambiguous-outcome recovery behavior.
- [ ] **Backup, restore, and portability:** implement and test verified snapshot backup/restore, export validation, recovery steps, and portability.
- [ ] **Deletion and retention:** implement and test the approved 540-day (18-month) original-file retention lifecycle, distinguishing deletion eligibility from confirmed deletion and handling backup copies consistently.
- [ ] **Privacy/security review:** document threat model, least-privilege scope, browser token lifetime/storage, data exposure risks, and how errors/logs avoid sensitive data.
- [ ] **Sustainable cost and terms:** recheck current Google API terms/quotas and confirm the full design remains at $0 recurring cost without trials or enabling billing.
- [ ] **Owner acceptance:** review feasibility evidence, test results, failure states, and security/cost findings before separately authorizing any production-storage implementation.

## Working rules

- Work on focused feature branches and use PRs. Never commit directly to `main`, force-push, rewrite shared history, or merge without explicit owner approval.
- Read `AGENTS.md`, `README.md`, the roadmap, and relevant design docs before each new task.
- Report what was actually tested, CI/deployment status, limitations, and remaining risks. Separate **Verified**, **User-confirmed**, **Hypothesis**, and **Open** claims.
- GitHub Pages is public static hosting, not private storage. Keep the manual CSV import path permanent and keep production financial data out of the repository.
