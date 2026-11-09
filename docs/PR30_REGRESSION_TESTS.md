# PR30 controller and financial-report regressions

**Implemented, synthetic-only:** this follow-up adds executable controller coverage and an independent financial-report oracle. Application code and existing tests remain unchanged. Production financial-data persistence remains **NO-GO**. No live Google Drive, merge or deployment is part of this work.

## Executable controllers

`tests/synthetic-year-ui.test.mjs` executes the checked-in synthetic-year controller with the real seeder, ledger store, recipe and serializers. A small DOM and invented storage lifecycle replace browser and external-service boundaries. It checks:

- Page load and local preview never connect or write; upload needs explicit confirmation.
- Rejected authorization or Picker connection stops before saving, with a later deliberate retry allowed.
- Pending commit and post-commit readback withhold success; repeated clicks cannot write twice.
- A lost response after a committed save remains uncertain until reconnect verifies the saved year, without another write.
- Unverified release remains an error and keeps the connection held.
- Both v2 and v3 survive reconnect with the opposite selector, unchanged bytes and no reseeding. Offline controls refuse further actions.

`tests/acceptance-ui.test.mjs` executes the checked-in checklist controller. It checks browser/source resets, source-bound reload, dependent-only invalidation, focus, fresh-run cancellation, clipboard failure and recovery, and disclosed session-storage failure. Assertions observe controls and reports rather than private controller variables.

The shared helper explicitly supplies imports and refuses network calls. It does not emulate native browser permissions, layout, browser history navigation or physical-device behavior. These tests supplement, not replace, real Safari and owner-operated OAuth/Drive acceptance.

## Independent report oracle

`tests/canonical-period-reports.test.mjs` retains its existing comparisons and adds ten hand-worked full reports. Expected totals, reasons and exclusions are literals, not results from the single-report implementation. Each expectation is checked through single, batch and owned-session reporting.

The fixture covers inclusive and overlapping dates, duplicate/empty account selection, an account with no imports, mixed currencies, transfer/card cash exclusions, pending/unknown/unclassified/unmatched activities, unresolved observations, and refund posting dates. For example, January spending is 30.25 + 20.00 = 50.25. Its 5.05 refund posts on February 1, reducing the overlapping January 31–February 1 spending to 45.20, while January stays 50.25.

## Verification

Run the focused checks:

```sh
node --test tests/synthetic-year-ui.test.mjs tests/acceptance-ui.test.mjs tests/canonical-period-reports.test.mjs
```

**Verified locally:** focused checks pass 20/20 on Node 24.22.1. Isolated temporary mutations proved failures when release confirmation, reconnect verification or browser-change reset was removed, and when refund reporting used the effective date instead of the posted date. None of those mutations changed the working application source. Independent review approved the test approach and oracle arithmetic.

The complete repository command remains:

```sh
node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

**Verified locally on November 8, 2026:** the complete final suite passed **946/946 tests on Node 24.22.1 and 26.13.0**, with zero failures, cancellations or skips. JavaScript syntax checks and `git diff --check` passed. No application source changed.

**Open:** native iPhone/iPad Safari, live authorization/Picker, Drive timing and device capacity. Invented lifecycle responses do not prove the real storage protocol; the existing adapter, history, interruption and backup suites continue to cover that separately.
