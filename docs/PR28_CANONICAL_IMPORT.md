# PR28 canonical import contract and verification

**Status: implemented for synthetic review; live acceptance remains outstanding.** This is the bounded implementation approved by the owner on November 6, 2026. Read [the included scope and acceptance criteria](PR28_IMPLEMENTATION_SCOPE.md) alongside the accepted canonical, database-lifecycle, and PR26 product decisions.

## Application pipeline

`provider-csv.mjs` reads source bytes and emits preserved source records. `canonical-import.mjs` maps explicit accounts and coverage, allocates UUID v4 identities, reconciles observations, and applies auditable decisions. `canonical-ledger-storage.mjs` serializes that application state for the existing `ApplicationStorageLifecycle` and `CatalogTransactionEngine`. The storage adapter adds no journal, session, manifest-publication, or recovery protocol.

The workbench at `prototype/pr28-import.html` fetches only fixed, invented CSV fixtures, including a later coffee purchase for prospective-category acceptance. It requires the existing dedicated synthetic folder and does not accept arbitrary financial uploads. Locally staged work is distinct from a saved commit; a failed or uncertain save requires recovery and reopening before recomputing another proposal.

### Manual save and leaving the page

Imports, review decisions, and corrections stay in memory until an explicit save. A prominent save-status callout remains visible on the guided page even when its optional workbench is collapsed. It distinguishes unsaved local changes, a save in progress, an unverified or deliberately paused save, and verified saved state. There is no background financial autosave or browser-storage copy of the ledger.

A save clears the unsaved state only after successful verification. A failed or unverified save keeps the local changes and warning. The write may already have reached Drive, so an error is not proof that nothing was saved; follow the existing recovery/reopen flow before another attempt. Connect, reopen, and recovery actions retain their explicit discard confirmations. Releasing the session does not save or erase the in-tab draft.

The existing `beforeunload` guard requests a generic browser warning while changes are unsaved or an operation is in progress. Browsers control that prompt and may require prior interaction. iPhone app switching, process termination, crashes, or some tab-closing paths can bypass it. The app cannot promise a warning or save changes after termination. Save before leaving; cancelling a supported warning leaves the draft in the current tab.

Ownership heartbeats, offline refusal, exact-base checks, crash recovery, and page-hide session release are unchanged. The callout does not authorize a background write, bypass recovery, or replace a confirmed save.

**Verified locally for these callouts:** the complete Node 24.22.1 and Node 26.13.0 suites each passed 541/541 tests with no failures or skips. Fourteen behavioral UI cases cover unsaved/busy leave guards, cancelled discard and recovery actions, pending/repeated/failed saves, verified save/reopen, dirty release, offline state, keyboard focus, and the intentional interruption rehearsal. Independent review found no blocker. Real browser layout and native warning behavior, especially on Safari/iPhone, remain **Open**.

## Records and evidence

The synthetic envelope is `finance-tracker-canonical-ledger`, version 1, with a UUID `ledgerId`, `createdAt`, `syntheticOnly: true`, and these collections:

- `accounts`: persistent UUID `accountId`, institution, `displayName`, explicit currency and standard type.
- `imports`: stable file/account context, SHA-256 of the original file bytes, source format, timestamps, observed and declared dates, counts, source-retention status, observation IDs, and appended retry-attempt evidence.
- `observations`: original source fields, canonicalized source-row SHA-256, CSV record ordinal and starting physical line, import/account links, proposed normalization, disposition, and review state. Identical-looking rows may share a fingerprint but never acquire identity from that fact alone.
- `activities`: immutable accepted financial evidence with exact minor units or decimal fallback, original source description/action and investment fields, separate dates, account, lifecycle, and application IDs.
- `events`: ordered append-only classification, category correction, bank correction, refund-link, and supported pending-to-posted evidence. Explicit commands have an idempotency identity. Prior values and references are validated before replay.
- `reviewDecisions`: explicit, scoped decisions with rationale, affected observation/activity IDs and, where needed, confirmed missing currency. Reversal appends a new decision; it does not erase the first decision or its created records.

A review-created activity whose sole supporting decision is reversed remains as retained inactive history. It cannot contribute to totals or accept new matches/events. Reversal refuses later dependent work or a lifecycle-changing match that needs a more specific resolution.

Each record has its own stable logical path under `synthetic/canonical-v1/`; the index preserves collection order and metadata. Unchanged records reuse their hashes. Save rejects removal/reordering of prior records, mutation of immutable activities/events/decisions, replacement of original observation/import evidence, and alteration of prior retry-attempt entries. Loading validates identities, references, exact monetary representations, counts, event order, and the selected snapshot. A changed base requires reopening and recomputing, not stale replay.

Original source-file retention remains separate from processing. This slice records `not-retained` and null retention locators/timestamps; it does not claim a private full-file retention receipt. The invented source bytes remain in bundled fixtures. The accepted 540-day policy and the existing retention machinery remain unchanged for their authorized use.

## Coverage

`declaredCoverage` has inclusive `start`/`end` dates and confirmation provenance. The workbench uses two independently navigable calendars and an explicit confirmation. `observedStart`/`observedEnd` describe source dates, including nulls for empty files. Import timestamps are not transaction dates. Usable source dates outside the declaration block finalization.

A declared period is not proof of complete history. `coverageReconciled` starts false. The current readout always identifies its results as known subtotals with `complete: false` and `coverage-not-reconciled`, plus specific exclusions. It cannot manufacture a complete total from supplied dates alone.

## Matching, corrections, and calculations

Identical completed file bytes in the same account/format context are a no-op even if renamed. Needs-review retries reevaluate unresolved occurrences against current evidence, retain accepted IDs, and append retry audit. Stable provider IDs remain scoped to institution/account. Composite similarity alone routes to review, including a single apparent candidate; repeated occurrences within a file retain their multiplicity.

Explicit review can confirm the same activity, preserve a separate activity, or reject a row with retained evidence. A missing Fidelity currency can be explicitly supplied with rationale only when that is the sole validation issue. Reversing that decision returns the unchanged original evidence to missing-currency review so it can be resolved again. Original source fields remain unchanged. This cannot bypass an invalid date, amount, row width, or other malformed evidence.

Category correction changes the selected activity's effective category and records an inspectable prospective rule. Its exact key includes account, institution, currency, normalized description, and source action. Already-imported peers are explicitly excluded. Empty descriptions disable prospective matching rather than creating a broad rule. Later explicit overrides win.

Bank corrections preserve the original activity and apply an evidenced exact amount to its effective reporting period. Refund links require distinct records, a same-currency spending target and supporting evidence. Their effective category follows the linked purchase, including an auditable correction to that purchase, unless a later explicit refund-category correction overrides it. Original records remain unchanged; partial refunds reduce spending in their posting period. An optional `confirmedPostedDate` on the refund-link event records explicit posting-date evidence without changing the original activity, and cannot conflict with an existing known posting date. A refund without an evidenced `postedDate` is excluded with `missing-refund-posted-date`; its source activity date is not substituted for a posting date. Unmatched refunds need explicit classification/category treatment and remain qualified. Unsupported reversals, unknown lifecycle and unclassified investment activity are not silently assigned reporting meaning.

Readouts use exact decimal arithmetic. Pending activity is excluded from finalized subtotals; unknown lifecycle, currency, amounts and classification have explicit exclusions. Cash subtotals cover explicitly classified external movement in checking/savings accounts, separate from credit-card liabilities. These are scoped known subtotals, not complete financial statements.

## Tested provider variants

The fixtures and adapter tests cover UTF-8 with optional BOM, comma-delimited fields, quoting and escaped quotes, multiline fields, line endings, exact ordered headers, optional Wells Fargo check-number and SoFi current-balance columns, and Fidelity's observed 18-column shape. Numeric grammar is a signed decimal string; unsupported grouping/symbols/precision are retained as errors rather than rounded or guessed.

Wells Fargo's documented US date form and the existing invented ISO fixture variant are recognized. SoFi uses the documented ISO form. Fidelity preserves run and settlement dates separately. Only the exact invented Fidelity explanatory footer is ignored; unknown nonblank footer-like text remains rejected evidence. Missing currency or lifecycle is not inferred from provider name. These are synthetic-tested variants, not validation of every original provider export.

## Verification

### Assisted live acceptance

Open [PR28 assisted acceptance](../prototype/pr28-testing.html). Confirm the deployed SHA and browser, connect a fresh empty synthetic Drive folder, then press **Run live checks**. That button authorizes the fixed invented recipe and its synthetic saves. It supplies account mappings, declared coverage, classifications and evidence, checks actual canonical save/reopen, verifies portable history in memory, revalidates the existing session, and verifies release. No console, manual calculations or repeated entry of invented fields is required. No recipe runs on page load.

The runner uses the same workbench, canonical functions, `CanonicalLedgerStore`, and PR25 catalog lifecycle. It is not another financial or persistence engine. A module-only exclusive lease disables manual operations while it runs. The gate checks a clean writable session and the actual verified writable base: synthetic, revision zero, empty full snapshot and no pending catalog finalization. An empty canonical collection alone is insufficient. Dashboard-only, populated, partial and unsupported copies are not reset or overwritten.

There are 25 fixed live assertions. The first 24 include:

- Explicit account and coverage gates; source evidence and both identical-looking coffee purchases.
- Exact classifications, repeated imports and repeated commands without duplicate effects.
- Unresolved retry evidence, keep-separate, append-only reversal with retained inactive history, match and malformed-row rejection.
- A missing refund posting-date probe discarded by independent reopen, an evidenced February refund, amount correction, prospective coffee category rule, refund category inheritance and explicit override.
- Separate Wells Fargo and SoFi imports and both Fidelity accounts. Missing Fidelity currency is explicitly resolved, reversed and resolved again; blank original source currency and unknown lifecycle are preserved.
- Three real saved checkpoints and independent reopen comparisons of the complete graph; immutable-account rewrite refusal without a transaction; retained-history export and verification in memory; existing-session revalidation and verified release.

The last assertion needs the human to reconnect through Google and choose the same folder. **Verify saved run after reconnect** then compares its copy identity and full saved graph against memory from this tab's completed run. It does not accept another copy, guess identity from record counts, or start another import. This comparison is intentionally unavailable after reload. An exported archive stays in memory and is not downloaded or included in the report; this check does not claim a real backup or restore to another folder.

The final graph contains 5 accounts, 7 imports, 15 observations, 15 activities, 15 events and 8 review decisions. Two activities are retained inactive history. The original checking account has January spending `106.00`, February spending `-40.00`, combined spending `66.00` and income `1000.00`. Across all accounts, January through March known spending is `101.75` and income is `2250.37`. All results remain incomplete; pending and unknown lifecycle activity stays excluded. These counts differ from the earlier manual recipe because the runner also saves reversal and provider scenarios.

**Stop after current operation** waits for the admitted operation to finish or fail, then starts no further step. Failed or stopped runs retain completed statuses and never retry a write automatically, erase records, reclaim a stale session or infer that a save succeeded. Inspect via the existing reconnect/recovery/reopen controls. Use a new empty synthetic folder for a new complete run. A double-click cannot acquire another workbench lease. A reset clears only recorded evidence and the in-memory comparison, never the ledger or session.

The main human checklist has four items: device and Google connection confirmation, touch/keyboard/layout and OAuth cancellation, one whole-tab interruption rehearsal, and actual new-folder backup/restore. The old deterministic import recipe no longer needs duplicate manual sign-off. For interruption, connect a separate empty synthetic folder and choose **Prepare interruption test**. It saves and independently reopens the four-row baseline, then stages one classification. The existing explicitly confirmed pause button stops after the first durable mutation. Close the whole tab, reconnect and use the existing recovery controls only when offered. Verify the full baseline or full one-event state and avoid duplicating the classification. This is one live boundary, not every crash boundary or proof of iOS process termination. Backup/restore uses the existing PR25 page and separate empty destinations after releasing this session.

The 13 bundled fixture checks remain available without Google. Their in-memory results, live programmatic assertions and tester selections are separate. The report allows only fixed check IDs/statuses, date, browser label, an explicitly confirmed full source SHA, and sanitized aggregate request metrics. It excludes ledger contents, account/folder/file IDs, provider error bodies, credentials, URLs and free text. Same-source, same-tab reload restores sanitized evidence as **historical**; it never resumes a run or claims a newly connected folder was tested. Unknown or changed source stamps cannot restore evidence. Copying does not send a report.

The [storage performance follow-up](PR28_STORAGE_PERFORMANCE.md) records the measured synthetic request baseline, optimizations, request-counter privacy boundaries, and regression requirements. Request counts and elapsed time explain the work performed; they do not replace any acceptance assertion or prove live browser performance.

The public Pages URL can serve a different branch after another deployment. Confirm its source stamp against the intended commit. A missing stamp remains unverified. CI, deployment, programmatic acceptance and human acceptance are distinct.

**User-confirmed, November 6, 2026:** the owner reported 13/13 local fixture checks passing in Safari on iPhone, and successful connection to and release of a fresh synthetic folder on the earlier guided deployment. This report did not include canonical live saves, the former manual recipe, interruption, backup/restore or other browser checks. This evidence is not a pass for this new runner.

**Verified locally for the assisted runner, November 6, 2026:** the complete Node 24.22.1 and Node 26.13.0 suites each passed 427 tests with no failures or skips. Syntax and diff checks passed. An actual-handler DOM simulation used the real application lifecycle, catalog transaction engine and invented in-memory Drive adapter. It passed 24 assertions, then the 25th after reconnect, and checked safe release, nonempty-folder refusal, reset, and separate local/manual results. A second simulation verified that a repeated start cannot overlap, Stop lets one admitted checkpoint finish, and later steps remain unrun. These are not live Google Drive, OAuth or device results.

**Verified locally for the earlier guided page, November 6, 2026:** the complete Node 24.22.1 and Node 26.13.0 suites each passed 410 tests. A DOM simulation exercised the prior guide/workbench recipe with a qualified combined subtotal of `66.00`, source-scoped restore, clipboard fallback, reset without financial changes, and one interrupted in-memory catalog mutation. These are historical engineering checks, not new-run live Drive or Safari acceptance.

### Efficient verified canonical reopen

Canonical reopen now uses the lifecycle's pinned verified-snapshot reader when available. It verifies retained catalog history once for the operation, copies the selected object bytes, then rechecks the exact manifest and session ownership. It does not retain a cross-operation cache or change the transaction engine, recovery protocol or checksums. Older test drivers keep the original reader fallback. This avoids re-reading all retained history separately for every canonical record during live acceptance. `canonical-snapshot-read.test.mjs` covers changed manifests, changed ownership and detached returned bytes. Existing canonical storage tests cover the fallback reader.

### Automated and live verification

Run `node --test tests/*.test.mjs` and syntax checks for the new application/browser modules. The existing CI uses Node 26. The development workspace provides Node 24.22.1; Node 26.13.0 is also available for CI-equivalent local checks. Local results and remote CI evidence must be reported separately.

The canonical integration tests run the actual catalog transaction engine through every durable mutation exercised by the multi-record payload, then recover and compare complete record graphs. They also export and restore through the existing portable backup APIs, preserving logical identity/history with new physical locators. The shared `validateSyntheticApplicationSnapshot` composes the canonical and existing dashboard validators, rejects unknown paths, and is wired into the PR25 browser backup, export, and restore handlers. Tests cover retained dashboard/canonical coexistence and complete decision, reversal, rule, correction, and refund history. Existing storage/session tests continue to run unchanged.

A local DOM simulation may exercise the actual workbench handlers, financial modules and catalog engine against invented in-memory Drive data. Such a simulation is not a browser-layout, Safari/device, OAuth or live Drive acceptance test. Record those results separately.

Use the assisted runner above for deterministic live acceptance. Its programmatic pipeline does not replace workbench-control regression tests, browser layout checks, actual offline/online transitions, OAuth cancellation, whole-tab interruption or new-folder restore. Review those separately on the target devices. Deployment and production activation still require their separate authorization.

### Implementation verification recorded November 6, 2026

- **Verified locally:** Node 24.22.1 and Node 26.13.0 each ran the complete suite, 397 tests passed, no failures or skips. Syntax checks passed for the application, parser, reconciliation, storage, shared backup validator, and affected browser modules. `git diff --check` passed.
- **Verified with the existing catalog engine:** 38 interrupted-write boundaries recover a whole import or its prior state. Save/reopen and portable restore preserve a graph containing retry history, keep/match/reject/reversal decisions, a prospective category rule, an amount correction, and a refund with explicit posting evidence. Dashboard/canonical coexistence passes export and restore.
- **Verified in a DOM simulation:** actual workbench handlers complete map, review, classify, save, reopen, and partial-refund linking using invented in-memory Drive data. The known spending subtotal is exactly `70.00`, labeled incomplete. Changing the fixture, failing a preview, and receiving an obsolete asynchronous preview cannot stage old source data.
- **Open:** real browser layout, keyboard/touch and Safari/device acceptance, interactive OAuth, and live synthetic Drive operation. Browser execution was unavailable in the implementation workspace; the DOM simulation does not replace these checks. Original provider exports and production data were not used.
- **Open:** remote CI and owner review must be checked against the published implementation head. Local test results do not establish merge or production readiness.
