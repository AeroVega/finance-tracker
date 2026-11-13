# Shared application diagnostics

## Contract

`js/app-diagnostics.mjs` owns the privacy boundary and report controls.
`js/app-diagnostic-messages.mjs` holds fixed, reviewed explanations and next
steps. `js/app-diagnostic-codes.mjs` is the source allowlist for stable internal
codes and exception class names. Codes are identifiers, not raw provider text.
Unknown codes remain `unknown`; errors are resolved through a bounded cause
chain and a small list of known nested failure fields. If a broad outer code
masks a recognized inner code, the report may include it as `causeCode`.
Surface-specific wording preserves existing recovery instructions without
letting callers supply arbitrary report content. A new user-facing failure still
needs fixed explanatory copy and an appropriate regression check.

The report contains only:

- The fixed report schema version.
- An allowlisted error code and page category.
- A 40-character hexadecimal source commit, or a fixed unknown/development label.
- For the synthetic-year page, an allowlisted operation phase and a bounded
  count of verified durable writes.
- For unresolved writes and selected Drive failures, bounded storage details
  such as HTTP status and attempt count. A manifest-read mismatch may include
  one fixed reason indicating whether metadata changed across the read, the
  reported content size disagreed with the bytes read, or both. Ownership
  failures retain their allowlisted session subcheck. Verification metadata
  changes that remain after revalidation may include a fixed reason and names
  of changed metadata fields, without the associated values. A bounded
  exception class may be included when no code is recognized.

It contains no credentials, session/folder/file/account identifiers, transaction
records, amounts, dates, URLs, stacks, raw messages or provider response bodies.
Reports are constructed from those fields, not produced by redacting an Error.
They stay in the current page. Nothing uploads, persists or retries automatically.
Copying happens only when the user presses **Copy diagnostics**. A read-only,
labelled textarea and **Select diagnostics** button remain available when the
Clipboard API is absent or denied. Replacing or clearing a panel invalidates a
pending clipboard callback so an old failure cannot steal focus.

Errors do not change storage ownership, verification or recovery decisions.
An uncertain write is still uncertain. Copying a diagnostic is not recovery or
proof that no write happened. Existing controls continue to gate further work.

## Diagnostic-code follow-up, November 12, 2026

**Implemented in the working tree:** the safe code set now includes canonical
v5 root-publication, paged-locator and Drive transport failures. Resolution
checks a bounded cause chain and selected nested failure fields, preserving a
recognized underlying code where available. Synthetic-year failures include
the page phase and verified durable-write count. Adapter failures also include
a fixed boundary label and may preserve the underlying allowlisted failure code.
Selected Drive errors include only bounded numeric HTTP statuses and retry
counts. Manifest-read mismatches distinguish metadata changes from reported
size disagreement using a fixed reason enum. A version-only verification
change triggers exact-byte revalidation; remaining metadata mismatches may list
only fixed field names and a fixed reason. A bounded revalidation-limit report
may include the number of files and bytes already rechecked. Unknown reports
may include an allowlisted exception class. No messages, IDs, hashes, metadata
values, request bodies or financial records are exposed.

**Checked:** changed JavaScript modules pass `node --check`; `git diff --check`
passes. Automated tests were not run. This is a local source change only; it
does not alter the deployed build. The owner later reported (**User-confirmed**)
that deployed build `a510b09` completed a synthetic-year save and verified the
exact saved year with 71 verified durable writes in 5m06s. This owner acceptance
does not establish production readiness or independent live-Drive verification.

## Integrated surfaces

**Implemented:** canonical workspace actions and Google setup; synthetic-year
seeding/setup; the legacy local-preview dashboard and CSV failures; PR28 import
and interruption tools; PR25 backup/restore/migration tools; session, lifecycle,
Drive feasibility and folder-discovery tools. Lifecycle and dashboard status
publishers also sanitize error codes/messages before asynchronous status updates
reach the UI. Existing acceptance checklist/aggregate reports remain separate;
they already have their own explicit copy controls and do not serialize errors.

Unhandled browser errors and promise rejections after the shared module loads
produce a fixed unexpected-error report. This cannot cover failure to fetch or
parse the shared module itself, a browser crash, or a tab/OS termination. There is
no claim of complete crash reporting or remote telemetry. Developer tool views
may intentionally show synthetic session state, but that state is not included
in shared diagnostic reports.

## Verification and limits

**Verified locally:** the final extended suite passed 2,039/2,039 tests on Node
24.22.1, with no failures, skips or cancellations (330.726 seconds). Changed
JavaScript syntax, documentation links and diff checks passed. Independent code
and controller review found no remaining blocker.

Node tests exercise allowlisting, hostile diagnostic inputs, safe readback/session
subchecks, denied or missing clipboard access, manual selection, successful copy,
stale clipboard completion, controller recovery guards, and asynchronous status
sanitization. Controller tests use an intentionally small DOM and synthetic
storage seams; they do not establish browser layout or live Google behavior.

A local Chromium desktop/mobile check was attempted for this change, but this
executor rejected Chromium's process socket creation, including an escalated
attempt. Rendered layout, physical iPhone/iPad Safari clipboard behavior and live
Google integration remain unverified. Do not claim deployment or owner acceptance
from local tests. Production financial-data persistence remains **NO-GO**.
