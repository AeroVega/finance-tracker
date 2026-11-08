# Operation-local catalog lookup

**Implemented, synthetic-only:** A complete history scan previously revalidated every catalog entry for each snapshot path and commit lookup. An operation now snapshots and validates all locator bindings, then resolves individual hashes through a private map. The map is discarded after the operation. It is separate from the version-checked byte cache and does not replace fresh Drive metadata, hashes, journal verification, exact manifest checks or session ownership.

The public single-locator function still validates its input each call. Public snapshot resolution creates its own checked lookup. History verification, terminal-journal recovery checks and retained backup validation share one lookup only within their operation. A new recovered catalog creates a new lookup.

Every required scalar is copied explicitly, including previously accepted non-enumerable properties. The copied catalog is validated again, so getters cannot introduce duplicate or malformed bindings during capture. Returned locator objects and binding snapshots cannot mutate private checked fields. No caller-supplied trusted flag, cross-call weak cache or persisted lookup proof is accepted.

Backup structural validators are asynchronous. Retained validation iterates detached bindings, then revalidates and compares the caller's catalog and all checked bindings before returning to export/copy. A callback that rebinds, removes or corrupts an entry therefore fails. The error can occur after later pure validators rather than before the next validator; no copy or publication begins within this function.

## Evidence

**Verified locally:** A synthetic snapshot with 1,000 paths and a catalog with 1,000 data entries required 3,004,000 instrumented hash-property reads before the change and 5,000 afterward. All resolved identities, file IDs and hashes were identical. This counts the instrumented field accesses, not every CPU instruction. The avoided validation work grows with paths multiplied by catalog size; the new lookup setup and resolution grow with their sum.

Run `node tests/benchmark-catalog-resolution.mjs --baseline-ref=c41448b`. It checks complete output equality and reports three-call medians plus deterministic field-access counts for 100 and 1,000 entries/paths. One run under concurrent host load measured 6,743.7 ms versus 20.3 ms at 1,000 entries. Timing is illustrative, not a browser or live Drive guarantee.

Focused tests cover malformed and missing locators, unsafe paths, duplicate physical IDs, prototypes, stable getters, non-enumerable scalar fields, original/returned-object mutation, and asynchronous backup callbacks changing catalog entries or replacing the map. Independent review found the callback mutation case during development; the correction and regressions now reject it before a backup/export can proceed.

## Remaining growth

The lookup change does not compact catalog or commit history. Metadata bytes, catalog JSON, hashing and all retained snapshots still grow. The separate 80-save synthetic HTTP probe remained at 149 save-only requests through save 60, then used 187 at saves 70 and 80 as complete folder enumeration needed two pages. Exact reopen rose from 10 to 14. The run retained 1,050 entries and 2,082,475 payload bytes. Counts include ownership checks and full pagination; initial connection, periodic heartbeats, retries, OAuth and browser CORS are excluded.

Production persistence remains **NO-GO**. Live Google and device-memory acceptance remain open. No real Drive action, migration, merge or deployment is part of these checks.
