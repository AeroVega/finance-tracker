# PR38 staged-save performance

## Workload and scope

**User-confirmed, November 12, 2026:** seeding a synthetic year finally completed
on PR38, but saving one staged change took more than two minutes. The owner
requested measured improvements on PR38. No real records or owner Drive folders
were accessed for this investigation.

**Verified:** the baseline is `dc73be544f148caa51642e50c8c43ad3f17bf3c1`.
Measurements run the actual application lifecycle, canonical store and workspace
controller against invented HTTP responses. The standard year has 253 activities.
The primary case stages one classification correction to one activity, saves,
then explicitly reopens and compares the complete ledger, original observations,
activities and existing audit events. Monthly totals are checked independently.

## Changes

- Reuse the Drive adapter's detached exact-ID GET receipt instead of downloading
  each newly created immutable object again. Recheck its hash, size and binding;
  keep the closing metadata witness. Never substitute upload bytes for readback.
- Within an already remotely admitted write, immutable staging uses the live
  local lease. It rejects expired leases, offline state and invalidated ownership.
  Authoritative manifest publication still checks remote ownership and the exact
  expected manifest. Heartbeats continue normally. An external takeover can leave
  unreachable staged files before the next remote check, but cannot use this
  shortcut to publish a changed financial root. This remains a best-effort lock,
  not server-side atomic compare-and-swap.
- Overlap at most four independent, fixed-ID immutable staging operations.
  Preparation callbacks stay serial. Drain all issued operations on failure or
  cancellation before returning; never publish authority while siblings remain.
- Adopt the independently audited prepared ledger only after the lifecycle
  confirms its exact clean committed root, copy identity and next revision.
  This removes an automatic second full reopen. Explicit Reopen is unchanged.
- Keep the existing 8 MiB byte cache, but do not let a full scan of snapshot
  pages evict the working set once it is full. New write receipts and structural
  pages retain normal cache admission. Bypassed reads still validate exact bytes
  and retain metadata witnesses for closure.
- Remove one repeated ownership check immediately after the same scope-closing
  check, and one repeated absent-ID probe. Dispatch guards and fixed-ID collision
  verification remain.

There is no new storage format, browser persistence, implicit migration, garbage
collection or reduced audit-history retention. The saved financial content and
number of durable financial/protocol mutations are unchanged.

## Measured result

**Verified in Node 24.22.1, Linux x64, 768 MiB heap ceiling:**

| One-edit workload | Baseline | Candidate | Change |
| --- | ---: | ---: | ---: |
| 253 activities, 100 ms artificial delay per request | 30.65 / 30.92 s | 18.17 / 18.20 s | 40.9% lower median wait |
| Requests in that save | 276 | 186 | 32.6% fewer |
| 253 activities, 400 ms artificial delay per request | 116.76 / 117.21 s | 66.28 / 66.55 s | 43.2% lower median wait |
| Requests including timed heartbeats at 400 ms | 290 | 193 | 33.4% fewer |
| 2,340 activities, zero artificial delay, one run each | 18.42 s / 1,936 requests | 12.46 s / 361 requests | 81.4% fewer requests |

The slow runs include normal timed heartbeats: two during each baseline save,
one during each candidate save. Financial/protocol writes remain 22 for the
standard case and 33 for the dense case. No records or history are dropped.
The standard save's data upload stays 207,020 bytes excluding heartbeat traffic.

The [individual measurements](evidence/pr38-save-latency.csv) also retain the
first candidate and an extra control run. A short focused test overlapped A2;
that run is excluded from the timing summary. The earlier slow comparison ran baseline/candidate/candidate/baseline. Final
exact-source repeats ran after the full suite, without another intentional test
workload. Both sets give about 43% lower median wait at 400 ms per request.
Every run completed its exact-ledger checks and reported an unchanged source
fingerprint. Dense timings are one-run observations, not repeated CPU evidence. Dense
downloaded responses fell from 57.38 MB to 8.45 MB; financial/protocol mutations
remain unchanged. The cache-policy change reduced the intermediate candidate
from 1,159 requests to 361.

**Prediction, not live acceptance:** if the same request latency dominates the
owner's next test, about 40% less waiting is plausible. A two-minute save might
become roughly 70 seconds. Ten seconds is not supported by these measurements.
Drive retries, metadata settling, connection speed and physical Safari behavior
can change the result. The owner's live test remains decisive.

The dense snapshot exceeds the existing 8 MiB byte cache. A sequential scan
previously evicted pages immediately before the next pass needed them. Read-side
admission bypass reduces this churn without increasing the budget. This is not
selective loading: whole-history preparation remains. A newly read hot page may
miss repeatedly while the cache is full; future selective workloads should
rebenchmark that tradeoff. Global MRU eviction was tested and rejected because
it increased the dense save to 3,940 requests.

## Reproduce

Use the same benchmark harness on the baseline and candidate:

```sh
V5_BENCH_SINGLE_EDIT=1 V5_BENCH_SAVE_LATENCY_MS=100 \
  node --max-old-space-size=768 tests/benchmark-v5-workspace.mjs
```

`V5_BENCH_SAVE_LATENCY_MS` delays only the measured save's HTTP responses.
Initialization and fixture construction use zero artificial latency. The lifecycle
uses its normal heartbeat timer. `V5_BENCH_REVISIONS` exercises retained history;
`V5_BENCH_DENSE=1` selects the dense fixture. These are request/latency experiments,
not live Google Drive or physical iPhone benchmarks. Response-size and file
identity checks remain active. Logs include source fingerprints, per-phase CPU,
request categories, bytes, concurrency and successful verification status.

## Validation and limitations

The complete extended storage suite passes **1,950/1,950** tests on Node 24.22.1
with `FINANCE_EXTENDED_STORAGE_TESTS=1`, serial test files and a 768 MiB heap
ceiling (528.63 seconds). Documentation and whitespace checks pass. An independent
review found no blocking issue. GitHub CI uses Node 26 and is a separate check.

Regression coverage includes exact ledger reopen, corrupt or rebound bytes,
late receipt admission, scope closure draining, lease expiry, offline state,
blocked initial ownership admission, takeover before publication, interrupted
concurrent writes, raced fixed-ID occupancy and mismatched committed roots.

Several existing tests on the baseline still expected every Drive version change
to fail, despite the earlier bounded exact-byte revalidation implementation.
Their assertions now distinguish benign version-only changes from changed bytes
or bindings. A pre-existing diagnostic regression also now finds the bounded,
allowlisted details inside a same-code wrapper instead of losing the HTTP status.
In-memory lifecycle test fixtures now return the same verified commit
result as the real lifecycle. A guard-lifetime test now targets the retained
publication boundary rather than the ordinal of a removed duplicate check.

The app still prepares and verifies complete financial history. Four ordered
manifest transitions and retained protocol evidence remain. These changes do not
establish a ten-second live-save guarantee, bounded whole-database memory,
selective loading or production financial-data readiness.
