# Test commands and scope

Use invented data only. Node checks do not establish live Google behavior,
browser layout, iPhone/iPad capacity or production readiness.

## During development

Run the affected files first, then the ordinary regression suite:

```sh
node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

This runs every test file and every financial, corruption, interruption,
ownership and recovery case. The partitioned-storage growth comparison uses
24 and 144 activities. Its test name prints the sizes actually exercised.
This is not the complete scale gate.

## Before handoff and in CI

```sh
FINANCE_EXTENDED_STORAGE_TESTS=1 node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

The extended run also exercises the existing 576-activity partitioned-storage
fixture. CI sets this flag explicitly and runs the full suite once. The former
second workflow ran the same suite again on pull requests. Its extra syntax
checks, manual trigger and branch trigger are now in `test-node.yml`.
Both old job names remain available for required checks. `transaction-contracts`
only reports whether the single full-suite job succeeded; it runs no tests twice.

Keep concurrency at one. The large synthetic storage checks should not compete
for heap across files. Report the flag, commit, Node version, actual result and
elapsed time. Do not describe a focused or ordinary run as extended-scale proof.

For a storage-only extended check:

```sh
FINANCE_EXTENDED_STORAGE_TESTS=1 node --max-old-space-size=768 --test --test-concurrency=1 tests/canonical-partitions.test.mjs
```

## What to retain and what to remove

Keep separate crash positions, corrupt bindings, authorization failures,
financial edge cases and supported-format roundtrips. Similar setup does not
make those failure modes interchangeable. Prefer shared helpers when setup is
repeated.

Avoid tests that only require a README sentence or a private variable name.
The deployment checks retain workflow behavior and artifact/source-stamp hooks.
The prototype check retains navigation, module/control wiring, the synthetic
guard and its own recovery-readiness and session-cleanup safeguards. Runtime
lifecycle, transaction, recovery and UI tests remain unchanged.

Add browser/device and live synthetic acceptance where Node substitutes cannot
observe the behavior. More passing Node cases are not a substitute for those
checks. No real financial data is needed for routine acceptance.

## Measured cleanup

**Verified on Node 24.22.1, cleanup-only comparison based on `5e9c896`:**
the unchanged suite passed 1,398 tests in 250.424 seconds. The ordinary suite
after this cleanup passed 1,397 tests in 168.202 seconds. One removed test only
required a README phrase; no financial, authorization, corruption or recovery
scenario was removed. The partition growth case took 74.684 seconds before and
17.022 seconds with the ordinary 24/144-activity fixtures. The 576-activity
fixture remains required in CI and the extended pre-handoff command.

These are one before/after run each with other work occurring on the same
machine, so they are directional timing evidence. They do not measure the later
combined app changes. Removing the duplicate CI suite avoids repeating its test
work; it does not promise to halve wall-clock time when jobs previously ran in
parallel.
