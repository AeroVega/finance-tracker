# Current project state

**Checked:** 2026-11-15  
**Repository:** [AeroVega/finance-tracker](https://github.com/AeroVega/finance-tracker)  
**Authoritative branch:** `main`  
**Main baseline:** [`5dcaabbd7d5b4fc1b8a56257914eea1a953d1fca`](https://github.com/AeroVega/finance-tracker/commit/5dcaabbd7d5b4fc1b8a56257914eea1a953d1fca)

This page is the concise, mutable snapshot for agents. The detailed [project status log](PROJECT_STATUS.md) and PR records retain historical evidence; they do not replace this current snapshot.

## PR46 fresh-copy test-build update (2026-11-16)

This branch now routes the Dashboard and workspace to **full-snapshot v1**, a fresh-copy single-user synthetic experiment. The canonical-v5 storage description below records the earlier main baseline, not this branch's active application route. Main has since advanced to `f183cdc`; PR46 is separate and must not be described as merged or deployed from local tests.

The new format uses one full immutable ledger snapshot and a small commit envelope per save, retaining published/clean acknowledgement, full ancestry audit on open/recovery and current/new-transition validation during saves. See [the focused contract and measurements](EXPERIMENTAL_FULL_SNAPSHOT_STORAGE.md). Use a new empty synthetic folder. Old copies are unsupported by this route, not migrated or deleted. Legacy modules remain for regression testing; removing them is separate work.

**Limitations:** legacy import and backup/restore are unavailable for this format. It is a performance/recovery test build, not Alpha-ready or approved for real financial data. The 8 MiB encoded snapshot limit is not a browser memory bound. Full-history open and storage grow with retained full snapshots; iPhone/iPad Safari and live Drive acceptance remain open.

The owner authorized implementing and updating PR46 for their own deployment/test, not an agent merge or deployment. Repository settings and existing folders must remain unchanged. The final exact-head validation evidence belongs in the focused contract; historical results below do not validate this new route.

## What is on main

- **PR #37 — merged:** incremental storage foundation, segmented locator catalogs, monthly indexes, bounded Drive response/recovery safeguards, and canonical v5 replacement work.
- **PR #38 — merged:** mobile/tablet workspace redesign and associated interaction fixes.
- **PR #40 — merged:** bounded privacy-safe diagnostics, registered error-code handling, cause/context preservation, tiered main-app diagnostic UI, startup fallback, offline triage, and Copy/Select-only behavior. Prototype files were intentionally unchanged.
- PR #41 and #42 added the centralized documentation/navigation and visualization design handoff. Their changes from the earlier `be43951a` baseline are documentation only.
- PR #43 adds bounded owned reads/staging and phase-scoped complete-tree verification memoization. It merged on 2026-11-15 as `363260e`. Merge is not a claim of live acceptance or a verified served build. See [performance evidence](OPEN_SAVE_PERFORMANCE.md) for exact validation scope.
- **PR #44 — merged:** corrected retained-save latency measurement and fixed-label benchmark telemetry, merged as `5dcaabb`. It changes tests, benchmarks and documentation, not application runtime.
- Do not describe PR37 or PR38 as open/draft, or PR40 as unpublished.

## Active storage contract

The application writes **canonical v5** through the existing store and lifecycle. It refuses canonical v1/v2/v3/v4 copies and obsolete initialization markers without converting or overwriting them. Existing v5 copies that retain migration-origin provenance remain supported through read-only provenance verification. Preserve existing data; create new v5 synthetic test copies only in a fresh empty synthetic folder.

Keep version namespaces distinct: canonical v5; compact source/derived version 2; locator catalog version 3; physical root protocol 4; framed transport version 3 with the explicit `canonical5-physical4` profile. These subsystem numbers do not imply support for a canonical layout of the same number. See [the format contract](PARTITIONED_CANONICAL_STORAGE.md) and [terminology glossary](STORAGE_TERMINOLOGY.md) for exact rules.

The active path coalesces canonical and locator changes and prepares only final-reachable new pages for upload. This does **not** mean the app has bounded whole-database memory or selective financial loading. Full ledger/history materialization, semantic and physical verification, workspace cloning, and preparation memory remain. Incremental financial validation and bounded whole-database memory remain open.

## Verification and deployment evidence

- **PR44 head `ef337ab`:** exact tree passed 2,104/2,104 local extended tests and required remote checks before merge. Main `5dcaabb` has a successful [Pages workflow](https://github.com/AeroVega/finance-tracker/actions/runs/43739103439); this records pipeline success, not independent served-asset identity.
- **Tier1 candidate:** the current branch carries the previously validated `5ad8abe` runtime onto this main baseline. That runtime passed 2,138/2,138 extended tests before integration. The integrated runtime/test tree passed 2,145/2,145 extended tests at `1afa62f`; exact-head remote CI remains a separate gate. See [Tier1 scope and evidence](TIER1_SAVE_PERFORMANCE.md).

- **PR43 reconciled head `92c6bd9`:** local extended suite 2,097/2,097 passed; [remote Node CI43692062845](https://github.com/AeroVega/finance-tracker/actions/runs/43692062845) succeeded. The merged tree matches this tested tree; this is not a claim that the separate main workflow or browser deployment was independently verified.

- **Node CI:** [run 43561156605](https://github.com/AeroVega/finance-tracker/actions/runs/43561156605), Node contract tests on the historical `be43951a` baseline — success. This is not CI evidence for the reconciled PR43 head.
- **Pages push workflow:** run 43561156654 failed. A subsequent manual deployment run [43561726496](https://github.com/AeroVega/finance-tracker/actions/runs/43561726496) completed successfully; the Pages build/deployment run [43561306077](https://github.com/AeroVega/finance-tracker/actions/runs/43561306077) also succeeded.
- The workflow result establishes a successful deployment pipeline, **not independent verification of the SHA currently served to a browser**.
- PR40's published PR description records 1,994/1,994 extended tests on its exact reduced-scope local code and successful remote Node CI for the merged main SHA. Earlier PR37/PR38 test counts apply only to their named revisions.
- Physical iPhone/iPad Safari acceptance and current live Google Drive seed/save/reopen acceptance are not established by these CI results.

## Product and authorization boundary

- The product remains synthetic-only for engineering and acceptance. Use invented fixtures only.
- Do not access or commit real transaction records, the private workbook, owner Drive financial data, or production credentials.
- Production financial-data persistence is **NO-GO**. PR27 approved a plan, not production activation. Production use still requires the separate implementation and review of OAuth/account binding, privacy, cost, backup/recovery, live synthetic acceptance, and explicit owner authorization.
- No merge, deployment, production configuration change, or real-data operation is authorized by this documentation task.
- Preserve the $0 recurring-cost constraint, permanent manual file imports, no stored bank passwords, and no unauthorized scraping.

## Remaining project work

- Tier0 measurement work is merged in PR44. See [measurement scope](TIER0_SAVE_MEASUREMENT.md); complexity observations are explicitly not enforced budgets.
- Review and test the bounded [Tier1 candidate](TIER1_SAVE_PERFORMANCE.md) separately. It excludes experimental closed-phase structural certificates and body-fact transfer. No sub-30-second live acceptance is established.

- Complete the open/save performance gate: under 30 seconds per operation for Alpha, under 10 seconds later. The current optimizations do not establish that target or production acceptance. Preserve full integrity checks and distinguish local benchmarks from live synthetic results.

1. Validate the latest integrated application on physical iPhone/iPad Safari and recheck the synthetic Google Drive initialization and one-change save/reopen path using the current build. Use diagnostics to preserve evidence; do not infer or guess provider causes.
2. Complete the distinct historical monthly-summary migration from 2023 onward, first against invented workbook fixtures. Preserve monthly granularity and provenance; never manufacture transactions from aggregates.
3. Complete supported owner-file ingestion through the application, with explicit account mapping, declared coverage, discrepancy review, and verified save.
4. Complete production controls and the separate security/privacy/cost/recovery review before any production activation request.

The dependency-aware acceptance checklist lives in [NEXT_STEPS.md](NEXT_STEPS.md). Product scope lives in [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md); unresolved choices live in [PRODUCT_OPEN_DECISIONS.md](PRODUCT_OPEN_DECISIONS.md).

## Where to read next

- Agent entry point: [AGENT_QUICK_START.md](AGENT_QUICK_START.md)
- Mandatory permissions and guardrails: [AGENTS.md](../AGENTS.md)
- Focused contract map: [documentation index](README.md)
- Dated implementation/evidence history: [PROJECT_STATUS.md](PROJECT_STATUS.md)
- Storage format and compatibility: [PARTITIONED_CANONICAL_STORAGE.md](PARTITIONED_CANONICAL_STORAGE.md)
