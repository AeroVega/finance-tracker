# Declared import coverage selector

**Status:** Isolated reusable component and synthetic demonstration. Not wired into the production import workflow and not an import-completion or Alpha implementation.

## Semantics

Observed transaction dates describe rows found, not completeness. Source coverage metadata and the day after a prior confirmed coverage end may suggest editable dates; neither confirms a declaration. The component never derives coverage from observed minimum/maximum dates, expands a range to fit outliers, or removes rows.

The caller supplies usable transaction dates as ISO dates or objects with a date and optional rowReference, rowOrdinal, or row. Invalid observed values remain visible as review findings. Every usable date outside the inclusive range is reported with its row reference where available.

## API

Import mountImportCoverageSelector from components/import-coverage-selector.mjs. Supply a container element, observedDates, optional sourceCoverage {start,end}, optional priorConfirmedCoverageEnd, optional contextKey, and onConfirm/onCancel callbacks.

The returned instance exposes getState(), updateContext(next), reset(), and destroy(). updateContext replaces file context, reapplies suggestions, and invalidates confirmation. reset restores current suggestions. destroy is idempotent, removes the instance's delegated click/change/keydown listeners, clears rendered content and clears model state.

A confirmation callback is emitted only after explicit user activation and valid dates, start <= end, at least one usable observed date, no malformed observed date values, and no out-of-range dates. Its result contains start, end, and provenance with kind user-confirmed, confirmationMethod explicit-component-confirmation, sourceMetadata, priorConfirmedCoverageEnd, and contextKey. This provenance records the user's explicit declaration; it does not certify provider completeness, parsing correctness, or reconciliation. Cancellation returns accepted:false and never calls onConfirm.

## Interaction and accessibility

Two independently navigable, Monday-first calendars are rendered alongside two independently editable native date fields. Arrow keys move by day/week; Home/End move to week boundaries; PageUp/PageDown navigate months. Calendar controls and date inputs have accessible names and visible focus. Layouts collapse to one calendar column on narrow screens; interactive controls have 40–44px minimum targets.

## Synthetic demonstration

Run a local static server from the repository root, e.g. python3 -m http.server 8000, then open /prototype/import-coverage-selector.html. The fixture uses invented dates and row references only.

## Tests

Run node --test tests/import-coverage-selector.test.mjs. The component is outside js/ and is not added to the shipped diagnostic source inventory because it is not yet shipped or wired into the application.

## Remaining limits

This component does not parse files, decide parser row validity, map accounts, prepare canonical imports, reconcile duplicates, persist transactions, retain source files, or provide provider-file acceptance. The future caller must pass dates it considers usable and retain source rows independently. Physical iPhone/iPad Safari, VoiceOver, touch/keyboard interoperability, and owner integration acceptance remain outstanding. No real financial data, private workbook, Drive, or production credentials were used. No merge or deployment is included.
