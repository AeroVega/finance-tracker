# Synthetic data

## Current creation route

Use **Create new synthetic year** in the [main workspace](../index.html#storage). It is on Home until a ledger is open, then under **More**. The workspace prepares invented data, requests Google authorization from the click gesture, and uses Picker to select a fresh empty synthetic folder. An already-open local preview uses **Save preview to a new folder** and preserves its staged edits. Open saved synthetic year never initializes an empty folder.

The selected storage format is [full-snapshot v1](FULL_SNAPSHOT_STORAGE.md). Older layouts are unsupported and are not migrated, overwritten or deleted. The standalone synthetic-year seeder and old copy guides were retired during PR46 cleanup. Supported file import and portable backup/restore remain outstanding requirements, not available actions.

The default recipe is calendar year **2025**, the last complete year when implemented. It offers one reproducible invented dataset, not a production dashboard, investment engine or projection implementation. This document grants no deployment, merge, live Drive or real-data authorization; consult [current state](CURRENT_STATE.md).

## Recipe and financial meaning

The versioned pure generator `createSyntheticFinancialYear` constructs invented provider-shaped CSV bytes in memory. It uses the existing parser, canonical import and append-only event APIs. It returns the same identities, values and fixture timestamps on repeated calls with the same year. These fixed UUID-shaped identities and timestamps belong only to the invented recipe; they are not a source for production identity or import-time generation. The generator accepts no files, account details or private input.

- Four accounts and annual imports: Wells Fargo-shaped checking and credit card, SoFi-shaped savings, and Fidelity-shaped brokerage.
- 253 activities and source observations, 207 classification/correction/refund audit events, and 722 logical canonical objects including the index.
- Twelve months of twice-monthly pay, rent, utilities, insurance, savings interest, card purchases, subscriptions and seasonal purchases. December pay and spending vary. These are representative recurring entries, not daily spending coverage.
- Savings transfers and both sides of credit-card payments balance exactly. Card purchases count as spending once; payments do not count again. Brokerage contributions and trades do not inflate ordinary income or spending.
- An invented January utility overcharge is corrected by a separate event. A partial refund of June travel posts in July. Original descriptions and amounts remain preserved in the source observations.
- Fidelity actions, quantities, prices and settlement evidence are retained. The current engine does not support their full classification or posted lifecycle; all 48 investment activities are explicitly excluded from known income/spending, with unknown lifecycle reported. This is test material for future investment work, not investment performance or holdings calculations.

**Verified fixture expectations:** annual known income is **$73,739.50** and known spending is **$30,381.00**. Tests compare every monthly total to separately computed recipe expectations, check card/transfer conservation and inspect correction/refund evidence. Currency is explicitly USD.

Balances, historical valuations, net worth, investment performance and complete-history claims remain unavailable. The current engine's cash subtotal excludes transfers and card activity; it is not total bank movement or a balance. The synthetic declared coverage is source-confirmed by the authored recipe, but `coverageReconciled` remains false. Original CSV bytes are available only in memory, not uploaded as retained files. Canonical retention fields honestly remain `not-retained`; preserved row-level source evidence is not a full-file retention claim.

## Save and overwrite boundaries

1. Use a new empty synthetic folder for creation. Do not clear an old or uncertain folder to make it appear empty.
2. Cancelled sign-in or Picker leaves the local preview available. Creation refuses a nonempty destination.
3. Wait for verified success before staging another operation. A successful HTTP response alone is not a verified save.
4. Stage a correction, choose Save changes once, then independently reopen the saved copy to verify persistence.
5. Release the session before moving to a different tab or device. Release does not erase the saved copy.

## Interruption and retry

After a failed or uncertain save, preserve the folder and local draft. Do not blindly retry or delete files. Recover if offered, then perform a verified full reopen to establish what reached Drive. Recovery alone does not seed a save baseline or prove the intended draft was persisted. An uncertain release does not announce successful handoff. See the [current protocol](FULL_SNAPSHOT_STORAGE.md) and [archived owner guide](archive/OWNER_ACCEPTANCE_2026-11-24.md).

## Historical measurements

Measurements and owner procedures for the retired grouped-v2 and canonical-v5 seeders are not current guidance. They are in Git at commit `a089861` as `docs/SYNTHETIC_FINANCIAL_YEAR.md`. See [retired storage designs](archive/RETIRED_STORAGE_DESIGNS.md) for why those layouts ended.
