# Retired storage designs

The application stores one format: [full-snapshot v1](../FULL_SNAPSHOT_STORAGE.md). The designs below were built, tested with invented data, and then retired. They are not supported, migrated, or revived. This page keeps the reasoning that still helps a future decision.

Each original document is recoverable from Git at commit `a089861`:

```sh
git show a089861:docs/<FILE>.md
```

## Progression

| Generation | Layout | Why it ended |
| --- | --- | --- |
| Per-record v1 | One Drive file per record, with a locator catalog and journal | Request count grew with history. Two corrections to one activity took about three minutes to save on the owner's deployment (Nov 11). |
| Grouped v2 | Records grouped into larger files | Deprecated experimental layout. The canonical store and backup validator reject it outright. |
| Fragmented v3 / paged v4–v5 | Bounded fragments, immutable page trees, segmented catalogs, month indexes | The Nov 11 audit found that save history costs more than current records and that fragment limits do not bound total memory. Open and save needed page trees, catalogs, receipts and a root protocol. |
| **Full-snapshot v1** | One immutable logical-ledger snapshot plus a small commit envelope per save | Selected after live synthetic testing. Open 11 s, save 25 s on the accepted build. |

Shared safeguards survived every generation and remain required: exact-manifest ownership checks, verified read-back of every created object, fail-closed recovery, immutable history, and a hash that binds each commit to the whole logical ledger.

## Decisions that still apply

These originated in the retired design documents. The contracts named in the last column now own them.

| Decision | Current owner |
| --- | --- |
| Copies of a database share one logical identity. A Drive file ID is never portable identity. | [Full-snapshot storage](../FULL_SNAPSHOT_STORAGE.md) |
| Stale or foreign copies are recognized and refused, not silently activated. | [Full-snapshot storage](../FULL_SNAPSHOT_STORAGE.md) |
| Import coverage is kept separately from account-level coverage. Source-reported and observed coverage stay distinct. | [Canonical ledger contract](../CANONICAL_LEDGER_CONTRACT.md) |
| Overlapping transactions reconcile conservatively and auditably. | [Canonical ledger contract](../CANONICAL_LEDGER_CONTRACT.md) |
| Session claiming, heartbeats, and release are background application behavior, not user buttons. | [Session coordination](../SESSION_COORDINATION.md) |
| Single user, one active device at a time. The raw Drive REST stale `If-Match` probe failed, so there is no compare-and-swap guarantee. | [Session coordination](../SESSION_COORDINATION.md) |
| Original CSV files stay on the owner's device and out of app-managed storage and archives (supersedes a 540-day retention plan). | [ADR-010](../ARCHITECTURE_DECISIONS.md#adr-010-local-only-original-csv-files) |
| The ledger is stored in the owner's own Google Drive, with `drive.file` scope and no paid backend. | [Architecture decisions](../ARCHITECTURE_DECISIONS.md) |
| Drive reads are bounded by streamed byte counts, never by trusted headers. | [Drive response bounds](../DRIVE_RESPONSE_BOUNDS.md) |

## Retired documents

| Original | What it recorded |
| --- | --- |
| `PRIVATE_STORAGE_ARCHITECTURE` | 2026-10-17 decision to use the owner's Drive as the private store, with sequential single-device access and no recurring cost. |
| `DATABASE_IDENTITY_AND_LIFECYCLE` | 108 accepted decisions on database identity, manifests, copies, primary designation, coverage, reconciliation, journaling, initialization, backups and recovery. |
| `DRIVE_LOCATOR_CATALOG_DESIGN` | Per-copy locator catalog that stopped commits from embedding Drive file IDs. |
| `SEGMENTED_LOCATOR_CATALOG` | Segmented catalogs so each save stopped rewriting the whole retained catalog. |
| `TRANSACTION_STAGING_AND_RECOVERY` | Staged commits, append-only journal, idempotent object creation, and conservative deterministic recovery. |
| `ROOT_TRANSACTION_PROTOCOL` | Physical root protocol 4. The protocol-3 prototype was deleted unused. |
| `APPLICATION_STORAGE_LIFECYCLE` | How the dashboard composed session coordination, the Drive adapter, and the transaction engine. Fail-closed rules and concurrency regressions. |
| `LEDGER_SESSION` | In-memory ledger owner with invalidate-before-write rules. |
| `IMMUTABLE_PAGE_TREE` | Content-addressed ordered page tree for partitioned records. |
| `PARTITIONED_CANONICAL_STORAGE` | Canonical v5: paged values, derived monthly queries, coalesced saves. |
| `FRAGMENTED_CANONICAL_STORAGE` | PR30/PR32 fragmented v3 and the ban on grouped v2. |
| `PAGED_STORAGE_MILESTONE` | Isolated prototype of paged storage and recovery. |
| `SCALABLE_STORAGE_FOUNDATION` | Nov 11 owner-approved plan to change storage schemas for scale. |
| `STORAGE_SCALING_AND_PRODUCTION_READINESS` | Nov 11 audit. Save history costs more than current records, and fragment limits do not bound total memory. |
| `FRAMED_BACKUP_STREAM` | Version-3 framed binary transport for portable archives. |
| `DRIVE_BACKUP_AND_RESTORE` | Version-2 portable archive and restore, with live acceptance on 2026-11-04. |
| `ORIGINAL_SOURCE_RETENTION` | Separate expiring storage for uploaded originals, now removed from the product. |
| `DRIVE_HISTORY_VERIFICATION` | Session-private verified-byte reuse to avoid re-reading history. |

The generated glossary in [storage terminology](../STORAGE_TERMINOLOGY.md) lists each retired version name.
