# Existing migrated-v5 evidence fixtures

Generated with baseline `1dc79ca`, using invented `replayFixture(1)` records saved
twice in each old layout. The second save corrects the amount to `-100` with an
invented audit rationale. Each gzip JSON holds the exact old catalog archive,
original source manifest and independently expected latest ledger. Random IDs
belong only to the synthetic HTTP provider.

The test-only `existing-migrated-v5.mjs` wraps these frozen archived bytes in a v5
migration genesis and physical folder. Current runtime opens that existing v5
folder, performs an ordinary save, backs it up and restores source-offline. There
is no runtime migration writer or ability to open an old folder.

Regenerate with `bash tests/helpers/regenerate-migrated-v5-fixtures.sh` from the
repository root. It runs only the historical implementation in a temporary tree.
