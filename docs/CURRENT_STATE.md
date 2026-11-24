# Current project state

**Checked:** 2026-11-24
**Repository:** [AeroVega/finance-tracker](https://github.com/AeroVega/finance-tracker)

## Owner decision: GO for real financial data

On 2026-11-24, the owner confirmed that the [PR 57 acceptance checks](https://github.com/AeroVega/finance-tracker/pull/57) were complete and approved real financial data use as of the deployed commit produced by merging [PR 61](https://github.com/AeroVega/finance-tracker/pull/61) to `main`.

The approved SHA is the full merge-result commit reported by GitHub for PR 61 and matched to the deployed Pages source stamp. It is not the draft branch head or an earlier acceptance-test build. Verify that match before relying on the approval, and retain the deployment run as evidence. The record does not name its own SHA because it is assigned when the PR lands.

From that baseline, treat real financial data as a supported-use requirement for every subsequent merge to `main`. Preserve account and folder isolation, verified saves and recovery, encrypted private backups, and the existing required checks and owner review. Changes that affect those safeguards need evidence appropriate to their scope. Development, CI, diagnostics, and public artifacts still use invented data only; private account and folder details stay private.

This is an authorization record, not a runtime change. The checked-in [release profile](../js/release-profile.mjs) still allows only synthetic mode, so merging this record alone does not make Private database mode available. Do not enter real records into the synthetic workspace or infer support for the separate historical migration workflow.

The [security, privacy, OAuth, cost and recovery review](SECURITY_PRIVACY_OAUTH_COST_RECOVERY_REVIEW.md) retains its dated findings and pre-approval status. [Project status](PROJECT_STATUS.md) retains historical evidence; the [full-snapshot contract](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md) owns protocol invariants.

## Chosen storage and application route

The owner selected **full-snapshot v1** as the continuing format after live synthetic testing. Dashboard and workspace use one immutable full logical-ledger snapshot and one small commit envelope per save, with verified published/clean authority updates. Open and recovery audit complete ancestry; save validates the current and new financial transition. Reports are recomputed from validated canonical financial data. Metadata read overlap does not remove integrity or ownership checks.

Create new synthetic year and Save preview to a new folder require a fresh empty synthetic folder. Open saved synthetic year only opens a supported existing full-snapshot copy. Old per-record, grouped, fragmented and partitioned layouts are unsupported, not converted, overwritten or deleted. Remove obsolete format implementations and their exclusive regression/benchmark paths rather than maintaining multiple application storage formats. Preserve shared financial validation, transport, diagnostics, ownership, integrity and recovery safeguards.

The shipped release profile remains synthetic-only. The supported Wells Fargo, SoFi and Fidelity CSV application workflow is merged. The owner confirmed the Wells Fargo import, save and reopen path on the PR head; that is not evidence for all providers/devices. Post-merge Node and Pages workflows succeeded; this is not an independent live-browser check. The [historical-summary workflow](HISTORICAL_MONTHLY_SUMMARY.md) merged in [PR 54](https://github.com/AeroVega/finance-tracker/pull/54) and is present on the served synthetic build; that does not establish exact-build live Drive acceptance. Recovery and portable backup/restore remain implemented in the selected full-snapshot route; do not infer live acceptance beyond the evidence recorded in the relevant PRs. See the [backup/recovery contract](FULL_SNAPSHOT_BACKUP_RECOVERY.md). Snapshot size is capped at 8 MiB, envelope/manifest at 16 KiB, and history at 10,000 commits. Full-history cost grows with retained snapshots. These limits are not bounded whole-database memory or Safari capacity claims. There is no compare-and-swap guarantee.

## Acceptance and verification

- **User-confirmed:** on `86d1f2b3bf510fe75f678e4d4dcd28cd8d50d32d`, synthetic open took 11 seconds and save took 25 seconds, with persistence confirmed. The owner declared the open/save performance goal accomplished. The last reported seed time was 42 seconds; seed performance is a separate concern and does not reopen the accepted open/save gate. This is acceptance of the reported workflow, not a broad claim about every device, history size or network.
- **User-confirmed (PR 57, 2026-11-24):** live synthetic acceptance on `58f7a52` and revocation/reconnect on `f387592` passed; no billing account is linked (the project cannot be charged); the owner accepted best-effort single-device coordination and the uncertain-last-write procedure, set a 3-month encrypted backup cadence, and set a capacity review trigger (100 MB of saved history or Open over 60 seconds on iPhone). See the [owner gate record](SECURITY_PRIVACY_OAUTH_COST_RECOVERY_REVIEW.md#owner-gate-record-2026-11-24).
- **Verified before cleanup:** local extended suite 2,339/2,339 passed; exact-head [Node CI 44013565187](https://github.com/AeroVega/finance-tracker/actions/runs/44013565187) passed both required jobs. The four concurrency regressions preserve failure draining, invalidation, binding checks and serial version settling.
- **Simulated, not live:** one controlled latency-injected comparison measured save 27.80 → 25.97 seconds and seed 36.02 → 34.94 seconds. See [simulator scope and assumptions](DRIVE_SIMULATOR.md). Actual Google sign-in/Picker and physical Safari behavior are not fully emulated.
- **Verified cleanup candidate:** retained extended suite 858/858 passed, zero failures/skips/cancellations. Shared adapter, canonical JSON/hash and listing primitives were independently checked against the accepted build. Current-format, workspace and financial tests were preserved or ported; obsolete-format-only tests and writers were removed. Request counts remain unchanged in the simulator. Exact-head remote CI subsequently passed for the cleanup PR47.
- **Verified cleanup merge:** PR46 was merged before cleanup; follow-up PR47 completed cleanup. Its exact-head Node CI 44019112471 passed both required jobs, and merged main `ae10e45` has the reviewed tree `5c97803`. New feature tests and CI are separate gates.
- **Deployment:** independently verify the served source stamp and generated Google configuration. Branch-source Pages publication can omit those generated assets; CI success alone does not establish a usable configured deployment. The November 23 [verification update](SECURITY_PRIVACY_OAUTH_COST_RECOVERY_REVIEW.md#november-23-verification-update) records the exact served build and checks.

## Authorization and data boundaries

[PR 57](https://github.com/AeroVega/finance-tracker/pull/57) delivered readiness changes and the acceptance evidence above. Use invented fixtures for development and verification. Do not give agents or test jobs real transaction records, the private workbook, owner Drive financial data, or production credentials. Do not access, delete, or modify existing Drive folders as part of code cleanup.

Preserve the $0 recurring-cost constraint, permanent manual file imports, no stored bank passwords and no unauthorized scraping. Green tests, owner synthetic acceptance, a merge and deployment are distinct facts.

## Next work

The performance objective for the reported synthetic save/open is accepted. Recovery and portable backup/restore are implemented in the selected full-snapshot route; preserve their existing contracts and do not reopen unchanged acceptance gates without a demonstrated defect.

Preserve the real-data baseline and existing safeguards. **Guarded code checks** is required on `main`; the owner reviews the exact-SHA diff. Legacy Excel migration remains a separate workflow. Revisit performance only for a demonstrated workload or regression, without weakening verification.

## Reading map

- [Agent quick start](AGENT_QUICK_START.md) and [documentation map](README.md)
- [Full-snapshot storage contract](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md)
- [Canonical financial model](CANONICAL_LEDGER_CONTRACT.md)
- [Session coordination](SESSION_COORDINATION.md), [Drive response bounds](DRIVE_RESPONSE_BOUNDS.md), and [diagnostics](APP_DIAGNOSTICS.md)
- [Testing](TESTING.md), [product definition](PRODUCT_DEFINITION.md), and [historical evidence](PROJECT_STATUS.md)
