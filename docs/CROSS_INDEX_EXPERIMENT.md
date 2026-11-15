# Bounded cross-index read experiment

Historical four-read experiment. Its lookup scheduling is retained in the
current eight-read candidate, which passed 2083/2083 aggregate tests at
`00cd939`. See [current bounds and evidence](OPEN_SAVE_PERFORMANCE.md).

The owned physical adapter's full locator verification reads the identities and
files indexes independently. This experiment overlaps those two lookups only
when fewer than three body verifications are pending. Three pending bodies use
the original serial index checks, retaining a combined maximum of four physical
reads. Generic providers remain entirely on their original serial path.

Both index reads settle before the entry's mapping is accepted or its body is
started. Errors remain fail-closed; the first substantive rejection is retained
instead of a sibling's resulting scope-expiration error. Both index bindings,
full traversal, hash/metadata checks and final scope closure remain mandatory.
No speculative traversal or broad node prefetch is introduced.

Seven focused regressions cover owned/generic overlap, corruption in either
index, cancellation, invalidation, drainage, and the combined four-read bound.
The benchmark uses the unchanged open/save synthetic harness at artificial
400 ms request delay. Two sequential runs of candidate `f839e834` completed:

| Operation | Run 1 | Run 2 | Fresh a0a9600 control |
| --- | ---: | ---: | ---: |
| Cold reopen | 37.914 s | 37.983 s | 39.293 s |
| Single save | 63.318 s | 63.553 s | 63.511 s |

Cold reopen improved by 1.379 and 1.310 seconds, above the 0.3-second
retention threshold and outside the preceding controls' 39.223–39.595-second
range. Save is effectively unchanged; no save benefit is claimed. Both runs
retained 144 reopen requests and 198 save requests, unchanged category counts,
a maximum of four concurrent requests, and exact reopened-ledger equality.
Raw logs are retained outside the repository as `cross-index-400-run1.log` and
`cross-index-400-run2.log` in the recovery workspace's logs directory.

The scheduling change was subsequently retained and passed combined validation.
These are synthetic fixed-latency measurements, not live Drive acceptance or
a demonstration of the 30-second Alpha target. No user data was accessed.
