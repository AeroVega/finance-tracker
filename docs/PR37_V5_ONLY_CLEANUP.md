# PR37 v5-only cleanup

## Scope

**User-confirmed, November 11, 2026:** the owner deleted the old synthetic test
folders and requested canonical v5 only, removal of migration and other unused
paths, and continued efficiency review. This changes compatibility deliberately.
It does not authorize real financial data, merging or deployment.

The baseline is PR37 commit `1dc79ca`. This cleanup:

- Removes canonical v1/v3 persistence, fragmented serialization, v4 builders and
  legacy-to-v5 migration creation. Active canonical roots, readers and writers now accept v5 only.
- Retains a read-only archived-evidence decoder for existing v5 copies originally
  created by legacy migration. It loads only for that provenance check, has no
  live-folder adapter or writer, and preserves full historical and copy-origin
  verification. Existing migrated-v5 copies remain editable and backupable.
- Removes unprofiled canonical4/protocol3 and explicit canonical4 archive support.
  Framed transport remains version 3 with `canonical5-physical4`.
- Preserves source/derived codec 2, locator catalog 3 and physical root protocol 4.
  Those are current v5 components, not older canonical layouts.
- Removes legacy migration/copy-guide controls. The remaining copy tool backs up,
  exports and restores v5, including source-offline provenance verification.
- Makes the raw CSV/sample preview strictly local. Its obsolete dashboard Drive
  save/clear/recovery controls are gone. The main canonical workspace remains the
  place to save synthetic data; preview rows are not transferred automatically.
- Removes dead profile selectors, compatibility dispatch and unreachable verifier
  branches. Session ownership, exact readback, retained-history audits, financial
  validation and recovery remain.

Older or unknown folders are refused, not converted, overwritten or deleted.
Source and destination read-only preflight validates folder admission. Source preflight also validates the complete initialization/physical envelope
and canonical head before its session is acquired. An archive without required
source evidence is refused before destination data preparation. The copy UI may
acquire a session in the new empty destination before parsing the selected archive;
this is not a promise of zero session-marker writes for a bad archive. Interrupted v5
initialization and publication retain their recovery paths.

## Measurements

**Verified:** the same benchmark script ran against isolated baseline `1dc79ca`
and the candidate, sequentially. Each used the 253-activity invented year, two
retained corrections, a cold-adapter reopen and a 768 MiB Node heap limit.
Both runs completed every exact-ledger assertion and ended with unchanged source
fingerprints. Other test workloads were active, so timing and memory are not an
isolated performance comparison.

Every phase had identical request counts and transferred bytes. Totals were
1,858 requests, 2,172,299 request bytes and 9,137,590 response bytes on each side.
Measured phase time was 24.742 seconds for baseline and 26.074 seconds for the
candidate. Process maximum RSS was 252,996 KiB and 254,788 KiB respectively.
These single-run observations do not establish a speed or memory improvement.
The result establishes unchanged synthetic storage traffic and verified behavior.

The eager static import closure rooted at `js/canonical-workspace.mjs` shrank
from 51 files and 909,839 raw source bytes to 49 files and 834,539 bytes: 75,300
fewer bytes, or 8.28%. Including optional dynamic imports, the complete reachable
closure remains 52 files but shrank from 911,089 to 877,047 bytes: 34,042 fewer
bytes, or 3.74%. The archived-evidence decoder and catalog archive verifier load
only when an existing migrated-v5 lineage needs them. These counts measure
source, not compressed network transfer or browser startup time.

The final measured candidate source fingerprint is
`ae951c44f02435c2868ae3f7b493f4b4f3fe338aaeb78216e7d6a6d2aa820045`.
The benchmark fingerprints JavaScript, prototype modules, test helpers and its
own source. Documentation and unrelated test files are outside that fingerprint.

The total tracked repository content is about 177 KB smaller, including the new
compressed evidence fixtures. The patch removes roughly 3,000 net lines.

## Test coverage

Financial review, refund/reversal, position, posting-status and category-rule
cases now use v5 fixtures. V4 compact-codec tests became v5 tests. Large Unicode,
metadata, ordered collections, optional position history and byte ownership
remain covered. Position-specific retained-root corruption/deletion and hidden
position metadata are explicitly tested.

Removed cases describe retired behavior: legacy serialization formats,
legacy migration creation, legacy copy-guide state, and their old benchmark metrics.
Existing migration-origin v5 provenance remains covered separately. Its golden
synthetic archived-evidence fixtures add 40,335 compressed bytes. A separate
manual check also opened actual baseline-produced migrated-v5 physical folders
from both old layouts, saved an ordinary correction, exported and restored
source-offline with exact ledger equality.
Shared protections remain on v5: every durable mutation interruption,
source/target identity, stale metadata, publication/readback, cancellation,
retained provenance, source-offline file restore and independent reopen.
The generic catalog/physical protocol tests remain where they test a distinct
lower-level contract rather than an obsolete canonical layout.

Request budgets were remeasured where tests previously exercised fragmented v3.
The import recipe used 1,432 requests within its retained 2,300 ceiling. Ten small
v5 save/reopen samples grew from 253 to 388 requests. Six full-year saves used
285–337 requests. These are v5 regression baselines, not claims that the old v3
request budgets were preserved or that either format was faster.

## Verification and limits

**Verified November 12, 2026:** the complete extended Node suite passed 1,906/1,906
checks, with zero failures, skips or cancellations, in 589.662 seconds:

```sh
FINANCE_EXTENDED_STORAGE_TESTS=1 node --max-old-space-size=768 --test --test-concurrency=1 tests/*.test.mjs
```

All runtime JavaScript syntax checks and documentation links passed. Local
runtime is Node v24.22.1; CI is configured for Node 26. Independent review found
and fixed the source-envelope and destination-admission gaps described above;
the final read-only provenance review found no blocking regression.

No live Drive, OAuth, physical mobile/browser acceptance, merge or deployment was
performed. Full ledger/history materialization and semantic validation remain.
This cleanup does not complete bounded-memory loading, incremental financial
validation, or production readiness.
