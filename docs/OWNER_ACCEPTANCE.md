# Owner acceptance center

**Implemented, not live-verified:** [Start the owner checklist](../prototype/acceptance.html). This is the single manual entry point for the remaining device and live-service observations. It links the existing engines rather than embedding competing sessions or replacing their programmatic checks.

## Run order

1. Confirm the full deployed SHA against the intended successful Pages deployment and select the actual browser. Repeat separately on physical iPhone and iPad Safari; emulation is not device acceptance.
2. Use a separate DEVICE folder for preview-only layout, touch, focus, text enlargement and coverage-calendar checks. Verify release. Test real OAuth/folder-picker cancellation with no active session.
3. Save/release/reconnect the small invented year in a fresh v2 folder, then a distinct fresh v3 folder. Reconnect with the opposite selector choice must retain the saved format without reseeding. This is not migration or mobile capacity evidence.
4. Reconnect a completed year, briefly disconnect this device while idle, check the offline controls, then reconnect and verify the same saved year.
5. Run assisted canonical import and its separate reconnect verification in a fresh IMPORT source.
6. Rehearse actual paused-tab close/recovery using the separate disposable INTERRUPTION folder and existing verifier.
7. Reuse the completed YEAR-V3 source for guided backup, actual downloaded-file reimport and restore. The guide verifies the fragmented source and displays its logical record counts. BACKUP and RESTORE each require their own new empty folder.
8. Release and close device A before reconnecting an exact completed YEAR-V2 or YEAR-V3 source on device B. Use the year tool’s deterministic reconnect verification, not Upload. Verify release on B too. The import runner’s reconnect comparison requires the same tab that completed its run and cannot be used for cross-device validation.

The page contains the exact expected observations and links. The detailed engine procedures remain in [PR28 canonical import](PR28_CANONICAL_IMPORT.md), [synthetic year](SYNTHETIC_FINANCIAL_YEAR.md), [fragmented storage](FRAGMENTED_CANONICAL_STORAGE.md), and [PR30 evidence](PR30_PERFORMANCE_INTEGRATION.md). Do not duplicate engine results by marking a manual selection as an automatic assertion.

## Safe continuity and reporting

Only fixed plan/source/browser/manual-status fields are stored in this tab's sessionStorage. Navigation Back and reload retain those choices when the full source SHA and plan match. No folder, token, file, record, free text or log is collected. The report is an allowlisted JSON object, not a dump of page state. Copy/download it before closing the checklist tab. Browser storage failure is disclosed; no durable persistence is promised.

Changing browser, changing source confirmation or starting a fresh checklist clears observations. Changing an observation clears only its dependent phases. Independent checks can proceed even when another is blocked. The copy phase needs the completed version-3 year source. A source mismatch or missing full stamp prevents restoring prior evidence. The source stamp identifies the loaded page, not a continuous deployment monitor: recheck every tool's full SHA and reload this center if Pages changes while a tab is open. Back-forward cache cannot establish that the remote deployment stayed unchanged. A fresh run clears checklist choices only, never Drive data.

Pass means **User-confirmed manual observation**, never automatic proof. Fail and Blocked are first-class outcomes. Missing source/browser or required source preparation prevents choosing Pass for that phase; links remain available for inspection. Programmatic reports from the underlying tools remain separate and should be copied with their own source context.

## Boundaries

**Open:** real iPhone/iPad Safari, live OAuth, Drive throughput, memory and all owner-operated checks until actually run. Small-year v3 acceptance does not validate large datasets; the adapter reconstructs full graphs. Sequential handoff does not prove concurrent safety. Interruption rehearsal is one canonical boundary, not every failure point or iOS process termination.

No Google libraries, autoconnection, Drive operations or financial engines are loaded by this center. Following a tool link does not authorize production data. Owner-chosen synthetic folders and explicit existing controls are still required. Keep every completed or failed copy separate and preserve uncertain destinations. Session/recovery maintenance may write even when no financial records are added. Production remains **NO-GO**. No merge, deployment or live Drive action is part of this implementation.

**Verified locally:** `node --test tests/acceptance-plan.test.mjs` covers report/status sanitization, full-source confirmation, stale-state resets, prerequisites, tool paths and static safety boundaries. These tests do not claim device or Google acceptance.
