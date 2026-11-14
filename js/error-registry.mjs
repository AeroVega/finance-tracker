// One registry for report-safe codes and fixed user-facing copy. The grouped
// literals are reviewed source identifiers, not runtime strings discovered from errors.
// Unknown/ambiguous validation remains loud: the same slug can be raised while
// reading stored data, not only while entering a form. No code grants retry rights.
const workspace = {
  'unsupported-canonical-profile': 'Only canonical version 5 is supported. Keep this folder unchanged and choose a new empty synthetic folder. Older copies are not migrated.',
  'unsupported-canonical-layout': 'Only canonical version 5 is supported. Create a new synthetic copy; existing files will not be changed.',
  'unsupported-derived-projection': 'This ledger contains a linked refund without a defined category. Keep the original copy. Add an explicit category correction to the original activity, save it, then retry the new copy.',
  'canonical-ledger-required': 'This copy has no saved canonical ledger. Release it, seed a synthetic year in a new empty folder, then open that saved copy here.',
  'deprecated-canonical-layout': 'This standalone grouped version-2 copy is no longer supported. It was not initialized or modified. Preserve it and create a new synthetic copy using canonical version 5.',
  'existing-copy-required': 'Choose the folder where you already saved the synthetic year. This workspace does not initialize empty folders.',
  'correction-rationale-required': 'Explain the evidence or reason for this correction.',
  'classification-amount-conflict': 'That classification conflicts with the amount. Income must not be negative and spending must not be positive.',
  'category-required': 'Enter a category for this transaction.',
  'invalid-posting-status-correction': 'Choose Posted with a valid posting date, or Pending or Unknown without a posting date. Explain the evidence for the change.',
  'posting-status-unchanged': 'The posting status and date are unchanged. Choose a different value or another correction.',
  'invalid-amount': 'Enter an exact decimal amount, for example -125.50.',
  'reopen-before-editing': 'Reopen verified saved records before editing. Your local changes have not been discarded.',
  'authorization-cancelled': 'Google authorization was cancelled. No saved records were replaced.',
  'picker-cancelled': 'Folder selection was cancelled. No saved records were replaced.',
  'synthetic-folder-required': 'Choose an existing invented-data folder with “synthetic” in its name. No saved records were replaced.',
  'base-conflict': 'The saved copy changed. Reopen verified records before deciding what to retry.',
  'transaction-unresolved': 'The save result is uncertain. Recover if offered, then reopen saved records before retrying.',
  'reconnect-required': 'The connection could not be verified. Reconnect and reopen saved records before editing.',
  'verified-draft-required': 'There is no verified draft eligible for saving. Reopen saved records before editing.',
  'verified-preview-required': 'Load a local synthetic preview with no active Drive session before saving it to a new folder.',
  'new-empty-folder-required': 'The selected folder did not pass fresh-copy admission. No existing copy was changed; choose a newly created empty synthetic folder.',
  'seed-readback-mismatch': 'The new copy could not be independently verified. Keep this tab open, recover if offered, then reopen before deciding what to do next.',
  'transfer-link-rationale-required': 'Explain why these two activities represent the same transfer.',
  'invalid-transfer-link': 'These activities cannot be linked. Confirm that both are active transfers in different accounts, with equal opposite amounts in the same currency, and that neither is already linked.',
  'invalid-holding': 'Each holding needs a unique identifier, type, nonnegative exact quantity and value.',
  'invalid-reconciliation-component': 'Each component needs a supported movement kind, signed exact amount and statement reference.',
  'invalid-position-statement-coverage': 'Complete statement coverage must match the selected full month and account scope.',
  'invalid-position-amount': 'Enter an exact decimal balance without a currency symbol or separators.',
  'invalid-position-money': 'Enter an exact decimal amount without currency symbols or separators.',
  'negative-holding-value': 'Enter a nonnegative statement value for each holding. Short positions are not supported.',
  'invalid-position-month': 'Choose a calendar month before recording reconciliation evidence.',
  'closure-requires-selected-zero-balance': 'Choose a zero balance for this account on its closure date.',
  'invalid-statement-coverage': 'The complete statement declaration must match the selected account and calendar month.',
  'reconciliation-requires-selected-anchors': 'Resolve conflicting balances first, then choose the selected opening and closing evidence.',
  'invalid-account': 'Enter an invented account name, a listed institution and account type, and a three-letter uppercase currency.',
  'invalid-position-date': 'Choose a valid effective date.',
  'invalid-reconciliation-anchors': 'Choose the previous month-end opening balance and selected month-end closing balance for this account.',
  'invalid-position-source': 'Add a source evidence reference.',
  'liability-balance-must-be-positive': 'Enter a nonnegative amount owed for this liability, without a minus sign.',
  'release-unconfirmed': 'Release was not verified. Keep this copy selected and resolve its session before switching devices.'
};
const inputs = {
  'account-mapping-required': 'Choose a destination for every source account.',
  'coverage-dates-required': 'Choose both declared coverage dates for every account.',
  'coverage-order-invalid': 'Declared end must be on or after declared start.',
  'coverage-confirmation-required': 'Confirm the declared coverage for every account.',
  'currency-required': 'Enter an explicit three-letter ISO currency such as USD. No currency is assumed.',
  'review-reversal-dependency': 'This decision has later changes that depend on it. It cannot be returned to review automatically.',
  'account-name-required': 'Enter a name for each new invented account.',
  'distinct-account-required': 'Map each source account to a distinct destination account.',
  'evidence-required': 'Enter evidence and a rationale for this change.',
  'review-rationale-required': 'Enter a rationale for this review decision.',
  'match-target-required': 'Choose an activity to match.',
  'reconnect-required': 'Reconnect before changing review decisions.',
  'preview-required': 'Preview the currently selected fixture and map its accounts before staging.',
  'unknown-fixture': 'Choose one of the bundled invented fixtures.',
  'fixture-unavailable': 'The bundled fixture could not be loaded. Try again when connected.'
};
const seeder = {
  'write-unresolved': 'A dispatched storage write could not be independently verified. Preserve this folder and leave this tab open. Do not upload again, reconnect, recover or delete files until the diagnostic below has been inspected.',
  'ownership-unknown': 'Session ownership could not be verified. A session marker may already have been written even when this counter shows zero. Preserve this folder and marker for inspection. Do not delete the marker or blindly retry or reconnect.',
  'session-operation-cancelled': 'Session verification was cancelled. A dispatched marker write may still finish. Preserve the folder and marker; do not retry creation.',
  'unsupported-derived-projection': 'A linked refund lacks a defined category. Preserve the source copy and add an explicit category correction before making a new copy.',
  'empty-folder-required': 'The selected folder is not empty. No upload was started. Choose a newly created empty synthetic folder.',
  'deprecated-canonical-layout': 'This standalone grouped version-2 copy is no longer supported. No records were changed. Preserve it and choose a new empty synthetic folder for a canonical version-5 copy.',
  'existing-copy-required': 'No existing synthetic copy was found. Reconnect does not initialize a folder.',
  'fresh-genesis-required': 'The folder is no longer a fresh empty copy. No year was uploaded. Preserve it and choose a new empty folder.',
  'unrecognized-seed-copy': 'This copy is different from this version’s exact invented year. It will not be replaced or appended to. Preserve it and choose a new empty folder.',
  'new-empty-folder-required': 'This tab cannot safely retry into this copy. Preserve it and choose a new empty folder.',
  'seed-readback-mismatch': 'Read-back did not match the invented year. Success is not verified. Preserve this folder for inspection.',
  'authorization-required': 'Google authorization expired or is unavailable. Reconnect to the same folder, then verify before retrying.',
  'transaction-unresolved': 'The upload did not finish and verify. Some files may have been saved. Reconnect to the same folder and use recovery if offered before verifying or retrying.',
  'nonempty-folder': 'This folder has files without a supported manifest. Preserve it for inspection and choose a new empty synthetic folder.',
  'reconnect-required': 'Reconnect and resolve the storage session before continuing.',
  'release-unconfirmed': 'Release was not verified. Resolve the connection before switching devices.'
};
const copyGuideMessages = Object.freeze({
  "external-original-retention-not-supported": "This copy has separate original-retention metadata or files. V4 backup/migration cannot preserve their deletion schedule yet. Keep the source unchanged and use the legacy archive2 backup tools where applicable; no originals were deleted.",
  "retained-original-migration-not-supported": "This copy has separate original-retention metadata or files. V4 backup/migration cannot preserve their deletion schedule yet. Keep the source unchanged and use the legacy archive2 backup tools where applicable; no originals were deleted.",
  "unsupported-derived-projection": "This legacy copy has a linked refund whose original activity has no category. Keep the source, add and save an explicit category correction to that original activity, then retry migration to a fresh folder. No source evidence was changed.",
  "selection-cancelled": "Selection cancelled. Nothing passed. Choose again when ready.",
  "authorization-cancelled": "Google authorization was closed or blocked. Try the source button again.",
  "authorization-required": "Google authorization is unavailable or expired. Release sessions, then reconnect before retrying.",
  "synthetic-folder-required": "Choose a dedicated test folder with 'synthetic' in its name, such as 'synthetic-backup'. No copy was started for this selection. Backup and restore destinations must also be new and empty.",
  "canonical-source-required": "Choose the existing completed canonical synthetic source. An empty folder, backup or unrelated fixture is not a source for this check. No database was created.",
  "original-source-required": "That folder was used as a destination in this run. Choose the original completed source.",
  "retained-originals-unsupported": "This source includes separately retained original files. This guide is limited to canonical synthetic fixtures without those files. Release this source and use Advanced PR25 tools for original-file retention checks. No backup or restore was started.",
  "source-changed": "The source changed since verification. Release sessions and choose the source again. Do not rerun the 25 live checks.",
  "recovery-required": "The source needs catalog transaction recovery. Release its session, then use the PR28 workbench recovery controls on this same source. Recovering a stale session alone does not repair a transaction.",
  "unfinished-history": "The source contains unfinished transaction history. Release its session and use the PR28 workbench to recover this same source before copying it.",
  "source-graph-mismatch": "The exact retained history does not match the selected source. This step did not pass. Preserve any destination for inspection.",
  "different-export-selected": "Choose the actual file from this run's download. Another valid export does not prove this file roundtrip.",
  "fresh-destination-required": "Choose a new empty synthetic folder, distinct from the source and every prior destination. Keep existing or interrupted folders as evidence.",
  "stale-session": "A previous source session is stale. Stop its other tabs/devices, then use Confirm stopped sessions below.",
  "session-active": "Another session is active. Release it on the other tab/device before trying again.",
  "copy-quarantined": "The copy did not finish. Quarantine has NOT been independently confirmed here. Preserve this destination. Retry only in a new empty folder after resolving session release.",
  "release-unconfirmed": "Session release was not confirmed. This step has not passed. Keep this tab open and use Release sessions. Do not switch devices or reuse the destination.",
  "operation-and-release-unconfirmed": "The copy or reopen failed, and session release also could not be confirmed. Neither part passed. Preserve the destination. Quarantine is unverified. Use Release sessions before trying a new empty destination.",
  "release-stale-session": "An existing session expired while this page was open. Stop every other tab/device using these synthetic folders, then confirm recovery and release below. No takeover occurred.",
  "ownership-lost": "This page could not revalidate its original session identity. No takeover occurred. Preserve the folders and resolve the current session on its owning tab/device before continuing.",
  "release-required": "Release the current sessions before choosing a source again.",
  "page-interrupted": "This tab was interrupted. No unfinished step passed. Reopen this guide, choose the original source again and use new empty destinations. Keep interrupted destinations as evidence."
});

const extra = Object.freeze({
  'conflicting-match-requires-correction': 'The selected match has a different account, currency or amount, or is missing an amount. Choose a compatible activity or resolve the evidence with an explicit correction before matching.',
  'inactive-match-target': 'The selected activity is no longer active. Choose an active match target before submitting this review decision.',

  'recovery-required': 'Storage needs recovery before more changes can be saved. Keep this tab and folder unchanged. Use the recovery controls offered for this copy, then reopen and verify before retrying.',
  'adapter-contract': 'The storage adapter returned without confirming its required mutation guard. Keep this tab and folder unchanged and inspect the diagnostic before retrying.',
  'adapter-precondition-failed': 'The storage adapter failed before completing its mutation guard. The write outcome may still need recovery; keep this tab and folder unchanged and inspect the diagnostic before retrying.',
  'stale-session': 'A previous storage session appears stale. Stop every other tab or device using this copy, then use the explicit stale-session recovery control if offered. Do not delete its marker.',
  'session-active': 'Another storage session is active. Release it on the owning tab or device before opening this copy here.',

  "unexpected-error": "The application encountered an unexpected error. Stop this operation and keep the tab and any selected folder unchanged. Copy diagnostics before retrying; a save may not have finished verification.",
  'interruption-recipe-unrecognized': 'This is not the exact interruption recipe prepared by this version. No classification was staged or saved. Older or modified test folders are unsupported, not necessarily corrupt. Preserve this folder and use a new empty synthetic folder for a new interruption rehearsal.',

  "csv-unfinished-quote": "The CSV has an unfinished quoted field. Check the export or choose a complete file; no rows from this file were imported.",
  "csv-unsupported-header": "A supported header row was not found. Choose a CSV with Date, Description and Amount columns, or a documented Wells Fargo, SoFi or Fidelity export.",
  'unknown': 'Action did not complete. Keep this tab and any selected folder unchanged. Copy diagnostics for inspection before retrying an operation that may have saved data.',
  'offline': 'The device is offline. Loaded records remain visible. Return online, then reopen and verify the saved copy before editing.',
  'authorization-required': 'Google authorization is unavailable. Keep your draft in this tab. Reconnect to the same copy and verify its state before retrying a save.',
  'ownership-lost': 'This tab’s storage session could not be verified. Writes are disabled. Preserve the folder and marker; copy diagnostics before reconnecting.',
  'not-owner': 'This tab does not own the storage session. Resolve the active session before reopening this copy.',
  'base-conflict': 'The saved copy changed. Reopen verified records before deciding what to retry.',
  'drive-network-error': 'A storage request failed to reach Google. Keep the folder unchanged and inspect its saved state before retrying any write.',
  'drive-request-failed': 'Google did not complete a storage request. Keep the folder unchanged and copy diagnostics before retrying any write.',
  'storage-not-ready': 'Storage is not ready for this action. Keep your draft and follow the connection or recovery controls before continuing.'
});
const startup = Object.freeze({
  "google-config-network": "Google deployment configuration could not be reached because the request failed. Local preview still works; saved copies are unavailable until the configuration can be loaded.",
  "google-config-http": "Google deployment configuration could not be loaded (HTTP {status}). Local preview still works; saved copies are unavailable.",
  "google-config-json": "The deployed Google configuration file is not valid JSON. Local preview still works; saved copies are unavailable.",
  "google-config-invalid": "The deployed Google configuration is incomplete or invalid. Check the Google deployment settings. Local preview still works.",
  "google-libraries-unavailable": "Google's browser libraries did not load ({components}). This is a Google script/network or browser-blocking problem, not a missing deployment configuration. Local preview still works.",
  "google-picker-unavailable": "Google Picker could not initialize. The deployment configuration was loaded, but the Picker library failed. Check Google script access and browser content blockers. Local preview still works."
});

const codeGroups = {
  startup: `google-config-http google-config-invalid google-config-json google-config-network google-libraries-unavailable google-library-timeout google-picker-unavailable`,
  backup: `
    archive-canonical-profile-mismatch archive-hash-mismatch archive-identity-mismatch
    archive-object-hash-mismatch backup-commit-readback-failed backup-manifest-readback-failed
    backup-metadata-mismatch backup-metadata-unavailable backup-object-not-visible
    backup-object-readback-failed backup-quarantined backup-structure-invalid catalog-changed
    clean-v4-manifest-required commit-hash-mismatch commit-identity-mismatch concurrent-verification-read
    copy-mismatch copy-quarantined copy-readback-mismatch copy-source-hash-mismatch disconnected-history
    duplicate-archive-object duplicate-object-identity external-original-retention-not-supported
    fresh-destination-required header-byte-limit history-mismatch invalid-backup-config invalid-backup-copy-id
    invalid-backup-source invalid-base64 invalid-bytes invalid-catalog-archive invalid-chunk
    invalid-commit-hash invalid-copy-identity invalid-count invalid-descriptor invalid-frame-order
    invalid-header invalid-limits invalid-logical-path invalid-manifest invalid-object-bytes invalid-object-id
    invalid-object-list invalid-original-archive invalid-portable-binding invalid-portable-commit
    invalid-read-limit invalid-restore-copy-id invalid-revision invalid-root invalid-sink
    invalid-snapshot-reference invalid-source invalid-source-check invalid-staging-store
    invalid-storage-binding invalid-verification-result journal-identity-mismatch lineage-verifier-unavailable
    manifest-byte-limit missing-archive-object noncanonical-header not-restorable-backup object-byte-limit
    object-hash-mismatch physical-archive-locator published-copy-mismatch restore-incomplete
    same-backup-destination snapshot-object-set-mismatch source-changed source-changed-during-backup
    source-commit-invalid source-evidence-binding-mismatch source-evidence-byte-limit
    source-evidence-bytes-changed source-evidence-cycle source-evidence-database-mismatch
    source-evidence-format source-evidence-hash-mismatch source-evidence-manifest-mismatch
    source-evidence-metadata-mismatch source-evidence-missing-file source-evidence-missing-object
    source-evidence-read-only source-evidence-required source-evidence-size-mismatch
    source-evidence-unreferenced-file source-evidence-version-changed source-lock-and-sink-required
    source-lock-required source-object-hash-mismatch source-originals-changed source-version-changed
    staged-object-hash-mismatch staged-object-id-mismatch staged-object-mismatch storage-binding-mismatch
    structural-validation-failed structural-validator-required structural-verification-failed
    structural-verifier-required target-lock-required terminal-commitment-mismatch terminal-count-mismatch
    trailing-bytes truncated-stream unfinished-history unguarded-copy-write unsupported-archive
    unsupported-root-profile unsupported-root-version unsupported-stream-version verification-closed
    verification-plan-unavailable
  `,
  catalog: `
    ambiguous-transactions catalog-base-mismatch catalog-manifest-required catalog-root-limit
    catalog-segment-chain-mismatch catalog-segment-cycle catalog-segment-limit commit-history-cycle
    commit-history-mismatch duplicate-catalog-binding expired-write-receipt-scope immutable-hash-mismatch
    immutable-metadata-mismatch immutable-version-mismatch invalid-catalog-root invalid-catalog-segment
    invalid-history-cache-limit invalid-logical-commit invalid-metadata-batch invalid-publication-intent
    invalid-transaction invalid-write-receipt journal-commit-mismatch manifest-commit-mismatch
    manifest-readback-mismatch missing-history missing-pending-journal missing-staged-commit
    missing-staged-object object-location-mismatch pending-aborted-transaction pending-manifest-mismatch
    read-only-copy recovery-base-mismatch staged-commit-mismatch synthetic-catalog-required
    transaction-already-exists transaction-unresolved
  `,
  csv: `
    invalid-csv-quoting invalid-source-bytes invalid-source-encoding missing-csv-header unsupported-csv-header
    unsupported-source-format
  `,
  diag: `
    clipboard-unavailable
    account-mapping-required account-name-required authorization-cancelled broken-chain
    canonical-identity-mismatch canonical-index-missing canonical-record-missing canonical-source-required
    coverage-confirmation-required coverage-dates-required coverage-order-invalid csv-unfinished-quote
    csv-unsupported-header currency-required deletion-not-confirmed deprecated-canonical-layout
    diagnostic-self-test different-export-selected distinct-account-required duplicate-record-id
    empty-folder-required empty-journal event-after-terminal event-hash-mismatch evidence-required
    existing-copy-required fixture-unavailable fresh-genesis-required  
       
     history-order-change-refused history-removal-refused history-rewrite-refused
    import-evidence-rewrite-refused interruption-recipe-unrecognized invalid-abort
    invalid-backup-source-locator invalid-canonical-fragments invalid-canonical-group invalid-canonical-index
    invalid-canonical-object invalid-commit-stage invalid-deletion-state invalid-event invalid-event-type
    invalid-first-event invalid-id invalid-object-plan invalid-object-stage invalid-payload
    invalid-position-statement-coverage invalid-previous-hash invalid-publication invalid-publication-plan
    invalid-record-id invalid-retention-adapter invalid-retention-record invalid-retention-state
    invalid-source-hash invalid-synthetic-year-options invalid-terminal-event invalid-timestamp
    invalid-transition ledger-identity-mismatch ledger-metadata-rewrite-refused match-target-required
    migration-chunk-format migration-commit-mismatch migration-empty-chunk migration-evidence-format
    migration-evidence-hash migration-latest-ledger-mismatch migration-length-mismatch
    migration-payload-mismatch migration-snapshot-missing migration-source-mismatch
    migration-target-identity-required missing-deletion-failure missing-import-id missing-restored-locator
    missing-source-locator module-load-failed operation-and-release-unconfirmed original-source-required
    page-interrupted picker-cancelled preview-required provider-delete-failed release-required
    release-stale-session retained-original-migration-not-supported retained-originals-unsupported
    retention-clock-mismatch retention-not-expired retry-history-rewrite-refused review-rationale-required
    selection-cancelled session-claim-failed source-evidence-rewrite-refused source-graph-mismatch
    unexpected-error unindexed-canonical-record unknown unknown-fixture unrecognized-seed-copy
    unsupported-canonical-layout unsupported-derived-projection unsupported-folder-format unsupported-layout
    unsupported-object unsupported-value utf8-string-required
  `,
  drive: `
    adapter-contract adapter-precondition-failed ambiguous-original-import-index ambiguous-pending-original
    authorization-changed body-mismatch candidate-mismatch commit-record-metadata-mismatch
    commit-verification-failed content-hash-mismatch content-mismatch delete-not-accepted drive-network-error
    drive-request-failed drive-response-interrupted drive-response-too-large drive-stream-unavailable
    duplicate-original-locator existing-object existing-original-imports expired-original-content http-error
    immutable-readback-mismatch incomplete-folder-enumeration incomplete-metadata-batch incomplete-search
    incomplete-snapshot intent-mismatch invalid-adapter-config invalid-content invalid-drive-response
    invalid-engine-config invalid-filter invalid-generated-id invalid-immutable-query invalid-json-object
    invalid-lineage invalid-next-manifest invalid-original-import invalid-original-import-index
    invalid-original-omission invalid-original-retention-intent invalid-recovery-identity
    invalid-response-limits invalid-role invalid-sequence invalid-state invalid-verifier invalid-version
    invalid-visibility-retry-config manifest-commit-pointer-mismatch manifest-metadata-mismatch
    manifest-version-mismatch metadata-limit missing-commit-file-id missing-file-id missing-folder-name
    missing-original-retention missing-token mutation-in-flight not-retained-original original-hash-mismatch
    original-import-binding-mismatch original-index-conflict original-index-unverified pagination-loop
    parent-mismatch pending-base pending-incomplete pending-mismatch permission-denied physical-id-in-use
    preparation-mismatch race-folder-mismatch readback-mismatch receipt-mismatch recovery-base-changed
    recovery-manifest-builder-required recovery-manifest-mismatch recovery-needs-intervention
    recovery-publication-unverified retention-intent-conflict retention-intent-hash-mismatch
    retry-not-conflict snapshot-object-metadata-mismatch snapshot-object-verification-failed
    source-evidence-verifier-required staged-object-metadata-mismatch staged-object-verification-failed
    unfinished-verification-read unsafe-name unsafe-race-target unsupported-binding unsupported-intent
    unsupported-source-evidence verification-metadata-changed verification-read-limit
    verified-baseline-required visibility-timeout
  `,
  import: `
    account-already-exists account-mapping-conflict activity-outside-declared-coverage
    candidate-money-mismatch category-required classification-amount-conflict classification-history-mismatch
    confirmed-coverage-required conflicting-match-requires-correction correction-evidence-required
    correction-history-mismatch cyclic-refund-link duplicate-attempt-id duplicate-row-ordinal
    event-command-conflict event-command-id-required explicit-account-mapping-required
    explicit-currency-resolution-required import-counts-mismatch import-status-mismatch
    inactive-financial-target inactive-match-target invalid-account invalid-activity invalid-activity-kind
    invalid-activity-money invalid-bank-correction invalid-canonical-ledger invalid-category-correction
    invalid-classification invalid-clock invalid-effective-refund invalid-event-command invalid-event-metadata
    invalid-event-money invalid-exact-amount invalid-financial-commands invalid-import invalid-import-counts
    invalid-import-observations invalid-ledger-collection invalid-lifecycle-event invalid-money
    invalid-observation invalid-observation-state invalid-or-duplicate-record-id invalid-parsed-import
    invalid-posted-date invalid-posting-status-correction invalid-prospective-category-rule
    invalid-refund-link invalid-refund-posted-date invalid-report-scope invalid-report-scopes
    invalid-retry-audit invalid-review invalid-review-decision invalid-review-reversal invalid-review-target
    invalid-row-cannot-be-accepted invalid-settlement-date invalid-transfer-link ledger-session-busy
    ledger-session-closed missing-currency non-json-ledger observation-account-conflict
    observation-already-resolved observation-evidence-mismatch observation-outside-declared-coverage
    observation-resolution-without-decision posting-status-history-mismatch posting-status-unchanged
    refund-evidence-required refund-exceeds-original retry-normalization-changed retry-row-missing
    review-reversal-dependency rows-must-be-array session-activity-id-required session-generation-exhausted
    session-json-and-storage-binding-required session-json-required session-primitive-event-metadata-required
    session-revision-exhausted stale-ledger-session-revision synthetic-only-required unknown-account
    unknown-activity unsupported-classification unsupported-financial-event unsupported-money-precision
    unsupported-persisted-event unsupported-synthetic-retention-or-completeness uuid-v4-required
  `,
  lifecycle: `
    base-conflict catalog-required crypto-unavailable invalid-config invalid-path manifest-unavailable
    object-integrity-failure object-metadata-mismatch object-not-found paged-required recovery-required
    storage-not-ready synthetic-folder-required verification-scope-closed
  `,
  paged: `
    adapter-scope-mismatch ambiguous-manifest byte-limit canonical-commit-mismatch canonical-derived-mismatch
    canonical-genesis-mismatch canonical-preparation-mismatch canonical-profile-mismatch
    canonical-readback-mismatch child-mismatch count-mismatch cursor-mismatch cycle cyclic-value
    duplicate-child duplicate-entry duplicate-physical-locator entry-limit expected-count-mismatch guard-scope
    hash-mismatch index-mismatch invalid-byte-proof invalid-catalog-parent invalid-command invalid-cursor
    invalid-data-object-identity invalid-entry invalid-guard invalid-hash invalid-height invalid-identity
    invalid-initialization invalid-input invalid-journal invalid-journal-locator invalid-json invalid-key
    invalid-kind invalid-locator-addition invalid-locator-catalog invalid-locator-catalog-input
    invalid-locator-entry invalid-locator-identity invalid-logical-snapshot invalid-logical-snapshot-entry
    invalid-manifest-metadata invalid-memory-write invalid-node invalid-number invalid-options invalid-order
    invalid-page-limit invalid-parent invalid-parent-catalog-hash invalid-plan invalid-preparation
    invalid-query invalid-range invalid-shape invalid-store invalid-unicode invalid-value key-byte-limit
    locator-catalog-generation-mismatch locator-catalog-identity-mismatch locator-hash-mismatch
    locator-not-found locator-replacement-forbidden memory-write-hash-mismatch metadata-mismatch
    migration-evidence-required node-byte-limit node-entry-limit noncanonical-json nonempty-folder
    operation-in-progress paged-lifecycle-required read-only read-only-inspection read-only-store
    replacement-forbidden semantic-scope-open unexpected-parent-catalog-hash unsupported-canonical-profile
    unsupported-catalog unsupported-commit unsupported-manifest value-depth-limit verification-plan-changed
    verification-scope-open verified-base-required version-mismatch write-hash-mismatch
    write-readback-mismatch write-unresolved
  `,
  session: `
    ambiguous-session-record authorization-required confirmation-required drive-create-failed
    drive-read-failed drive-update-failed fetch-unavailable invalid-adapter invalid-operation invalid-response
    invalid-timing missing-folder network-error no-session-context not-owner not-stale offline ownership-lost
    ownership-unknown read-before-write-required release-unconfirmed session-active session-marker-not-visible
    session-operation-cancelled session-read-failed session-released stale-session timer-unavailable
  `,
  workspace: `
    invalid-amount
    canonical-ledger-required cash-reconciliation-cannot-add-components closure-requires-selected-zero-balance
    correction-rationale-required invalid-balance-resolution invalid-holding invalid-holdings-snapshot
    invalid-position-account-scope invalid-position-amount invalid-position-as-of invalid-position-basis
    invalid-position-command invalid-position-date invalid-position-event invalid-position-events
    invalid-position-money invalid-position-month invalid-position-source invalid-position-source-import
    invalid-reconciliation-anchors invalid-reconciliation-component invalid-reconciliation-method
    invalid-statement-coverage invalid-workspace-month invalid-workspace-options
    liability-balance-must-be-positive negative-holding-value new-empty-folder-required no-staged-changes
    position-command-conflict position-source-required reconciliation-requires-selected-anchors
    reconnect-required recovery-not-required release-before-preview reopen-before-editing
    seed-readback-mismatch statement-reconciliation-evidence-required synthetic-data-required
    transfer-link-rationale-required unknown-position-account unsupported-workspace-correction
    verified-draft-required verified-preview-required
  `,
};
const inputCodes = new Set(`category-required correction-rationale-required transfer-link-rationale-required
 account-mapping-required coverage-dates-required coverage-order-invalid coverage-confirmation-required
 currency-required account-name-required distinct-account-required evidence-required review-rationale-required
 match-target-required`.split(/\s+/).filter(Boolean));
const stateCodes = new Set(`offline authorization-required authorization-cancelled picker-cancelled selection-cancelled
 session-active stale-session reconnect-required reopen-before-editing storage-not-ready read-only read-only-inspection
 preview-required verified-preview-required existing-copy-required`.split(/\s+/).filter(Boolean));
const defectCodes = new Set(`unknown unexpected-error diagnostic-self-test module-load-failed
 invalid-options invalid-adapter invalid-adapter-config invalid-engine-config invalid-clock
 adapter-contract adapter-precondition-failed crypto-unavailable`.split(/\s+/).filter(Boolean));
const fixedFallback = 'An application check failed. Keep the tab and selected folder unchanged, and copy diagnostics before retrying.';
const userAction = 'Keep the tab and selected folder unchanged. Copy diagnostics for inspection before retrying a write.';
const entries = Object.create(null);
for (const [area, codes] of Object.entries(codeGroups)) {
  for (const code of codes.trim().split(/\s+/)) {
    if (Object.hasOwn(entries, code)) throw new Error('Duplicate diagnostic registry entry');
    const messages = {};
    for (const [surface, source] of Object.entries({workspace, import: inputs, 'synthetic-year': seeder, 'copy-guide': copyGuideMessages})) {
      if (Object.hasOwn(source, code)) messages[surface] = source[code];
    }
    // Preserve the former default precedence (surface > extra > combined copy).
    let message = extra[code] ?? seeder[code] ?? workspace[code] ?? inputs[code] ?? copyGuideMessages[code] ?? fixedFallback;
    if (Object.hasOwn(startup, code)) message = startup[code].replace('{status}', 'unknown').replace('{components}', 'one or more required Google scripts');
    const kind = inputCodes.has(code) ? 'input' : stateCodes.has(code) ? 'state' : defectCodes.has(code) || area === 'diag' ? 'defect' : 'integrity';
    entries[code] = Object.freeze({area, kind, message, userAction: kind === 'input' ? 'Correct the highlighted input and try again.' : userAction,
      retryable: false, writeOutcome: 'unknown', context: Object.freeze({}), messages: Object.freeze(messages)});
  }
}
export const ERRORS = Object.freeze(entries);
export function getEntry(code) {
  return typeof code === 'string' && Object.hasOwn(ERRORS, code) ? ERRORS[code] : null;
}
// Fixed templates for the existing startup formatter, not report-safe raw values.
export const startupMessageTemplates = startup;
