# PR #24 critical review and continuation handoff

**Updated:** 2026-11-02. Read this alongside `NEXT_STEPS.md`, `APPLICATION_STORAGE_LIFECYCLE.md`, and `DRIVE_TRANSACTION_ENGINE_TESTING.md` before changing the integration. This is a factual review of code and evidence, not an assessment of its author.

## Current baseline

**Verified:** corrective implementation was published on `feat/application-storage-integration` as commit `2d572dc56ecb978210abbc350ac715fdb5a77c00` (PR #24). Its Git tree is `0980c65935ab2684c34820cc237260a591ee5fb6`. The locally tested commit `850d3aacef3924a6fc1e5515d7d931636ffc62ea` has the identical tree; commit metadata differs. Continue from the published feature branch, not the old `36b3031` head. Do not revert the fixes merely because they differ from an earlier chat plan.

**Verified:** `node --test tests/*.test.mjs` passes 192 tests on the fetched published commit (163 before this review). JavaScript syntax and Git whitespace checks pass. Independent code review found no remaining blocker in the corrected queue/drain/identity mechanisms. CI `transaction-contracts` and `test` passed on that exact published SHA. These results do not prove live Drive or Safari behavior.

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

- **Open:** the original Drive metadata HTTP 404. The create request format and generated-ID `space=drive` usage match the reviewed provider documentation; no malformed-upload cause was demonstrated. Preserve the current create outcome/status diagnostics rather than increasing retries without evidence.
- **User-confirmed:** the warning changed to release success without a knowingly initiated release, refresh or navigation during the save.
- **Verified:** the screenshot's exact longer green sentence originated in the old dashboard release-handler continuation; automatic `pagehide` had different status wording. **Open:** the initiating event on that device. Do not tell the owner they must have clicked Release.
- **Open:** live synthetic save/read-back/reconnect/clear behavior after these corrections, and real iPhone/iPad Safari lifecycle behavior. No live Drive mutations were performed during this review.

The new expandable dashboard diagnostic panel contains a bounded, in-memory allowlisted event history. It records state/release source/browser-event booleans and the build stamp, not tokens, folder names, file IDs, URLs, transaction rows, balances or raw errors. Reload clears it. It is observational only. Use it to establish event provenance; do not invent an idle timer (none exists).

## Deployment discrepancy discovered during verification

**Verified on 2026-11-02:** automatic run [41372655252](https://github.com/AeroVega/finance-tracker/actions/runs/41372655252), named `pages build and deployment`, completed successfully for `2d572dc`; its event is `dynamic` and path is `dynamic/pages/pages-build-deployment`. Live `app.js`, lifecycle and diagnostic-module bytes matched that published tree.

**Verified blocker:** that built-in publication served the committed placeholder `build-info.js` (`development (not deployed)`), returned HTTP 404 for `js/google-config.json`, and served the empty client/API-key placeholders from `google-config.js`. The custom `.github/workflows/deploy-pages.yml` generates both configuration files and stamps the source commit, but triggers only on `main` push or explicit dispatch. Thus a green built-in Pages run is not proof of a configured Drive application. This configuration-file 404 is separate from the earlier Drive-file metadata 404.

**Open / requires deployment authority:** reconcile the actual Pages publishing mode with the intended artifact workflow, then verify generated configuration presence (booleans only), source stamp, artifact paths and served source bytes. Do not commit configuration credentials, manually dispatch a deployment, change repository settings or merge as an unannounced workaround. No such action was taken during this review.

## Continuation rules and acceptance

1. Fetch current PR #24 feature head; preserve concurrent work. Keep review/fix commits on that branch; no force-push or merge without authorization.
2. Preserve the architecture: static modular frontend, synthetic fixtures only, local-only CSV import, best-effort single active session, strict stale/offline/unknown ownership refusal. No production persistence or PR #25 expansion.
3. Diagnose the remaining 404 using action, build, create status and privately compared requested/returned IDs. Do not post tokens, full network captures, personal data or file IDs to this public repository.
4. Confirm the deployment/configuration prerequisite before asking the owner to reproduce app behavior. Do not request another test against an unstamped or unconfigured page.
5. Run all tests at final HEAD, inspect the diff, verify remote head/tree and exact-SHA CI. Then distinguish code-tested, deployed-assets-verified, configuration-ready, and live-behavior-verified states.
6. Browser automation was unavailable in the review environment: Chromium launch failed under its sandbox setup. Node behavioral UI tests passed, but no mobile rendering claim follows from them.

This document and the PR explanation are the discoverable handoff for a continuing coding assistant. They do not imply that another assistant has read or accepted them.
