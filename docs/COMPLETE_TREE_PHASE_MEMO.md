# Complete-tree phase memo

A private owned decoder capability captures an opaque identity for one active physical
verification scope/phase and decode epoch. Factory snapshots preserve this
capability; no caller registration or result-mint API exists. No-scope and
generic-provider verification still run the complete original path.

A module-private WeakMap stores at most 64 root/profile results and 64 KiB of encoded
keys per identity. Keys include exact root file/hash, database/copy/folder and
all locator limits. Results contain only copied scalar totals. Identity state
is itself keyed weakly by scope, with no strong retained opening inventory.
No pending promises or partial results enter the memo. Complete verification
must drain, check cancellation and validate its captured lifetime before minting.

All full-verification failures retire their captured memo and conditionally
invalidate the captured decode epoch, preventing concurrent stale reminting.
Late failures cannot invalidate a successor scope. Closure, publication, scope
invalidation and decoder invalidation retire reuse. Closing metadata witnesses
are preserved; no receipt, history, union, ownership or publication checks are
removed. Hits still check abort, destination and phase validity. There is no
TTL, durable cache, cross-phase proof or global concurrency policy change.


## Matched synthetic CPU measurements

The benchmark now supplies deterministic financial-event IDs/times and storage
UUIDs through existing injection seams. It retains real hashing, elapsed time,
session IDs and lease clocks. The `open-save-v2-deterministic-corrections` label
separates these results from the older harness. This is a deterministic financial
and storage fixture, not a byte-identical entire process or a provider latency model.

Two interleaved control/candidate pairs used five prior invented edits, then one
new correction, with `FAST_SEED=1 PRIOR_EDITS=5 DELAY=0`. Each independently
reopened the exact saved ledger. All four runs had identical ledger hashes,
275 save / 272 open requests, request categories, file-kind counts, and transferred
byte totals. Peak request concurrency remained eight; save/open mutations stayed
at four/one. The control is the preceding published branch checkpoint.

| Operation | Control runs | Candidate runs | Mean change |
| --- | --- | --- | --- |
| Save | 7.123 / 6.783 s | 4.958 / 4.912 s | 6.953 to 4.935 s, about 29% |
| Open | 5.305 / 4.971 s | 4.069 / 4.186 s | 5.138 to 4.128 s, about 20% |

These are elapsed times from a CPU-focused, zero-artificial-delay harness, not
process CPU counters. They demonstrate less repeated work with retained history,
not fewer network requests. They do not establish live Drive latency or the 30-second target.
Earlier runs used random correction IDs/times; one control had 275 save requests
versus 280 in other runs. A delayed pair likewise had different save workloads.
Those comparisons are excluded from the improvement claim. Historical live-anchor
ratios have not been recalibrated from this CPU-only result.

## Validation and publication boundary

The extended suite passed 2096/2096 tests with zero failures, skips or cancellations
in 451.8 seconds on Node 24.22.1. After that run, one direct no-op iterator regression
and a source-comment clarification were added, with no executable production change.
All 14 dedicated memo tests then passed. This is not a claim of a 2097-test aggregate
rerun. Independent source review found no remaining blocker.

The added regression primes a complete result, changes an old body and its provider
version during a no-op input iterator, and permits the candidate root to return.
The real publication boundary must still reject the changed body before calling
the publisher. This verifies that a memo does not turn a candidate into authority.

Scope/decode invalidation, late predecessor failures, publication, pending closure,
cancellation, generic/no-scope fallback, key/profile changes, bounded eviction,
returned-value ownership and closing metadata witnesses have dedicated coverage.
Backup/history/receipt checks and older format readers are unchanged. No merge,
deployment, live acceptance or permission to use real financial data follows from
these measurements.
