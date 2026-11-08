# Finance Tracker

[Open Finance Tracker](https://aerovega.github.io/finance-tracker/)

A second-generation personal finance tracker built around trustworthy data, transparent calculations, and privacy-first handling of financial information.

**North Star:** a dependable personal finance dashboard for iPhone and iPad. Target MVP date: **January 1, 2027**.

> **Privacy warning:** This repository is public. Never commit real financial data, account exports, statements, credentials, access tokens, or production secrets. Assume everything committed here can be read by anyone.

## Project status

MVP1 uses user-provided CSV imports. Google Drive is the **selected private-storage direction**. Experiment A's synthetic Drive probe passed a user-confirmed create/read-back/confirmed-delete test after API-key rotation. Experiment B then passed user-confirmed exact-name folder discovery after a prior Picker grant, including after reload/reauthorization and again with the app's saved comparison reference cleared (2026-10-29; source SHA `d29a4eb19bbd3a56aa00376692d2ea2ae6b68ec7`). These validate prototype paths only, not production ledger storage. See [Experiment B's live result and risk assessment](docs/DRIVE_FOLDER_DISCOVERY_EXPERIMENT.md#live-validation-record--2026-10-29) and [the A+B integration design and evidence record](docs/DRIVE_EXPERIMENTS_INTEGRATION_PLAN.md).

**Current phase:** PRs #20–#25 are merged. PR #28 implements the authorized synthetic-only canonical import scope; bounded live acceptance and a passed independent correctness review are recorded. Final local suites passed 694/694 tests on both supported Node versions. Remote CI for the exact published head and the owner's separate merge decision remain pending. PR #21's live synthetic browser tests passed for acquisition, heartbeat, offline refusal, reconnect revalidation, stale-session detection/recovery, and verified release. Session coordination remains best-effort, not a server-enforced lock; simultaneous starts/network partitions can still defeat it. PR #23's durable Google Drive transaction engine and crash recovery are merged; its in-memory fault-injection suite and owner-run live synthetic Drive smoke test and cleanup passed (2026-11-01). PR #24's synthetic-only application integration is merged after 199/199 Node tests and owner-confirmed dashboard save/reconnect/clear/reconnect acceptance. PR #25 added synthetic-only backup/restore portability and 540-day retention primitives, with its acceptance limits recorded separately. Production financial-data persistence remains disabled. Session claiming, heartbeats, reconnect checks, recovery, and release must be automatic background behavior, not routine user chores. Bounded synthetic canonical-ledger operations are authorized under [the PR28 scope](docs/PR28_IMPLEMENTATION_SCOPE.md). Production financial-data activation remains gated by PR27 and separate owner review. See [PR #25 acceptance evidence](docs/PR25_ACCEPTANCE.md) and the [current AI implementation / owner action handoff](docs/PR25_IMPLEMENTATION_HANDOFF.md). The PR25 synthetic dashboard now uses logical hash-only commits and per-copy locator catalogs. PR25 starts with fresh version-2 synthetic folders; PR24-format synthetic test folders are unsupported and are not converted.

## Start here

- [Project charter](docs/PROJECT_CHARTER.md)
- [Next steps and handoff checklist](docs/NEXT_STEPS.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture decisions and open questions](docs/ARCHITECTURE_DECISIONS.md)
- [Database identity and lifecycle architecture (PR #19, merged)](docs/DATABASE_IDENTITY_AND_LIFECYCLE.md)
- [Private storage architecture](docs/PRIVATE_STORAGE_ARCHITECTURE.md)
- [Google Drive feasibility spike and live test procedure](docs/DRIVE_FEASIBILITY_SPIKE.md)
- [Security and privacy requirements](docs/SECURITY.md)
- [Data-source research](docs/DATA_SOURCES.md)
- [Data model and reconciliation principles](docs/DATA_MODEL.md)
- [Contributor and agent instructions](AGENTS.md)

## PR28 canonical import foundation

The [approved PR28 scope](docs/PR28_IMPLEMENTATION_SCOPE.md) implements a synthetic-only CSV → account/coverage mapping → review → canonical save → reopen flow using the merged storage machinery. The [implementation contract and verification guide](docs/PR28_CANONICAL_IMPORT.md) describe the record model, tested provider variants, and acceptance evidence. The development-only [invented import workbench](prototype/pr28-import.html) accepts bundled fixtures only. Production activation remains gated by PR27.

Start with [PR28 assisted acceptance](prototype/pr28-testing.html), also linked first in the prototype hub. Connect a fresh empty synthetic folder and press **Run live checks**. It supplies the invented mappings and decisions, checks three saved checkpoints through the existing workbench/storage APIs, verifies a portable export in memory, and releases the session. Reconnect to the same folder and press **Verify saved run after reconnect** for the last assertion. Human device/OAuth, whole-tab interruption and new-folder backup/restore checks remain separate. The safe report contains fixed statuses and aggregate request metrics, never financial records or Drive identifiers. No run starts on page load. See [storage performance evidence and safety boundaries](docs/PR28_STORAGE_PERFORMANCE.md).

The manual steps now have adjacent controls, progress and timing. The interruption helper prepares its disposable fixture and verifies the exact recovered graph before any single retry. The [guided backup and restore flow](prototype/pr25-acceptance.html?guide=pr28) reuses the completed source, compares independent copy reopens automatically, and distinguishes the actual saved-file roundtrip from an in-memory export. You still choose folders/files, approve Google access, close the paused tab and confirm stopped sessions when required. The owner completed bounded live retests of these changed paths on `626ec025`; the earlier device checks remain tied to `70728162`. See [the latest results and remaining checks](docs/PR28_CANONICAL_IMPORT.md#owner-guide-retests-on-626ec025-november-8-2026).

## Temporary prototype navigation

During development, the app footer links to a temporary [Prototype Tools hub](prototype/), which indexes the browser-based Drive and session experiments. The hub and all browser prototype pages are development-only. **They are not MVP1 product features.** Before MVP1 completion, remove the app entry point and ensure the `prototype/` pages are excluded from the user-facing GitHub Pages deployment. Retain only the automated tests and engineering documentation needed to support the shipped product.

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
