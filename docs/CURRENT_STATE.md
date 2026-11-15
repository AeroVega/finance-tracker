# Current project state

**Checked:** 2026-11-14  
**Repository:** [AeroVega/finance-tracker](https://github.com/AeroVega/finance-tracker)  
**Authoritative branch:** `main`  
**Baseline commit:** [`be43951a7b4a09c8e54c1984b1fb41dc39401636`](https://github.com/AeroVega/finance-tracker/commit/be43951a7b4a09c8e54c1984b1fb41dc39401636)

This page is the concise, mutable snapshot for agents. The detailed [project status log](PROJECT_STATUS.md) and PR records retain historical evidence; they do not replace this current snapshot.

## What is on main

- **PR #37 — merged:** incremental storage foundation, segmented locator catalogs, monthly indexes, bounded Drive response/recovery safeguards, and canonical v5 replacement work.
- **PR #38 — merged:** mobile/tablet workspace redesign and associated interaction fixes.
- **PR #40 — merged:** bounded privacy-safe diagnostics, registered error-code handling, cause/context preservation, tiered main-app diagnostic UI, startup fallback, offline triage, and Copy/Select-only behavior. Prototype files were intentionally unchanged.
- The current main tree is the merge commit above. Do not describe PR37 or PR38 as open/draft, or PR40 as unpublished.

## Active storage contract

The application writes **canonical v5** through the existing store and lifecycle. It refuses canonical v1/v2/v3/v4 copies and obsolete initialization markers without converting or overwriting them. Existing v5 copies that retain migration-origin provenance remain supported through read-only provenance verification. Preserve existing data; create new v5 synthetic test copies only in a fresh empty synthetic folder.

Keep version namespaces distinct: canonical v5; compact source/derived version 2; locator catalog version 3; physical root protocol 4; framed transport version 3 with the explicit `canonical5-physical4` profile. These subsystem numbers do not imply support for a canonical layout of the same number. See [the format contract](PARTITIONED_CANONICAL_STORAGE.md) and [terminology glossary](STORAGE_TERMINOLOGY.md) for exact rules.

The active path coalesces canonical and locator changes and prepares only final-reachable new pages for upload. This does **not** mean the app has bounded whole-database memory or selective financial loading. Full ledger/history materialization, semantic and physical verification, workspace cloning, and preparation memory remain. Incremental financial validation and bounded whole-database memory remain open.

## Verification and deployment evidence

- **Node CI:** [run 43561156605](https://github.com/AeroVega/finance-tracker/actions/runs/43561156605), Node contract tests on the current main commit — success.
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
