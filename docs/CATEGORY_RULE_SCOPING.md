# Category-rule scope and storage

## Behavior

A category correction changes its target and creates a prospective exact-match rule. Existing peers keep their categories; matching activities created by later imports can inherit the rule, even when their financial dates are earlier. A linked refund can separately inherit the effective category of its original purchase until explicitly overridden.

**Implemented:** each new rule stores only existing activity IDs that match its account, institution, currency, normalized description and source action. Matching inactive activities are included. Other activities cannot enter this scope later because their matching fields are immutable in this engine. Bank corrections preserve currency; lifecycle changes affect dates/status; classifications and refunds do not rewrite source matching fields.

A blank normalized description, or blank source-description fallback, disables the future rule. Its inventory contains only the correction target required by the existing version-1 validation contract.

Existing version-1 rules containing all activity IDs remain valid, and their original bytes are not rewritten. The rule format, membership validation, canonical storage checks, size cap, transaction protocol and recovery checks are unchanged. Category projection checks the key before searching membership. Ordinary key fields compare directly; accepted structured JSON values retain the previous canonical-JSON equality behavior.

## Evidence

**Verified with invented data on Node 24.22.1, Linux x64:** the benchmark compares committed `c41448b` with the scoped-rule implementation. Four corrections on a ledger of 1,000 distinct activities shrink from 158,821 to 2,977 bytes of canonical event JSON, a 98.1% reduction. The former payload fails the 128 KiB chunk cap; the new payload packs successfully with the cap unchanged.

For the actual synthetic year, one utility correction stores 12 matching IDs instead of all 253. With the benchmark command and metadata, the event shrinks from 10,593 to 1,194 bytes, an 88.7% reduction. Financial subtotals remain equal.

Run `node tests/benchmark-category-rules.mjs --baseline-ref=c41448b` to reproduce sizes and three-call median projection timings. The optional baseline is loaded from local Git history; neither the benchmark nor its fixtures contact Drive or another network service. Timings are local CPU measurements, not browser responsiveness or Google latency promises.

Focused regression coverage includes:

- Existing exact-key peers, other accounts, currencies, descriptions and source actions.
- Blank descriptions and normalized-description fallback.
- Inactive retained peers and later backdated imports.
- Bank corrections, pending-to-posted transitions, and inherited or explicitly overridden refund categories.
- Mixed legacy and scoped rules, JSON roundtrips, packed save/reopen, archive verification and fresh-copy restore.
- Refusal to rewrite a saved legacy event and the unchanged size refusal for dense same-key history.
- Avoiding membership-array searches for unrelated keys, including old full-ledger inventories.

## Limits and future work

**Open:** membership still grows with the number of historical activities in one exact scope. Four corrections with 1,000 same-key peers still exceed the fixed chunk cap. This is a compatible reduction of irrelevant membership, not a constant-size rule representation.

An immutable activity-creation sequence and one applicability boundary per rule could remove that remaining growth. That needs an explicit versioned contract across imports, retained inactive activities, backup/restore and existing events. Transaction dates, wall-clock timestamps and freely mutable array positions are not equivalent boundaries. No such migration is part of this change.

The wider event engine still replays earlier event prefixes during validation and scans events per activity. Import reconciliation and retained storage history have separate scaling costs. This change does not claim to solve them.

All work remains synthetic-only. Production persistence is NO-GO. Live Google/device acceptance, merging and deployment are separate actions.


## Explicit fragmented storage option

**Implemented, synthetic-only:** fresh copies may now opt into [version-3 fragmented canonical storage](FRAGMENTED_CANONICAL_STORAGE.md). It preserves exact logical records while splitting oversized inventories and the logical index into bounded physical objects. The version-2 limits described above remain unchanged for existing copies. No implicit migration occurs. See the linked format, limits and verification record before choosing it.
