# Owner acceptance center

**Current guide, November 10, 2026.** Use this guide with the [canonical workspace checks](CANONICAL_MAIN_WORKSPACE.md#validation-and-owner-acceptance). The owner already accepted PR32 local exploration, evidence/corrections and mobile experience. The newer Drive-preview persistence and transfer-link paths remain open; do not repeat unaffected accepted checks without reason.

**Verified blocker:** the [checklist page](../prototype/acceptance.html) still requests grouped-v2 seeding and a v2/v3 selector. Current code writes v3 only and rejects standalone v2. Mark the obsolete v2/selector phases **Blocked**, never Pass; its aggregate result cannot establish complete current acceptance until the runtime plan is updated. The remaining tools and their independent evidence are still useful.

**Deployment prerequisite:** main's audited Pages run failed before upload. Confirm a successful authorized deployment and full served SHA before attributing new results to it. See [project status](PROJECT_STATUS.md). This guide does not authorize a deployment.

## Focused mobile pages

The [new navigation and layout acceptance](MOBILE_WORKSPACE_PAGES.md#owner-acceptance-on-the-intended-commit) covers the PR36 redesign. Its affected mobile checks need fresh acceptance despite the narrower earlier PR32 pass. Use **Storage** for opening/reconnecting a saved copy, previews, undo/revert, release, recovery and the served source SHA.

## Run order

1. Confirm the full deployed SHA against the intended successful Pages deployment and select the actual browser. Repeat separately on physical iPhone and iPad Safari; emulation is not device acceptance.
2. Use a separate DEVICE folder for preview-only layout, touch, focus, text enlargement and coverage-calendar checks. Verify release. Test real OAuth/folder-picker cancellation with no active session.
3. Use a fresh empty synthetic folder to save/release/reconnect the small invented year as fragmented v3. There is no v2/v3 selector. Test per-record v1 read compatibility only with a known compatible invented copy, and verify standalone-v2 rejection without writes only with a disposable synthetic fixture. Do not seed new v2 copies. This is not migration or mobile-capacity evidence.
4. Reconnect a completed year, briefly disconnect this device while idle, check the offline controls, then reconnect and verify the same saved year.
5. Run assisted canonical import and its separate reconnect verification in a fresh IMPORT source.
6. Rehearse actual paused-tab close/recovery using the separate disposable INTERRUPTION folder and existing verifier.
7. Reuse the completed YEAR-V3 source for guided backup, actual downloaded-file reimport and restore. The guide verifies the fragmented source and displays its logical record counts. BACKUP and RESTORE each require their own new empty folder whose name contains "synthetic", such as "synthetic-backup" and "synthetic-restore". A rejected folder-name selection starts no copy; a failed or uncertain copy must still be preserved and never reused.
8. Release and close device A before reconnecting an exact completed YEAR-V3 source on device B. Use the year tool’s deterministic reconnect verification, not Upload. Verify release on B too. The import runner’s reconnect comparison requires the same tab that completed its run and cannot be used for cross-device validation.

The underlying tools contain their observations and verification controls; the checklist page has the documented format drift. The detailed engine procedures remain in [PR28 canonical import](PR28_CANONICAL_IMPORT.md), [synthetic year](SYNTHETIC_FINANCIAL_YEAR.md), [fragmented storage](FRAGMENTED_CANONICAL_STORAGE.md), and [PR30 evidence](archive/PR30_PERFORMANCE_INTEGRATION.md). Do not duplicate engine results by marking a manual selection as an automatic assertion.

## Safe continuity and reporting

Only fixed plan/source/browser/manual-status fields are stored in this tab's sessionStorage. Navigation Back and reload retain those choices when the full source SHA and plan match. No folder, token, file, record, free text or log is collected. The report is an allowlisted JSON object, not a dump of page state. Copy/download it before closing the checklist tab. Browser storage failure is disclosed; no durable persistence is promised.

Changing browser, changing source confirmation or starting a fresh checklist clears observations. Changing an observation clears only its dependent phases. Independent checks can proceed even when another is blocked. The copy phase needs the completed version-3 year source. A source mismatch or missing full stamp prevents restoring prior evidence. The source stamp identifies the loaded page, not a continuous deployment monitor: recheck every tool's full SHA and reload this center if Pages changes while a tab is open. Back-forward cache cannot establish that the remote deployment stayed unchanged. A fresh run clears checklist choices only, never Drive data.

Pass means **User-confirmed manual observation**, never automatic proof. Fail and Blocked are first-class outcomes. Missing source/browser or required source preparation prevents choosing Pass for that phase; links remain available for inspection. Programmatic reports from the underlying tools remain separate and should be copied with their own source context.

## Boundaries

**Open:** current changed-path physical Safari/live-service acceptance and device capacity until actually run and attributed to a source SHA. Earlier bounded owner observations remain valid for their tested scope, not every later path. Small-year v3 acceptance does not validate large datasets; the adapter reconstructs full graphs. Sequential handoff does not prove concurrent safety. Interruption rehearsal is one canonical boundary, not every failure point or iOS process termination.

No Google libraries, autoconnection, Drive operations or financial engines are loaded by this center. Following a tool link does not authorize production data. Owner-chosen synthetic folders and explicit existing controls are still required. Keep every completed or failed copy separate and preserve uncertain destinations. Session/recovery maintenance may write even when no financial records are added. Production remains **NO-GO**. No merge, deployment or live Drive action is part of this implementation.

**Verified locally:** `node --test tests/acceptance-plan.test.mjs` covers report/status sanitization, full-source confirmation, stale-state resets, prerequisites, tool paths and static safety boundaries. These tests do not claim device or Google acceptance.
