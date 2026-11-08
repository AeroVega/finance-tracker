# PR29 visual overhaul

## Scope and status

**User-confirmed:** after reviewing the prototype and proposed approach, the owner authorized extending PR29's visual language across the application and improving its workflows. Removal of old prototype code was deferred. No merge, deployment, production activation or real-data testing is authorized by this work.

**Verified implementation:** the main workspace and every top-level prototype page now use a shared static design system. The original `prototype/modern-stack-exploration/` directory is unchanged and remains linked from the tools hub. Its original scope notes describe that earlier isolated exploration, not this subsequent extension.

PR29 incorporates current `main` through a history-preserving merge. The integration was published at `da25c2483d774adbee7e1b0f346c3cf457d95d70` and passed 694 tests on each supported Node version before this overhaul. No shared history was rewritten.

## Design and workflow changes

- `design-system.css` supplies obsidian surfaces, restrained cyan/violet accents, typography, focus treatment, semantic colors and reduced-motion support. No framework, build step, hosted font or styling service was added.
- The main workspace has persistent navigation, a clear overview → import → inspect sequence, and a separate optional synthetic-storage section. Narrow layouts use horizontally scrollable navigation and stacked cards rather than squeezing desktop columns.
- The overview names its actual scope: **loaded cash movement**, not reconciled income, spending, balances or a complete financial position. Missing eligible cash data is **Unavailable**, including investment-only imports. Existing arithmetic is unchanged.
- The page distinguishes local CSV records from invented sample rows, including mixed previews. Per-row provenance remains visible. CSV rows stay local and are never uploaded by these controls.
- Search filters the displayed ledger by description, provider or displayed/ISO date. It does not change totals, source records, persistence or reconciliation. Empty data and no search matches have separate messages.
- Action feedback is repeated near the ledger controls without adding a second live announcement. Save and clear explain their different effects on local rows and the synthetic snapshot. Existing duplicate and busy guards remain in place.
- The main page requests the browser's leave warning when local CSV rows exist or a synthetic mutation is pending. It does not autosave. Browser warnings are not guaranteed on mobile, and this guard does not cover every in-flight operation, such as the first CSV read or Drive connection/recovery/release.
- The tool hub groups guided workflows before manual workbenches and earlier experiments. Guided backup/restore is linked directly. All existing tool pages and controls remain available.
- Developer tools share navigation, surfaces, readable status colors and primary-action emphasis. PR25's guarded hub link retains its controller ID; no unguarded overview exit was added to that copy flow.

## PR28 lessons carried forward

Source: [the recorded workflow problems and follow-up criteria](PR28_CANONICAL_IMPORT.md#owner-testing-lessons-november-8-2026), [storage performance evidence](PR28_STORAGE_PERFORMANCE.md), and [the synthetic implementation contract](PR28_IMPLEMENTATION_SCOPE.md).

| Recorded lesson | PR29 response and preserved contract |
| --- | --- |
| The interruption preparation button was hard to find. | Guided routes are prominent in the hub. Existing adjacent step actions and prerequisites remain in the assisted workflow; sections and primary actions have a consistent hierarchy. |
| Feedback was far from the staging action, encouraging repeated clicks. | Preserve nearby staging confirmation and pending-change counts. Main-page actions also report beside the ledger. Existing intentional corrections and append-only history are unchanged. |
| Long copies lacked a visible phase and elapsed time. | Preserve phase, object count, elapsed time and final verification states, restyled for contrast. Copied-object completion is not represented as independent verification or release. |
| Source, interruption folder, backup and restored copy were confused. | Keep the folder-role explanations and guided source-to-new-destination sequence. Direct hub entry reuses the completed source rather than suggesting the live recipe must run again. |
| Growing controls made the flow hard to follow. | Separate ordinary preview work, guided checks, manual workbenches and earlier experiments. Keep advanced/recovery actions secondary, without hiding required warnings. |
| Mobile interaction needs to remain usable. | Responsive cards, local table overflow, visible focus, skip links, readable form text and touch-sized controls. Physical Safari/iPhone/iPad checks remain open. |
| Unsaved, incomplete and failed states must be honest. | Preserve workbench dirty/busy guards, incomplete coverage, failed/unverified states and release warnings. Missing main-page cash totals are not zero, and local preview limitations are visible. |
| Drive work needs measurement and careful reduction. | No changes to request concurrency, storage access, save granularity, retained-history validation, ownership checks, pagination or lazy detail behavior. Existing performance and integrity tests remain part of the full suite. No new performance improvement is claimed. |

## Validation

**Verified locally:**

- Seven new workspace UI tests cover missing-data states, search isolation, provenance, unload warnings, mutation settlement, native navigation and shared-theme/navigation contracts.
- Existing copy-guide controller tests caught a missing navigation hook during development. Restoring the original ID and removing an unguarded extra exit resolved the regression. All 22 copy-guide tests then passed.
- Chromium rendering covered 55 page/viewport combinations: main, hub and nine tool routes at 1440×1000, 820×1180, 1180×820, 390×844 and 320×740. No document horizontal overflow; no enabled button, input, select or summary below 24px high.
- Main sample loading, unmatched search, repeated sample loading and clearing passed at all five sizes. Repeated sample loading retained four rows, not eight.
- All 13 bundled fixture assertions passed in the browser. Keyboard Tab revealed the skip link with a cyan focus outline; Enter moved focus to the overview.
- Shared foreground contrast against the card surface: text 16.58:1, muted text 7.11:1, cyan 12.57:1 and violet 8.16:1. These measurements do not constitute a full accessibility audit.
- Original-reference and revised-page screenshots were inspected. Rendering used temporary Chromium/Playwright tooling from standard package registries, outside the repository. Google's requests were blocked; no live Drive operation was performed. The original prototype's exact external Tailwind script was supplied locally for reference rendering only.

**Verified final local checkpoint:** `node --test tests/*.test.mjs` passed **701/701** tests on Node **24.22.1** and **26.13.0**, with zero failures, cancellations or skips. JavaScript syntax checks passed for all files under `js/`, `prototype/` and `tests/`; `git diff --check` passed. All original IDs across ten top-level HTML pages remain present without duplicates, and all 70 local HTML asset/navigation targets exist. No tracked file was deleted. The restored PR25 navigation also passed a further ten viewport checks. Independent diff review found no remaining blocker.

These are local results, not remote CI or deployment results. See the PR's checks for the published commit's CI status.

## Open limits and review steps

- **Open:** physical iPhone/iPad and Safari/WebKit rendering, text scaling, file chooser behavior and navigation warnings. Chromium viewport simulation does not establish those results.
- **Open:** owner review of the revised flows. Earlier PR28 owner acceptance remains tied to its recorded source commits; it is not evidence of accepting the PR29 visuals.
- **Not performed:** Google authorization, live Drive reads/writes, real account imports, live copy/restore, deployment or production activation. Local pages show the expected missing deployment-configuration status.
- **Unchanged:** the landing page is a basic local preview, not the canonical ledger UI. It does not establish account mapping, complete coverage, transfer reconciliation or production financial reports. The synthetic canonical workbench remains a separate development flow.
- **Unchanged:** production persistence is NO-GO under the PR27 gates. No storage engine, credential handling, financial parser or reconciliation module changed.
- **Deferred by the owner:** prototype removal. This branch preserves the reference and all earlier tools.

Next: review PR29 and its screenshots, then perform the remaining device checks on a separately authorized preview deployment. Do not treat a branch push or green CI as deployment or production approval.
