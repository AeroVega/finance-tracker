# Project history

A dated timeline of what merged and what each milestone established. It is a record, not a live status feed. For the current baseline and permissions read [Current state](CURRENT_STATE.md). For detailed evidence from before 2026-11-24, see the [archive](archive/README.md).

The full pre-cleanup evidence log (582 lines of per-branch verification notes, mostly about retired storage formats) is in Git at commit `a089861`:

```sh
git show a089861:docs/PROJECT_STATUS.md
```

## Milestones

| Date (2026) | PRs | What merged | What it does not establish |
| --- | --- | --- | --- |
| Oct 31 – Nov 2 | [19](https://github.com/AeroVega/finance-tracker/pull/19)–[24](https://github.com/AeroVega/finance-tracker/pull/24) | Database identity decisions, Drive feasibility spike, best-effort single-session coordination, durable Drive transaction engine, application storage lifecycle. | Production persistence. |
| Nov 4 | [25](https://github.com/AeroVega/finance-tracker/pull/25) | Backup portability and readiness acceptance on invented data. | Production persistence. |
| Nov 6–8 | [26](https://github.com/AeroVega/finance-tracker/pull/26)–[29](https://github.com/AeroVega/finance-tracker/pull/29) | Product definition, production-persistence plan, synthetic provider parsing and canonical import, first visual direction. | Any production approval. |
| Nov 9–10 | [30](https://github.com/AeroVega/finance-tracker/pull/30), [32](https://github.com/AeroVega/finance-tracker/pull/32)–[34](https://github.com/AeroVega/finance-tracker/pull/34) | Synthetic financial year, canonical ledger in the main workspace, preview persistence, manual transfer links, 16 portable engineering workflows. | Acceptance of every save/reopen path. |
| Nov 11 | [36](https://github.com/AeroVega/finance-tracker/pull/36) | **PR36 financial position and reconciliation:** dated balances, holdings evidence, liabilities, qualified net worth, and evidence-backed account/month coverage. Owner synthetic/device acceptance recorded. | Historical migration, file ingestion for balances and holdings. |
| Nov 14 | [37](https://github.com/AeroVega/finance-tracker/pull/37), [38](https://github.com/AeroVega/finance-tracker/pull/38), [40](https://github.com/AeroVega/finance-tracker/pull/40) | Incremental storage foundation and monthly indexes, mobile/tablet workspace redesign, bounded privacy-safe diagnostics. | Large-device capacity. |
| Nov 15 | [41](https://github.com/AeroVega/finance-tracker/pull/41)–[45](https://github.com/AeroVega/finance-tracker/pull/45) | Documentation consolidation, bounded open/save concurrency, retained-save telemetry, native receipt and staging optimizations. | Live acceptance. |
| Nov 17 | [46](https://github.com/AeroVega/finance-tracker/pull/46), [47](https://github.com/AeroVega/finance-tracker/pull/47) | **Full-snapshot v1 selected.** The owner measured open 11 s and save 25 s on `86d1f2b` and declared the performance goal met. PR47 removed the obsolete formats and their tests. | Seed time (42 s, separate), other devices or history sizes. |
| Nov 17–19 | [48](https://github.com/AeroVega/finance-tracker/pull/48)–[55](https://github.com/AeroVega/finance-tracker/pull/55) | CSV preview, verified encrypted portable backup and uncertain-save recovery, designated-account binding, declared coverage selector, supported Wells Fargo, SoFi and Fidelity CSV workflow, historical monthly summaries, guarded-code checks. | Live acceptance of providers other than Wells Fargo. |
| Nov 24 | [57](https://github.com/AeroVega/finance-tracker/pull/57), [58](https://github.com/AeroVega/finance-tracker/pull/58), [60](https://github.com/AeroVega/finance-tracker/pull/60) | Release-gated private-database path (the build stays synthetic-only until the release profile lists `production`), one-time monthly history migration wizard, Windows test-suite fix. Owner acceptance of live synthetic checks, revocation/reconnect, backup cadence and capacity triggers. | Real-data use. |
| Nov 24–25 | [61](https://github.com/AeroVega/finance-tracker/pull/61) | Listed `production` in the release profile. The owner declared **GO for real financial data**; see [Current state](CURRENT_STATE.md#owner-decision-go-for-real-financial-data). | Verification of the served build. Check it before entering real records. |

## Status vocabulary

Use these terms exactly. A merge, green CI, owner acceptance and a successful deployment are distinct facts.

- **Implemented:** code exists on the named revision.
- **Verified:** a stated check passed on that exact revision.
- **User-confirmed:** the owner reported the result.
- **Hypothesis / Open:** the evidence does not establish completion.
