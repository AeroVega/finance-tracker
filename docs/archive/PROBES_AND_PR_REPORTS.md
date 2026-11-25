# Probes and PR reports (Oct–Nov 2026)

These reports recorded what a specific experiment or PR built, tested and observed. Their conclusions live in current contracts; this page keeps the findings that changed a decision. Every test used invented data.

Originals are recoverable at commit `a089861`:

```sh
git show a089861:docs/<FILE>.md
```

Older reports ([PR29](PR29_VISUAL_OVERHAUL.md), [PR30 integration](PR30_PERFORMANCE_INTEGRATION.md), [PR30 tests](PR30_REGRESSION_TESTS.md), [PR36 review](PR36_ADVERSARIAL_REVIEW.md), [Nov 8 next steps](NEXT_STEPS_2026-11-08.md), [modern UI exploration](MODERN_UI_EXPLORATION.md)) remain in this folder.

## Google Drive feasibility

| Original | Date | Finding |
| --- | --- | --- |
| `DRIVE_SYNTHETIC_PROBE` | 2026-10-21 | The owner chose their existing restricted Drive folder as the private ledger home. A probe page created, read and (after confirmation) deleted one invented file with the `drive.file` scope. A pass shows access only. It does not show conflict safety, recovery or cross-device sync. |
| `DRIVE_FOLDER_DISCOVERY_EXPERIMENT` | 2026-10-29 | On iPad, an exact-name `files.list` query rediscovered the folder after a prior Picker grant, with no folder ID kept and no file changed. |
| `DRIVE_EXPERIMENTS_INTEGRATION_PLAN` | 2026-10-29 | Merged the sign-in and discovery experiments through PR 16. PR 15 was closed to avoid duplicate configuration changes. |
| `DRIVE_FEASIBILITY_SPIKE` | Phase 1 | Complete child listing, same-ID retry (HTTP 409 with exact read-back) and SHA-256 read-back all worked. **The browser metadata response exposed no ETag, and a raw REST PATCH with a deliberately stale `If-Match` returned HTTP 200 and wrote.** Drive gives no compare-and-swap for this path. The owner accepted single-user, single-active-device operation. |
| `SYNTHETIC_STORAGE_ACCEPTANCE` | 2026-11-04 | Live pass of version-2 backup to a separate copy, failed-backup quarantine, portable archive export, and restore to a fresh folder with a new physical identity. It also passed an original-file retention rehearsal for a feature that was later removed. |

## Storage and persistence PRs

| Original | Finding |
| --- | --- |
| `PR27_PRODUCTION_PERSISTENCE_PROPOSAL` | 2026-11-08 planning record for production persistence. Release must verify the app's actual OAuth configuration and behavior, not assume Google's formal review. Orderly release closes admission, drains admitted writes, resolves recovery, and verifies release before reporting success. |
| `PR28_IMPLEMENTATION_SCOPE` | Five-part synthetic scope for canonical import, approved 2026-11-06. The contract it produced is [Canonical import](../CANONICAL_IMPORT.md). |
| `PR37_V5_ONLY_CLEANUP`, `PR37_ENGINEERING_REVIEW` | 2026-11-11. The owner deleted old synthetic folders and asked for canonical v5 only, with migration code removed. The review traced edit → save end to end, inventoried safeguards, and diagnosed an initial-copy read-back failure with a fixed-code diagnostic that separates create outcome from later read-back failure. |
| `PR38_ADVERSARIAL_REVIEW` | Four defects found and fixed: a staged draft hid the editor at 568×320 with 200% text; reopening a record erased the typed explanation; a pending fee classified as spending showed as spending with no exclusion note; and tapping the active Home tab jumped the page to 188 px. |
| `APP_TESTING_FEEDBACK` | Original owner feedback on the v3-era app, with reproduction and measurement context. Its format labels were already historical. |
| `PROTOTYPE_CLEANUP` | 2026-11-08 owner-requested consolidation of prototype pages and tests. PR46 later retired the acceptance, import, seeder and copy pages it described. |
| `SYNTHETIC_FINANCIAL_YEAR` | The invented-year recipe is current behavior and now lives in [Synthetic data](../SYNTHETIC_DATA.md). Its historical section reported measurements for the retired grouped layout. |

The PR37 and PR38 per-request measurements are in [`evidence/`](../evidence).
