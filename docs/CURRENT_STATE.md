# Current project state

**Checked:** 2026-11-24
**Repository:** [AeroVega/finance-tracker](https://github.com/AeroVega/finance-tracker)

This is the one place for mutable project status and the permission boundary. Other documents link here instead of copying it. [Project history](PROJECT_STATUS.md) holds the dated timeline.

## Owner decision: GO for real financial data

On 2026-11-24 the owner confirmed that the [PR 57 acceptance checks](https://github.com/AeroVega/finance-tracker/pull/57) were complete and declared the project **GO for real financial data**. [PR 61](https://github.com/AeroVega/finance-tracker/pull/61) has merged to `main`; its merge was the owner's authorization act. This record names no commit SHA.

**This GO is standing.** The authoritative statement of it, the merge rules and the standing rules is [Standing owner authorization in AGENTS.md](../AGENTS.md#standing-owner-authorization), a guarded file, so this frequently edited page cannot change them. The pre-GO checklist is archived as [OWNER_ACCEPTANCE_2026-11-24.md](archive/OWNER_ACCEPTANCE_2026-11-24.md).

What this means for every later merge to `main`:

- Real financial data is a supported-use requirement. Preserve account and folder isolation, verified saves and recovery, encrypted private backups, and the existing required checks and owner review.
- A change that affects those safeguards (guarded code) needs evidence suited to its scope and is merged only by the owner, after an agent-assisted review. See the [merge policy](GUARDED_CODE.md).
- Development, CI, diagnostics and public artifacts still use invented data only. Private account and folder details stay private.

The merge listed `production` in the checked-in [release profile](../js/release-profile.mjs), so Private database mode is available in the served build under the [release gate](PERSISTENCE_DATA_CLASS.md#release-gate-what-static-code-can-and-cannot-enforce). Synthetic remains the default.

Practices for real records:

1. After a deployment, spot-check the served build stamp and profile; this is a check for the owner or agent, not a gate.
2. Do not enter real records into the synthetic workspace.
3. The workbook history migration is done in the app's History migration page into the private database (owner direction, 2026-11-25; see [In-app history migration](HISTORICAL_MONTHLY_SUMMARY.md#in-app-history-migration)). It applies once its guarded PR is merged and deployed. Only the owner types real figures; agents and tests use invented values.

The [security and cost review](SECURITY_AND_COST_REVIEW.md) retains its dated findings and pre-approval status.

## Storage

The owner selected **full-snapshot v1** after live synthetic testing. Each save writes one immutable full logical-ledger snapshot and one small commit envelope, then verifies the published/clean authority update. Open and recovery audit the complete ancestry. Save validates the current and new financial transition. Reports are recomputed from validated canonical data.

- **Creating:** *Create new synthetic year* and *Save preview to a new folder* need a fresh empty synthetic folder. *Open saved synthetic year* opens only a supported full-snapshot copy.
- **Older layouts** (per-record, grouped, fragmented, partitioned) are unsupported. They are not converted, overwritten or deleted. Their code and exclusive tests are removed; see [retired storage designs](archive/RETIRED_STORAGE_DESIGNS.md).
- **Limits:** snapshot 8 MiB, envelope/manifest 16 KiB, history 10,000 commits. Full-history cost grows with retained snapshots. These are not whole-database memory or Safari capacity claims. There is no compare-and-swap guarantee.
- **Contracts:** [full-snapshot storage](FULL_SNAPSHOT_STORAGE.md) and [backup and recovery](FULL_SNAPSHOT_BACKUP_RECOVERY.md).

## Application features

- **Supported CSV import** for Wells Fargo, SoFi and Fidelity is merged. The owner confirmed the Wells Fargo import, save and reopen path on the PR head. That is not evidence for the other providers or all devices.
- **Historical monthly summaries** ([PR 54](https://github.com/AeroVega/finance-tracker/pull/54), [workflow](HISTORICAL_MONTHLY_SUMMARY.md)) are present on the served synthetic build. The localhost wizard from [PR 58](https://github.com/AeroVega/finance-tracker/pull/58) is replaced by the in-app **History migration** page (`#migration`) in [PR 66](https://github.com/AeroVega/finance-tracker/pull/66), which also lets history be staged into the private database. Neither the page nor that change has had a live Drive acceptance run.
- **Portable encrypted backup and restore** and recovery are implemented in the selected route. Do not infer live acceptance beyond the evidence in the relevant PRs.
- **Post-merge** Node and Pages workflows succeeded. That is not an independent live-browser check.
- **Redesigned shell and Home** merged in [PR 62](https://github.com/AeroVega/finance-tracker/pull/62). It changes presentation only; see [Design](DESIGN.md). Further UX slices are in [Next steps](NEXT_STEPS.md).
- **Accounts redesign** (institution-grouped list, per-account detail with dots-only balance observations, a 12-month coverage strip and next steps for each gap; holdings folded into investment account detail) is in progress on `t3/accounts-detail-ux`. It changes presentation and navigation only: position and coverage rules are unchanged. See [Design § Accounts](DESIGN.md#accounts).
- **Activity discovery** (type and category filters, sorting, month grouping, inline review decisions) is in progress in [PR 64](https://github.com/AeroVega/finance-tracker/pull/64). Reporting rules are unchanged. Following the owner's 2026-11-25 decision, category rules for later imports are opt-in and audit notes are suggested from templates; see [Product § 4.6](PRODUCT_DEFINITION.md#46-categories).

## Acceptance and verification

The table is dated evidence behind the 2026-11-24 GO, not a list of open gates.

| Claim | Evidence | Scope |
| --- | --- | --- |
| **User-confirmed** open and save speed | On `86d1f2b`: synthetic open 11 s, save 25 s, persistence confirmed. Last reported seed time was 42 s, a separate concern. | The reported workflow only. Not every device, history size or network. |
| **User-confirmed** PR 64 device check (2026-11-25) | The owner deployed `fa25e1d` and, in iPhone Safari, corrected flagged transactions, staged and saved them, and set and cleared filters. The two-tab check passed: a second tab was refused the same Drive folder while the first tab's heartbeat held the claim. The release check also passed. | That build only. Later PR 64 changes (opt-in rules, template notes) were not part of this check. |
| **User-confirmed** PR 57 acceptance (2026-11-24) | Live synthetic acceptance on `58f7a52`; revocation and reconnect on `f387592`. No billing account is linked, so the project cannot be charged. The owner accepted best-effort single-device coordination and the uncertain-last-write procedure, set a 3-month encrypted backup cadence, and set a capacity review trigger (100 MB of saved history, or Open over 60 s on iPhone). | See the [owner gate record](SECURITY_AND_COST_REVIEW.md#owner-gate-record-2026-11-24). |
| **Verified** pre-cleanup tree | Local extended suite 2,339/2,339. [Node CI 44013565187](https://github.com/AeroVega/finance-tracker/actions/runs/44013565187) passed both required jobs. | That tree, not later changes. |
| **Verified** cleanup | Retained suite 858/858 with no failures or skips. PR 46 merged, then PR 47 removed obsolete formats. Exact-head Node CI 44019112471 passed. Merged `main` `ae10e45` has tree `5c97803`. | Cleanup only. New feature tests and CI are separate gates. |
| **Simulated, not live** | One latency-injected comparison: save 27.80 → 25.97 s, seed 36.02 → 34.94 s. | See [simulator scope](DRIVE_SIMULATOR.md). Google sign-in, Picker and physical Safari are not emulated. |

**Deployment** must be checked independently: verify the served source stamp and generated Google configuration. Branch-source Pages publication can omit those generated assets, and CI success alone does not prove a usable configured deployment. The [Nov 23 verification update](SECURITY_AND_COST_REVIEW.md#november-23-verification-update) records one checked build.

## Authorization and data boundaries

- Use invented fixtures for development and verification. Do not give agents or test jobs real transaction records, the private workbook, owner Drive financial data, or production credentials.
- Do not access, delete or modify existing Drive folders as part of code cleanup.
- Preserve the $0 recurring-cost constraint, permanent manual file imports, no stored bank passwords and no unauthorized scraping.
- Green tests, owner synthetic acceptance, a merge and a deployment are distinct facts.
- **Guarded code checks** is required on `main`. Guarded changes are merged only by the owner after an agent-assisted review; other changes merge on green required checks. See [Guarded code](GUARDED_CODE.md).

## Next work

See [Next steps](NEXT_STEPS.md). Do not reopen accepted performance or recovery gates without a demonstrated defect. Revisit performance only for a demonstrated workload or regression, without weakening verification. Legacy Excel migration stays a separate workflow.

## Reading map

[Agent quick start](AGENT_QUICK_START.md) · [Documentation map](README.md) · [Canonical financial model](CANONICAL_LEDGER_CONTRACT.md) · [Session coordination](SESSION_COORDINATION.md) · [Drive response bounds](DRIVE_RESPONSE_BOUNDS.md) · [Diagnostics](APP_DIAGNOSTICS.md) · [Testing](TESTING.md) · [Product definition](PRODUCT_DEFINITION.md)
