# Test commands and scope

Use invented data only. Node checks do not establish live Google behavior,
browser layout, iPhone/iPad capacity or production readiness.

## During development

Run the affected files first, then the ordinary regression suite:

```sh
node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

This runs the retained financial, corruption, interruption, ownership, recovery and UI tests. Obsolete-format-only tests are removed with their implementation; shared safeguards remain required.

## Before handoff and in CI

```sh
FINANCE_EXTENDED_STORAGE_TESTS=1 node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

CI runs the complete retained suite once. The compatibility flag does not imply retained partitioned-storage support. No separate baseline checkout is needed. Both required job names remain available: `transaction-contracts` reports whether the full-suite job succeeded rather than running it twice.

Keep concurrency at one to avoid competing for heap across files. Report the exact commit, Node version, result and elapsed time. Test counts from before obsolete-format cleanup do not describe the new tree. Never remove a recovery or integrity scenario solely to reduce run time.

## What to retain and what to remove

Keep separate crash positions, corrupt bindings, authorization failures,
financial edge cases and supported-format roundtrips. Similar setup does not
make those failure modes interchangeable. Prefer shared helpers when setup is
repeated.

Avoid tests that only require a README sentence or a private variable name.
The deployment checks retain workflow behavior and artifact/source-stamp hooks.
Retained UI checks cover current navigation, module/control wiring and synthetic guards. Full-snapshot lifecycle, transaction, recovery and UI safety cases remain required.

Add browser/device and live synthetic acceptance where Node substitutes cannot
observe the behavior. More passing Node cases are not a substitute for those
checks. No real financial data is needed for routine acceptance.

## Historical test-run measurements

**Verified on Node 24.22.1, cleanup-only comparison based on `5e9c896`:**
the unchanged suite passed 1,398 tests in 250.424 seconds. The ordinary suite
after this cleanup passed 1,397 tests in 168.202 seconds. One removed test only
required a README phrase; no financial, authorization, corruption or recovery
scenario was removed. The partition growth case took 74.684 seconds before and
17.022 seconds with the ordinary 24/144-activity fixtures. At that historical revision, the 576-activity fixture remained required in CI. That obsolete partitioned-storage fixture is not a current-format gate.

These are one before/after run each with other work occurring on the same
machine, so they are directional timing evidence. They do not measure the later
combined app changes. Removing the duplicate CI suite avoids repeating its test
work; it does not promise to halve wall-clock time when jobs previously ran in
parallel.

## Current full-snapshot provider benchmark

Run the selected synthetic application path with:

```sh
node tests/benchmark-drive-scenarios.mjs
FINANCE_SCENARIO_WALL_CLOCK=1 node tests/benchmark-drive-scenarios.mjs
```

The second command injects assumed provider delays; it is not a live Drive benchmark. See [simulator scope](DRIVE_SIMULATOR.md). Earlier v5 benchmark commands in dated reports are historical reproduction instructions for their named revisions, not current-format gates.

## Diagnostic contract checks

```sh
node scripts/audit-error-codes.mjs
node scripts/generate-error-code-docs.mjs --check
node --test tests/app-diagnostics.test.mjs tests/error-registry.test.mjs tests/error-reporting.test.mjs tests/diagnostic-capture.test.mjs tests/boot-diagnostics.test.mjs tests/diagnostic-tools.test.mjs
node scripts/explain-diagnostic.mjs tests/fixtures/diagnostic-reports/integrity.json
```

The literal-code scan reports dynamic forwarding sites for review rather than
claiming complete static coverage. The full suite includes the focused cases; CI
does not run a second full suite. `scripts/check-apple-ui.cjs` includes diagnostic
layout/self-test cases, but a blocked browser launch is not a pass. Real Safari
stack capture, clipboard/selection and boot-failure behavior need device acceptance.
