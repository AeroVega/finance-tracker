# Project status

## Staged-save performance, November 12, 2026

The owner completed a live synthetic-year seed, then reported a single staged
change taking over two minutes to save. The PR38 follow-up removes redundant
readbacks, repeated staging ownership requests and an automatic second reopen;
it bounds independent immutable uploads to four and prevents full snapshot scans
from flushing the 8 MiB byte cache. Publication still verifies remote ownership,
exact base, financial history and durable bytes. No storage-format change or
real-data operation is included.

See [the measured comparison and limitations](PR38_SAVE_PERFORMANCE.md) before
interpreting this as a live speed guarantee. Physical Safari/Drive validation
remains the next owner check; ten-second saves are not established.

## Safe diagnostic code follow-up, November 12, 2026

**Implemented in the local `feat/apple-pwa-ui` working tree:** synthetic-year
reports now retain allowlisted canonical v5 root, locator and Drive transport
codes through bounded causes, include the page phase and verified durable-write
count, and distinguish a missing adapter guard from a failure before the guard
with a bounded operation label and underlying code. A manifest read mismatch
also reports a fixed reason for metadata changing across the read, a declared
size disagreement, or both. The diagnostic remains privacy-safe. The owner
reported (**User-confirmed**) `manifest-version-mismatch` during `connecting`
after 8 verified durable writes on build `4d1dfe7`; code inspection (**Verified**)
shows that this code covers the two manifest read checks, but the report did not
distinguish them. `node --check` and `git diff --check` pass for the added reason.
Automated tests were not run. This change is not in the deployed build; the next
report from a build containing it can distinguish the mismatch category, but will
not establish the provider-side cause by itself.

The owner then reported (**User-confirmed**) `adapter-precondition-failed` with
cause `verification-metadata-changed` at `root-manifest-admitted`, after 66
verified durable writes on build `1845971`. The guard compares metadata used in
the verification phase with a fresh folder listing before publication. The
report does not identify which file or metadata field differed. The working tree
now adds a privacy-safe missing/changed reason and allowlisted field names; the
updated diagnostic has not yet been built or deployed. A mismatch classification
does not by itself establish why Drive returned different metadata or prove
whether recovery is needed.

On build `9db2acf`, the owner reported (**User-confirmed**) that the only changed
field was Drive `version`. The application now treats version-only changes as
revalidation triggers in immutable reads, locator reads, manifest reads and
verification closure. It retries a stable metadata bracket, and at verification
closure rereads exact immutable bytes and checks their stored size and SHA-256.
(**Implemented in the working tree; JavaScript syntax and diff checks passed;
automated tests not run; not deployed.**) Other
metadata changes, missing objects, hash mismatches and unsettled versions still
stop publication. Google documents [`version`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
as advancing for any server-side change, including invisible changes; it is
therefore a freshness signal, not a content hash. Rechecks are bounded and do
not provide provider-side compare-and-swap. Verification closure allows up to
512 version-changed files and 16 MiB of re-read content per phase; a higher
count/byte limit remains an explicit stop with bounded counts in diagnostics.

The owner reports (**User-confirmed**) that deployed build `a510b09` completed
synthetic-year seeding and verified the exact saved year: 71 verified durable
writes in 5m06s. This acceptance followed the version-only revalidation change.
It confirms the reported synthetic operation succeeded; it is not independent
live-Drive instrumentation or production approval.

## Combined PR37 storage and PR38 interface, November 12, 2026

**Implemented:** merge PR37 head `8e340b3` into PR38 head `75e295e`, preserving
both histories. The combined branch retains the v5-only storage, session fixes,
shared diagnostics and audit/paging improvements with PR38's mobile interface.
A bounded Home-view cache prevents its recent-record read from evicting Activity's
filtered-page cache on every render; ledger, account and month changes invalidate it.

**Verified locally:** the final complete extended suite passes **1,927/1,927**
on Node 24.22.1 in 529.786 seconds, with no failures, skips or cancellations.
The new Home-cache regression fails before the integration fix and passes after;
it covers search/pagination reuse and scope/correction invalidation. The initial
combined controller, routing and diagnostic subset passed 90/90. Runtime syntax
and documentation checks pass. Independent integration review found no remaining
blocker. Earlier sections below record their original revision's evidence, not
validation of this combined tree.

**Open:** rendered Chromium checks could not launch because this executor refuses
browser process sockets (`EPERM`), including the permitted elevated retry. Earlier
PR38 render results do not validate this merge. Physical Safari, Home Screen and
live Drive behavior require owner acceptance. No manual deployment, main merge,
PR closure or real-data operation was performed; production remains **NO-GO**.

## PR38 adversarial review, November 11, 2026

**Implemented:** preserve unfinished transaction edits on same-record reentry,
confirm destructive editor changes, expose excluded posting states, control
route-link scroll behavior and make chrome scroll in short phone windows.
The [adversarial review](PR38_ADVERSARIAL_REVIEW.md) records the four confirmed
findings, baseline reproductions, what works well and the implemented suggestions.
**Verified:** 2,009/2,009 extended tests pass on Node 24.22.1 in 318.394 seconds,
with no failures, skips or cancellations. All 82 focused controller/routing
checks, nine rendered layouts, a separate posting-state flow, syntax,
documentation and diff checks pass. Four regressions fail for the expected
reasons at the isolated reviewed head and pass after repair.
Physical Apple-device behavior remains **Unverified**. No merge,
deployment or live Drive operation was performed.

## Mobile and tablet design at 1874860 in PR38, November 11, 2026

**Implemented on `feat/apple-pwa-ui`:** Home with recent scoped source activity
and review status, an expandable filter row, tappable transaction records,
balances before editors, correction-first detail and a compact tablet rail.
The [design contract](MOBILE_UI_DESIGN.md) connects the first-party finance-app
research to the implementation and acceptance checks. The Apple installation
foundation remains in place. **Verified:** 2,003/2,003 extended tests pass on
Node 24.22.1 in 350.519 seconds, with no failures, skips or cancellations. The
76 focused controller/routing tests, eight Chromium layouts, tablet-to-phone
resize checks, anonymous assets, syntax, documentation and diff checks pass.
Physical Apple-device behavior remains **Unverified**. Financial calculations and storage
are unchanged. No merge, deployment or live Drive operation was performed.

## Apple web app UI, November 11, 2026

Initial foundation at `2198a61`, before the design follow-up above.
**Implemented on a separate branch from `feat/scalable-storage-foundation`:**
install metadata and opaque icons, additive safe-area spacing, a sticky mobile
header, measured tab/draft clearance, touch feedback and enlarged-text wrapping.
Financial logic and persistence are unchanged. The focused
[UI contract and browser evidence](APPLE_WEB_APP.md) records seven passing Chromium
layout scenarios and local anonymous asset checks. **Verified:** the required
extended suite passed 1,999/1,999 tests on Node 24.22.1 in 335.845 seconds, with
no failures, skips or cancellations. Syntax, documentation and diff checks pass.
The complete run used the outer executor after sandboxed child-process tests
reported `EPERM`. Physical Apple-device
appearance, keyboard and Home Screen behavior remain **Unverified**. This work
does not deploy or merge the storage branch, or expand production authorization.
## Audit and paging efficiency, November 12, 2026

**Implemented and verified locally:** canonical audits use one checked tree scan,
and workspace pagination reuses its latest filter result. The complete extended
suite passed 1,916/1,916 tests on Node 24.22.1, with no failures, skips or
cancellations. Matched synthetic measurements show less audit work and faster
search paging, with unchanged HTTP traffic. See the
[follow-up evidence](PR37_V5_ONLY_CLEANUP.md#follow-up-remove-repeated-audit-and-paging-work).
This does not complete selective loading or bounded whole-database memory.
Cleanup head `ace083a8` passed both required CI jobs in
[run 43127078947](https://github.com/AeroVega/finance-tracker/actions/runs/43127078947).
Follow-up CI is not yet verified. No merge, manual deployment or live-data access
was performed.

## V5-only active storage, November 12, 2026

**Implemented and verified locally:** active canonical storage now uses v5 only.
Older folders and archives are refused without conversion. New migration is
removed; existing migration-origin v5 copies retain read-only provenance
verification and remain editable and backupable. The obsolete raw-preview Drive
controls are retired. See the [cleanup evidence](PR37_V5_ONLY_CLEANUP.md) for
compatibility, coverage, source-size measurements and unchanged request traffic.
The final extended suite passed 1,906/1,906 tests on Node 24.22.1, with no failures,
skips or cancellations. No merge, deployment or live-data acceptance was performed.

## Shared privacy-safe diagnostics, November 11, 2026

**Implemented in this change:** one shared error-code/message/report path across
workspace, seeder, local preview and retained developer tools. Reports use a
strict field allowlist, offer Copy and selectable fallback, and never upload or
retry automatically. Asynchronous lifecycle error statuses use the same privacy
boundary. See the [diagnostic contract](APP_DIAGNOSTICS.md) for exact coverage,
verification and exclusions. The final local extended suite passed 2,039/2,039
tests on Node 24.22.1 with no failures or skips. Browser-rendered checks are blocked by this
executor's Chromium process restrictions; physical Safari, live Google and owner
acceptance remain separate. This is not a deployment claim or production approval.

## Initial-copy readback incident, November 11, 2026

**User-confirmed:** deployed `56cafc2` reached four verified initialization writes
then reported `write-unresolved`. The year-seeding phase had not started.
[Incident analysis](PR37_ENGINEERING_REVIEW.md#initial-copy-readback-failure-on-deployed-56cafc2)
records two distinct synthetic reproductions and the candidate's narrowly
bounded new-page verification and safe diagnostics. The live cause is unconfirmed.
The affected folder and marker remain untouched. Runtime candidate `6900bce`
passed 1,999 extended tests on Node 26.13.0, with no failures, skips or
cancellations, in 316.656 seconds. Diagnostic rendering passed desktop/mobile
Chromium checks with external HTTPS blocked. The fix is isolated on
`fix/pr37-immutable-readback`; PR37 and its Pages publishing branch remain at
`56cafc2`. This is not a deployed fix or confirmed live acceptance. Earlier
evidence follows.

## PR37 engineering review, November 11, 2026

**Implemented locally:** delayed session-marker verification and cancellation,
candidate-only marker enumeration, and removal of the unused seeder layout
setting. See [session coordination](SESSION_COORDINATION.md#delayed-marker-visibility-and-cancelled-acquisition)
for the reproduced failure, retry/deadline contract and remaining ownership limits.
The owner reports a seed failure on deployed `5317afdf`; temporary listing omission
is reproduced synthetically, not confirmed as the live cause. The affected folder
and marker have not been accessed. The unpublished `7d517671` candidate was not
available in this environment and has not been adopted or claimed as deployed.

**Verified configuration:** Pages used the feature branch as a legacy publishing
source at initial review. After the owner changed it, the API reports `main` as
source. Publishing PR commits no longer requires changing that setting. No merge
or deployment is authorized. **Verified on published code/review head `c07d141`:** 1,988 extended tests
passed on Node 26.13.0 in 326.643 seconds, with no failures, skips or
cancellations. Syntax, documentation and desktop/mobile Chromium preview
checks passed. Remote CI remains queued, not passed. The
[matched measurements](PR37_ENGINEERING_REVIEW.md#validation-and-matched-measurements)
show reduced response-body bytes, unchanged requests/uploads, and no established
latency or memory improvement. The [engineering review](PR37_ENGINEERING_REVIEW.md) records the end-to-end
flow, safeguard inventory, compatibility gaps and device procedure. The
complete-ledger loading limits in the v5 section remain open.

## Canonical v5 replacement slice, November 11, 2026

**Implemented in the publication candidate:** the [v5 slice](PARTITIONED_CANONICAL_STORAGE.md)
extends the existing paged store and lifecycle with coalesced canonical and locator
updates and final-reachable new-page uploads. The current application is v5-only;
older canonical copies and initialization markers are refused and preserved, with
no new migration or older writer path. Existing migration-origin v5 copies remain
supported through full read-only audit of their retained legacy provenance.
Full logical derived
validation accepts different valid tree topologies. Compact source/derived 2,
locator 3, physical protocol 4 and framed transport 3 retain their meanings, with
an explicit `canonical5-physical4` archive profile. Initialization marker 2 pins
v5; interrupted marker-1 initialization is refused. The following test and benchmark
results predate this v5-only cleanup and do not validate its changes.

**Verified repair baseline:** the required extended suite passed 1,840 tests on
local `1993fb6a3d0e19f9909f48277257c03cad656c41`. [Published repair `89a29b6`](https://github.com/AeroVega/finance-tracker/commit/89a29b612747cc56cefeefd4bbb6bf2a818a939a)
passed [CI run 43029837232](https://github.com/AeroVega/finance-tracker/actions/runs/43029837232).
That repair evidence is separate from the v5 gate. Both ordinary and required
extended suites passed **1,972/1,972** on candidate `39b3d1e` (Node 24.22.1),
with no failures or skips. Publication code commit `d9d04c7` has the identical
tree. Independent review found and verified the exact-base preparation repair.
The [matched synthetic evidence](V5_MATCHED_SYNTHETIC_EVIDENCE.md) records all
eight successful A-B-B-A runs, input checks, counts, timing variation and limits.
The assembled publication code also passed **1,972/1,972** in the required
extended gate. Documentation checks passed after the final guide corrections.
Remote CI remains separate and must be checked on the exact PR head.

**Open:** full financial validation, retained-history and physical checks,
whole-ledger workspace cloning/materialization and preparation memory remain.
No bounded whole-database memory, selective app loading, incremental semantic
validation or device-memory improvement is claimed. Dense mixed/retained saves
upload substantially fewer bytes, but total requests fall only about 3% and
timings do not establish a precise latency gain.
PR37 remains a draft and is unmerged. **User-confirmed:** the owner tested deployed
`5317afdf` and reported the session failure described above. Successful v5 live
Drive/device acceptance is not established by that failed attempt. Production
remains **NO-GO**, with invented fixtures only and no new real-data, live Drive,
merge, deployment or production authorization. Earlier evidence follows.

## Canonical v4 app integration, November 11, 2026

Historical checkpoint, superseded by the v5 status above. These results describe
the earlier v4 integration, not the current v5 slice.

**Implemented locally in PR37 work:** new synthetic copies use canonical v4
through seeding, preview/import saves, workspace corrections/reopen, interrupted
recovery, backup, framed export/restore and explicit fresh-copy v1/v3 migration.
The [format contract](PARTITIONED_CANONICAL_STORAGE.md) defines the compact value
tag and the distinct physical catalog/protocol versions. Existing copies are
not silently converted, and historical source evidence is preserved.

**Verified locally:** the required extended suite passed **1,733/1,733** tests
on Node 24.22.1, with no failures, skips or cancellations and unchanged tracked
files during the run. Independent reviews and synthetic HTTP/controller checks
cover the changed paths. The initial aggregate exposed a stale seeder test;
real v4 upload/reconnect coverage replaced that gap before the passing rerun.
Publication and CI results belong to the exact PR revision. No v4 deployment,
live Drive or physical-device acceptance is claimed. The [owner guide](OWNER_ACCEPTANCE.md)
and runtime checklist now describe the integrated format.

**Open:** full ledger/history materialization and deterministic tree rebuilding
remain. V4 save/reopen costs exceed the published v3 path in some measured
workloads despite improvements within v4. Synthetic timing guides iteration;
the owner's live Drive/device experience determines practical effectiveness.
Selective cold loading, bounded complete semantic auditing, incremental edit
validation, source-only index repair and production controls remain unfinished.
Production remains **NO-GO**. The sections below retain earlier milestone evidence.

## App testing follow-up, November 11, 2026

**Implemented and locally verified:** the [app feedback fixes](APP_TESTING_FEEDBACK.md)
add auditable posting-status corrections, reduce the measured two-edit save from
209 to 132 synthetic HTTP requests, and explain the active v3 format. The final
combined extended suite passed 1,507/1,507 tests on Node 24.22.1. Independent
review passed. [Test scheduling](TESTING.md) avoids duplicate CI execution while
retaining the extended storage gate. Live Google latency and device acceptance
for these changes remain open. This follow-up does not deploy or merge PR37;
production remains **NO-GO** and the larger storage integration is unfinished.

## Storage and safety update, November 11, 2026

**Verified:** [PR36](https://github.com/AeroVega/finance-tracker/pull/36) is merged
in main `04aacf31b8aaae31fa73b10408fa22d417c0d943`. Its description reports completed
owner synthetic/device acceptance. The baseline local Node 24.22.1 suite passes
1,120/1,120. Financial position and reconciled coverage are implemented; the
November 10 branch-status paragraphs below are historical.

The [storage scaling and production-readiness audit](STORAGE_SCALING_AND_PRODUCTION_READINESS.md)
records measured catalog growth, whole-ledger memory limits, safe local codec and
token-cleanup changes, and remaining production gates. The owner subsequently authorized execution and draft publication. The
[incremental storage foundation](SCALABLE_STORAGE_FOUNDATION.md) implements
segmented catalogs, source-bound monthly reports, response bounds and lower-memory
Drive backup. Full bounded loading and production controls remain unfinished.
At that earlier checkpoint, the [paged storage milestone](PAGED_STORAGE_MILESTONE.md)
added isolated immutable trees, a canonical v4 reference reader, framed archives
and a root transaction prototype. The integration update above supersedes that
checkpoint's runtime status.
PR37 is not merged. A temporary branch preview was published to the shared Pages site at `5e9c8966`; this is not a main-branch or production release. Deployment/owner acceptance remains a separate gate.
Historical monthly migration, supported owner-file ingestion and production
controls remain. **Alpha is incomplete and production remains NO-GO.**

## Earlier main snapshot, November 10, 2026

**Verified snapshot:** November 10, 2026. Audited `main` at [`d38681ee013cbe3e52dd861264f70490935c3582`](https://github.com/AeroVega/finance-tracker/commit/d38681ee013cbe3e52dd861264f70490935c3582). This is a dated record, not a live status feed.

The synthetic canonical workspace and storage foundation are implemented. **Alpha is not complete.** Financial position, reconciled coverage, monthly-history migration and production controls remain. Production financial-data persistence is **NO-GO**.

## Financial-position branch update, November 10, 2026

**Implemented, under review:** The owner-authorized [financial-position milestone](FINANCIAL_POSITION.md) builds on main `e0420a70a27cec6f7d13fe6b65258643433e4c64`. It adds dated balance selection, source/conflict history, a 35-day freshness warning, separate-currency position totals, holdings evidence, credit-card/mortgage/auto-loan balances, explicit zero-balance closure and evidence-backed account/month coverage. Position changes use append-only records and the existing verified save/reopen/portable-restore path.

The workspace can stage accounts, balances, balance/holdings conflict decisions, dated holdings, cash/card reconciliation, statement-component reconciliation and closures. Manual investment/loan statements can explicitly declare the full month without a fabricated CSV import; declaration alone does not prove completeness. General provider balance/holdings file importers are outside this milestone. The legacy synthetic-year fixture remains unchanged.

The [PR36 adversarial follow-up](archive/PR36_ADVERSARIAL_REVIEW.md) corrects closure contradictions, corroborating evidence, holdings comparisons and audit-identity collisions. It improves reconciliation choices, local feedback, draft preservation and repeated financial report work. The review remains synthetic-only.

**Verified local review tests:** 1,097/1,097 passed on Node 24.22.1, with no failures or skips. This includes 23 added review regressions across financial evidence, persistence identity checks, cached readers and editor workflows. Changed module syntax and diff checks passed.

**Verification limits:** Automated suites exercise synthetic domain records and in-memory storage/recovery adapters. Browser rendering could not be verified in this environment: Chromium could not create its local socket, and the provided browser could not reach the local test server. Physical iPhone/iPad Safari, live synthetic Drive acceptance and deployment remain outstanding. No real records or live financial services were used.

This branch does not complete Alpha or authorize production persistence. The tables below remain the dated main audit, not a claim that this branch has merged or deployed.

## Repository and deployment

| Work | Verified state | What that establishes |
| --- | --- | --- |
| [PR26](https://github.com/AeroVega/finance-tracker/pull/26) | Merged November 6 | Product baseline and monthly migration requirements. |
| [PR27](https://github.com/AeroVega/finance-tracker/pull/27) | Merged November 8 | Production planning only. No production implementation or activation approval. |
| [PR28](https://github.com/AeroVega/finance-tracker/pull/28) | Merged November 8 | Synthetic provider parsing, canonical import/review/save/reopen. |
| [PR29](https://github.com/AeroVega/finance-tracker/pull/29) | Merged November 8 | Shared visual work; not financial-position completion. |
| [PR30](https://github.com/AeroVega/finance-tracker/pull/30) | Merged November 9 | Synthetic year, storage/CPU improvements and bounded acceptance evidence. |
| [PR33](https://github.com/AeroVega/finance-tracker/pull/33) | Merged November 9 | Sixteen portable engineering workflows, replacing PR31's earlier skills. No application feature completion. |
| [PR34](https://github.com/AeroVega/finance-tracker/pull/34) | Merged into PR32's branch November 10 | Exact preview persistence and manual transfer linking; included in main through PR32. |
| [PR32](https://github.com/AeroVega/finance-tracker/pull/32) | Merged into main November 10 | Canonical main workspace, including its follow-ups. |

At this snapshot, GitHub's open-PR search returned no open PRs. Remaining branch names are not evidence of unfinished or delivered work.

**Verified CI:** [Node contract tests](https://github.com/AeroVega/finance-tracker/actions/runs/42752426272) passed on the audited main SHA. Earlier PR test counts belong to their recorded heads; do not reuse them as today's result.

**Verified deployment failure:** [Pages run 42752426270](https://github.com/AeroVega/finance-tracker/actions/runs/42752426270) failed at `Configure GitHub Pages` on that same main SHA. Checkout, source stamping and generated Google-configuration validation passed. Artifact upload and deployment were skipped. The underlying configuration error and the currently served live SHA were not verified in this audit. The earlier [branch Pages build](https://github.com/AeroVega/finance-tracker/actions/runs/42751899321) succeeded on `4a61325fbd8b1abd20b53c42af83c259b42c9a5b`; that does not prove main deployed.

The workflow in source deploys main pushes or an explicitly selected manual run. Pages is one shared public deployment. Verify actual repository Pages settings and the served source before owner acceptance; do not infer hosting configuration from workflow YAML alone.

## What exists and what remains

| Area | Implemented on audited main | Remaining Alpha work |
| --- | --- | --- |
| Canonical activity | Account/month browsing, exact qualified reports, evidence, append-only corrections, staged undo/revert and manual transfer links. | Finish acceptance of changed save/reopen and transfer-link paths. |
| Imports | Strict known Wells Fargo, SoFi and Fidelity fixture parsers; provenance, mapping, declared coverage, duplicate review and canonical storage in the advanced workbench. | Supported owner-file ingestion in the production-capable application, with the same validation and privacy controls. The main workspace currently does not ingest user CSVs. |
| Storage | Synthetic ownership/session checks, immutable transaction history, recovery, backup/restore, portability and retention machinery. The current application supports canonical v5 only and safely refuses older canonical copies. | Production binding, clearing, configuration/privacy/cost review and current end-to-end acceptance. Synthetic implementation is not production approval. |
| Financial position | PR36 adds dated balances, holdings evidence, liabilities, qualified net-worth reporting and account/month reconciliation. Owner synthetic/device acceptance is recorded in PR36. | Historical monthly migration and supported owner-file ingestion remain separate work; production activation remains gated. |
| Coverage | Import provenance and declared intervals; unresolved source evidence stays visible. | Evidence-backed per-account and per-month reconciliation completeness. An interval or row count does not prove completeness. |
| Historical continuity | Monthly migration requirements are settled. | Separate monthly-summary schema, converter, reconciliation and source-selection rules from January 2023. No conversion is claimed. |
| Devices and deployment | Local automated/browser evidence and bounded owner observations exist. | Verify current served SHA, current live paths and physical-device coverage. Whole-graph loading has no demonstrated large-device capacity guarantee. |

Code evidence: [workspace model](../js/canonical-workspace-model.mjs), [workspace session](../js/canonical-workspace-session.mjs), [provider parsers](../js/provider-csv.mjs), [canonical store](../js/canonical-ledger-storage.mjs) and [guided import](../prototype/pr28-import.mjs). See the linked contracts for exact financial and failure semantics.

## Acceptance evidence has a scope

- **User-confirmed, recorded in the workspace guide:** the owner accepted PR32 local synthetic-year exploration, evidence/corrections and mobile workspace experience. Preserve that observation; do not repeat unaffected checks merely because the PR merged.
- **Open:** the newer preview-to-Drive save, transfer-link persistence and interruption checks. The guide does not provide a new acceptance pass for these paths. Record the full tested SHA with the next result.
- **User-confirmed, historical:** PR25, PR28 and PR30 records contain bounded live synthetic/device results. They do not validate every later screen or every interruption boundary.
- **Implemented checklist correction:** the [acceptance plan](../prototype/acceptance-plan.mjs) now requests canonical v5 seeding and v5 backup/restore. This removes the obsolete grouped-v2 steps; it does not establish owner acceptance. Use [the current owner guide](OWNER_ACCEPTANCE.md).

## Safety and release boundary

Keep invented fixtures in the public repository and CI. Do not inspect, convert, upload or persist real financial records as part of ordinary synthetic development. Keep the archived workbook unchanged.

The accepted production policy requires working financial data and tokens in memory and clearing on sign-out or orderly release. The synthetic workspace currently retains loaded records and drafts read-only after release. That remains an implementation gap, not permission to weaken the policy.

PR27's later decision removes a separate real-data smoke-test prerequisite. Synthetic test evidence still must be accompanied by actual OAuth/configuration review, live synthetic acceptance, recovery/privacy/cost review, residual-risk acceptance and explicit production authorization. January 1, 2027 remains a conditional v1.0.0 target.

Continue with [next steps](NEXT_STEPS.md). The broader product scope remains in the [roadmap](ROADMAP.md).

## Diagnostic v2 follow-up — November 13, 2026

**Implemented:** the focused `feat/actionable-diagnostics` branch starts at PR38
`7aa553eeab83d898b9a6bb43dfb8a68c298ae70a`. It consolidates code recognition and
fixed copy; preserves sanitized reports across status publishers and native
causes at transport/session boundaries; adds bounded source locations, action,
request, lifecycle and environment context; and integrates tiered diagnostic UI,
recent history, a manual developer self-test, startup fallback and offline triage.
It does not rewrite the storage error hierarchy or change ownership, retry,
verification or recovery decisions. Existing cancellation codes are retained;
reports can identify the underlying native abort. The literal-code audit finds
628 codes with zero unregistered literal sites, and explicitly lists 40 dynamic
forwarding sites rather than claiming those are statically proven.

**Verified baseline:** Node 24.22.1, extended suite at `7aa553e` passed 1,950 tests
in 481.7 seconds. The [approximate baseline audit](evidence/error-code-audit-baseline.txt)
found 420 unrecognized codes out of 621. The new lexical audit has broader coverage,
so these two scan totals are not identical populations.

**Verified candidate:** diagnostic-focused checks at `37e6a7f` passed 50 tests.
Syntax, code audit, generated-reference freshness and documentation checks passed.
Independent reviews found and fixed changing-getter/array-method privacy bypasses,
stale cross-attempt deduplication, and tool-surface forwarding. The final extended
suite at `85edca6` passed **1,993/1,993 tests** in **485.4 seconds**, Node 24.22.1.
Nine initial integration failures were outdated v1 field/DOM assertions; the
updated tests retain exact metadata, privacy, mutation and false-success checks.

**Not deployed or owner-accepted:** Chromium launch is blocked by this executor's
socket restrictions; rendered checks were added but are unverified. Physical
Safari stack capture, clipboard/selection, panel layout and live Google integration
remain owner acceptance. No merge, deployment or live Drive operation was performed.
Production financial-data persistence remains **NO-GO**.

**Publication scope:** owner requested Copy/Select only; the optional OS Share
button and its capability field were removed. All prototype files are unchanged from PR38. Startup fallback, diagnostic styling
and status report-ID forwarding are integrated in the main app only; legacy
prototype status-only error paths retain their previous context limitations.

**Verified reduced scope:** the exact Copy/Select-only, main-app integration tree
at `760ef91` passed the complete extended suite: **1,994/1,994 tests**, Node
24.22.1, **495.3 seconds**. All prototype files match the PR38 base byte-for-byte.
Publication is pending approval review of diagnostics-related synthetic test
updates; no branch, PR, deployment or merge has been published for this follow-up.


## PR40 save receipt investigation — November 13, 2026

**User-confirmed:** PR40 diagnostics build `311b542` was deployed and a staged
synthetic save failed. The report locates the first failure in immutable-create
receipt checking; `verification-scope-closed` is a subsequent invalidation of the
captured locator read capability. The older broad `hash-mismatch` check cannot
distinguish metadata fields from body corruption. The precise live cause remains
unconfirmed; no owner Drive folder was inspected or modified.

**Implemented candidate:** correct-body receipt metadata gets at most two fresh
reads of the same already-created ID before refusal. Every original binding,
size and body hash must match; corrupt bodies, lost ownership/cancellation and
persistent metadata mismatch still fail. No write is retried. Fixed field labels
make persistent failures more specific, and current-action request metrics are
separate from lifecycle aggregates. Focused synthetic checks reproduce stale-size
receipt convergence and retained refusal behavior. The complete extended suite at
`5688c04` passed **2,012/2,012 tests** (Node 24.22.1,497.6seconds). Code-audit,
generated-reference and documentation checks passed. The candidate is not yet
deployed or live-verified; preserve the affected folder rather than retrying it
on the strength of synthetic tests.
