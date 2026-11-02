# PR #24 critical review and continuation handoff

**Updated:** 2026-11-02. Read this alongside `NEXT_STEPS.md`, `APPLICATION_STORAGE_LIFECYCLE.md`, and `DRIVE_TRANSACTION_ENGINE_TESTING.md` before changing the integration. This is a factual review of code and evidence, not an assessment of its author.

## Current baseline

**Verified:** the final reviewed feature branch is `feat/application-storage-integration`, at final review head `d9fb3092a1a6f06601bb1f41b5dab5a9e92c9855` (the subsequent handoff refresh is documentation-only). The live dashboard acceptance was performed against source commit `c6c9f93f54e888a721bcdf78c6d6cb09b829cbf4`; the code under test is unchanged at the current head.

**Verified:** both exact-head GitHub Actions workflows passed on `d9fb3092a1a6f06601bb1f41b5dab5a9e92c9855`: Node contract tests (run #297) and Finance Tracker contract tests (run #184). The complete Node suite reports **199 passed, 0 failed**; dashboard/browser syntax checks also passed. CI now uses Node-24-compatible v7 actions and no longer emits the Node 20 action-runtime deprecation warning. The owner subsequently completed the full live synthetic dashboard save/reconnect/clear/reconnect acceptance cycle described below. Browser automation remains unavailable in the review environment, so no independent automated iOS rendering claim is made.

## Demonstrated mistakes and their corrections

| Finding | Why it mattered | Correction and evidence |
| --- | --- | --- |
| Release set `releasing` before waiting, while every transaction guard rejected that flag. | A handoff could abort the write it was supposedly waiting to finish. | Admission closes immediately, but already-admitted operations retain ownership guards. Regression exercises actual guards, not only a dummy pending callback. |
| Recovery was checked only before the drain. | A save could become unresolved while release waited, then the app announced successful handoff anyway. | `beforeRelease` rechecks after drain, before marker mutation. Failure retains active ownership/renewal and recovery-required status. Both manual and automatic pagehide paths are covered. |
| Whole transactions and heartbeat shared one queue. | A sufficiently slow operation prevented its own renewal and could expire the 120-second lease. | A separate serialized session-operation queue handles renewals and final release. Controlled-clock tests cover more than a lease during successful and failed real-engine uploads. The reported 24-second retry alone was never proof of expiration. |
| Startup began heartbeat only after recovery. | Long initialization/recovery could consume the lease before renewal existed. | Start renewal after verified acquisition, before initialization/recovery. Preserve original ownership failures instead of masking them with a second timer-start error. |
| Several asynchronous layers independently wrote successful status. | A later completion could erase a newer ownership/recovery error. | Removed the UI handler's independent release-success writer; verify release result, lifecycle identity, terminal state and recovery flag. Recovery rechecks ownership; committed-save completion does not overwrite concurrent ownership loss. |
| Recovery examined every journal against one selected manifest. | A valid interrupted transaction from a different synthetic harness could block the dashboard. | Preflight all chains/identities, then recover only the exact database/copy pair. Foreign verified histories remain untouched; unidentified/corrupt/conflicting evidence still blocks. |
| Missing storage/lifecycle could fall through an optional call to a success message. | UI success was not necessarily evidence of any release. | Missing lifecycle and unverified results now reject. Behavioral tests cover absent storage, stale completions, and newer lifecycle replacement. |

The useful foundations remain: immutable staging, hash-verified read-back, append-only recovery evidence, explicit synthetic-only boundaries and fail-closed ownership. The corrections preserve those rather than replacing the architecture.

The common weakness was not a missing retry: asynchronous state changes were tested too independently. A green suite did not exercise the interactions between guards, drain, lease renewal and status writers. Keep the new combined tests when refactoring.

## Follow-up review: local CSV loss during Clear

**Verified by executing the actual dashboard handlers with a minimal synthetic DOM:** importing a CSV while a remote Clear was pending worked initially, but a later remote failure restored old array references and silently discarded the new import and its provenance. The old source-pattern test merely checked that rollback assignments existed; it did not test their behavior under interleaving.

**Implemented and locally verified:** Clear no longer optimistically removes local imports. It captures original row/source/fingerprint identities and removes only that selection after a verified remote result. Failure leaves both prior and new imports untouched. New CSV imports remain usable during remote I/O. A pending synthetic save/clear gates duplicate sample/clear actions and disables manual Release until the complete operation, including read-back, finishes. Five actual-handler tests cover failed/successful clear with new imports, an import already reading its file, duplicate clear/sample handlers, and imports during sample save.

**Verified on the follow-up working tree:** the complete suite passes 196 tests (five behavioral tests replace one source-pattern test). Rerun on the final published head; this count is not a substitute for live acceptance. No production-storage scope or deployment settings were changed.

## Unresolved symptoms: do not claim these are fixed

- **Residual / not reproduced in final acceptance:** the historical Drive metadata HTTP 404 has not had a definitive root cause assigned. The final owner-run end-to-end cycle completed successfully, including verified save/read-back and subsequent recovery; retain the old 404 diagnostics and do not expand retries without evidence if it recurs.
- **Historical / initiating event unproven:** an earlier warning changed to release success without a knowingly initiated release, refresh or navigation. The stale-success overwrite mechanism was corrected, and the final diagnostic trace shows two trusted release clicks followed by two completed dashboard handoffs. This does not establish the initiating event behind the earlier incident; do not claim it was definitely a user click.
- **Owner-confirmed live acceptance passed:** see the complete four-row save/reconnect/clear/reconnect cycle below. Real Drive interruption at every durable mutation boundary, backup/restore, security review and PR #25 production-readiness work remain out of scope.

The new expandable dashboard diagnostic panel contains a bounded, in-memory allowlisted event history. It records state/release source/browser-event booleans and the build stamp, not tokens, folder names, file IDs, URLs, transaction rows, balances or raw errors. Reload clears it. It is observational only. Use it to establish event provenance; do not invent an idle timer (none exists).

## Deployment discrepancy discovered during verification

**Historical deployment discrepancy — superseded for the tested build:** an earlier built-in dynamic Pages publication omitted generated Google configuration and source stamping. The owner later performed the full live dashboard acceptance against a deployed build stamped with source commit `c6c9f93f54e888a721bcdf78c6d6cb09b829cbf4`; Google authorization and Drive operations succeeded. Therefore the old unconfigured artifact is not the artifact used for final acceptance. The precise publication path/settings used for that successful build are not independently recorded here; do not infer that a future branch deployment is configured merely because CI passes. The custom `.github/workflows/deploy-pages.yml` generates the public Google config and full source stamp and can be manually dispatched for a selected ref, but deployment remains a separate, explicitly authorized action.

## Continuation rules and acceptance

1. Fetch current PR #24 feature head; preserve concurrent work. Keep review/fix commits on that branch; no force-push or merge without authorization.
2. Preserve the architecture: static modular frontend, synthetic fixtures only, local-only CSV import, best-effort single active session, strict stale/offline/unknown ownership refusal. No production persistence or PR #25 expansion.
3. Diagnose the remaining 404 using action, build, create status and privately compared requested/returned IDs. Do not post tokens, full network captures, personal data or file IDs to this public repository.
4. Confirm the deployment/configuration prerequisite before asking the owner to reproduce app behavior. Do not request another test against an unstamped or unconfigured page.
5. Run all tests at final HEAD, inspect the diff, verify remote head/tree and exact-SHA CI. Then distinguish code-tested, deployed-assets-verified, configuration-ready, and live-behavior-verified states.
6. Browser automation was unavailable in the review environment: Chromium launch failed under its sandbox setup. Node behavioral UI tests passed, but no mobile rendering claim follows from them.

This document and the PR explanation are the discoverable handoff for a continuing coding assistant. They do not imply that another assistant has read or accepted them.


## Follow-up: explicit dashboard Save and recoverable Clear controls (2026-11-02)

**Implemented on the PR #24 feature branch:** the ledger now has an explicit **Save** action. It persists only the current `syntheticTransactions` snapshot through the existing transaction engine and requires the normal verified read-back before reporting success. CSV-imported rows, source-file metadata and fingerprints are not included. Save remains disabled unless the existing synthetic storage lifecycle is `ready` and no synthetic mutation is in flight. Saving an empty synthetic snapshot is valid, allowing an explicit persisted-empty state.

**Implemented:** lifecycle status changes immediately refresh ledger action availability. Clear is disabled while an existing storage lifecycle is not `ready`, and its handler independently refuses the action in that state rather than silently clearing only the browser copy. Once ready, Clear continues to commit an empty synthetic snapshot before removing the captured local selection; on failure it preserves local rows and provenance. CSV imports remain available during remote operations and remain local-only.

**Regression coverage added:** explicit Save writes only synthetic rows while retaining local CSV rows; Save/Clear availability follows lifecycle state transitions; direct Clear invocation during uncertain ownership is refused without removing rows. These new tests supplement the existing clear/import race tests.

**Verified:** the final exact-head CI and owner-run live dashboard Save/Clear acceptance both passed. Do not use Save or Clear while recovery or ownership is uncertain; recover first and wait until the lifecycle returns to `ready`.


## Owner-confirmed live dashboard acceptance (2026-11-02)

The owner reports that the complete end-to-end synthetic storage cycle succeeded in the live dashboard on source commit `c6c9f93f54e888a721bcdf78c6d6cb09b829cbf4`:

1. Loaded four synthetic sample transactions.
2. Explicitly saved them and received the verified-save confirmation.
3. Released the Drive storage session.
4. Reconnected and confirmed all four synthetic rows were restored.
5. Cleared the synthetic transactions and saved the empty snapshot.
6. Released the session again.
7. Reconnected and confirmed zero synthetic rows were restored.

The accompanying page diagnostics show repeated `stale-session` recovery followed by `ready`, two trusted release clicks, two completed `dashboard-handoff` releases, and successful subsequent reconnections. The final page message says zero synthetic rows were restored; the dashboard separately reports that zero rows were saved and verified. CSV imports remain local.

**Performance baseline from the owner-provided trace:** initial recovery approximately 50 seconds; subsequent reconnect/recovery cycles approximately 53 and 55 seconds; each release approximately 4 seconds. Treat performance optimization as a separate follow-up. Do not weaken recovery, ownership, or read-back guarantees to reduce latency without measurement and regression coverage.

This owner-confirmed live cycle supersedes the earlier statement above that live iOS Safari/Drive acceptance was still pending for the dashboard Save/Clear workflow. It does not, by itself, close the separately tracked historical Drive metadata 404 investigation or establish production financial-data persistence; PR #24 remains synthetic-fixtures-only.


## Final review disposition (2026-11-02)

**Ready for merge review:** PR #24's intended synthetic-only application integration has passed exact-head CI and owner-confirmed live dashboard acceptance. Final review head `d9fb3092a1a6f06601bb1f41b5dab5a9e92c9855` passed both PR workflows; the full Node suite reports 199/199 passing. No unresolved code defect was identified in this final pass. The historical Drive metadata 404 root cause and earlier unsolicited-release initiating event remain unproven but were not reproduced in the successful final acceptance cycle; retain them as residual investigation items rather than silently claiming root-cause closure.

**Scope guardrails remain:** synthetic fixtures only, dedicated folder name containing `synthetic`, CSV imports local-only, fail-closed ownership/recovery, no production ledger persistence. PR #25 still owns the remaining fault-injection/live interruption rehearsals, backup/restore/portability, OAuth/security, 540-day retention/deletion, current terms/quotas/$0-cost review, and explicit owner acceptance.

**Performance follow-up:** owner-observed recovery takes approximately 50 seconds initially and 53–55 seconds on subsequent reconnects; orderly release takes approximately 4 seconds. Investigate request-level timings in a separate performance task. Do not weaken integrity or ownership checks to improve latency.
