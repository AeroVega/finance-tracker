# Canonical import

**Status:** The import semantics below are implemented and tested with invented data. The browser import path is [Provider CSV import workflow](PROVIDER_CSV_IMPORT_WORKFLOW.md). The PR28 workbench and copy tools were retired during PR46 cleanup. For acceptance status see [Current state](CURRENT_STATE.md). The original scope is summarized in [probes and PR reports](archive/PROBES_AND_PR_REPORTS.md).

## Application pipeline

`provider-csv.mjs` reads source bytes and emits preserved source records. `canonical-import.mjs` maps explicit accounts and coverage, allocates UUID v4 identities, reconciles observations, and applies auditable decisions. The result is saved through [full-snapshot storage](FULL_SNAPSHOT_STORAGE.md), which adds the journal, session, publication and recovery protocol. Import itself adds none.

### Manual save and leaving the page

Imports, review decisions and corrections stay in memory until an explicit save. A save-status callout distinguishes unsaved local changes, a save in progress, an unverified or paused save, and a verified saved state. There is no background autosave and no browser-storage copy of the ledger.

- A save clears the unsaved state only after verification. A failed or unverified save keeps the local changes and the warning. The write may already have reached Drive, so an error does not prove nothing was saved. Follow the recovery and reopen flow before another attempt.
- Connect, reopen and recovery actions keep their explicit discard confirmations.
- The `beforeunload` guard asks the browser for a generic warning while changes are unsaved or an operation runs. Browsers control that prompt. iPhone app switching, crashes and some tab-closing paths bypass it, so the app cannot promise a warning. Save before leaving.
- Ownership heartbeats, offline refusal, exact-base checks and page-hide release are unchanged. The callout never authorizes a background write.

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


## Overlap reconciliation

Overlap review considers original and accepted source evidence for active activities, plus their correction and lifecycle history. Candidates are deduplicated by activity ID. Composite similarity opens review and never establishes an automatic match. Rejected, unresolved and inactive evidence cannot supply candidates.

An explicit *Match* to retained historical evidence preserves the current corrected values and existing events. Mathematically equivalent exact decimal spellings compare equal without rewriting source text. Source-ID matching, lifecycle behavior, storage format and recovery are unchanged.

## Verification

Run `node --test tests/*.test.mjs`. The suites cover interrupted writes at every durable boundary (whole import or prior state recovers), save and reopen and portable restore of a graph with retry history, keep/match/reject/reversal decisions, a prospective category rule, an amount correction and a refund with posting evidence, and the overlap cases above. A DOM simulation exercises the handlers against invented in-memory Drive data. It is not browser layout, Safari, OAuth or live Drive acceptance.

Local results, remote CI and owner or device acceptance are separate evidence. The live evidence recorded in 2026-11 was bounded and tied to commits `70728162` and `626ec025`. Test counts from that period are in Git history at `a089861`.
