# PR28 canonical import contract and verification

**Status: implemented for synthetic review; live acceptance remains outstanding.** This is the bounded implementation approved by the owner on November 6, 2026. Read [the included scope and acceptance criteria](PR28_IMPLEMENTATION_SCOPE.md) alongside the accepted canonical, database-lifecycle, and PR26 product decisions.

## Application pipeline

`provider-csv.mjs` reads source bytes and emits preserved source records. `canonical-import.mjs` maps explicit accounts and coverage, allocates UUID v4 identities, reconciles observations, and applies auditable decisions. `canonical-ledger-storage.mjs` serializes that application state for the existing `ApplicationStorageLifecycle` and `CatalogTransactionEngine`. The storage adapter adds no journal, session, manifest-publication, or recovery protocol.

The workbench at `prototype/pr28-import.html` fetches only five fixed, invented CSV fixtures. It requires the existing dedicated synthetic folder and does not accept arbitrary financial uploads. Locally staged work is distinct from a saved commit; a failed or uncertain save requires recovery and reopening before recomputing another proposal.

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

Run `node --test tests/*.test.mjs` and syntax checks for the new application/browser modules. The existing CI uses Node 26. The development workspace provides Node 24.22.1; Node 26.13.0 is also available for CI-equivalent local checks. Local results and remote CI evidence must be reported separately.

The canonical integration tests run the actual catalog transaction engine through every durable mutation exercised by the multi-record payload, then recover and compare complete record graphs. They also export and restore through the existing portable backup APIs, preserving logical identity/history with new physical locators. The shared `validateSyntheticApplicationSnapshot` composes the canonical and existing dashboard validators, rejects unknown paths, and is wired into the PR25 browser backup, export, and restore handlers. Tests cover retained dashboard/canonical coexistence and complete decision, reversal, rule, correction, and refund history. Existing storage/session tests continue to run unchanged.

A local DOM simulation may exercise the actual workbench handlers, financial modules and catalog engine against invented in-memory Drive data. Such a simulation is not a browser-layout, Safari/device, OAuth or live Drive acceptance test. Record those results separately.

Live acceptance should use a dedicated synthetic folder and the bundled foundation/review fixtures: explicitly map accounts and dates, preserve both identical-looking purchases, classify known activity, save/reopen, resolve the overlap and malformed row, link the invented partial refund, correct a known amount, and save/reopen again. Supply the invented refund receipt's confirmed posting date; without posting evidence the refund stays excluded. Also change fixture selection and simulate a failed preview to verify old mappings cannot be staged. Inspect record counts, original evidence, event order, exact qualified subtotals, and recovery behavior. Review mobile touch/keyboard behavior and interruption/repeated-action flows on the target devices. Deployment and production activation still require their separate authorization.

### Implementation verification recorded November 6, 2026

- **Verified locally:** Node 24.22.1 and Node 26.13.0 each ran the complete suite, 397 tests passed, no failures or skips. Syntax checks passed for the application, parser, reconciliation, storage, shared backup validator, and affected browser modules. `git diff --check` passed.
- **Verified with the existing catalog engine:** 38 interrupted-write boundaries recover a whole import or its prior state. Save/reopen and portable restore preserve a graph containing retry history, keep/match/reject/reversal decisions, a prospective category rule, an amount correction, and a refund with explicit posting evidence. Dashboard/canonical coexistence passes export and restore.
- **Verified in a DOM simulation:** actual workbench handlers complete map, review, classify, save, reopen, and partial-refund linking using invented in-memory Drive data. The known spending subtotal is exactly `70.00`, labeled incomplete. Changing the fixture, failing a preview, and receiving an obsolete asynchronous preview cannot stage old source data.
- **Open:** real browser layout, keyboard/touch and Safari/device acceptance, interactive OAuth, and live synthetic Drive operation. Browser execution was unavailable in the implementation workspace; the DOM simulation does not replace these checks. Original provider exports and production data were not used.
- **Open:** remote CI and owner review must be checked against the published implementation head. Local test results do not establish merge or production readiness.
