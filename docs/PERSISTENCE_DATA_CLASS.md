# Persistence data-class boundary

The active route remains synthetic-only. The shared
[header discriminator](../js/persistence-data-class.mjs) separates existing
synthetic records from a proposed future production header. Header recognition
does not decode a production record, prove data provenance, verify approval,
or authorize any use of real data.

| Artifact | Active synthetic header | Inactive production-header placeholder |
| --- | --- | --- |
| Canonical ledger | Versions 1 and 2 with `syntheticOnly: true` | Version 3 with `dataClass: "production"` |
| Full-snapshot manifest | Version 1 with `syntheticOnly: true` | Version 2 with `dataClass: "production"` |
| Portable backup envelope | Version 1 with `syntheticOnly: true` | Version 2 with `dataClass: "production"` |

Existing synthetic writers still emit the same headers. Mixed markers,
missing markers and unknown versions are rejected. The active validator,
storage engine and backup codec continue to require the synthetic class;
they have no production codec or fallback. A correctly checksummed backup
does not override the inner ledger's class. Explicit Open now reads and validates the candidate manifest before changing
its session marker or releasing another session. After acquiring ownership,
it rechecks the same manifest ID and canonical contents before making
financial data available or finalizing recovery. A concurrent change after
preflight can still cause refusal after a session-marker write. An
admission-only refusal releases a newly confirmed claim using normal
readback; it never releases an older claim or clears a prior unresolved
save. If the new release cannot be verified, it stops renewal rather than
claiming success. This is not atomic admission or a complete ancestry check
before claim. Independent cold restore verification repeats the private-folder
proof and read-only manifest check before releasing or acquiring ownership.

## Before a production route is considered

- Settle the future versions and exact schemas together. Bind the class and
  database/copy identity across historical commits, pending manifests,
  recovery, archive headers and the decrypted payload. Authenticate new
  archive metadata. In particular, this change does not define a production
  commit envelope or allow a synthetic record to be relabelled.
- Extend read-only pre-admission checks for prospective production folders before
  opening records, writing a session marker, or releasing another session.
  Use the exact verified Google account and folder, not their names. Keep
  workspace, CSV/historical import, and restore routes fail-closed across
  classes. A marker does not prove a file is actually invented or private.
- Separate synthetic candidate acceptance from activation. Follow the
  [security review](SECURITY_PRIVACY_OAUTH_COST_RECOVERY_REVIEW.md)
  for exact served-build, account, folder, privacy, backup and cost evidence.
  A public page URL, browser setting, build label, or embedded identifier
  cannot authenticate approval. No runtime activation switch is introduced.

## Detached v2/v3 proof (fixture only)

The [prospective snapshot codec](../js/prospective-production-snapshot.mjs)
is an early hash-only fixture, not a second durable provider format.
It exercises only clean manifests with invented records. Each fixture commit binds
production class, v3 ledger profile, database and copy identity, the previous
manifest and parent commit, and the exact canonical snapshot. The verifier
replays the complete bounded chain with existing ledger transition rules.
A detached v2 archive uses the encrypted branch of the backup codec: its
class and version are authenticated header fields, and inner validation
requires matching v2 envelope and v3 ledger. A verified restore creates a
fresh copy lineage while preserving the logical ledger. Synthetic v1
archives retain the existing optional encryption and are not accepted by
the detached v2 decoder.

The 128-frame and 64 MiB aggregate verification limits are checkpoint
limits, not proposed Drive capacity. The prototype intentionally excludes
provider publication, pending recovery, browser/destination wiring and
activation. The encrypted-only detached export is not an owner decision to
permanently require encryption for all future production backups. No app
entry point reads, writes, or converts a production ledger today.


## Native provider simulation

The native storage engine's closed simulation profile is the prospective
provider design. It uses the existing immutable Drive references, exact
readback, session ownership, pending-publication and recovery paths. It emits
v2 manifests and commits with explicit production class and binds the v3
ledger validation profile. V2 witnesses require one exact parent for manifest,
commit and snapshot; the existing v1 immutable-object compatibility path is
unchanged. Fixture-only hashes use different type IDs and cannot be opened
as native provider records. It does not change the v1 synthetic factory or
the deployed app's synthetic-only folder admission.

The isolated simulation factory runs only in Node's test runner with an
injected fixture transport and a fixed invented token; it is not called by
the browser app and accepts no production token, authorization input or
transport default. The simulation verifies pending-publication recovery,
independent reopen and fresh-lineage restore with invented records. It does
not establish live provider behavior or grant permission to use real data.
Before any app wiring, verify exact release-artifact approval and provider
account/folder admission; never use the test-runner check as an authorization policy.
