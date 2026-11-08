# Original Source File Retention

**Current implementation status:** Synthetic acceptance path implemented; owner-reported live retention/deletion rehearsal passed on 2026-11-04.
**Production status:** Production CSV upload/retention is not enabled or authorized.

## Purpose and separation from the financial ledger

Original uploaded source bytes are retained separately from immutable financial history so expiry can actually remove the original file without rewriting canonical ledger commits. Retention metadata is linked to a completed import and is separate from import processing status.

The current acceptance path can generate and retain an invented original. Real financial CSV imports remain local to the browser and are not uploaded by the synthetic dashboard.

## Retention policy

The selected retention period is **540 days (18 months)**. Reaching exactly day 540 makes an original eligible for deletion; it does not guarantee deletion at that instant.

The static application performs maintenance on connection and hourly while a page is open with a verified session. It cannot run while all devices are closed. Consequently, actual deletion may occur after the eligibility boundary.

## Safe deletion requirements

An original is eligible for deletion only after its exact import identity, source hash, object kind, and folder are checked. Deletion must be confirmed by the provider, followed by absence verification under the same authorization and folder context, before its locator is cleared.

A bare HTTP 404, changed token, lost grant, permission failure, or other provider error does not prove deletion. Failed eligible deletions preserve the locator, record the failure/attempt, and remain retryable. Backup metadata preserves the original retention timestamp and expiry; backup/restore does not restart the clock.

Backups and portable archives omit originals that have expired or whose deletion is confirmed. Restore includes only originals still unexpired at restore time. Import provenance/status is preserved even when original bytes are omitted.

## Known residual limitation: interrupted deletion receipt

A process loss after provider deletion but before the durable metadata update can lose the in-memory deletion receipt. On the next page, the app conservatively preserves the old locator and records a retryable failure; it does not infer deletion from an access-ambiguous 404.

This means owner inspection/provider evidence may be required to reconcile that case. Autonomous recovery from every possible interruption in the deletion window is **not established**. Do not describe this path as fully autonomous production deletion.

## Acceptance evidence (owner-reported, 2026-11-04)

Using invented source data, the owner reported:
- An original was uploaded, hash-verified, and linked to a completed synthetic import.
- The retention boundary was checked: one millisecond before day 540 remained ineligible.
- Expired invented originals were deleted and absence was verified through Drive.
- Import status and timing were preserved after original deletion.

These are owner-reported observations, not independent telemetry or CI assertions. Automated tests cover retention state transitions and fault cases separately.

## Constraints

- Real CSV imports remain local-only; production original-source upload/deletion is not enabled.
- Never commit real source files, account identifiers, credentials, tokens, or private Drive file/folder IDs.
- Local exported originals cannot be remotely erased by this static application. The owner remains responsible for private copies and their expiry.
