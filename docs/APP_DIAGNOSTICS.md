# Shared application diagnostics

## Contract

`js/app-diagnostics.mjs` owns the privacy boundary and report controls.
`js/app-diagnostic-messages.mjs` holds fixed, reviewed explanations and next
steps. Existing error codes are stable identifiers, not raw provider text.
Unknown codes become `unknown`; adding a foreseeable failure requires adding a
fixed message and a test. Surface-specific wording preserves existing recovery
instructions without letting callers supply arbitrary report content.

The report contains only:

- The fixed report schema version.
- An allowlisted error code and page category.
- A 40-character hexadecimal source commit, or a fixed unknown/development label.
- For unresolved writes or ownership checks, the existing allowlisted storage or
  session diagnostic, including bounded HTTP statuses and attempt counts.

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
