# Read-only provider CSV import preview

**Status:** implemented on `feature/provider-csv-import-preview`; synthetic tests are included. This module is not wired into the application UI or persistence path.

## API

```js
import { previewProviderCsv } from '../js/provider-csv-preview.mjs';

const preview = await previewProviderCsv({
  bytes: new TextEncoder().encode(inventedCsvText),
  // Optional: an existing in-memory canonical ledger.
  ledger,
  // Optional: source account key -> existing canonical account ID.
  accountMappings: { default: existingAccountId },
  // Optional: declared coverage keyed by canonical account ID.
  coverageByAccount: {
    [existingAccountId]: {
      start: '2026-01-01',
      end: '2026-01-31',
      provenance: 'user-confirmed',
    },
  },
});
```

The function returns a preview object. It does not mutate the supplied ledger, persist the proposal returned internally by canonical validation, write to Drive, retain source bytes, or accept review decisions.

### Result shape

- `status`: `preview`, `unrecognized`, `ambiguous`, or `parse-error`.
- `sourceFormat` / `institutionId`: populated only after conservative recognition and successful parsing.
- `rows`: source row count, parsed row count, parser-ignored rows, valid rows, and rows requiring review.
- `accounts[]`: source account key, row counts, review count, valid-date row count, and min/max valid effective date observed for that source account.
- `requirements.accountMappings[]`: source account keys that still need explicit mapping.
- `requirements.explicitAccountSelectionRequired`: true when a recognized empty file provides no source account identity and the caller has not explicitly selected one. Header-only Fidelity files honor caller-supplied mapping keys, then require confirmed coverage for those accounts. No account is inferred.
- `requirements.sourceAccountIdentityRows[]`: row ordinals whose source account identity is missing; these rows cannot be mapped until their source evidence is resolved.
- `requirements.declaredCoverage[]`: mapped canonical account IDs that still need declared coverage.
- `canonicalValidation`: `not-run`, `passed`, or `failed`. It is run only when a ledger, all required mappings, and coverage declarations are supplied. It calls the existing `prepareCanonicalImport` validation/reconciliation path and discards the proposed ledger.

For bank formats the source account key is `default`; it still requires explicit mapping to an existing canonical account. Fidelity rows use the source Account Number as a source key; it must be mapped to an existing Fidelity account. Raw source account identifiers are sensitive: do not log or display them in production UI without an explicit privacy design.

## Recognition and parsing

The module uses `parseRecognizedProviderCsv` in `provider-csv.mjs`. Recognition and explicit-format parsing share one CSV decode and tokenization path, exact ordered header matching, and row conversion. CSV quoting and blank records are interpreted identically, including comma-only and quoted-empty preambles. It does not try each provider parser in turn.

Supported identifiers:

- `wells-fargo-csv-v1`
- `sofi-csv-v1`
- `fidelity-accounts-history-csv-v1`

Unknown, near-match, reordered, or ambiguous headers are reported without guessing. Once a header is recognized, all row-level CSV, date, amount, status, and row-width behavior remains owned by the existing provider parser. Whole-file syntax/encoding failures are returned as `parse-error`; malformed data rows remain visible as review rows.

## Coverage and review semantics

Observed date ranges are calculated only from valid effective dates actually present in parsed rows. They are not declared coverage, evidence of complete history, or proof that there are no missing transactions. The preview always calls out that declared coverage remains a separate requirement.

Rows the provider parser marks invalid are counted as requiring review; their source evidence remains in the parsed result used for summary calculation. A valid date on an otherwise malformed row still contributes to the observed valid-date range, because date observation and row validity are distinct facts.

Repeated-looking rows are counted individually. The preview does not deduplicate, match, discard, classify, or infer transaction identity. Canonical reconciliation may propose matches/review states through the existing engine only when explicitly supplied a ledger, mapping, and declared coverage; the proposed ledger is never returned or saved.

## Limitations

- Header recognition is intentionally narrow: exact ordered names only, with only the optional columns supported by the current parser. It is not a general CSV dialect or provider discovery engine.
- Recognition uses the first nonblank decoded CSV record. Whitespace-only cells are not blank, matching the existing parser. Malformed CSV syntax returns `parse-error`, even when no supported header can yet be established.
- No real financial files or live provider exports were used. The supported variants are the synthetic-tested variants documented by the existing parser and tests.
- Account mapping and user/source-confirmed declared coverage are not guessed.
- This module is not connected to UI, Drive, storage, recovery, or production import workflows.
- It does not prove complete coverage, validate balances against statements, or decide financial classifications.

## Focused tests

Run the preview tests and the existing provider parser tests:

```sh
node --test tests/provider-csv-preview.test.mjs tests/provider-csv.test.mjs
```

The focused tests cover all three supported headers, conservative/unrecognized headers, malformed rows, empty input, header-only input, mixed Fidelity accounts and dates, mapping/coverage requirements, in-memory canonical validation, read-only ledger behavior, and repeated-looking rows.
