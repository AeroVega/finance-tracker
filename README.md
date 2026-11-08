# Finance Tracker

[Open Finance Tracker](https://aerovega.github.io/finance-tracker/)

A second-generation personal finance tracker built around trustworthy data, transparent calculations, and privacy-first handling of financial information.

**North Star:** a personal financial intelligence application that helps the user understand their financial position, evaluate possible futures, and make informed decisions. Mobile-first, tablet-friendly, and desktop-capable. The intended **1.0.0 release target is January 1, 2027**, subject to scope and release-readiness gates.

> **Privacy warning:** This repository is public. Never commit real financial data, account exports, statements, credentials, access tokens, or production secrets. Assume everything committed here can be read by anyone.

## Project status

The initial release retains user-provided CSV imports as its permanent ingestion path. Google Drive is the **selected private-storage direction**. Experiment A's synthetic Drive probe passed a user-confirmed create/read-back/confirmed-delete test after API-key rotation. Experiment B then passed user-confirmed exact-name folder discovery after a prior Picker grant, including after reload/reauthorization and again with the app's saved comparison reference cleared (2026-10-29; source SHA `d29a4eb19bbd3a56aa00376692d2ea2ae6b68ec7`). These validate prototype paths only, not production ledger storage. See [Experiment B's live result and risk assessment](docs/DRIVE_FOLDER_DISCOVERY_EXPERIMENT.md#live-validation-record--2026-10-29) and [the A+B integration design and evidence record](docs/DRIVE_EXPERIMENTS_INTEGRATION_PLAN.md).

**Current phase:** PRs #20–#26 are merged, and [PR #28](https://github.com/AeroVega/finance-tracker/pull/28) merged on 2026-11-08 with the authorized [synthetic-only canonical import scope](docs/PR28_IMPLEMENTATION_SCOPE.md). Bounded owner live acceptance and a passed independent correctness review are recorded. The correctness update passed 694/694 local tests on Node 24.22.1 and 26.13.0. The integrated branch also passed 694/694 local tests on both Node versions, with no failures or skips. Those results cover the documented synthetic implementation, not production acceptance.

PR #21's live synthetic browser tests passed acquisition, guarded no-op writes, heartbeat, offline refusal, reconnect revalidation, stale-session detection/recovery, and verified release. Session coordination remains best-effort, not a server-enforced lock; simultaneous starts or network partitions can still defeat it. PR #23's durable transaction engine passed in-memory fault injection and the owner-run live synthetic Drive smoke test and cleanup on November 1, 2026. PR #24 passed automated CI and the owner-confirmed dashboard save/reconnect/clear/reconnect cycle.

PR #25's synthetic backup, restore, portability, and 540-day source-retention implementation is merged. [Synthetic Storage Acceptance](docs/SYNTHETIC_STORAGE_ACCEPTANCE.md) records the owner-reported results and limits. The subject-based [backup/restore](docs/DRIVE_BACKUP_AND_RESTORE.md), [original-source retention](docs/ORIGINAL_SOURCE_RETENTION.md), [application lifecycle](docs/APPLICATION_STORAGE_LIFECYCLE.md), and [Google Drive configuration](docs/GOOGLE_DRIVE_CONFIGURATION.md) guides retain the implementation and operational details. Remaining owner review includes the deletion-receipt recovery limitation, actual Cloud OAuth/API-key configuration and quota/usage/billing inspection, and final deployed-artifact privacy/security review.

Production financial-data persistence remains disabled and **NO-GO**. [PR #27](docs/PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md) is a documentation-only planning review. Merging that plan would not authorize implementation or production activation. A separately authorized implementation, its acceptance evidence, and explicit owner production approval remain required. Neither the PR25 merge nor the merged synthetic PR28 canonical-ledger operations approve production activation. Synthetic data remains first-class for ongoing development, tests, migrations, recovery, and acceptance.

Session claiming, heartbeats, reconnect checks, recovery, and release must be automatic background behavior, not routine user chores. The PR25 synthetic dashboard uses logical hash-only commits and per-copy locator catalogs. It requires fresh version-2 synthetic folders; PR24-format folders are unsupported and are not converted.

The [Second Generation Product Definition](docs/PRODUCT_DEFINITION.md) records the product direction and owner decisions. The [Product Design Open Decisions register](docs/PRODUCT_OPEN_DECISIONS.md) tracks unresolved decisions.

## Start here

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

## Synthetic financial year

[Seed an invented year](prototype/synthetic-year.html) uploads a reproducible 2025 canonical ledger to a newly created empty synthetic Drive folder you choose. It preserves source observations and audit events for future visualization, insight and projection tests. Fresh-folder checks, exact read-back and conservative retry protect existing records. The current workspace does not yet render this canonical year. Read [the recipe, operating steps and validation limits](docs/SYNTHETIC_FINANCIAL_YEAR.md). Production persistence remains **NO-GO**; live acceptance and deployment are separate.

The [Drive history verification follow-up](docs/DRIVE_HISTORY_VERIFICATION.md) reduces repeated downloads during saves by checking private, bounded session evidence against fresh Drive file versions. Full reconnect and backup integrity checks remain. This is a synthetic implementation, not production or live-Google acceptance.

## PR28 canonical import foundation

The [approved PR28 scope](docs/PR28_IMPLEMENTATION_SCOPE.md) implements a synthetic-only CSV → account/coverage mapping → review → canonical save → reopen flow using the merged storage machinery. The [implementation contract and verification guide](docs/PR28_CANONICAL_IMPORT.md) describe the record model, tested provider variants, and acceptance evidence. The development-only [invented import workbench](prototype/pr28-import.html) accepts bundled fixtures only. Production activation remains subject to the [PR27 plan](docs/PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md) and separate implementation, acceptance, and owner authorization.

The current synthetic workbench preserves unsaved changes in the tab after session release; release does not save or erase that draft. The approved future production policy clears working financial data and the token on sign-out or normal orderly release. That production behavior still needs implementation and validation. This planning reconciliation changes no application behavior. See [the release-clearing gap](docs/PR27_PRODUCTION_PERSISTENCE_PROPOSAL.md#current-pr28-release-behavior-and-production-gap).

Start with [PR28 assisted acceptance](prototype/pr28-testing.html), also linked first in the prototype hub. Connect a fresh empty synthetic folder and press **Run live checks**. It supplies the invented mappings and decisions, checks three saved checkpoints through the existing workbench/storage APIs, verifies a portable export in memory, and releases the session. Reconnect to the same folder and press **Verify saved run after reconnect** for the last assertion. Human device/OAuth, whole-tab interruption and new-folder backup/restore checks remain separate. The safe report contains fixed statuses and aggregate request metrics, never financial records or Drive identifiers. No run starts on page load. See [storage performance evidence and safety boundaries](docs/PR28_STORAGE_PERFORMANCE.md).

The manual steps now have adjacent controls, progress and timing. The interruption helper prepares its disposable fixture and verifies the exact recovered graph before any single retry. The [guided backup and restore flow](prototype/pr25-acceptance.html?guide=pr28) reuses the completed source, compares independent copy reopens automatically, and distinguishes the actual saved-file roundtrip from an in-memory export. You still choose folders/files, approve Google access, close the paused tab and confirm stopped sessions when required. The owner completed bounded live retests of these changed paths on `626ec025`; the earlier device checks remain tied to `70728162`. See [the latest results and remaining checks](docs/PR28_CANONICAL_IMPORT.md#owner-guide-retests-on-626ec025-november-8-2026).

## Temporary prototype navigation

PR #29 squash-merged on November 8, 2026. It extends the original visual reference across the main workspace, guided acceptance pages and development tools. The [visual overhaul record](docs/PR29_VISUAL_OVERHAUL.md) explains the changes, the PR28 lessons they address, and the validation limits. The main workspace remains a local CSV preview with optional invented-data storage; it is not the canonical production dashboard. All existing prototype pages remain available. Prototype removal is deferred, not part of PR29.

During development, the app footer links to a temporary [Prototype Tools hub](prototype/), which indexes the browser-based Drive and session experiments. The hub and all browser prototype pages are development-only. **They are not v1.0.0 product features.** Before the v1.0.0 release, remove the app entry point and ensure the `prototype/` pages are excluded from the user-facing GitHub Pages deployment. Retain only the automated tests and engineering documentation needed to support the shipped product.

## Deploying a branch for experiments

The GitHub Pages URL is a **single shared deployment**, not an isolated staging environment. The deployed page is public, and whichever branch is deployed is what every visitor sees.

- A push to `main` automatically deploys `main`.
- To try a branch without merging it: open **Actions → Deploy static site to GitHub Pages → Run workflow**, choose the desired branch in the branch selector, then run the workflow.
- The workflow checks out the selected ref and stamps the deployed artifact with that checked-out commit's full 40-character SHA. The dashboard and Drive prototype show that SHA at the bottom of the page.
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
