# Current project state

**Checked:** 2026-11-17
**Repository:** [AeroVega/finance-tracker](https://github.com/AeroVega/finance-tracker)
**Main baseline before PR46 merge:** `f183cdccc9a9710e29a0da6df9f615940de19334`
**Active work:** PR46 cleanup for the selected full-snapshot format; not yet merged.

This is the concise current direction and permission boundary. [Project status](PROJECT_STATUS.md) retains dated historical evidence; the focused [full-snapshot contract](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md) owns protocol invariants.

## Chosen storage and application route

The owner selected **full-snapshot v1** as the continuing format after live synthetic testing. Dashboard and workspace use one immutable full logical-ledger snapshot and one small commit envelope per save, with verified published/clean authority updates. Open and recovery audit complete ancestry; save validates the current and new financial transition. Reports are recomputed from validated canonical financial data. Metadata read overlap does not remove integrity or ownership checks.

Create new synthetic year and Save preview to a new folder require a fresh empty synthetic folder. Open saved synthetic year only opens a supported existing full-snapshot copy. Old per-record, grouped, fragmented and partitioned layouts are unsupported, not converted, overwritten or deleted. Remove obsolete format implementations and their exclusive regression/benchmark paths rather than maintaining multiple application storage formats. Preserve shared financial validation, transport, diagnostics, ownership, integrity and recovery safeguards.

The format is synthetic-only and **not Alpha-complete**. Import and portable backup/restore are unavailable on this route and remain product requirements. Snapshot size is capped at 8 MiB, envelope/manifest at 16 KiB, and history at 10,000 commits. Full-history cost grows with retained snapshots. These limits are not bounded whole-database memory or Safari capacity claims. There is no compare-and-swap guarantee or production authorization.

## Acceptance and verification

- **User-confirmed:** on `86d1f2b3bf510fe75f678e4d4dcd28cd8d50d32d`, synthetic open took 11 seconds and save took 25 seconds, with persistence confirmed. The owner declared the open/save performance goal accomplished. The last reported seed time was 42 seconds; seed performance is a separate concern and does not reopen the accepted open/save gate. This is acceptance of the reported workflow, not a broad claim about every device, history size or network.
- **Verified before cleanup:** local extended suite 2,339/2,339 passed; exact-head [Node CI 44013565187](https://github.com/AeroVega/finance-tracker/actions/runs/44013565187) passed both required jobs. The four concurrency regressions preserve failure draining, invalidation, binding checks and serial version settling.
- **Simulated, not live:** one controlled latency-injected comparison measured save 27.80 → 25.97 seconds and seed 36.02 → 34.94 seconds. See [simulator scope and assumptions](DRIVE_SIMULATOR.md). Actual Google sign-in/Picker and physical Safari behavior are not fully emulated.
- **Verified cleanup candidate:** retained extended suite 858/858 passed, zero failures/skips/cancellations. Shared adapter, canonical JSON/hash and listing primitives were independently checked against the accepted build. Current-format, workspace and financial tests were preserved or ported; obsolete-format-only tests and writers were removed. Request counts remain unchanged in the simulator. Exact-head remote CI remains a separate gate.
- **Cleanup gate:** inspect the complete cleanup diff, independently review shared dependencies, run the retained full suite and exact-head CI. Do not apply pre-cleanup counts to the new tree or claim PR46 merged until GitHub verifies it.
- **Deployment:** independently verify the served source stamp and generated Google configuration. Branch-source Pages publication can omit those generated assets; CI success alone does not establish a usable configured deployment.

## Authorization and data boundaries

The owner explicitly requested cleanup of PR46, removal of obsolete storage-format code and tests, commitment to the current format, and merge when ready. Complete review and exact-head validation before the final merge step. This does not authorize a manual deployment or production configuration change. Existing automatic branch publication is a known side effect of the authorized PR update.

Use invented fixtures only. Do not access real transaction records, the private workbook, owner Drive financial data or production credentials. Do not access, delete or modify existing Drive folders as part of code cleanup. Production financial-data persistence is **NO-GO** until separate security/privacy/OAuth/cost/recovery review and explicit owner activation approval.

Preserve the $0 recurring-cost constraint, permanent manual file imports, no stored bank passwords and no unauthorized scraping. Green tests, owner synthetic acceptance, a merge and deployment are distinct facts.

## Next work

The performance objective for the reported synthetic save/open is accepted; do not keep pursuing that gate by default. Finish this cleanup and merge first. The next PR will focus on recovery and portable backup/restore for full-snapshot v1, using the upgraded simulator extensively before asking the owner to deploy and test. Existing protocol recovery already audits ancestry, resolves pending publication and requires a verified reopen before saving; retain that engine and its safety checks. The next work strengthens the user-facing recovery flow and adds the missing backup/restore capability, rather than treating recovery as absent. Do not implement that scope in the cleanup PR.

Supported file ingestion, monthly-summary history and remaining production controls follow that next PR; see [NEXT_STEPS.md](NEXT_STEPS.md). Seed performance remains separate. Further performance work should address a demonstrated workload or regression without weakening verification.

## Reading map

- [Agent quick start](AGENT_QUICK_START.md) and [documentation map](README.md)
- [Full-snapshot storage contract](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md)
- [Canonical financial model](CANONICAL_LEDGER_CONTRACT.md)
- [Session coordination](SESSION_COORDINATION.md), [Drive response bounds](DRIVE_RESPONSE_BOUNDS.md), and [diagnostics](APP_DIAGNOSTICS.md)
- [Testing](TESTING.md), [product definition](PRODUCT_DEFINITION.md), and [historical evidence](PROJECT_STATUS.md)
