# Owned first/final receipt audit experiment

Local experiment, not production acceptance. Long native read-only receipt audits
retain the first and final ownership→exact-manifest observation. Every intermediate
body, index, plan, receipt and disjoint-union check remains. Chains with zero, one
or two receipts retain their original guard counts. Generic/custom ownership paths
retain every original guard.

The first receipt finishes its original guard before the private bracket begins.
Only then can intermediate remote guards be deferred. The final guard must finish
before the chain returns to staging. Existing final inventory closure, mutation
dispatch checks, fixed-ID recovery and uncertain-write handling are unchanged.

This intentionally changes remote sampling and error timing for eligible native
long chains: a transient remote change that fully disappears between observations
may no longer be sampled. No server CAS, atomic listing, cached ownership authority
or TTL is assumed. Previously observed native loss invalidates the private lifetime,
including loss followed by same-session resume. Normal successful heartbeat does
not invalidate it; release waits for admitted writes before final invalidation.

Eligibility requires factory-owned session adapter, native coordinator/control-flow
and queue identity, known ownership wrapper, native physical read transport, and
unchanged binding/context. Private epoch bookkeeping does not change public
coordinator results. Custom factories and arbitrary guards do not acquire this
capability. Dynamic replacement during an active bracket fails closed.

The bracket checks native ownership and physical lifetime at receipt boundaries
and around its final guard. Existing per-read cancellation and scope checks are
unchanged; remote ownership is not re-observed on every read. Read-only work may
continue until the next boundary after loss, but cannot return success or enter
staging. The runner is bound to its original scope/phase and cannot invalidate a
successor. The explicit native ownership factory opts into these observations;
its online callback is an environment dependency, not a generic guard callback.

Focused tests cover short/long guard counts, generic guard counts, coordinator
loss/revalidation, native dispatch replacement, and successor isolation alongside
existing root/recovery/body/lifetime tests. No benchmark/full aggregate acceptance
or live Drive validation has been claimed.

Dynamic native control-flow eligibility is checked immediately before and after
the retained final guard, so a coordinator replacement detected at that boundary
cannot be invoked as the owner check. Transport callbacks may run during a
read-only receipt before a boundary detects replacement; this experiment does not
promise that arbitrary transport observers are never invoked. Such detection
still forbids successful audit return, staging, or publication.

Drainage is unchanged: existing tracked physical reads retain their existing
close behavior, and the application awaits the receipt audit before returning or
staging. The scoped runner is not registered as an additional whole-operation
pending read. Tests establish rejection before audit success after invalidation
or closing; they do not assert that close waits for every arbitrary runner
callback. Adding that guarantee would change reentrant-close liveness.
