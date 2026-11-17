# Synthetic Drive provider scenarios

This test-only environment runs the real full-snapshot application, workspace session,
Drive adapter and (in UI tests) shipped page controller against HTTP-shaped fake responses.
It does not use a Google account, credentials, real folders or a deployment.
It is a fetch replacement, not a complete Drive emulator or a live Drive compatibility test.

## Run

```sh
node --test tests/full-snapshot-provider-scenarios.test.mjs tests/full-snapshot-google-ui-scenarios.test.mjs
node tests/benchmark-drive-scenarios.mjs
```

The scenarios join the ordinary `tests/*.test.mjs` suite. Named profiles in
`tests/helpers/scenario-full-snapshot-drive.mjs` provide stable metadata, version-only
server settling after writes, paginated listings, and explicitly assumed latency/bandwidth.
Fault rules target semantic operations and file kinds rather than absolute request numbers.
They support provider status errors, a lost response after a committed mutation, version
changes and corrupted downloaded bytes. Each fault test asserts its injection fired.

Coverage includes seed, edit, save, release, fresh reopen, both manifest-publication
lost-response boundaries, draft retention, recovery, initial 401/403/429/503 refusal,
corruption rejection, OAuth denial/closed/blocked popup, and Picker cancel/error cleanup.
Token-expiry cases verify fail-closed behavior before saving and during a delayed read,
retained drafts, and no silent reauthorization. The delay is suspension-shaped, not a
real browser visibility or device suspension event; actual OAuth renewal is not verified.
The existing convergence and integrity suites remain necessary: these profiles do not
replace exhaustive content, identity, ownership or competing-writer tests.

The UI scenarios found a real bug: Picker ERROR previously left the selection promise
pending. It now rejects with the existing `google-picker-unavailable` error, allowing
normal busy-state cleanup. Tests verify no writes and preservation of the preview.

## Cost reporting

`benchmark-drive-scenarios.mjs` seeds a generated synthetic year, saves one correction,
releases and independently reopens it. JSON lines contain request counts by category,
request/response bytes, concurrency, local execution time and modeled service time.
The slow profile assumes 250 ms/read, 1,300 ms/write, 1 MB/s upload and 5 MB/s download.
These are scenario inputs, not measured Google performance. Modeled service time is a
sum, not concurrent critical-path latency. Local elapsed time measures fake-provider
execution, not a user's experience. Use counts/bytes to detect regressions and compare
candidate optimizations; do not infer a real-world speedup without real measurements.

## Optional browser acceptance

```sh
node scripts/check-drive-simulator.mjs chromium
node scripts/check-drive-simulator.mjs webkit
```

Requires Playwright and its browser binaries (or `CHROMIUM_PATH` for Chromium). The
harness serves the app on loopback and intercepts Google requests with synthetic
OAuth/Picker responses and the same provider simulator. It rejects unexpected external
requests. It exercises terminal authentication/Picker states and seed/reopen at a narrow
touch viewport. This is not real sign-in, an iPhone, or Safari certification.

As of 2026-11-17, this harness is syntax-checked but browser execution is **not verified**:
the available standalone Chromium failed at launch with `socket() failed: Operation not
permitted` in process-singleton setup, including an approved retry; the WebKit binary was
not installed. The passing Node UI tests must not be reported as browser passes.

## Provider contract sources and limits

- [Drive file resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files):
  `version` can reflect invisible server changes; version-only settling is therefore an
  important adversarial case. The exact schedule here is a test assumption, not a claim
  about Google's frequency or timing.
- [Drive errors](https://developers.google.com/workspace/drive/api/guides/handle-errors)
- [Google Identity JavaScript reference](https://developers.google.com/identity/oauth2/web/reference/js-reference)
- [Picker actions](https://developers.google.com/workspace/drive/picker/reference/picker.action)

Still outside this model: real OAuth grants and popup policies, Picker iframe behavior,
Google propagation behavior not encoded in a scenario, HTTP caches/proxies, actual
quotas, physical-device suspension and actual service latency. A small live synthetic
smoke test can remain a final compatibility check; it should not be the primary bug loop.
