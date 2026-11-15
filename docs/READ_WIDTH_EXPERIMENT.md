# Read-width-eight experiment

Selected for the performance branch after local aggregate validation; not deployed. Only owned physical
body verification and read-only planned-ID preflight increase from four to eight.
These bounds apply per invocation, not globally across concurrent invocations.
The body/index admission policy permits two index reads only below seven pending
body tasks. Generic adapters remain serial. All immutable writes and owned
preparation stage probes remain at four. No proof, inventory, publication, or
retry behavior changes.

Tests exercise at least sixteen bodies, exact eight-read admission, combined
index/body bound, corruption, cancellation, invalidation, HTTP 429 propagation,
no next batch after failure, and complete drainage. Preflight tests require at
least sixteen distinct planned IDs on success and exactly eight on failure.

## Measurement method and completed results

Timing used identical synthetic fixtures in sequential width-four, width-six
and width-eight runs at artificial 400 ms request latency, two runs per width.
The width-four control was measured earlier in the same session, not interleaved
with each later width. Request totals and exact independent reopen assertions
were unchanged. Save/open durations are reported separately; the proxy omits
real provider/browser scheduling and is not live acceptance.

Memory profiling was separate from timing, using fresh Node processes and an
interleaved four/eight/four/eight order. It sampled whole-process heap, external,
ArrayBuffer and RSS values, not phase-specific or pre-operation allocation.
Sampling can miss short peaks, and Node memory does not establish Safari memory.
The observed ranges and limitations are recorded below.

Eight versus four admits four additional raw bodies, at most 256 KiB at 64 KiB per
body. This is NOT a total additional heap bound: response buffers, defensive
copies, hashing, metadata, and retained caches add overhead. Retain unchanged
cache budgets. Do not infer bounded whole-ledger memory from this experiment.


### Selected width-eight result

Source `25ef336` measured save 58.206/58.195 seconds and cold reopen
35.050/34.793 seconds at artificial 400 ms latency. Width-six open was
36.040/36.110; width-four open was 37.997/38.215. All runs made 198 save and
144 reopen requests and asserted exact reopened graph equality. Width eight
passed aggregate validation in integrated code `00cd939` (2083/2083 tests);
no write-width increase is included. See [the full report](OPEN_SAVE_PERFORMANCE.md).

Separate Node 24.22.1 memory runs used fresh processes, DELAY=0, 5 ms sampling,
no forced GC and the whole initialize/seed/save/reopen workload. Order was
four/eight/four/eight. Sampled peak heap was 84,362,240/80,452,768 bytes for
four and 82,608,784/84,543,896 for eight. Sampled RSS peaks were
254,767,104/255,397,888 and 255,909,888/246,079,488 respectively. External and
ArrayBuffer peaks showed no conspicuous increase either. These small samples
show no obvious memory regression, not a precise allocation delta or a browser
memory guarantee. GC variation and sampling can hide short peaks; DELAY=0 does
not model network buffer lifetimes. Timing comparisons were separate and
uninstrumented. Four additional admitted 64-KiB bodies allow up to 256 KiB more
raw body capacity; defensive copies/cache mean this is not a total heap bound.
