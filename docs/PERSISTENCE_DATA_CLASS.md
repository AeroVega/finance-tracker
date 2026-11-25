# Persistence data class and release gate

**Status (2026-11-24):** implemented and tested with invented
data in Node simulation. The shipped [release profile](../js/release-profile.mjs)
lists `synthetic` and `production`; the owner's GO for real financial data takes
effect on merge of PR 61 (see [current state](CURRENT_STATE.md#owner-decision-go-for-real-financial-data)).
The UI defaults to synthetic and offers the private-database class. See the
[archived owner checklist](archive/OWNER_ACCEPTANCE_2026-11-24.md).

## Two classes, one per session

| Artifact | Synthetic header | Production header |
| --- | --- | --- |
| Canonical ledger | Versions 1 and 2 with `syntheticOnly: true` | Version 3 with `dataClass: "production"` |
| Full-snapshot manifest | Version 1 with `syntheticOnly: true` | Version 2 with `dataClass: "production"` |
| Commit envelope | Version 1, profile `canonical-ledger-full-v1` | Version 2, profile `canonical-ledger-production-v3`, `dataClass: "production"` |
| Portable backup | Version 1, plaintext or encrypted | Version 2, **encrypted only** |

The [header discriminator](../js/persistence-data-class.mjs) recognizes exactly
these headers. Mixed markers, missing markers and unknown versions are refused.
A header does not prove that data is invented or real, and it authorizes nothing.

A session has exactly one class, chosen before connection and fixed until
verified release. The class is threaded through the
[storage engine](../js/full-snapshot-storage.mjs) (manifest, envelope and
snapshot validation), the [application](../js/full-snapshot-application.mjs),
the [Drive/Picker bridge](../js/dashboard-synthetic-storage.mjs), the
[workspace session](../js/canonical-workspace-session.mjs) and the
[backup codec](../js/full-snapshot-backup.mjs). Both classes use the same native
engine: immutable Drive references, exact readback, session ownership,
pending publication, recovery and fresh-lineage restore. There is no second
storage format; the earlier detached hash-only fixture was removed.

### Cross-class refusal (`data-class-mismatch`)

Refusal happens at the earliest point that can observe the class, and always
before touching the destination or replacing the current session or draft:

- **Folder:** the read-only manifest inspection before any session marker
  refuses the other class. Under ownership the engine rechecks the same
  manifest and its class. Production refuses a folder whose name contains
  "synthetic" right after the Picker metadata read, before the privacy proof or
  any folder-content read; synthetic keeps its existing name rule.
  Names only refuse mix-ups; they never authorize a folder.
- **Ledger:** preview, staging, undo and save-to-new-copy validate the session
  class before any connection. Domain transitions preserve the declared class,
  and `assertCanonicalLedgerTransition` refuses any header rewrite.
- **CSV import:** the importer must name the expected class; the session's
  staging boundary rejects a proposal of another class.
- **Backup:** the cleartext archive header is checked before key derivation or
  decryption. The decrypted inner header and ledger must match again. A
  checksummed archive cannot relabel its inner ledger.
- **Restore:** the backup class, the preview ledger class and the newly
  created destination manifest class must all equal the session class.

Existing synthetic ledgers, manifests and backups are unchanged and remain
readable by synthetic sessions only.

Workbook historical-summary staging stays synthetic-only and is refused in a
production session; that workstream is separate (see PR 58).

## Access authority for a private database

Google OAuth and Drive permissions are the access authority. The app adds
checks that can only refuse:

1. **One designated Google account.** `about.get` identity, explicit
   confirmation, and a local SHA-256 fingerprint of the permission ID. A
   different account is refused; reauthorization must return the same account.
2. **One exact private folder.** The [private-folder proof](../js/google-private-folder-proof.mjs)
   requires an unshared, non-shared-drive folder owned only by the designated
   account before any session release, manifest read or write. In addition, a
   production session keeps a per-browser fingerprint of (account, folder).
   Open refuses any other folder (`designated-folder-mismatch`) after the Picker
   metadata read but before the privacy proof or any
   folder-content read. A first Open asks to designate. Creating or restoring into a
   new empty folder asks to replace the designation, and the fingerprint moves
   only after that new copy is independently verified; a failed restore keeps
   the previous designation. If the browser cannot record a new designation, the
   verified copy stays open and verified, the app says the designation was not
   updated, and the previous designation still applies. Clearing site data removes the fingerprint and
   requires designation again. The fingerprint is not a credential, never
   leaves the browser, and is not written to diagnostics.
3. **One active device.** The existing best-effort session marker: an active
   claim refuses another device; a conclusively expired one is reclaimed
   through normal Open without publishing the abandoned draft. There is no
   Drive compare-and-swap; see [session coordination](SESSION_COORDINATION.md).

No URL flag, browser storage value, folder name or automatic discovery can
select or authorize the production class.

## Release gate: what static code can and cannot enforce

`RELEASE_PROFILE.dataClasses` in [release-profile.mjs](../js/release-profile.mjs)
lists the classes this exact source revision can construct. It is checked when
the storage engine, application and bridge are constructed and when the class
is changed. Those constructors accept a substitute profile only so tests can
stand in for a future approved release; the shipped controller always passes
the checked-in profile. The
class selector is hidden and disabled unless the profile lists `production`.

**Enforced by code:** an ordinary build cannot open, create, restore or import
a private database, and cannot be switched by page input.

**Not enforced by code:** whether a given release *should* list `production`.
A static page cannot verify an owner's approval, and anyone who can publish a
modified page can change its code. The control is therefore the **release
decision**, recorded outside the page:

1. Listing `production` is a reviewed change to the release profile (and the
   assertion that pins it). As of 2026-11-24 the owner recorded that decision
   in [current state](CURRENT_STATE.md#owner-decision-go-for-real-financial-data)
   as taking effect on merge of PR 61, without naming a SHA.
2. After each deployment, verify that the served `js/release-profile.mjs` and
   build stamp match the merged commit and the Pages workflow run. The
   designated account and dedicated folder stay private, not in the repository.
3. Deployment from that commit requires the required checks on `main`
   (including **Guarded code checks**, enforced since 2026-11-23) and the
   owner's merge for guarded changes after an agent-assisted review. This
   single-owner project does not require independent human approval; see [guarded code](GUARDED_CODE.md#owner-and-reviewer-checklist).
4. Real-data activation was the owner's 2026-11-24 GO and is not repeated per build. The original invented-data rehearsal is archived in [OWNER_ACCEPTANCE_2026-11-24.md](archive/OWNER_ACCEPTANCE_2026-11-24.md). Run a scoped rehearsal again only when a change affects a safeguard.

## Verification (invented data only)

- [Production app flow](../tests/production-app-flow.test.mjs) runs the
  shipped controller, session, bridge, engine and codec against simulated
  Drive folders with a test-only release profile: locked default, private
  create / CSV import / explicit save / release / independent reopen,
  cross-class refusal in both directions, wrong/shared/unverifiable/undesignated
  folders, canceled authorization, expiry and reconnect, interrupted save and
  recovery, active versus expired ownership, encrypted restore to a fresh empty
  folder with independent comparison, and privacy of uploads, diagnostics and
  browser storage.
- [Production storage engine](../tests/production-storage-engine.test.mjs)
  covers v2 pending-publication recovery, archive round-trip, ambiguous parents
  and class refusal at the engine level.

Simulation does not establish live Google OAuth, Picker, Drive permission
fields, quota, or physical Safari behavior.
