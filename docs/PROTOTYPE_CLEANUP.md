# Prototype cleanup and retained coverage

**User-confirmed scope, November 8, 2026:** the owner asked for safe prototype cleanup, consolidation, and a fresh suite for tests that still need a person. This supersedes PR29's earlier preserve-all instruction. Production persistence remains **NO-GO**. This work does not authorize live Drive actions by agents, merge or deployment.

## Start here now

The workspace opens the [owner acceptance suite](../prototype/acceptance.html). It groups the remaining physical-device and live synthetic observations in order and keeps a separate, sanitized report for each source commit and browser. The [owner guide](OWNER_ACCEPTANCE.md) is the written companion. The [tools index](../prototype/index.html) lists current tools, with specialist diagnostics collapsed by default.

The suite does not connect to Google, run storage actions, infer passes from old reports or import another tool's results. It sends the tester to existing tools, which retain their own gates and exact graph checks. Save and verify release before switching tools or devices. Passing this suite is not production authorization.

## Retired runtime

- **Modern-stack visual demo.** Removed the isolated `prototype/modern-stack-exploration` HTML, JavaScript and outdated README. PR29 already adopted its visual direction in the workspace and shared static CSS. This removes the unused Tailwind Play CDN dependency and a second invented dashboard. Its [architecture record](archive/MODERN_UI_EXPLORATION.md) survives, with historical PR29 evidence unchanged. The old runtime remains recoverable from Git history at pre-cleanup source `e12e0238f2d52775f75d2e86459f2a364cc56c89`.
- **First Drive probe UI.** Removed `prototype/drive-probe.html` and its controller. Current year/import tools verify real synthetic save/reopen paths with the shared configured Google client. The old hand-entered configuration fields are replaced by the [current deployment configuration instructions](GOOGLE_CLOUD_SETUP.md), not copied into another page. Its original create/read-back/confirmed-delete algorithm moved unchanged from `js/drive-probe-core.mjs` to `tests/helpers/legacy-drive-probe-core.mjs`; all mocked regression cases remain. It has no active browser import. [Original live evidence](DRIVE_SYNTHETIC_PROBE.md) is retained and explicitly historical.

The removed pages were self-contained. No production or storage engine is deleted. No financial fixture, recovery boundary, benchmark, source evidence, or owner acceptance record is removed. Retired URLs are no longer entry points and have no automatic redirect or automatic connection; use the acceptance suite instead.

## Why the other pages remain

| Tool | Unique reason to keep it | Coverage retained |
| --- | --- | --- |
| Synthetic financial year | Current v2/v3 seeding, fresh-folder refusal, exact reconnect, uncertain-outcome recovery | Synthetic-year, packed and fragmented storage suites |
| Guided import checks | Programmatic checkpoints, request metrics, exact interruption recipe, safe detailed report | PR28 live, UI, timing and request-budget suites |
| Manual import workbench | The guided runner fetches its markup and imports its controller into the same session; it is not a redundant standalone implementation | Canonical import and PR28 workbench suites |
| Guided backup and restore | Actual saved-file round trip, new-copy verification, guarded navigation | PR25 copy guide and copy progress suites |
| Backup and recovery manual mode | Quarantine, failed copies, retention boundary, token-expiry and interruption controls absent from the guided mode | Backup, retention, portable archive and transaction suites |
| Application lifecycle diagnostics | Serialized writes, explicit recovery checks, stopped-heartbeat simulation, legacy disposable-file cleanup | Application lifecycle and prototype suites |
| Session coordination diagnostics | Marker-only ownership tests, heartbeat, two-device refusal and stale recovery without a ledger | Session coordination and UI suites |
| Drive protocol diagnostics | Pagination, generated-ID retry, raw If-Match behavior and conditional-write races | Drive feasibility and transaction suites |
| Exact-name discovery | Rediscovery after reauthorization and forgetting the previous Picker comparison | Drive folder discovery suite |

File names keep their historical PR numbers where tests, imported controllers and guide links rely on them. Visible entry-point labels describe the task instead. The PR25 `prototype-tools` navigation guard is preserved, including refusal to leave while a copy operation/session is held.

## Guided copy compatibility fix

**Verified defect and fix:** the copy guide read summary counts directly from the canonical root index. Version 3 stores a fragment inventory there, so its verified source could fail before the backup step. The guide now reassembles the logical index from the current snapshot’s already verified archive bytes. It makes no extra Drive read and changes no storage, archive or copy-validation contract. Regression tests run the complete source/backup/export/saved-file/restore/reopen/release flow for versions 1, 2 and 3, and refuse a corrupted fragment before enabling backup. The owner suite uses the completed version-3 year for its live copy check.

## Automated verification

Use the repository's complete serial command on the final source:

```sh
node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

The cleanup adds checks for local page assets, navigation targets, module imports, retired-runtime references and the retained diagnostic inventory. Acceptance-suite tests cover report allowlists, source/browser changes, stale saved state and the separation between tester observations and programmatic results. Existing financial/storage tests remain in the aggregate suite.

**Verified locally, November 8, 2026:** the final integrated suite passed **931/931 tests on Node 24.22.1 and 26.13.0**, with zero failures, cancellations or skips on either version. The serial runs took about 247 and 231 seconds. All browser/test JavaScript syntax checks, workflow YAML parsing, local Markdown targets and `git diff --check` passed.

**Verified in local Chromium 153:** the final center passed 320×740, 390×844, 844×390, 768×1024 and 1440×1000 layouts, plus doubled body text, without document overflow. Checks covered no external resources or automatic actions in the center, missing-source refusal, source/browser resets, Back/reload continuity, dependency-only result resets, jump navigation, fresh-run cancel/confirm, download allowlists and clipboard-failure fallback. All retained tool navigation and the guarded copy-guide exit were checked. There were no page errors. External Google requests from the underlying tools were blocked; checklist selections were invented test inputs, not owner acceptance.

Independent review covered retired dependencies, unique diagnostic coverage, report privacy, source binding and guide accuracy. It corrected the same-tab import-verifier limitation in cross-device instructions and approved the bounded v3 summary fix. Local Chromium, mocked requests and viewport emulation do not establish real Safari, Google authorization, Drive performance or physical device capacity. Those remain owner checks after a separately authorized deployment.
