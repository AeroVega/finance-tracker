# Shared application diagnostics

## Contract

The registry in `js/error-registry.mjs` owns stable code recognition, fixed copy,
conservative presentation kinds and surface-specific recovery directions.
`js/error-reporting.mjs` constructs diagnostic v2 JSON; `app-diagnostics.mjs`
keeps the existing caller API and renders it. No diagnostic changes ownership,
verification, cancellation, retry or recovery decisions. All write outcomes
remain conservatively `unknown`; copying a report does not establish recovery.

Reports and recent history stay in memory. Nothing uploads, persists, logs to
console or retries automatically. Copy and Select require
an explicit button press. At most ten reports and sixty typed breadcrumbs are
retained. Repeated code/source/action failures within thirty seconds share a
report ID and increment the visible occurrence count. Starting a new action
clears its old panel, not its history.

### What a report contains

- Fixed codes, exception names, bounded cause links, existing safe storage/session
  subchecks and fixed transport categories. No raw exception message is copied.
- Build commit from `__FT_BUILD__`, report ID, generation time and page uptime.
- Known action/page/phase, lifecycle/ownership/draft flags and request counters.
  `requests` is the lifecycle aggregate, including idle time in `elapsedMs`; it
  is not one save. Optional `actionRequests` covers requests admitted while the
  current UI action runs and its wall-clock elapsed time. Both `requestMs` values
  sum fetch-to-response durations, not body-read/CPU time. An action window is
  unavailable when no lifecycle existed at action start.
- Immutable receipt failures may identify fixed metadata field names. A
  `hash-mismatch` code without these fields does not distinguish a body mismatch
  from metadata binding/size mismatch in older builds. No field values are copied.
- Ledger counts: exact only when `syntheticOnly === true`, otherwise upper
  power-of-two buckets. No record content or financial values.
- A bounded timeline of actions, page/lifecycle/visibility events and request
  method, fixed endpoint class, status and elapsed time. URLs are never parsed by
  request metrics; endpoints not labeled by a caller remain `unknown`.
- Coarse browser/OS enums, version integers, viewport, display mode, capabilities,
  connectivity, language and UTC offset. These describe the device, not its user.
- Source file/line/column only when the stack URL matches this deployment's
  origin/base and the explicit public-source manifest. Function names are omitted.
  Raw messages, stack headers, foreign URLs, query strings, encoded paths and
  traversal are rejected. Safari/JSC and V8 formats have fixture tests; these
  tests are not physical Safari evidence.

No credentials, IDs, hashes other than the public build commit, filenames from
imports, records, amounts, balances, source dates, headers or provider bodies
are included. Each field is constructed from fixed vocabularies/numeric checks.
Providers cannot register arbitrary schemas. Input lengths, cause traversal and
output are bounded before potentially large iteration. The hard UTF-8 budget is
16 KiB, including pretty JSON; truncation is identified in the report.

### Presentation

Clearly identified form-input errors use inline messages without a technical
panel. Expected state failures have closed Technical details. Integrity failures
and defects open the report with a safe next step; ambiguous validation codes
remain visible rather than hiding a stored-data problem. Clipboard denial and
absence retain Select diagnostics; late clipboard completions cannot steal focus.
Shared styles use 16px textareas and 44px controls. Recent problems and the manual
**Test error reporting (developer)** control are in Recovery and advanced tools.

The main app has a small classic startup script that catches known app-entry
resource failures before modules load. Legacy prototype files are unchanged. They do not receive this boot fallback,
the new stylesheet or report-ID forwarding; status-only errors there can still
lose rich cause context. Main-app reporting is the integration target. It can show a fixed `module-load-failed` fallback, not a complete
report when the reporter itself is unavailable. A crash, OS termination or tab
death loses in-memory history. No complete crash-reporting claim is made.

## Maintenance and investigation

Run `node scripts/audit-error-codes.mjs` for unregistered literal sites. The
lexical scan reports computed/forwarded sites separately; zero literal misses
is not proof of every dynamic path. New typed errors can use `AppError`/`fail`
from `js/app-error.mjs`, which rejects unknown codes. Existing storage classes
remain intact to preserve their behavioral contracts; targeted boundaries retain
native causes without reclassifying cancellation or weakening safety gates.

The [generated code index](ERROR_CODES.md) comes from the registry. Run
`node scripts/generate-error-code-docs.mjs --check` to verify freshness.
Use `node scripts/explain-diagnostic.mjs report.txt` (or stdin) to validate a pasted
v2 report and inspect local code/test references. It accepts optional header/fences,
but the application emits plain JSON for compatibility with existing consumers.
It performs no network, checkout, recovery or replay. Missing commits are clearly
identified before working-tree source is used. Source locations require public
unminified modules; a future bundler would need retained source maps.

See [project status](PROJECT_STATUS.md) for implementation/verification evidence,
[testing](TESTING.md) for commands and [the v1 archive](archive/APP_DIAGNOSTICS_V1.md)
for historical behavior. Rendered layout, physical Safari stack/clipboard/selection
behavior and live Google integration require separate acceptance. Production
financial-data persistence remains **NO-GO**.
