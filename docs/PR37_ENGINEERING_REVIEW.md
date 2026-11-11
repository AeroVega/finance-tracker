# PR37 engineering review

Review began November 11, 2026 at remote head
`288795b63ebf228f2527eef37cd5b0f370c1eb16`. The original checkout was clean;
implementation uses a separate worktree. No concurrent local candidate or
`7d51767126dd835e47a672dbf48320d314f685e6` object was available. Existing
PR and documentation changes are retained. Current direction remains in
[project status](PROJECT_STATUS.md).

## Findings and changes

**Verified:** a single omitted post-create listing reproduces the owner-reported
symptoms through the real session adapter and coordinator against synthetic HTTP.
The marker persists, acquisition fails, and no database initialization occurs.
**Hypothesis:** this could explain the live failure; neither the live folder nor
its marker has been accessed to establish that cause.

The [session contract](SESSION_COORDINATION.md#delayed-marker-visibility-and-cancelled-acquisition)
defines the repair, finite read retries, operation deadlines and cancellation.
Marker verification retries reads only. Known marker identity survives uncertain
outcomes, so a second acquisition cannot create another marker merely because the
first is absent from a listing. Initial claim cancellation is now observed before
manifest initialization; listeners are attached during connection as well as
normal operation. A dispatched request can still commit remotely after abort.

Session ownership queries exclude unrelated database objects while retaining
all candidate markers, pagination and duplicate checks. This removes repeated
transmission and parsing of irrelevant ledger metadata, without removing a
fresh ownership check. Physical verification still inventories the database.

Removed the seeder's unused layout setting and its two constructor-option
assertions. Actual writer selection already belongs to the connected lifecycle
and verified stored profile; legacy-v3 and integrated-v5 roundtrips remain.
Corrected the existing benchmark's default output label from v4 to v5. Its
historical filename is retained to preserve existing commands and evidence links.
No supported format, recovery scenario or historical evidence was removed.

## End-to-end storage trace

| Stage | Active path and authority |
| --- | --- |
| Select/connect | `DashboardSyntheticStorage.connect` authorizes/selects the synthetic folder and checks empty/existing-copy requirements. `ApplicationStorageLifecycle.start` claims the session before initializing a manifest. |
| Seed | The page requests `partitions-v5`; `SyntheticYearSeeder` admits only a verified pristine genesis, prepares the invented year, checks for an exact existing recipe, saves, then independently loads and compares the saved ledger. |
| Acquire/renew | `SessionCoordinator` serializes marker operations independently of financial writes. The Drive adapter checks previous state, performs one mutation and verifies exact bytes. The coordinator verifies its state transition. |
| View/detail/month | `PagedCanonicalLedgerStore.loadVerified` obtains a pinned physical snapshot, fully audits source and derived data, closes current-manifest/ownership evidence and builds the in-memory month index. Workspace views and detail currently use that complete ledger. The partition reader has root-pinned record/month APIs, but they are not a selective cold app open. |
| Edit/save | `CanonicalWorkspaceSession` retains an explicit draft. The store checks append-only transition and exact base; v5 coalesces changed trees. Preparation is owned and audited before `PhysicalRootBinding` publishes recoverable plans, objects, receipts and the root. Save then verifies/readbacks the selected ledger. |
| Reopen | A verified full load, including retained logical/physical history. Byte reuse is private and requires fresh metadata and ownership closure. |
| Backup/restore | `paged-canonical-backup` pins and verifies the source; framed export/restore verifies commitments and fresh destination identity. A late source change blocks publication. Blob fallback, source evidence and inventories still have memory costs. |
| Interrupted write | Uncertain dispatched mutations require exact-state recovery. Pending publication and receipts are retained. Cancellation is not rollback and is not evidence that no remote write occurred. |

## Safeguard inventory

| Safeguard | Failure addressed and decision |
| --- | --- |
| Candidate enumeration, strict shape and duplicate refusal | Ambiguous owner, malformed or hidden second marker. Retained; exclude only unrelated ledger objects from this query. |
| Pre-write marker recheck, exact readback and coordinator verification | Another owner arriving between inspection, dispatch and ownership admission; lost mutation responses. Retained. These checks cannot provide atomic exclusion. |
| Heartbeat with independent marker queue | Long uploads must renew their lease rather than starve behind their own transaction. Retained. |
| Expiry, future-clock and explicit stale recovery checks | Suspended/crashed tabs and uncertain device handoff. Retained; no automatic takeover. |
| Read retry only for absence/exact old record | Transient visibility after our one mutation. Added; errors and conflicting identities do not become successful retries. |
| Cancellation generation and abort deadline | Queued or late claim work after offline/pagehide or stalled network I/O. Added; no authority from a late completion. |
| Financial-write admission/drain and physical operation lifetime | Writes dispatched before cancellation/release may still commit. Retained unchanged; session cancellation cannot replace these guards. |
| Exact base, root/profile binding, hashes and readback | Wrong copy/profile, concurrent changes, missing or modified objects. Retained. |
| Complete semantic source/derived and immutable-transition audit | Self-consistently rehashed wrong totals, omissions or rewritten history. Retained. An index hash cannot replace this proof. |
| Pending plans, receipts, final source pin and recovery | Lost responses, interruption between durable boundaries, stale backup publication. Retained. |
| Fresh version-checked byte/body evidence with bounded lifetime | Avoid rereading immutable bytes while detecting rebinding or stale authority. Retained; caches are not persistent trust. |

## Design assessment and unfinished scope

**Verified:** canonical v5 is integrated, but the desired scalable *application*
is unfinished. Full audit calls the whole-ledger validator, retained commits
validate complete transitions, the store clones the ledger and the workspace
keeps another baseline. Copying the partition reader into the UI would not
remove this work. It would add a second read path and risk presenting derived
results without their source-completeness proof.

Keep one canonical writer and lifecycle per verified profile. New copies remain
v5. Do not add v6 merely to address the marker bug. Existing v4 profiles are
supported data, not disposable scaffolding. V1/v3 fresh-copy migration preserves
legacy evidence; v4-to-v5 migration remains unsupported. Grouped v2 is refused.
No existing folder is silently migrated, pruned or deleted.

A complete next storage milestone requires a bounded semantic audit over source
partitions and relations, history transition validation without whole-ledger
clones, then one root-bound app query interface for summaries, detail and edits.
Position/reconciliation require their complete evidence dependencies, not just
spending totals. Only after equivalent adversarial coverage exists can the old
materializing runtime and its now-redundant tests be removed. This review does
not claim that work implemented, or introduce a partial-database selector/cap.

## Device acceptance

Use a separately approved deployment of the exact reviewed commit. No deployment
was performed in this review. Preserve the originally affected folder and marker.
Use a different newly created empty synthetic folder, and stop other tabs/devices.

1. Preview locally, then explicitly seed the fresh synthetic folder. Verify the
   reported v5 format and complete saved-year readback. A zero durable-write
   counter does not include marker writes.
2. Release and verify the session, then open the saved year on iPhone/iPad Safari.
   Check account/month navigation, transaction detail and monthly summaries.
3. Stage an amount, category and posting-status correction with rationale. Check
   the draft/history, explicitly save, release and reopen on the other device.
4. Keep one session active and confirm the second device refuses acquisition.
   Test background/resume separately from explicit, confirmed stale recovery.
5. Export a backup and restore into another fresh synthetic folder, with the
   source unavailable. Compare source evidence, audit history and exact amounts.
6. Use a disposable synthetic copy for interruption/offline checks. Preserve an
   uncertain result and follow recovery; do not repeatedly press Upload or delete
   markers to force a retry. Stop and report the commit, fixed error code, phase,
   elapsed time and aggregate request counts if ownership is unknown.

Automated HTTP does not model real Drive indexing latency, permission visibility,
Safari timer suspension, OAuth privacy controls or physical-device memory.
Production remains NO-GO; no real-data acceptance is requested.
