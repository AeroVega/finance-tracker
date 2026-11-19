# Current project state

**Checked:** 2026-11-19
**Repository:** [AeroVega/finance-tracker](https://github.com/AeroVega/finance-tracker)
**Main baseline:** `2f527adb663e7112bd31d480fceede4b62f1baa4` ([PR 53](https://github.com/AeroVega/finance-tracker/pull/53) merged)
**Active work:** historical monthly summaries on `feature/alpha-historical-monthly-summaries`. This separate Alpha increment uses invented normalized JSON. No merge or deployment of this work is authorized.

This is the concise current direction and permission boundary. [Project status](PROJECT_STATUS.md) retains dated historical evidence; the focused [full-snapshot contract](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md) owns protocol invariants.

## Chosen storage and application route

The owner selected **full-snapshot v1** as the continuing format after live synthetic testing. Dashboard and workspace use one immutable full logical-ledger snapshot and one small commit envelope per save, with verified published/clean authority updates. Open and recovery audit complete ancestry; save validates the current and new financial transition. Reports are recomputed from validated canonical financial data. Metadata read overlap does not remove integrity or ownership checks.

Create new synthetic year and Save preview to a new folder require a fresh empty synthetic folder. Open saved synthetic year only opens a supported existing full-snapshot copy. Old per-record, grouped, fragmented and partitioned layouts are unsupported, not converted, overwritten or deleted. Remove obsolete format implementations and their exclusive regression/benchmark paths rather than maintaining multiple application storage formats. Preserve shared financial validation, transport, diagnostics, ownership, integrity and recovery safeguards.

The format remains synthetic-only and **not Alpha-complete**. The supported Wells Fargo, SoFi and Fidelity CSV application workflow is merged. The owner confirmed the Wells Fargo import, save and reopen path on the PR head; that is not evidence for all providers/devices. Post-merge Node and Pages workflows succeeded; this is not an independent live-browser check. The [historical-summary contract](HISTORICAL_MONTHLY_SUMMARY.md) describes the separate Alpha increment, which has not been merged, deployed or owner-accepted. Recovery and portable backup/restore remain implemented in the selected full-snapshot route; do not infer live acceptance beyond the evidence recorded in the relevant PRs. See the [backup/recovery contract](FULL_SNAPSHOT_BACKUP_RECOVERY.md). Snapshot size is capped at 8 MiB, envelope/manifest at 16 KiB, and history at 10,000 commits. Full-history cost grows with retained snapshots. These limits are not bounded whole-database memory or Safari capacity claims. There is no compare-and-swap guarantee or production authorization.

## Acceptance and verification

- **User-confirmed:** on `86d1f2b3bf510fe75f678e4d4dcd28cd8d50d32d`, synthetic open took 11 seconds and save took 25 seconds, with persistence confirmed. The owner declared the open/save performance goal accomplished. The last reported seed time was 42 seconds; seed performance is a separate concern and does not reopen the accepted open/save gate. This is acceptance of the reported workflow, not a broad claim about every device, history size or network.
- **Verified before cleanup:** local extended suite 2,339/2,339 passed; exact-head [Node CI 44013565187](https://github.com/AeroVega/finance-tracker/actions/runs/44013565187) passed both required jobs. The four concurrency regressions preserve failure draining, invalidation, binding checks and serial version settling.
- **Simulated, not live:** one controlled latency-injected comparison measured save 27.80 → 25.97 seconds and seed 36.02 → 34.94 seconds. See [simulator scope and assumptions](DRIVE_SIMULATOR.md). Actual Google sign-in/Picker and physical Safari behavior are not fully emulated.
- **Verified cleanup candidate:** retained extended suite 858/858 passed, zero failures/skips/cancellations. Shared adapter, canonical JSON/hash and listing primitives were independently checked against the accepted build. Current-format, workspace and financial tests were preserved or ported; obsolete-format-only tests and writers were removed. Request counts remain unchanged in the simulator. Exact-head remote CI subsequently passed for the cleanup PR47.
- **Verified cleanup merge:** PR46 was merged before cleanup; follow-up PR47 completed cleanup. Its exact-head Node CI 44019112471 passed both required jobs, and merged main `ae10e45` has the reviewed tree `5c97803`. New feature tests and CI are separate gates.
- **Deployment:** independently verify the served source stamp and generated Google configuration. Branch-source Pages publication can omit those generated assets; CI success alone does not establish a usable configured deployment.

## Authorization and data boundaries

The owner approved synthetic-only implementation of historical monthly summary review and persistence in a separate draft PR. This authorizes code, synthetic tests and a draft PR, not merge, deployment, production configuration changes or real-data access. Backup is the last verified saved logical database, optionally password-encrypted. Restore is fresh-empty-folder-only with independent verification. Drafts remain in memory only; safe recovery is automatic, retry explicit.

Use invented fixtures only. Do not access real transaction records, the private workbook, owner Drive financial data or production credentials. Do not access, delete or modify existing Drive folders as part of code cleanup. Production financial-data persistence is **NO-GO** until separate security/privacy/OAuth/cost/recovery review and explicit owner activation approval.

Preserve the $0 recurring-cost constraint, permanent manual file imports, no stored bank passwords and no unauthorized scraping. Green tests, owner synthetic acceptance, a merge and deployment are distinct facts.

## Next work

The performance objective for the reported synthetic save/open is accepted. Recovery and portable backup/restore are implemented in the selected full-snapshot route; preserve their existing contracts and do not reopen unchanged acceptance gates without a demonstrated defect.

Verify historical monthly-summary persistence/review in its separate PR, followed by the purpose-built legacy workbook converter in another separate PR. Keep remaining production controls as a distinct NO-GO review. The dependency order and acceptance boundaries are maintained in [NEXT_STEPS.md](NEXT_STEPS.md). Seed performance remains separate. Further performance work should address a demonstrated workload or regression without weakening verification.

## Reading map

- [Agent quick start](AGENT_QUICK_START.md) and [documentation map](README.md)
- [Full-snapshot storage contract](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md)
- [Canonical financial model](CANONICAL_LEDGER_CONTRACT.md)
- [Session coordination](SESSION_COORDINATION.md), [Drive response bounds](DRIVE_RESPONSE_BOUNDS.md), and [diagnostics](APP_DIAGNOSTICS.md)
- [Testing](TESTING.md), [product definition](PRODUCT_DEFINITION.md), and [historical evidence](PROJECT_STATUS.md)
