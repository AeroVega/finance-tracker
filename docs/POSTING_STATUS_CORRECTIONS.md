# Posting-status corrections

## Scope

**User-confirmed, November 11, 2026:** fix the app's synthetic review flow where
"Posting status unknown" could not be resolved. This implements the editor in
the main workspace. It does not change the invented seed, provider parsing,
production restrictions or deployment.

## App workflow

1. Inspect an activity. Unknown status selects **Posting status** in the
   correction editor. Other activities expose it under **What needs changing?**
2. Choose **Posted**, **Pending** or **Unknown**. Posted requires an explicit
   calendar posting date. The app does not guess one from the transaction date.
3. Explain the evidence in the rationale field, then **Stage correction**.
   Inspect the prior and new status/date in Correction history.
4. Resolve any remaining classification or other review reasons. Posting alone
   does not classify an investment activity, reconcile coverage or prove a
   balance. Pending activities remain excluded from totals.
5. **Save changes**, then reopen to verify. Local preview, staged undo/revert,
   uncertainty handling and storage ownership checks remain unchanged.

Original activity and observation records remain unchanged. This event records
user confirmation separately from provider evidence. Ordinary activities retain
their effective transaction month. Refund reporting uses the confirmed posting
date, so changing that date can move the refund between monthly reports. Choosing
Pending or Unknown clears the effective posting date, not the retained source.

## Event contract

`posting-status-correction` uses the existing immutable event metadata and
command-signature/idempotency rules. It adds:

- `priorValues`: exactly `lifecycleStatus` and `postedDate`, matching the replay
  state immediately before the event.
- `proposedValues`: exactly those two fields. The status is `posted`, `pending`
  or `unknown`. Posted requires a real `YYYY-MM-DD` date; the other two require
  `null`.
- `evidence`: an object with a nonblank string `rationale`.

The event must change at least one field. It changes no amount, classification,
effective date, settlement date, account or original source evidence. Both
command preparation and persisted-history validation enforce the contract.
Command retries with identical content do not append another event. Reordered
history, stale prior values and extra prior/proposed fields are rejected.

A previously source-backed pending-to-posted event remains valid and immutable.
The new correction can follow it without changing its effective/settlement dates.
After a manual correction, conflicting known source status is reviewed rather
than automatically overriding the correction. Matching source identity preserves
the manual status; accepting a different status requires another explicit posting
correction. Identical-file re-import remains a no-op. Agreeing source evidence
can still match, and conflicting posted dates retain the existing review path.

## Storage compatibility

The active per-record v1 and fragmented-v3 storage layouts preserve these events
and their history through save/reopen. This is not a v4 migration. Existing
ledgers without this event remain readable. After saving a posting correction,
use the updated app: older builds reject the unfamiliar event instead of
silently ignoring it. Preserve the original copy before experimenting with an
older build.

The separate bounded-audit prototypes must support the new status change before
they can adopt such a ledger. Their status projection must not overwrite the
unchanged effective and settlement dates. They remain outside the active app.

## Verification

Tests cover command and persisted-event validation, retries and rollback,
source preservation, status/date replay, remaining review reasons, exact period
and monthly-index totals, source re-import/review, both supported storage layouts,
staged undo/revert, and the actual workspace controller's controls and navigation.
All fixtures are invented. DOM tests do not establish rendered Safari behavior,
real Google timing or live-device acceptance.

**Verified compatibility check:** the unchanged validator from deployed commit
`5e9c8966ddda10161f18d5483ff579a8a09e534a` accepts the original invented
fixture and rejects its corrected ledger with `unsupported-persisted-event`.
The updated validator accepts both. The unchanged physical v3 label does not
imply compatibility with old application event readers.
