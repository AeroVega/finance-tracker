# Experimental incremental native save

Integrated, unmerged PR46 candidate, reconciled with its successful-action and request-purpose diagnostics. No storage format change or deployment. The owner approved the historical-verification tradeoff below for this candidate; local validation is not live acceptance.

A completed full open audits retained history. A private application baseline can then authorize a native canonical save to defer rehashing historical-only payloads and replaying old receipt/semantic ancestry. Routine physical verification scopes do not erase that historical audit fact, but it is not fresh evidence about unchanged historical bytes. Historical-only corruption may be discovered only by the next full open, explicit full verification or recovery.

Every save still checks all locator page hashes and three-index structure/membership, exact unchanged mappings and additions, current financial state, new transition and staged evidence. Current dependencies remain fully verified even if their objects are old. The incremental path deliberately bypasses the ordinary semantic memo so required postpublication reads reenroll current dependencies after phase rotation. Authority publications, exact root/owner guards, readbacks, metadata closure and unknown-outcome recovery are unchanged.

The capability is private to an actual native canonical preparation callback, owned application engine, exact loaded manifest and live native ownership epoch. It is seeded only after a full snapshot closes successfully and promoted only after successful save closure, final exact readback and ownership checks. Failed or unknown operations, recovery, ownership loss/reacquisition, changed composition and changed base cannot reuse it. Generic/custom preparation and source-evidence copies keep complete verification. No historical records are deleted, no rollback occurs automatically, and recovery always uses the full path.

The structural-only locator path must never populate or satisfy the complete-body verification cache. Its byte totals describe catalog bytes, not all retained payloads. Independent source review, fault tests and actual old-source compatibility passed for the integrated candidate. Remote CI and live acceptance remain separate gates.

## Single-current-audit refinement

The reduced native path omits only the second current-state materialization at fresh transact entry. The earlier baseline current-state audit remains. Transact still checks exact base, native ownership, locator structure and preflight; the mandatory prepublication candidate audit independently reads both exact base and candidate financial states and checks their transition. Postpublication current/candidate audit and closure remain uncached. No cross-phase result cache is introduced.

Corruption introduced after baseline/preparation may therefore be detected after additional immutable objects are staged. Those objects are unreachable orphans; the failed prepublication audit must permit zero authority publications. Corruption after the first publication must refuse finalization and leave the existing published recovery marker. Generic/custom and recovery paths retain their prior full verification sequence.

## Current-snapshot-only baseline refinement

Within a genuine incremental baseline, the selected current snapshot is fully materialized and audited using the existing `readVerifiedPartitionedLedger` source, derived-data and financial checks. Exact typed head, database, revision, root, semantic profile and genesis/operation constraints remain. The previous snapshot and previous→current transition are historical work and are no longer reread at this baseline step. Corruption limited to that predecessor can be deferred until the next full audit, as approved for historical-only content.

The new current→candidate transition remains fully audited before and after publication. Data shared with the current snapshot is still a current dependency regardless of age. A current migration-origin genesis uses the original full semantic verifier; source-evidence, generic, full-open and recovery paths remain unchanged. This is a narrow audit-policy change, not a root-only decode or a cache shortcut.

## Lifecycle and cache acceptance oracles

Dedicated tests exercise an unknown durable publication followed by full recovery, historical corruption rejection, and a required full reopen before reduced saves resume. A same-session ownership resume cannot revive an interrupted save: the lifecycle requires recovery and the failed store has no reusable verified base. These are supported-lifecycle non-reuse assertions, not claims of inspecting every private certificate object.

A structural-only verification is followed, on the same physical adapter, scope and root, by an ordinary full-body verifier. The latter must fetch and reject a corrupted historical body. Structural success therefore cannot stand in for complete-body verification.

Synthetic measurements remain mixed: current-only baseline improves retained-history CPU work, but the bounded first-save sample regressed. No claim is made that save cost stops growing or that live operations meet30seconds. Full history still runs at open/recovery; historical-only corruption may intentionally be discovered later than a routine save.


## Integrated validation

Runtime/test commit `dd4143389731b18703678eb16a8909c2c9317a8a` reconciles the
preserved redesign with diagnostics head `314c384`. Its complete extended gate
passed **2,237/2,237 tests**, with zero failures or skips. Actual unchanged
`f183cdccc9a9710e29a0da6df9f615940de19334` source executed the compatibility gate.
Independent review compared both parents: private baseline and invalidation state
remain intact, while diagnostic success is still recorded only after required
closure, final readback and ownership checks. An integration regression exercises
actual incremental capture, native publication counts, bounded purpose metrics,
detached observations and no success-summary overwrite after a failed save.

The native-publication fault loader now targets its specific method rather than
an earlier similarly shaped incremental helper. This preserves the intended
fault boundary; it is not a relaxation of the recovery assertions. Documentation
updates after the named commit do not change its runtime or test tree.

Previously measured retained-history improvements remain synthetic evidence,
not a guarantee for this integrated build or a live latency target. The first-save
sample was mixed and included a regression. Full open and recovery still perform
the historical audit; routine native saves may intentionally defer corruption
limited to historical-only data. No deployment, merge or successful live test is
claimed here.
