# Supported provider CSV import workflow

**Status:** Implemented on `feature/supported-csv-import-workflow`; automated review, CI and owner acceptance are pending. Synthetic fixtures only. This does not authorize real financial exports or production financial persistence.

## Application path

The Storage page now hosts a local import workflow for the three exact formats already supported by `provider-csv.mjs`:

- `wells-fargo-csv-v1`
- `sofi-csv-v1`
- `fidelity-accounts-history-csv-v1`

The controller uses the read-only `previewProviderCsv` boundary to recognize an exact supported schema and obtain its preview summary. It then invokes the strict provider parser for the row model needed by account-scoped mapping controls; both operations are local and neither accepts or persists a proposed ledger. It uses `prepareCanonicalImport` for canonical validation and reconciliation. After account mappings and coverage are confirmed, the UI displays read-only reconciliation counts before the user stages the proposal. It stages the resulting proposal through `CanonicalWorkspaceSession.stageCanonicalImport`. It does not create accounts, upload source bytes, write to Drive, or save automatically. Persistence remains behind the workspace's existing explicit save action: Save changes for an opened saved ledger, or Save preview to a new folder for a new preview.

Every source account key must be mapped to a distinct existing ledger account at the same institution. Fidelity source account identifiers are shown only by their last four characters in the mapping label. Rows without source account identity are retained and require an explicit mapping. Header-only exports require an explicit source account key for Fidelity, an existing-account mapping, inclusive declared coverage, and a separate empty-export confirmation.

## Coverage and row handling

Declared coverage is entered by the user for each mapped account and requires a separate explicit confirmation checkbox. Changing the account or either date clears that confirmation and the header-only confirmation. Observed valid dates are displayed separately as a diagnostic range; they are not copied into the declaration. Every usable effective date is checked against the inclusive declared range, including rows that have another parser error. An out-of-range row blocks staging without dropping the row or widening coverage. Malformed dates remain review evidence and do not become invented dates.

The selected file, active ledger identity, account mappings, coverage values and per-account confirmations are treated as one review context. If the active ledger changes while the file is being read or before staging, preparation is invalidated. The user must select and review the file again. Re-importing an already processed identical file for the same account is a no-op; it does not stage duplicate rows. A prior `needs-review` run follows the canonical retry path, which retries only unresolved occurrences and preserves accepted observations and decisions.

The canonical import engine retains its existing conservative matching and review behavior. Unresolved rows appear in the existing Review page. Pending-to-posted transitions, correction evidence, repeated-looking rows, and ambiguous duplicate candidates remain governed by the canonical reconciliation and review contracts. No row is silently discarded because it is malformed or ambiguous.

## Undo, save and recovery

Staging is local to the current canonical session. The session validates the proposed ledger and requires existing ledger identity, account records, prior activities/events and user review decisions to remain intact. New import work is append-only; the only permitted edits to prior imports are the canonical retry metadata and the bounded disposition/activity/reason changes to unresolved observations belonging to that retried run. Undo checkpoints retain the complete ledger, so undoing a new import or retry restores all prior records and provenance without leaving orphan records. Save, uncertain-write handling, session ownership, recovery and reopen continue through the existing full-snapshot lifecycle.

No raw file bytes are added to the canonical ledger or persisted by this workflow; the browser reads the selected file in memory for recognition and parsing. The canonical import run retains the file fingerprint, source format, institution/account identity, observed dates, declared coverage and import timestamps already defined by the ledger contract. Coverage remains unreconciled; a declared date range is not proof of completeness.

## Privacy and limitations

- Only synthetic fixtures are used in repository tests. No real exports, account statements, private workbook, owner Drive financial data or production credentials are permitted.
- Source bytes are read locally in the browser and are not uploaded by the import controls.
- The supported header variants remain narrow and synthetic-tested. No claim of universal compatibility with current bank downloads is made.
- This does not authorize real-data use, production storage, automatic bank connections, or production deployment.
- Fidelity activity is not automatically classified as ordinary income or spending. Review and the existing investment-activity rules remain in force.

See [provider parser and format constraints](PROVIDER_CSV_PREVIEW.md), [canonical import contract](PR28_CANONICAL_IMPORT.md), [ledger contract](CANONICAL_LEDGER_CONTRACT.md), and [current state](CURRENT_STATE.md).
