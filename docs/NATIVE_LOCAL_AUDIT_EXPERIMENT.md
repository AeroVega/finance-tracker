# Native local read-audit guard experiment

Part of the integrated, unmerged incremental-save candidate, based on the native two-publication implementation. See [integrated validation](EXPERIMENTAL_INCREMENTAL_SAVE.md#integrated-validation) for its exact test attribution. No
format changes, heartbeat removal, provider CAS assumption or content-check shortcut.

The initial clean-base remote ownership and exact-manifest observation remains.
The complete initial history audit must establish owned semantic callbacks, and
the supplied preparation reader must have genuine internal provenance. Only then
can the fresh native transaction create its private read-audit policy. Generic,
custom, restored/source-evidence, existing-pending recovery, prepare and public
open/read paths retain their original observations.

The policy pins the exact expected manifest, application operation, sticky native
ownership lifetime and physical phase. Candidate and retained-receipt audits use
local checks at their existing boundaries while retaining every body hash, tree,
index, union, history, domain, receipt and metadata-closure check. A successful
own published write and exact readback are the only callsite allowed to refresh
the physical phase and expected manifest. Ownership lifetime is never refreshed.

Every actual authority dispatch/retry still uses the unchanged full remote
ownership→exact-manifest guard. A full remote guard also runs after finalization
before returning success, followed by the existing application closure checks.
Failures after final dispatch remain uncertain/recovery-required, never success.

This deliberately reduces remote observations during read-only audits. An external
owner or root change that has not yet been observed locally can permit additional
reads or unreachable immutable staging before the decisive publication guard
rejects. Already observed loss, cancellation, revalidation, transport replacement
or physical invalidation cannot revive the old operation. No successful result
or authoritative publication is allowed past a failed retained boundary.

The first-save benefit is smaller than a naive audit count: it has no retained
receipt chain and the final full guard offsets one omitted observation. Count
actual removed guards and requests before measuring latency; no live target is
claimed from a source-derived estimate.
