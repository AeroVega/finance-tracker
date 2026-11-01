# Finance Tracker

A second-generation personal finance tracker built around trustworthy data, transparent calculations, and privacy-first handling of financial information.

**North Star:** a dependable personal finance dashboard for iPhone and iPad. Target MVP date: **January 1, 2027**.

> **Privacy warning:** This repository is public. Never commit real financial data, account exports, statements, credentials, access tokens, or production secrets. Assume everything committed here can be read by anyone.

## Project status

MVP1 uses user-provided CSV imports. Google Drive is the **selected private-storage direction**. Experiment A's synthetic Drive probe passed a user-confirmed create/read-back/confirmed-delete test after API-key rotation. Experiment B then passed user-confirmed exact-name folder discovery after a prior Picker grant, including after reload/reauthorization and again with the app's saved comparison reference cleared (2026-10-29; source SHA `d29a4eb19bbd3a56aa00376692d2ea2ae6b68ec7`). These validate prototype paths only, not production ledger storage. See [Experiment B's live result and risk assessment](docs/DRIVE_FOLDER_DISCOVERY_EXPERIMENT.md#live-validation-record--2026-10-29) and [the A+B integration design and evidence record](docs/DRIVE_EXPERIMENTS_INTEGRATION_PLAN.md).

**Current phase:** PR #20 (synthetic Drive feasibility), PR #21 (best-effort single-active-session coordination), and PR #22 (pure transaction protocol core) are merged. PR #21's live synthetic browser tests passed for acquisition, guarded no-op writes, heartbeat, offline refusal, reconnect revalidation, stale-session detection/recovery, and verified release. Session coordination remains best-effort, not a server-enforced lock; simultaneous starts/network partitions can still defeat it. PR #23 is implementing the durable Google Drive transaction engine and crash recovery using synthetic-only data; its in-memory fault-injection suite and full Node contract suite currently pass in CI, while the owner-run live Drive smoke test remains outstanding. The storage implementation roadmap is documented in [Next Steps](docs/NEXT_STEPS.md): PR #24 integrates the engine into app workflows with automatic background session lifecycle; PR #25 completes end-to-end acceptance and production-readiness gates. Session claiming, heartbeats, reconnect checks, recovery, and release must be automatic background behavior, not routine user chores. No production financial data or canonical-ledger operations are authorized.

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
