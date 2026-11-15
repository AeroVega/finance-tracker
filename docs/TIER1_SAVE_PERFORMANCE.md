# Tier1 bounded save-performance candidate

This branch starts from merged PR44 (`5dcaabb`) and carries only the previously
validated runtime from preservation head `5ad8abe`. Its JavaScript runtime is
byte-identical to that head. Tier0 benchmark corrections remain present.

## Included

- Avoid redundant private metadata/decoded-result copies while preserving detached
  outward values, bounds, hashes and lifetime checks.
- For genuinely native read-only retained-receipt chains, retain the first and
  final ownership/exact-manifest observations while checking every receipt, body,
  index, plan and disjoint union. Short chains and generic callback paths remain
  unchanged. See [the exact observation contract](OWNED_RECEIPT_AUDIT.md).
- Increase only the owned immutable preparation probe/write batch from four to
  eight. All probes drain before writes, issued writes drain before continuation,
  and authoritative manifest updates remain serial. See [staging tradeoffs](OWNED_STAGE_WIDTH8.md).

No format migration, provider permission change, persistent cache, single-publication
protocol, closed-phase structural certificate or body-fact transfer is included.

## Evidence and limits

The preserved runtime passed 2,138/2,138 extended synthetic tests with zero failures
or skips, static checks and independent source reviews. The integration with PR44 passed 2,145/2,145 extended tests at `1afa62f`, with
zero failures or skips, plus syntax, registered-error, generated-reference and
documentation checks. The subsequent update only records this evidence in docs;
runtime and tests are unchanged. Exact-head remote CI remains a separate gate.

Controlled synthetic observations, not live predictions:

- Native receipt bracketing: one retained-revision-8 pair at 120 ms artificial
  request delay changed 40.643 s / 327 requests to 29.686 s / 243 requests. The
  84 removed requests were 42 ownership listings and 42 manifest metadata reads;
  content and mutation request counts were unchanged. Initial short-chain save
  request counts were unchanged.
- Wider staging, incremental to receipt bracketing: one 120 ms pair changed R8
  30.296 to 29.904 s and dense initial save 40.842 to 40.085 s, with unchanged
  request counts and matching final financial hashes/reopen results.
- Isolated reversed staging pairs showed a repeatable stage reduction, but the
  standard whole-save gain was noisy. Do not treat a single pair as a guaranteed
  provider speedup or achievement of the 30-second Alpha goal.

The native receipt contract intentionally changes remote sampling and error timing:
a transient remote change that disappears between retained observations may no
longer be sampled. Previously observed native loss invalidates the operation.
This is not continuous ownership, atomic listing or server compare-and-swap.
Every existing final inventory, mutation guard and uncertain-write recovery remains.

Eight-way staging permits up to eight simultaneous immutable creates instead of
four, with more possible orphan objects after interruption and twice the raw batch
body exposure. This is not a browser heap bound or a promise about provider throttling.

## Synthetic deployment acceptance

Use an explicitly identified deployed source SHA and a fresh empty synthetic copy.
Preserve all earlier unresolved folders. Load a deliberately invented one-year
fixture, stage one edit, save once, release, then independently reopen and confirm
that edit. Record load/save/release/reopen durations and the build SHA. Do not retry
an uncertain save blindly or infer recovery acceptance from one happy path.

Deployment, exact served-asset identity, live provider latency, mobile Safari and
real-data use are separate gates. Production financial-data persistence remains
NO-GO. This document does not authorize merging, deployment or private-data access.
