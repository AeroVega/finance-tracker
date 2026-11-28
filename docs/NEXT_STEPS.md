# Next steps

**Updated:** 2026-11-27
**Release target:** v1.0.0 on 2027-01-01, conditional on all release gates. Defer the date rather than weaken a gate.

This is the active priority queue. It grants no permission to merge, deploy or change production configuration. [Current state](CURRENT_STATE.md) owns authorization. The [product definition](PRODUCT_DEFINITION.md) owns the v1.0.0 scope.

## Goals to v1.0.0

Checked against `main` at `f212f2a` on 2026-11-27. The target is 2027-01-01, five weeks out. The shell, Home, Activity, Accounts, Planning, storage, backup and the three provider imports are merged. What remains is a few missing scope items, owner decisions, owner-only data entry, live acceptance and release hardening.

### 1. Close the scope gaps (build)

The [v1.0.0 scope table](PRODUCT_DEFINITION.md#minimum-coherent-v100-scope-owner-confirmed-2026-11-05) lists items that a search of `js/` and `index.html` does not find. Confirm each gap before building.

- **Insights.** Product § 6 specifies a Home card that opens an Insights page. No code mentions insights. Build the four types the owner confirmed on 2026-11-27, with a five-finding cap and a Dismissed list. Dismissals are new append-only ledger records, so that PR is guarded code and the owner merges it. See [Open decisions](PRODUCT_OPEN_DECISIONS.md#second-owner-review-closed-2026-11-27).
- **Savings and net-worth reporting.** The scope requires savings reporting. No code computes the savings rate (income minus spending, divided by income; zero income shows not applicable). Home shows no net-worth figure by name. Confirm what the trend card plots. Net worth shows a total only when every account is fresh, otherwise a labelled subtotal.
- **Custom date range.** Product § 6 settles an optional custom range next to Month, Year and Lifetime. The Home period bar has only those three.
- **Data-quality indicators.** Stale balances, coverage gaps and reconciliation issues exist per account. Add one place on Home or More that lists them across accounts.
- **No-directory start screen and folder-title data class.** Until a Drive directory is open, the app offers only: open an existing directory, create a new empty directory, restore from a backup, and app settings (owner, 2026-11-27). Remove the data-class selector and the separate invented-data preview. Choose the class from the Picker folder title after the metadata read and before any folder-content read: a title containing "synthetic" opens or creates a synthetic folder (creation seeds the invented 2025 year), and any other title is a production folder. The header check keeps refusing a class mismatch, so a real ledger in a folder titled "synthetic", or the reverse, is refused (`data-class-mismatch`). A title never authorizes a folder. This changes the session class selection, so the PR is guarded code. Update [Persistence data class](PERSISTENCE_DATA_CLASS.md), which says the class is chosen before connection. Settle which app settings show before a directory opens (Q5).
- **Finding and ordering rules** (owner request, 2026-11-27). The owner expects hundreds of rules. The Rules page in `js/canonical-workspace.mjs` lists every rule in run order with only **Move up** and **Move down**. The owner compared the goal to Microsoft Outlook's rules list and settled these details on 2026-11-27:
  - Build it as its own PR after PR 76. It changes only the page, so it is not guarded unless it touches guarded files.
  - **Find.** A search box over the description text, category name, and account names. Filters for category, type, account, and status. Status means turned off, category deleted, or matching nothing that needs review now.
  - **No sorting.** The list always shows the run order with position numbers. A filter hides rules and never reorders the rest.
  - **Reorder.** Keep **Move up** and **Move down**. Add **Move to top**, **Move to bottom**, and drag to reorder. A move in a filtered list still moves the rule within the full run order. Each move stays one `rule-order` record.
  - **Old correction rules.** A filter that lists only the rules under **Rules from earlier corrections**, with each one's category and whether that category was deleted. The owner will use it to replace every old rule with a new rule.
  - **Overlaps.** Flag a rule that an earlier usable rule always beats. That happens when the earlier rule's text is contained in the later rule's text, ignoring case, and the earlier rule covers every account the later rule covers. The amount direction of the two rules' types must also overlap.
- **Remove the old correction rules from the app** (owner, 2026-11-27). Start only after the owner confirms that their production ledger has no old correction rule left in force. The app will then remove the **Rules from earlier corrections** section and the `createRule` path that creates these rules. The replay in `js/canonical-import.mjs` must keep applying stored rules up to each retirement boundary, because saved activity events are never rewritten and past transactions keep the category those rules gave them. Validation could refuse a new correction event that turns a rule on. That changes ledger validation, so the PR is guarded code.
- **Dashboard customization** is not a v1.0.0 requirement. Leave it out.

### 2. Owner decisions (done 2026-11-27, build what they change)

The owner closed every v1.0.0 product question on 2026-11-27 in four reviews, and deferred the 17 later-work entries. See [Open decisions](PRODUCT_OPEN_DECISIONS.md#owner-review-bundles-closed-2026-11-27). Three answers need code:

- **Savings rate** (Q12): negative when spending exceeds income, not applicable at zero or negative income. Build it with goal 1.
- **Projection wording** (Q16): the Planning intro text in `js/planning-page.mjs` must say the estimate is a flat three-month average that does not account for annual or seasonal bills. It now says each month looks like the average.
- **Start screen and folder-title data class**: see goal 1.

Engineering detail inside these answers, such as exact screens, does not return to the owner unless it changes a financial meaning.

### 3. Migrate the workbook history (owner, rolling, done by 2026-12-18)

The owner types January 2023 onward into the History migration page, one year at a time. This is the longest task and depends on no code. Run the first year now so any page defect surfaces in December, not January. A later PR retires the page after the last month is saved and backed up.

### 4. Live acceptance on the deployed build (owner with agent support, by 2026-12-18)

Each item below has Node or simulator evidence only. Record each on a named commit, separately from CI.

1. SoFi Checking and Savings and Fidelity import, save and reopen. Only Wells Fargo is owner-confirmed. The Planning projection stays blocked until this passes.
2. Planning: set a budget, exclude a row, save, reopen on a live Drive folder.
3. History migration: save one year, reopen, check the Home trend against the typed values.
4. Encrypted backup and restore into a new folder, then compare against the source.
5. Physical iPhone and iPad pass over every tab: standalone launch, keyboard, safe areas, portrait and landscape.
6. Check the served source stamp, Google configuration and release profile after the last deploy.

### 5. Release hardening (agents, from 2026-12-04)

- Categories page copy, found in the PR 74 review (2026-11-27). The **Delete** confirmation in `categoryItem` in `js/canonical-workspace.mjs` always says "Its budget ends from this month", even when the category has no budget. Say it only when `budgetRemovals` would return a record. **Delete** on a parent that still has subcategories is clickable, and validation then refuses it with `category-has-subcategories`. Disable the button and say why. Neither changes stored data, so the PR is not guarded unless it touches guarded files.
- Empty, partial and failed states on every tab, with the first-run path from an empty private database to a first import.
- Account for the 8 MiB snapshot limit against five years of history. Run the dense-ledger benchmark at three years of imports and compare with the capacity triggers in [Current state](CURRENT_STATE.md#acceptance-and-verification).
- Stamp the build as 1.0.0, add a short user guide for the weekly check-in and import, and write release notes with the known limitations.
- Documentation pass. [ROADMAP.md](ROADMAP.md) was last reconciled 2026-11-14. [PROJECT_STATUS.md](PROJECT_STATUS.md) predates the Home, Accounts and Planning merges. [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md) is 56 KB and repeats decisions that also sit in the open-decisions file. Keep one statement of each.

### 6. Release gate

| Date | Milestone |
| --- | --- |
| 2026-12-04 | Gaps in goal 1 merged or cut. Goal 2 decisions recorded. First migration year saved. |
| 2026-12-11 | Goal 4 items 1 to 4 accepted. Hardening PRs merged. |
| 2026-12-18 | Feature freeze. Migration complete. Goal 4 items 5 and 6 on the release candidate. |
| 2026-12-25 | Only blocking fixes. Owner reviews the evidence. |
| 2027-01-01 | Tag v1.0.0, or move the date. Incorrect totals, data loss and privacy failures block the release. Documented cosmetic issues do not. |

Run the 3-month encrypted backup and restore cadence from [Current state](CURRENT_STATE.md#acceptance-and-verification) once before the tag.

## Acceptance boundaries

- **Full-snapshot v1** is the only supported format. Do not migrate, overwrite, revive or delete older layouts.
- **Performance:** the reported open and save goal is accepted. The ledger still loads and validates in full, so make no bounded-memory claim. Preserve integrity and financial checks.
- **Provider imports:** only the Wells Fargo path has owner confirmation. Do not extend it to SoFi, Fidelity or other devices.
- **Diagnostics:** reports are bounded and privacy-safe and are Copy/Select only. They do not prove a live provider cause or replace acceptance.
- **Deployment:** green CI or a Pages run does not verify the served SHA. Record each state separately.
- **Data:** invented fixtures only. No real transactions, private workbook, owner Drive data or production credentials in the repository or CI.

## Alpha completion

A merged PR does not complete Alpha. Demonstrate one traceable synthetic journey: supported import, review and correction, financial position and coverage, monthly history, explicit save, independent reopen, and encrypted backup and restore. Show exact reconciliation, provenance and interruption recovery.

Record these separately: implementation on a named commit; automated tests and CI on that commit; physical-device and live synthetic acceptance; deployment and the independently checked served SHA; unresolved limitations and accepted risks. Incorrect totals, data loss and privacy failures block release.

## Verification

For application changes follow [Testing](TESTING.md). For documentation changes run `node scripts/check-docs.mjs` and `git diff --check`. Do not report a check you did not run as a pass.
