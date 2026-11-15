# Native clean → published → clean experiment

Status: isolated experimental design from main f183. Not adopted, published or deployed. No real financial inputs or Drive access.

## Proposed state transition

For the genuine native canonical fresh-save path only:

1. Verify the exact clean base, retained history and receipt chain; validate preparation and stage every immutable body and catalog as today.
2. Create the existing immutable transaction receipt while authority still equals the clean base.
3. Verify the receipt and complete candidate: all body hashes/indexes, exact disjoint union, semantic history/domain and retained receipts. Close full metadata evidence and check fresh ownership→exact base immediately before publication.
4. Publish the EXISTING `published` manifest shape directly. It selects the new logical root and retains the full pending intent, candidate and receipt.
5. Enter unchanged published recovery/finalization: revalidate staged bytes, receipt and full candidate against published authority, then write exact clean final.

This removes the native fresh path's durable `admitted` and `ready` writes. It does not remove those states from format validation or recovery. Custom/standalone providers, custom verifiers and existing pending transactions keep their original path. No compare-and-swap or atomic owner claim is introduced.

## Evidence and recovery obligations

The first authoritative update still follows durable verified candidate bytes. Its published payload contains all information the old published recovery path already consumes. Recovery does not require a previous physical admitted/ready transition or the local preparation store once published is selected. This must be tested using the unchanged main implementation, not inferred only from new code.

Before first authority publication, interruption leaves the exact old clean root plus unreachable immutable artifacts. Existing prestaging already permits this class of outcome; moving receipt creation earlier extends that pre-intent window. It does NOT authorize recovery to finish an unannounced user edit from orphan files. Preserve all such files.

After the first authority update, the existing published quarantine marker remains until full postpublication validation succeeds. A corruption/lost-ownership failure during finalization leaves published, not a newly clean-but-unvalidated result. The final clean write retains the existing uncertainty and postwrite application closure behavior. No stronger continuous clean-content guarantee is claimed.

Lost first publication response: never assume failure means not applied. Retire the failed scope; recover independently from exact clean base or exact published/final evidence after outstanding mutations settle. Conflicting/malformed states stop. A delayed old write cannot authorize a new operation; preserve existing operation/session fences and no-CAS limitations.

## Native eligibility

The fast path requires the exact factory-created canonical verifier and genuine native ownership, physical transport and application operation provenance. It is not enabled by a caller flag. Native method/epoch/operation checks surround the changed sequence; known loss cannot fall back into the old path to revive authority. Generic callbacks retain their existing phase calls and ordering.

## Acceptance tests before measurement

- Exactly two manifest PATCHes on eligible fresh save; old fallback still four.
- Same final logical state, immutable receipt bindings and successful warm/cold reopen.
- Native eligibility cannot transfer to wrapped/replaced verifiers or custom transports/owners.
- Crash before/after every immutable and authority mutation; first authority shape is published; recovery has no preparation-store dependency after that point.
- Lost response, cancellation, conflicting owner/root, late mutation completion and no speculative rollback.
- Corruption of receipt/plan/body/index during first authority update leaves published and cannot return success.
- Actual unchanged main code recovers direct published and reads final; new code still recovers older admitted/ready/published fixtures.
- All original full structural, semantic, metadata closure and final-guard checks remain at the retained boundaries.

Source ceiling: removes two publication wrappers and two repeated candidate audits on the eligible fresh path. Nested spans cannot be summed as independent savings. Measure representative input first; no30-second/live claim.

### Historical callback eligibility and resumed pending writes

The initial complete history audit returns an uncached eligibility boolean. Every
retained portable semantic callback must be factory-owned; any version-specific
lineage callback or source-evidence callback declines the short path. All existing
history checks and commit counts still run. Declining this optimization does not
revive a retired native epoch: when an invocation captured native ownership, every
publication in the older admitted/ready/published route is fenced too.

The mixed-history test uses a loader-only invented genesis profile and compatibility
alias. The production canonical verifier currently rejects a different parent
semantic profile. The fixture exercises conservative fallback if such a compatible
historical extension is introduced; it does not claim production supports that
invented format. The same fixture exercises epoch retirement followed by native
same-session revalidation at admitted and ready boundaries.

## Local validation evidence

The corrected implementation passed the full extended Node gate: **2,188 tests,
zero failures and zero skips**. The gate explicitly supplied the pinned clean
`f183cdccc9a9710e29a0da6df9f615940de19334` checkout; its unchanged recovery and
reader code recovered directly published invented bytes without preparation.
CI checks out that exact baseline and supplies it to the complete suite. Extended
validation fails if the baseline is absent, rather than silently skipping compatibility.

The first aggregate exposed an initial eligibility regression: custom adapter or
ownership wrappers installed before admission were rejected instead of selecting
the original path. That was corrected before the passing gate. Initial unavailable
provenance declines optimization; loss or replacement after native capture still
rejects. Tests now run both native and generic mutation-crash and issued-operation
matrices. They retain old admitted/ready coverage and test native published
quarantine, root conflict, durable-receipt interruption, body/plan/receipt/catalog
and index corruption, lost replies, and obsolete continuations.

Controlled synthetic measurements used a fixed 120 ms provider delay, not live
Drive. Standard seed was 19.633→15.395 seconds; first correction 17.314→12.615;
three retained corrections 20.811→14.941; eight 28.375→20.733. These standard
comparisons are single pairs. Dense first-save reversed pairs averaged
38.834→32.545 seconds (16.2% lower), still above 30 seconds. All measured financial
outputs and warm/cold reopens matched. Fresh native authority writes fell from
four to two; immutable create counts were unchanged. No live-device latency or
mobile-memory claim follows from these figures.

Measurement preceded the initial generic-eligibility correction; that correction
changes only whether unavailable provenance selects the unchanged original path,
not the measured eligible native sequence. Adoption and publication remain separate
from these local results.
