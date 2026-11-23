# Manual monthly history

This one-time utility creates the existing normalized monthly-history JSON by
transcribing invented categories, not by reading a spreadsheet. It does not
connect to Google, write a ledger, or retain browser drafts. Keep testing
synthetic-only until real-data use is separately authorized.

From the repository root run:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/tools/manual-history/`. Entry is disabled on remote
origins, including GitHub Pages. No third-party browser resources are loaded.

1. Enter the inclusive last month (coverage begins January 2023). Set a stable
   source ID you will reuse for this workbook in every export, and enter honest
   workbook/worksheet references.
2. Enter each month’s complete categorized income and expenses. Use one
   income category if that is all your source supports. Use the zero checkbox
   only when the source confirms zero. Confirm the entered sum only when it
   represents the entire month. Blank rows provide no information.
3. Enter the observed January 2023 closing net worth only if known. The review
   shows later cash-flow-based closing estimates using income minus expenses
   from February onward, stopping at a missing month, missing total, or currency
   mismatch. Neither estimates nor invented snapshots are exported.
4. Add each month to review. Check totals and reported gaps, and edit or remove
   entries before download. Downloading despite warnings makes a review draft,
   not an accepted import. Download a private wizard draft periodically and keep it local. Add
   or clear the in-progress month before saving a draft. To resume, choose that
   private draft file; the wizard verifies it before offering to replace current
   work. The private draft is not a tracker import. Closing or reloading loses
   the local session; the browser may warn if changes remain.
5. For synthetic testing, select the JSON in the tracker's existing historical
   summary review. The tracker makes its own admission/acceptance decision.

For the invented June 2023 example, income is 4000.00. Rent 1150.00, Food
250.32, Transportation 350.63, Health 18.68, Entertainment 40.66,
Subscriptions 34.99, Gifts 75.00, and Taxes 2.89 total exactly 1923.17.
June alone cannot produce a closing estimate without the January anchor and
every intervening month. Actual snapshots are never inferred.
