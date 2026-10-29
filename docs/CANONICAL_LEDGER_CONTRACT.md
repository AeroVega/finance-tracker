# Canonical Ledger and Import-Run Contract (M1)

**Status:** Proposed implementation contract for review; no production ledger implementation is authorized by this document alone.  
**Version:** `finance-tracker-ledger-v1`  
**Last updated:** 2026-10-28

This is the source-independent contract that every file adapter must target. Provider parsers translate source-specific fields into this model; they do not define separate ledgers. All public fixtures use invented data.

## 1. Core invariants

1. **Preserve evidence.** A canonical activity is linked to one or more source observations. Keep the original source fields needed to explain normalization and matching; do not upload or retain raw CSV files in Drive by default.
2. **Do not lose multiplicity.** Similar-looking rows are not duplicates merely because date, amount, and description match.
3. **Idempotent retries.** A content-identical file for the same institution/account/import context must not create duplicate side effects after a completed run. A retry after failure must be safe.
4. **Row-level overlap reconciliation.** A newer export never replaces a whole date range. Reconcile each observation against known source observations and canonical activities.
5. **Fail closed on ambiguity.** Automatically link only when identity evidence is sufficiently strong and exactly one candidate qualifies. Otherwise preserve the incoming observation and open a review item.
6. **Auditable changes.** Canonical facts are not silently rewritten by matching, categorization, or review. Corrections and human decisions are recorded as linked events.
7. **Unknown is not zero.** Missing values remain null/unknown; unavailable coverage is never represented as zero activity.
8. **Exact money.** Store monetary values as signed integer minor units plus ISO currency code where the currency has a conventional minor unit; do not use binary floating-point arithmetic. Preserve the source amount text/value for audit. For currencies/quantities where minor-unit conversion is not well-defined, use a documented decimal-string representation.
9. **No sensitive fixtures.** Never commit real exports, account numbers, personal data, tokens, folder IDs, or user-derived records. Invent fixtures from scratch.

## 2. Canonical entities

Field names below are normative for the first implementation unless an ADR changes them. IDs are app-generated stable opaque strings; they must not contain account numbers or other source secrets.

### Account

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `accountId` | string | yes | Stable app identity; never derived from a raw account number |
| `institutionId` | string | yes | Stable provider key, e.g. `wells-fargo`, `sofi`, `fidelity` |
| `displayName` | string | yes | User-editable label; no raw account number |
| `accountType` | enum | yes | `checking`, `savings`, `credit-card`, `brokerage`, `retirement`, `other` |
| `currency` | ISO 4217 code | yes | Default account currency; each activity still records its own currency |
| `sourceAccountRef` | string or null | no | Protected source-side mapping value; never log or expose in public diagnostics |
| `createdAt` | ISO timestamp | yes | Creation time |
| `archivedAt` | ISO timestamp or null | yes | Null while active; archiving does not delete history |

Account mapping must be explicit when a file contains multiple accounts. A display name or masked identifier is not sufficient to silently map an unknown account.

### Canonical activity

The entity is called **activity**, not just transaction, because Fidelity files contain trades, fees, dividends, contributions, and valuation events.

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `activityId` | string | yes | Stable app-generated identity |
| `accountId` | string | yes | FK to Account |
| `activityKind` | enum | yes | `cash-transaction`, `trade`, `dividend`, `interest`, `fee`, `contribution`, `distribution`, `transfer`, `valuation-change`, `other`, `unclassified` |
| `effectiveDate` | `YYYY-MM-DD` | yes | Source date selected by documented adapter policy; never a timestamp inferred from import time |
| `postedDate` | date or null | yes | Distinct posting/settlement date when supplied; otherwise null |
| `amountMinor` | integer or null | yes | Signed value in currency minor units; null only when this activity has no meaningful monetary amount |
| `currency` | ISO 4217 code or null | yes | Currency of `amountMinor`; null only when amount is null or not monetary |
| `sourceDescription` | string | yes | Source description preserved verbatim, including empty string only when source is genuinely blank |
| `normalizedDescription` | string or null | yes | Optional derived searchable description; never replaces source text |
| `sourceAction` | string or null | yes | Provider's original action/type, especially for investment events |
| `lifecycleStatus` | enum | yes | `pending`, `posted`, `reversed`, `corrected`, `unknown`; use `unknown` rather than guessing |
| `processingStatus` | enum | yes | `processed`, `needs-review`, `rejected`; software workflow only, not settlement or human sign-off |
| `transferGroupId` | string or null | yes | Links known sides of an internal transfer; never infer a pair from amount alone |
| `securitySymbol` | string or null | yes | Optional investment symbol |
| `quantityDecimal` | string or null | yes | Exact decimal quantity; not a monetary amount |
| `unitPriceDecimal` | string or null | yes | Exact decimal price per unit |
| `createdAt` | ISO timestamp | yes | First canonical creation timestamp |
| `updatedAt` | ISO timestamp | yes | Last metadata update timestamp; source facts remain provenance-backed |

**Signed amount convention:** negative means money leaves the account; positive means money enters it. An adapter must explicitly convert a provider's convention if different. Preserve the original source amount representation in its source observation. Zero is a valid value and is not the same as missing.

**Date convention:** preserve all supplied dates separately in source observation. The adapter documents which source date becomes `effectiveDate`; use settlement/posting dates only for `postedDate` when semantically appropriate. Import time is never a substitute for an activity date.

### Source observation

Each source row that is accepted, matched, or sent to review is represented as a source observation. This supports multiple exports describing one activity and preserves repeated-looking legitimate rows.

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `observationId` | string | yes | Stable app-generated identity |
| `importRunId` | string | yes | Import run that saw this row |
| `accountId` | string | yes | Resolved account |
| `rowOrdinal` | integer | yes | One-based source row ordinal within parsed input |
| `sourceRecordId` | string or null | yes | Provider transaction/activity ID only when available and understood |
| `sourceFields` | object | yes | Source columns/values needed to explain mapping; protect from diagnostics/logging |
| `sourceRowFingerprint` | string | yes | Hash of canonicalized row representation, matching evidence only—not proof of identity |
| `activityId` | string or null | yes | Canonical activity when confidently linked; null while unresolved/rejected |
| `disposition` | enum | yes | `created`, `matched`, `review`, `rejected`, `ignored` |
| `reasonCode` | string or null | yes | Machine-readable mapping/match/rejection rationale |
| `observedAt` | ISO timestamp | yes | Time the row was processed |

The original CSV file is not uploaded to Drive by default. `sourceFields` are the selected row-level evidence necessary for audit and must be covered by the private-data storage policy.

### Import run

One import run is one attempt to process one selected file for one explicitly mapped account/import context.

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `importRunId` | string | yes | Unique ID for this attempt |
| `institutionId` | string | yes | Provider key |
| `accountId` | string | yes | Resolved account |
| `sourceFormat` | string | yes | Versioned adapter/format key |
| `fileFingerprint` | string | yes | SHA-256 of file bytes; private metadata, never emit in public logs |
| `startedAt` | ISO timestamp | yes | Attempt start |
| `completedAt` | ISO timestamp or null | yes | Null until terminal |
| `status` | enum | yes | `validating`, `processing`, `processed`, `needs-review`, `failed`, `cancelled`, `no-op` |
| `coverageStart` | date or null | yes | Earliest valid activity date observed in file |
| `coverageEnd` | date or null | yes | Latest valid activity date observed in file |
| `latestActivityDate` | date or null | yes | Latest activity date currently known for the account after this run; not interchangeable with file coverage |
| `counts` | object | yes | Non-negative counts defined below |
| `errorCode` | string or null | yes | Safe, non-sensitive error category; never raw rows/tokens |
| `retryOfImportRunId` | string or null | yes | Prior attempt when retrying |
| `resultDigest` | string or null | yes | Optional deterministic digest of the logical result for integrity checks |

Required `counts` keys: `rowsSeen`, `rowsRecognized`, `created`, `matched`, `review`, `rejected`, `ignored`. Counts are non-negative integers. Their meanings are mutually exclusive row dispositions for terminal runs: `created + matched + review + rejected + ignored = rowsRecognized`; `rowsSeen` can exceed `rowsRecognized` because of headers, footers, blank separators, or unsupported non-data rows. If a parser cannot classify a nonblank row, it must report it as rejected/review-needed, not silently omit it.

A valid empty file is a successful `processed` run with zero data rows and explicit coverage nulls. A malformed/unsupported file is `failed` or `needs-review`, not a successful empty import. Terminal `no-op` runs refer to a previously completed identical fingerprint/context and must not reapply side effects.

### Review decision

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `reviewDecisionId` | string | yes | Unique decision event |
| `createdAt` | ISO timestamp | yes | Decision time |
| `reviewer` | string | yes | `user` for owner decisions in MVP1 |
| `decisionType` | enum | yes | `identity-match`, `keep-separate`, `correction`, `categorization`, `account-mapping`, `transfer-link`, `other` |
| `outcome` | enum | yes | `approved`, `rejected`, `deferred`, `reversed` |
| `observationIds` | string array | yes | Exact source observations in scope |
| `activityIds` | string array | yes | Affected canonical activities; may be empty before resolution |
| `rationale` | string or null | yes | Optional concise user rationale; avoid unnecessary sensitive details |
| `evidence` | object or null | yes | Relevant field comparisons / decision basis |
| `supersedesDecisionId` | string or null | yes | Links a reversal or later decision to prior event |

Decisions are append-only events. Reversal creates a new event; it does not erase the prior decision. Identity decisions apply only to the exact records or explicitly defined matching rule they reference, never as a global signature for similar transactions.

## 3. Match and import algorithm

1. Validate file bytes, encoding/delimiter/header, required fields, and account mapping before mutating canonical data.
2. Compute the content fingerprint. If a completed run with the same fingerprint, account, institution, and source-format context exists, return a `no-op` result linked to that run.
3. Parse rows and create source observations. Preserve raw source field values and row ordinals.
4. Resolve source IDs scoped by institution and account. If a known source ID conflicts on account, currency, or amount, route to review; never blindly merge.
5. For sources without stable IDs, use a documented composite of account, currency, signed amount, appropriate date, normalized description, and action/type. Auto-match only if exactly one candidate remains and corroborating context rules out reasonable collisions.
6. Preserve duplicate-shaped rows within the same input unless source IDs establish duplication. Multiple plausible candidates or weak/conflicting evidence creates a review item.
7. Link a confident match by attaching the new observation to the existing activity. Do not create a second activity or overwrite existing source facts.
8. Model pending-to-posted transitions and corrections as linked lifecycle evidence only when supported by source IDs or strong corroboration; retain old and new source observations.
9. Apply accepted changes as one logical unit. If persistence cannot guarantee atomicity, stage a recoverable operation and make interrupted retries idempotent.
10. Persist terminal status and row counts. Do not call a run `processed` until its defined pipeline has completed; `needs-review` can coexist with successfully created activities when unresolved rows remain.

## 4. Financial meaning and reporting boundaries

- Internal transfers are movements between accounts, not consolidated income or spending. Link both sides only with evidence; unknown counterparties remain unclassified.
- Credit-card purchases are expenses. The checking outflow and credit-card payment/credit are not two expenses.
- Refunds/chargebacks retain their own signed source events and are interpreted under an explicit report convention.
- Investment deposits/contributions/withdrawals are transfers to/from investment accounts, not investment returns.
- Trades, dividends, interest, fees, distributions, employer matches, and valuation changes remain distinguishable.
- A holdings snapshot is a point-in-time position/value, not transaction history.
- `Change in Market Value` is not external cash flow.
- A missing balance, price, quantity, date, or identifier is unknown—not zero or fabricated.
- Categorization is derived state and must not overwrite canonical source facts.

## 5. Provider boundary

Adapters normalize into this contract; the ledger never depends on provider-specific column names.

- **Wells Fargo:** observed `DATE`, `DESCRIPTION`, `AMOUNT`, optional `CHECK #`, `STATUS`; date `MM/DD/YYYY`.
- **SoFi:** observed `Date`, `Description`, `Type`, `Amount`, optional `Current balance`, `Status`; date `YYYY-MM-DD`.
- **Fidelity Accounts History:** observed 18-column activity export, including `Run Date`, `Settlement Date`, `Account`, `Account Number`, `Action`, `Symbol`, `Quantity`, `Commission`, `Fees`, and `Amount`. Header may follow leading blank rows; footer/legal text must not be treated as activity. Map account numbers locally and never expose them in logs or public fixtures.

These are documented sample observations, not guarantees about every future export. Raw CSV mechanics and provider-specific ID semantics still require adapter tests.

## 6. Acceptance criteria before parser implementation

- [ ] Model fields and enum values are accepted or revised by review.
- [ ] Every fixture is deliberately invented and structurally representative, not copied from a real/sanitized row.
- [ ] Tests verify each fixture's header/shape, amount sign, optional blanks, Fidelity leading blanks/footer, and activity types.
- [ ] Import tests cover identical-file retry, overlap, same-day collisions, ambiguous candidates, source-ID conflicts, pending/posted lifecycle, corrections, malformed rows, valid empty input, and interrupted retry.
- [ ] Test assertions demonstrate that rejected/ambiguous rows are not silently dropped and canonical activities are not silently overwritten.
- [ ] Contract/schema versioning and migration behavior are documented before persisted real data is introduced.

**Boundary:** this contract and synthetic fixtures do not implement a parser, production storage, Drive synchronization, or authorization. The Drive prototype remains separate; real financial data must not be used until security/storage release gates are approved.
