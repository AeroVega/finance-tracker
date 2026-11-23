# Full-snapshot backup and recovery

## Acceptance contract

The implemented route is synthetic-only. Backup exports the last verified saved logical database; staged drafts are either saved first or explicitly excluded. Portable exports preserve the complete validated logical ledger, historical entries, source records, provenance and relationships, while excluding physical Drive revisions, ownership state and credentials. Restore is fresh-empty-folder-only and requires independent verification using a fresh application/adapter instance, full open, exact logical equality and recomputed-report equality.

## Save and recovery outcomes

| Evidence after a failed write | Outcome | Safe next action |
| --- | --- | --- |
| Exact attempted authority and complete logical candidate independently verify | Saved | Clear only the matching draft; do not repeat the save |
| Original authority unchanged, no authority publication was dispatched, and local mutations settled | Not saved | Retain draft and offer explicit retry |
| Authority request dispatched but result unknown, even if immediate read still shows old base | Unverifiable | Keep draft and block retry; a late remote write may still arrive |
| Different valid authority or logical database found | Different | Keep draft and block retry; explicit reopen can discard only after confirmation |
| Ownership, folder, transport, authentication or content validation cannot be established | Unverifiable | Keep draft and require reconnect/recovery |
| App reloaded with no in-memory attempt evidence | No attempt context | Verify stored data without claiming whether the lost draft was saved |

Recovery is single-flight, does not race outstanding local mutations and may finalize an independently verified publication. It must never resubmit a candidate automatically. A completed transport promise does not prove a dispatched remote mutation cannot commit late. This remains a provider limitation: Drive update requests do not supply the atomic compare-and-swap guarantee needed to rule out every concurrent-writer race.

## Backup format and limitations

Optional encryption uses AES-256-GCM with a fresh random 96-bit IV and 128-bit tag. PBKDF2-HMAC-SHA-256 uses a fresh random 128-bit salt and fixed 600,000 iterations. The password is not persisted/logged; lost passwords are unrecoverable. JavaScript cannot promise memory zeroization. The archive is bounded but buffered in memory, not streamed. Apple-device KDF latency and peak memory remain unmeasured.

A plaintext SHA-256 checksum detects accidental corruption, not malicious replacement or sender authenticity. The archive codec preserves ledger fields accepted by the validator; it does not scrub arbitrary secrets inserted into free-text or extension fields. Treat downloaded backups as private files. Local copies cannot be remotely erased by the static app.

## Retention and capacity

Portable backup contains logical history and provenance, not physical Drive revision history. The 540-day source-import retention policy must apply consistently to private originals and backup copies: expired originals must not be restored. A restored copy preserves original retention timestamps; restore does not restart the clock. Confirmed deletion of private original files is distinct from expiry and from an inaccessible/ambiguous 404.

The full-snapshot store retains all prior snapshots. Per-snapshot, manifest/envelope and commit-count caps do not cap aggregate history bytes. Every changed save uploads a full snapshot. Cold-open/recovery audits grow with retained commits; backup/restore are additional bounded but expensive operations. No automated garbage collection is implemented in the selected route.

## User procedure (synthetic acceptance; not production authorization)

1. Save the current draft and wait for an explicit verified Saved state, or choose the backup option that excludes the staged draft. Do not close the page during a write.
2. Download a verified portable backup. Prefer password encryption when storing outside a trusted private location; keep the password separately because it cannot be recovered.
3. Keep at least one prior known-good backup until the new copy has been restored and independently verified.
4. To recover, validate the local backup before choosing a new, empty, dedicated synthetic folder. Do not choose an existing database folder.
5. Restore once. Wait for a verified release and fresh-instance full reopen; compare record/history and recomputed reports. Never delete or reinitialize a partial/uncertain destination.
6. If a save or restore result is Unverifiable, stop writes, retain the tab/folder and use explicit recovery. Do not retry until the application establishes a safe retry state.
7. Keep exported backup files private and manage retention/deletion separately from Drive data.

## Verification scope and residual limitations

Automated tests exercise invented provider responses and cryptographic operations. Simulator request counts and modeled service sums are not live Google quota, cost, latency, propagation or physical Safari proof. Live synthetic Google/provider acceptance, physical-device download and KDF capacity, and browser retained-state inspection are separate gates. No real-data authorization follows from code tests or a successful synthetic restore.
