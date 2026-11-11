# Finance Tracker

[Open Finance Tracker](https://aerovega.github.io/finance-tracker/)

A second-generation personal finance tracker built around trustworthy data, transparent calculations, and privacy-first handling of financial information.

**North Star:** a personal financial intelligence application that helps the user understand their financial position, evaluate possible futures, and make informed decisions. Mobile-first, tablet-friendly, and desktop-capable. The intended **1.0.0 release target is January 1, 2027**, subject to scope and release-readiness gates.

> **Privacy warning:** This repository is public. Never commit real financial data, account exports, statements, credentials, access tokens, or production secrets. Assume everything committed here can be read by anyone.

## Project status

**Storage draft, November 11, 2026:** the owner-authorized
[incremental storage foundation](docs/SCALABLE_STORAGE_FOUNDATION.md) adds segmented
catalogs, verified/rebuildable monthly reports, bounded Drive responses and direct
backup improvements. It does not complete bounded full-database loading or lift
production NO-GO. Main remains `04aacf31b8aaae31fa73b10408fa22d417c0d943` at this
review. No merge or deployment is part of this work. The earlier status below is
a dated record.

**Verified November 10, 2026:** main at `d38681ee013cbe3e52dd861264f70490935c3582` includes the merged canonical workspace, PR32 and its PR34 preview-persistence/transfer-link follow-up. PR33's engineering workflows are also merged. The synthetic app can browse saved years, inspect evidence, stage corrections, explicitly save/reopen, save a local preview to a fresh synthetic folder and manually link transfers.

**Alpha is not complete.** Financial position and reconciled coverage, historical monthly summaries from January 2023, and production controls remain. The main workspace does not yet ingest owner CSVs; the advanced canonical import workbench uses invented fixtures. See [project status](docs/PROJECT_STATUS.md) for code and PR evidence and [next steps](docs/NEXT_STEPS.md) for the four-step Alpha sequence.

Main's [Node tests passed](https://github.com/AeroVega/finance-tracker/actions/runs/42752426272), but its [Pages deployment failed at configuration](https://github.com/AeroVega/finance-tracker/actions/runs/42752426270), before artifact upload. The live served SHA remains unverified in this audit. Merged, tested and deployed are separate states.

Production financial-data persistence remains **NO-GO**. [PR27](docs/PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md) merged the plan only. Implementation, actual OAuth/configuration/privacy/cost review, live synthetic acceptance and explicit owner production authorization remain required. The owner does not require a separate real-data smoke test. Do not use real records in GitHub, CI or routine acceptance.

Google Drive remains the selected private-storage direction, with a single active device and best-effort session coordination. Earlier [storage acceptance](docs/SYNTHETIC_STORAGE_ACCEPTANCE.md) and [PR28 acceptance](docs/PR28_CANONICAL_IMPORT.md) remain useful bounded evidence, not approval of every later path. Current canonical format policy is fragmented v3 for new stores, readable per-record v1, and rejection of standalone grouped v2.

## Focused mobile pages

The [mobile workspace redesign](docs/MOBILE_WORKSPACE_PAGES.md) separates Overview, Activity, Position, Review and Storage. Holdings and reconciliation have dedicated subpages. Page changes keep the synthetic ledger and unfinished editors in memory. The compact draft bar appears only when changes or an operation need attention. Rendered/device acceptance remains outstanding.

## Financial position and reconciled coverage

The authorized synthetic [financial-position milestone](docs/FINANCIAL_POSITION.md) adds dated balances, source-backed conflict decisions, holdings evidence, debt balances and per-account/month reconciliation to the canonical workspace. Its separate invented position scenario demonstrates exact assets minus liabilities without treating transaction sums as balances. It retains explicit save/reopen and recovery boundaries. Review and owner/device acceptance remain outstanding; production persistence remains **NO-GO**.

## Start here

- [Documentation guide](docs/README.md)
- [Current project status and evidence](docs/PROJECT_STATUS.md)
- [Project charter](docs/PROJECT_CHARTER.md)
- [Next steps and handoff checklist](docs/NEXT_STEPS.md)
- [Production persistence plan and review boundaries](docs/PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture decisions and open questions](docs/ARCHITECTURE_DECISIONS.md)
- [Database identity and lifecycle architecture (PR #19, merged)](docs/DATABASE_IDENTITY_AND_LIFECYCLE.md)
- [Private storage architecture](docs/PRIVATE_STORAGE_ARCHITECTURE.md)
- [Google Drive feasibility spike and live test procedure](docs/DRIVE_FEASIBILITY_SPIKE.md)
- [Security and privacy requirements](docs/SECURITY.md)
- [Data-source research](docs/DATA_SOURCES.md)
- [Data model and reconciliation principles](docs/DATA_MODEL.md)
- [Contributor and agent instructions](AGENTS.md)

## Canonical application workflow

**Implemented, synthetic-only:** [Open the main workspace](index.html) to explore saved synthetic years by account and month, inspect source evidence, stage auditable corrections, explicitly save/reopen through the existing canonical storage engines, save the exact local preview (including staged corrections) to a new empty synthetic folder, and manually link outgoing/incoming transfer activities with append-only audit evidence. See [scope, limits and the new owner acceptance checks](docs/CANONICAL_MAIN_WORKSPACE.md). The owner accepted the earlier PR32 local exploration/correction/mobile experience; the newer persistence and transfer-link paths still need live acceptance. PR30 device results do not validate later changes. Balances, holdings, migration and production authorization remain later work.

## Synthetic financial year

[Seed an invented year](prototype/synthetic-year.html) uploads a reproducible 2025 canonical ledger to a newly created empty synthetic Drive folder you choose. It preserves source observations and audit events for future visualization, insight and projection tests. Fresh-folder checks, exact read-back and conservative retry protect existing records. The [canonical main workspace](docs/CANONICAL_MAIN_WORKSPACE.md) now opens the saved year, browses accounts and months, stages auditable corrections, and explicitly saves and reopens it. Read [the recipe, operating steps and validation limits](docs/SYNTHETIC_FINANCIAL_YEAR.md). Production persistence remains **NO-GO**; live acceptance and deployment are separate.

The [Drive history verification follow-up](docs/DRIVE_HISTORY_VERIFICATION.md) reduces repeated downloads during saves by checking private, bounded session evidence against fresh Drive file versions. Full reconnect and backup integrity checks remain. This is a synthetic implementation, not production or live-Google acceptance.

The [PR30 integrated performance report](docs/PR30_PERFORMANCE_INTEGRATION.md) collects the reviewed CPU, session, CSV and storage changes, final combined checks, and remaining limits. Fragmented v3 is the default for new canonical stores and fresh synthetic copies. Existing per-record v1 copies remain readable; standalone grouped-v2 copies are rejected. Existing folders are not silently migrated, and this does not establish mobile capacity.

## PR28 canonical import foundation

The [approved PR28 scope](docs/PR28_IMPLEMENTATION_SCOPE.md) implements a synthetic-only CSV → account/coverage mapping → review → canonical save → reopen flow using the merged storage machinery. The [implementation contract and verification guide](docs/PR28_CANONICAL_IMPORT.md) describe the record model, tested provider variants, and acceptance evidence. The development-only [invented import workbench](prototype/pr28-import.html) accepts bundled fixtures only. Production activation remains subject to the [PR27 plan](docs/PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md) and separate implementation, acceptance, and owner authorization.

The current synthetic workbench preserves unsaved changes in the tab after session release; release does not save or erase that draft. The approved future production policy clears working financial data and the token on sign-out or normal orderly release. That production behavior still needs implementation and validation. This planning reconciliation changes no application behavior. See [the release-clearing gap](docs/PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md#current-pr28-release-behavior-and-production-gap).

Start with the [current owner acceptance guide](docs/OWNER_ACCEPTANCE.md). The [acceptance suite](prototype/acceptance.html) still contains obsolete grouped-v2 instructions; mark those phases blocked until its plan is corrected. Its [guided import runner](prototype/pr28-testing.html) retains the tested PR28 workflow. Connect a fresh empty synthetic folder and press **Run live checks**. It supplies the invented mappings and decisions, checks three saved checkpoints through the existing workbench/storage APIs, verifies a portable export in memory, and releases the session. Reconnect to the same folder and press **Verify saved run after reconnect** for the last assertion. Human device/OAuth, whole-tab interruption and new-folder backup/restore checks remain separate. The safe report contains fixed statuses and aggregate request metrics, never financial records or Drive identifiers. No run starts on page load. See [storage performance evidence and safety boundaries](docs/PR28_STORAGE_PERFORMANCE.md).

The manual steps now have adjacent controls, progress and timing. The interruption helper prepares its disposable fixture and verifies the exact recovered graph before any single retry. The [guided backup and restore flow](prototype/pr25-acceptance.html?guide=pr28) reuses the completed source, compares independent copy reopens automatically, and distinguishes the actual saved-file roundtrip from an in-memory export. You still choose folders/files, approve Google access, close the paused tab and confirm stopped sessions when required. The owner completed bounded live retests of these changed paths on `626ec025`; the earlier device checks remain tied to `70728162`. See [the latest results and remaining checks](docs/PR28_CANONICAL_IMPORT.md#owner-guide-retests-on-626ec025-november-8-2026).

## Temporary prototype navigation

PR #29 squash-merged on November 8, 2026. It extends the original visual reference across the main workspace, guided acceptance pages and development tools. The [visual overhaul record](docs/PR29_VISUAL_OVERHAUL.md) explains the changes, the PR28 lessons they address, and the validation limits. The main workspace now reads synthetic canonical records through the [step-1 application flow](docs/CANONICAL_MAIN_WORKSPACE.md). The previous raw-CSV/sample page remains a separate [local preview diagnostic](prototype/local-preview.html). Production data remains disabled. PR29 preserved the original prototypes. The later owner-authorized [cleanup](docs/PROTOTYPE_CLEANUP.md) replaces the crowded entry point with one acceptance suite, retires the superseded visual sandbox and first Drive probe UI, and retains every unique recovery and diagnostic path.

During development, the workspace links to the [acceptance suite](prototype/acceptance.html) and a smaller [test tools index](prototype/). The [owner guide](docs/OWNER_ACCEPTANCE.md) explains the remaining physical Safari, OAuth, save/reopen, interruption, backup/restore and device handoff checks. Specialist diagnostics are grouped separately. The hub and all browser prototype pages are development-only. **They are not v1.0.0 product features.** Before the v1.0.0 release, remove the app entry point and ensure the `prototype/` pages are excluded from the user-facing GitHub Pages deployment. Retain only the automated tests and engineering documentation needed to support the shipped product.

## Deploying a branch for experiments

The GitHub Pages URL is a **single shared deployment**, not an isolated staging environment. The deployed page is public, and whichever branch is deployed is what every visitor sees.

- A push to `main` automatically deploys `main`.
- To try a branch without merging it: open **Actions → Deploy static site to GitHub Pages → Run workflow**, choose the desired branch in the branch selector, then run the workflow.
- The workflow checks out the selected ref and stamps the deployed artifact with that checked-out commit's full 40-character SHA. The dashboard and acceptance suite show that SHA.
- To restore the stable version, manually run the same workflow with `main` selected, or push an approved change to `main`.
- A later push to `main` will replace an experimental deployment. Deployments share one concurrency group, so a newer run can cancel an in-progress deployment.

The build SHA is generated in the Actions workspace and is not committed back to the source branch. The `development (not deployed)` label is only the local/source fallback; a successful Pages deployment should display a full SHA.

## Non-negotiable constraints

1. No recurring costs for hosting, storage, aggregation, refresh, or AI.
2. No real personal financial data or secrets in this public repository.
3. No stored bank passwords, unauthorized scraping, or reliance on expiring trials.
4. Manual file imports remain a permanent fallback.
5. Finance Tracker is single-user and single-active-device; simultaneous use on two devices is unsupported. The app must refuse writes when it detects another active session.
6. Do not enable production financial-data storage until data access, storage, authentication, sequential device handoff, recovery, and security have been implemented and reviewed.
7. Distinguish verified facts, user-confirmed observations, hypotheses, and open questions.

## Working approach

Use focused branches and pull requests. Do not push directly to `main`, force-push, rewrite shared history, or merge without explicit authorization. Update documentation when decisions change.

No license has been selected. Until one is added, do not assume the project grants permission to reuse its code.
