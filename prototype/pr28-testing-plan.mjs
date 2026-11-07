import { blankLive, safeLiveMetrics } from './pr28-live-checks.mjs';
import { safeElapsedMs } from './pr28-testing-timing.mjs';
// Public, invented acceptance instructions only. No ledger or provider data belongs here.
export const PLAN_VERSION = 'pr28-assisted-v2';
export const STATUS_LABELS = Object.freeze({ 'not-run': 'Not run', passed: 'Passed by me', failed: 'Failed', blocked: 'Blocked', skipped: 'Skipped' });
export const BROWSER_LABELS = Object.freeze(['Not recorded', 'Safari on iPhone', 'Safari on iPad', 'Safari on Mac', 'Chrome on desktop', 'Firefox on desktop', 'Edge on desktop', 'Other browser']);
export const MANUAL_RECIPE = Object.freeze([
  {
    id: 'setup', title: 'Connect a fresh synthetic folder', target: 'connect-storage',
    actions: [
      'Check the source commit at the top against the branch commit you intended to deploy. GitHub Pages has one shared URL. A different deployment can replace it.',
      'In Google Drive, create a new empty folder whose name includes synthetic, for example PR28 synthetic acceptance. Use only invented data. Do not select the production database or reuse a folder from an earlier run when following these exact counts.',
      'Choose Connect synthetic folder below, authorize Google, then select that folder. Stay in this one tab while working. The guide and workbench share the same storage session.'
    ],
    expected: 'The connection says Synthetic storage connected. Source evidence shows zero records in each collection. If you see earlier canonical records, release this session and choose a fresh folder. Never delete existing records to make counts match.'
  },
  {
    id: 'foundation', title: 'Map and stage four invented rows', target: 'choose-source',
    actions: [
      'Choose Invented review foundation, then Preview fixture. Expect 4 recognized records, 5 rows seen, 1 ignored and 1 source account. Preview alone imports nothing.',
      'For default, choose Create invented account. Enter Invented checking, USD, and checking. Set Declared start to 2026-01-01 and Declared end to 2026-01-31. Try each calendar month control independently, then restore these dates and check the coverage confirmation.',
      'Choose Stage mapped import locally once. Use the source evidence collection headings to inspect record counts.'
    ],
    expected: '1 account, 1 import, 4 source observations, 4 activities, 0 events, 0 review decisions and 0 pending review items. Both identical-looking Jan 12 coffee purchases remain separate. Unsaved local changes is visible. Declared coverage is not proof of complete history.'
  },
  {
    id: 'classify', title: 'Classify income and all three purchases', target: 'review-records',
    actions: [
      'For each activity, choose Classification. Set INVENTED MARKET PURCHASE and each of the two separate INVENTED COFFEE PURCHASE records to Spending. Set INVENTED PAYROLL to Income.',
      'For each of these four changes, enter category invented-default and evidence Invented acceptance classification, then choose Stage auditable change once. The coffee entries have distinct trailing IDs. After a change, select the next activity again.',
      'Set the subtotal Start to 2026-01-01 and End to 2026-01-31. Choose Calculate USD subtotals.'
    ],
    expected: '4 audit events. Known spending is 110.00 and income is 1000.00. complete is false and coverage-not-reconciled remains. These are qualified USD subtotals, not a complete balance or financial statement.'
  },
  {
    id: 'category', title: 'Correct one coffee category', target: 'review-records',
    actions: [
      'Select just one Jan 12 coffee record. Choose Category correction, enter invented-coffee, and evidence Invented coffee category correction. Stage once.',
      'Inspect Effective classifications and categories and the prospective category rules below. Keep the other coffee record unchanged.',
      'Choose Save canonical ledger, then Reopen verified saved ledger. Recalculate January subtotals.'
    ],
    expected: '5 events and 1 prospective rule. Only the selected old coffee record becomes invented-coffee. The other remains invented-default. Spending stays 110.00. Save and reopen each report 1 account, 1 import, 4 observations, 4 activities, 5 events and 0 decisions.'
  },
  {
    id: 'repeat', title: 'Repeat the same foundation import', target: 'choose-source',
    actions: [
      'Preview Invented review foundation again. Choose the existing Invented checking account, not Create invented account. Confirm January 1 through January 31 again.',
      'Stage, save, reopen and recalculate. Do not repeat the classification buttons, since they record new explicit commands.'
    ],
    expected: 'No duplicate financial effects. Counts remain 1 account, 1 import, 4 observations, 4 activities, 5 events and 0 decisions. Spending remains 110.00. This page tests the same bundled bytes; renamed-file identity is covered by automated tests, not an upload here.'
  },
  {
    id: 'review-import', title: 'Stage overlap, refund and malformed evidence', target: 'choose-source',
    actions: [
      'Choose Invented overlap and refund review. Preview shows 4 recognized records, 5 rows seen, 1 ignored and 1 source account. Recognized does not mean valid.',
      'Map default to existing Invented checking and confirm January 1 through January 31. Stage once.',
      'Preview and stage this same review fixture once more with the same mapping and dates. Inspect the second import in Source evidence.'
    ],
    expected: '2 imports, 8 observations, 6 activities and still 5 events. Two items need review: the overlapping market purchase and the malformed amount. Refund and pending purchase are preserved. Retrying adds one retryAttempts entry, not another import or duplicate activities.'
  },
  {
    id: 'review-decisions', title: 'Resolve the overlap and reject the bad amount', target: 'review-records',
    actions: [
      'In the market overlap review item, open Choose a match target, then select the original INVENTED MARKET PURCHASE in Match to activity. Search or browse pages if needed. Enter Same invented market receipt and choose match. Selecting a target alone applies no decision.',
      'In the malformed amount item, enter Invented malformed amount retained as rejected evidence and choose reject. Do not turn it into a zero or invent an amount.',
      'Select INVENTED PENDING PURCHASE in Activity, choose Classification, Spending, category invented-default, and evidence Invented pending classification. Stage once, then save and reopen.'
    ],
    expected: '0 pending review items, 2 review decisions, 6 activities and 6 events. Source evidence retains the malformed row and original market amount. January spending remains 110.00; the pending purchase is excluded with pending. This saved checkpoint is needed for the next step.'
  },
  {
    id: 'refund-missing-date', title: 'Check the missing refund date, then discard the probe', target: 'review-records',
    actions: [
      'From the saved checkpoint, select INVENTED PARTIAL REFUND FOR MARKET PURCHASE, choose Refund link and select INVENTED MARKET PURCHASE as the original. Clear the confirmed refund posting date. Enter Invented receipt links purchase but does not establish posting date. Stage once. Do not save this probe.',
      'Calculate January subtotals. Verify missing-refund-posted-date and spending 110.00. A source activity date must not silently become a posting date.',
      'Choose Reopen verified saved ledger and confirm discarding unsaved local changes. Check that you are back to 6 events. A refund link cannot be added twice to the same activity. If you accidentally saved the probe, mark this step Blocked and use a fresh test folder for a new core run.'
    ],
    expected: 'The temporary seventh event does not reduce spending without posting evidence. Reopen restores the saved 6-event checkpoint. Your recorded checklist result is separate from the discarded financial probe.'
  },
  {
    id: 'refund-date', title: 'Link the refund with February posting evidence', target: 'review-records',
    actions: [
      'Select the refund and Refund link again. Select the original market purchase, enter confirmed posting date 2026-02-02, and evidence Invented refund receipt confirms posting on February 2. Stage once.',
      'Calculate January 1 through January 31, then February 1 through February 28, then January 1 through February 28. Inspect original activities and the appended event.',
      'Save and reopen, then recalculate the combined period.'
    ],
    expected: '7 events. January spending is 110.00, February spending is -40.00 and combined spending is 70.00. The original refund source date stays January 15 and its original postedDate stays null. The new event supplies February 2. The refund follows the purchase category. All readouts remain incomplete.'
  },
  {
    id: 'correction', title: 'Correct the market amount without rewriting source', target: 'review-records',
    actions: [
      'Select the original market purchase. Choose Bank amount correction. Enter -90.00 and evidence Invented corrected market receipt. Stage once.',
      'Inspect the original observation and activity. Recalculate January and the combined January-February period.'
    ],
    expected: '8 events. Original source and activity retain -100.00. The appended correction makes January spending 100.00 and combined spending 60.00. February stays -40.00. A correction affects the original effective period.'
  },
  {
    id: 'future-rule', title: 'Apply the coffee rule to a later import', target: 'choose-source',
    actions: [
      'Choose Invented future coffee category check. Preview shows 1 row. Map it to the existing checking account and confirm January 1 through January 31. Stage once.',
      'Inspect the Jan 20 coffee record. It should already have category invented-coffee. Select it, choose Classification and Spending, clear the Category field, enter Invented future coffee classification, then stage once.',
      'Save, reopen and recalculate January, February and the combined period. Expand imports and confirm original-source retention is not-retained.'
    ],
    expected: 'Final core counts are 1 account, 3 imports, 9 observations, 7 activities, 9 events, 2 decisions and 0 pending review items. January spending is 106.00, February is -40.00, combined is 66.00 and income is 1000.00. The later coffee inherits invented-coffee; the untouched Jan 12 peer stays invented-default. Coverage is still unreconciled and originals are not claimed as retained.'
  },
  {
    id: 'preview-guards', title: 'Check preview changes and offline refusal', target: 'choose-source',
    actions: [
      'With the core saved, preview Invented Wells Fargo but do not stage. Switch to Invented SoFi. Old mappings must disappear and Stage must become unavailable until a new preview.',
      'Save all real work in other apps first. Temporarily disconnect this device from the network. The workbench must disable preview, stage, events, save and reopen. Calculate may still show known local subtotals; that does not mean a write is allowed.',
      'Reconnect. If the session is not ready, use Connect synthetic folder on the same folder and follow any recovery prompt. Reopen and verify the final core counts. A cached preview or browser offline state may behave differently, so record what you actually tested.'
    ],
    expected: 'No old mappings can be staged after a fixture switch. No offline writes occur. Reconnect revalidates ownership and saved history. Failed and obsolete asynchronous preview responses are additionally covered by automated tests; this UI does not claim you reproduced them manually.'
  },
  {
    id: 'release-reopen', title: 'Release, reconnect and reopen independently', target: 'connect-storage',
    actions: [
      'Save any changes, then choose Release session. Wait for Synthetic storage session released. Do not switch devices before release is verified.',
      'Reload this testing page, connect to the same synthetic folder, and choose Reopen verified saved ledger. Recalculate January 1 through February 28.',
      'For sequential iPhone/iPad handoff, repeat on the next device only after verified release on the first. Record the device-specific run separately.'
    ],
    expected: 'The same final counts, classifications, audit history and combined spending 66.00 return. No canonical ledger is kept in browser storage by this guide. Only safe checklist choices can survive a reload in this tab.'
  },
  {
    id: 'recovery', title: 'Rehearse one canonical save interruption', target: 'save-records',
    actions: [
      'This extended test needs a separate disposable synthetic folder. Save and release the completed core folder first. In the disposable folder, repeat the foundation mapping step, then save and reopen its 4 activities with 0 events. Do not classify anything yet.',
      'Stage just one classification for INVENTED MARKET PURCHASE as Spending with invented-default and an invented rationale. Open the interruption rehearsal below Save and reopen. Choose Save and pause after first durable write, then confirm. Wait for PAUSED. This is not a successful save.',
      'Copy the safe report before closing; whole-tab closure can erase session checklist choices. Keep the earlier core report separately. The reopened page is a new manual run, so do not recreate Passed choices for checks you have not run there. Fully close this tab. If your browser asks about unsaved changes, confirm leaving. Reopen this testing page and connect to the same disposable folder. A normal close may release cleanly. If a stopped session remains, wait until the UI conclusively reports it stale, confirm every old tab or device stopped, then choose Recover stopped session. Never take over a live session.',
      'Use Recover interrupted save if offered, then Reopen verified saved ledger. Expect 1 account, 1 import, 4 observations and 4 activities, with either 0 events from the prior checkpoint or the one complete classification event. Inspect first. Only if the event is absent, stage that classification again, save and reopen. Finally there must be exactly 1 event and known January spending 100.00.',
      'Mark Passed only after observing the pause and verifying recovery. Closing a tab does not prove iOS killed the browser process. This tests one canonical boundary. The automated canonical suite tests its other boundaries. PR25 Storage acceptance has a separate dashboard-payload pause tool; it does not prove PR28 canonical crash recovery.'
    ],
    expected: 'Writes remain blocked while ownership or recovery is unresolved. Recovery returns the complete prior or committed state, never a partial graph. A retry after inspecting the recovered state must not duplicate financial effects. Leave this Not run or Blocked if you cannot complete the interruption on this device.'
  },
  {
    id: 'backup-restore', title: 'Verify canonical backup and portable restore', target: 'connect-storage',
    actions: [
      'This is an extended check. Save the completed core ledger and release its session. Open PR25 Storage acceptance using the link below and connect to this same version-2 source.',
      'Choose Verify all retained history, then Create verified Drive backup into a fresh empty synthetic folder. Export portable archive, move the downloaded file outside Drive, reopen it with the file control and Verify loaded archive. Restore archive into a second fresh empty synthetic folder.',
      'Do not choose Save invented snapshot or retention/interruption controls for this check. Keep archives private because they contain copy locators. After verified release in PR25, return here and connect to the backup and restored folder in turn, releasing between each.',
      'Reopen each copy and inspect the final core counts, events, categories and combined subtotal. This page intentionally does not attach exported archives to its safe report.'
    ],
    expected: 'Both copies preserve logical canonical identity and full history with different physical copy locators. Final counts and combined spending 66.00 match. Backup creation alone is insufficient; independently reopening the copied canonical ledger is part of this check.'
  },
  {
    id: 'other-adapters', title: 'Spot-check Wells Fargo, SoFi and Fidelity', target: 'choose-source',
    actions: [
      'Use another fresh synthetic folder so these imports do not change core expectations. Invented Wells Fargo previews 2 rows and 1 account. Map a new checking account with USD and January 1 through January 31. Invented SoFi previews 2 rows and 1 account. Map a separate checking account with USD and February 1 through February 28.',
      'Invented Fidelity previews 2 records, 7 rows seen, 5 ignored rows and 2 distinct source accounts. Map each to a separate USD account, retirement and brokerage respectively, with March 1 through March 31. Do not map both to the same account.',
      'Fidelity has missing currency in its two original rows. Keep one separately with explicit USD and an invented rationale. Inspect that the original blank currency remains blank and lifecycle stays unknown. Return that decision to review with a rationale, then resolve again. Save and reopen.',
      'Release this separate session before returning to the core folder. Invalid-date, amount, width, quoting and footer variations are covered by parser tests; these three UI fixtures are not a promise about every real provider export.'
    ],
    expected: 'Wells Fargo and SoFi each add 2 observations and 2 activities when fresh. Fidelity adds 2 observations across 2 accounts, initially 0 activities and 2 pending review items. Resolving and reversing preserves audit history; unknown lifecycle remains excluded, not silently finalized.'
  },
  {
    id: 'device-usability', title: 'Check touch, keyboard and layout on this device', target: 'choose-source',
    actions: [
      'Try narrow portrait and landscape layouts, text zoom, and both independent coverage calendars. The calendars and evidence tables may scroll within their own panels. The whole page should not need sideways scrolling.',
      'Use touch on iPhone/iPad and a keyboard where available. Labels and focus must remain visible. Read each long activity choice before applying a change.',
      'Try cancelling Google consent or folder selection when safe, then reconnect. The page must show an honest unavailable/error state, not success or a replacement database. Do not revoke access to a real production account as part of this quick path.',
      'Copy the sanitized report below. Mark only checks you personally completed. Keep account information, folder/file IDs, financial contents, tokens and screenshots out of shared notes.'
    ],
    expected: 'Navigation and controls remain usable, cancellation does not write the fixture ledger, and manual results stay separate from automated checks. Real Safari/device and OAuth acceptance must be recorded here by the tester.'
  }
]);

// Only checks that need a human stay on the main checklist. The former recipe
// remains available for engineering reference, not as duplicate acceptance work.
export const CHECKS = Object.freeze([
  { id: 'setup', title: 'Confirm this device and Google connection', target: 'connect-storage',
    actions: ['Confirm the intended deployed source commit and choose your device/browser above.', 'Create a fresh empty Drive folder with synthetic in its name. Connect below and choose that folder. Run live checks once. The page supplies invented data, saves, reloads, verifies and releases automatically.'],
    expected: 'The selected source and browser are the ones you intended. Google consent and folder selection work on this device. Machine results appear separately and do not mark this observation for you.' },
  { id: 'device-usability', title: 'Check touch, keyboard and OAuth cancellation', target: 'choose-source',
    actions: ['Use portrait, landscape and text zoom. Open optional workbench controls and preview a fixture to try both independent coverage calendars. Do not stage or save manual changes to the completed automated run.', 'Check touch targets, labels, focus and panel scrolling. When no save is running, try cancelling Google consent or folder selection, then reconnect. The page must show an honest cancelled/error state.'],
    expected: 'Controls remain usable on this device. The whole page does not require sideways scrolling. Google cancellation does not save an invented ledger or count as a successful connection.' },
  { ...MANUAL_RECIPE.find(check => check.id === 'recovery'), actions: [
    'Copy the completed live report first. Release any connected session, connect a separate fresh empty synthetic folder, then choose Prepare interruption test. The page saves the four-row baseline and stages one classification for you. It does not pause or claim recovery passed.',
    'Open the optional workbench Save and reopen section. Choose Save and pause after first durable write, confirm, and wait for PAUSED. Copy the safe report before closing. Fully close this tab and reopen this page. This is one canonical boundary rehearsal, not every crash boundary or an iOS process-kill test.',
    'Reconnect to that same disposable folder. Recover interrupted save if offered. If a stopped session remains, wait for conclusively stale status and confirm all old tabs/devices stopped before Recover stopped session. Never take over a live session.',
    'Reopen verified saved ledger. Expect 1 account, 1 import, 4 observations, 4 activities, 0 decisions and either 0 events or one complete market classification. Only if the event is absent, stage that one classification, save and reopen. Exactly 1 event and January spending 100.00 must remain. Mark this human check only after observing the pause and recovered state.'
  ] },
  { ...MANUAL_RECIPE.find(check => check.id === 'backup-restore'), actions: [
    'The live runner already verifies all retained history and a portable archive in memory. This additional check creates real copies. Copy your live report and release the current session. Open PR25 Storage acceptance and connect to the completed source.',
    'Create a verified Drive backup in a fresh empty synthetic folder. Export the portable archive, move it outside Drive, reopen and verify it, then restore to a second fresh empty synthetic folder. Keep the archive private. Do not use dashboard snapshot, retention or interruption buttons.',
    'Release PR25 before opening each copied folder in this page. Reopen each copy with the optional workbench. Expect 5 accounts, 7 imports, 15 observations, 15 activities, 15 events and 8 review decisions. The two retained inactive activities remain history. Full January–March known spending is 101.75 and income is 2250.37, qualified as incomplete. The automated core checking account alone has combined January–February spending 66.00.',
    'The same-copy verification button intentionally rejects backup/restored copies because their physical copy identities differ. Use this human copy check for them, then release.'
  ], expected: 'Both copies independently reopen with the complete logical graph and history, using new physical copy locators. In-memory archive validation alone does not prove a live new-folder backup or restore.' }
]);

export const AUTOMATED_IDS = Object.freeze(['fixture-foundation', 'canonical-foundation', 'classifications', 'category-rule', 'repeat-import', 'review-import', 'review-retry', 'review-decisions', 'missing-refund-date', 'refund-period', 'amount-correction', 'future-category', 'provider-shapes']);
export const AUTOMATED_LABELS = Object.freeze(['Parse the foundation fixture', 'Import the canonical foundation', 'Classify income and spending', 'Apply the prospective category rule', 'Refuse duplicate import effects', 'Import overlapping review evidence', 'Retry unresolved review', 'Apply review decisions and pending exclusion', 'Exclude a refund without posting evidence', 'Use the confirmed refund posting period', 'Preserve source amounts after correction', 'Apply the rule to a later import', 'Parse all three provider shapes']);
export const blankResults = () => Object.fromEntries(CHECKS.map(check => [check.id, 'not-run']));
export function safeStatuses(input) {
  return Object.fromEntries(CHECKS.map(check => [check.id, typeof input?.[check.id] === 'string' && Object.hasOwn(STATUS_LABELS, input[check.id]) ? input[check.id] : 'not-run']));
}
export function safeAutomated(input) {
  return Object.fromEntries(AUTOMATED_IDS.map(id => [id, ['passed', 'failed', 'not-run'].includes(input?.[id]) ? input[id] : 'not-run']));
}
export function verifiedSource(text, confirmed) {
  return confirmed === true && typeof text === 'string' && /^[0-9a-f]{40}$/.test(text) ? text : 'unverified';
}
export function createSafeReport({ manual, automated, browser, source, sourceConfirmed, date, live, liveState, metrics, fixtureElapsedMs }) {
  // Deliberate allowlist. Never serialize DOM, URLs, errors, storage objects or free text.
  const isoDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : 'not-recorded';
  return JSON.stringify({ plan: PLAN_VERSION, date: isoDate,
    browser: BROWSER_LABELS.includes(browser) ? browser : 'Not recorded',
    sourceCommit: verifiedSource(source, sourceConfirmed),
    manualProvenance: 'Tester selections, not automatically verified', manual: safeStatuses(manual),
    automatedProvenance: 'Bundled-fixture checks only; no browser-layout, OAuth or Drive verification', automated: safeAutomated(automated),
    fixtureTimingProvenance: 'One shared fixture-run duration, including fixture loading and common setup. Not independent or additive check times. Unmeasured after reload.',
    fixtureElapsedMs: safeElapsedMs(fixtureElapsedMs),
    liveProvenance: 'Programmatic assertions in the connected synthetic session; save/reopen, export validation and release have separate results. No layout, OAuth cancellation, whole-tab interruption or new-folder restore claim.',
    liveEvidence: ['not-run', 'running', 'complete', 'failed', 'stopped', 'historical', 'blocked'].includes(liveState) ? liveState : 'not-run', live: blankLive(live),
    requestMetricsProvenance: 'In-memory API fetch attempts started in the live-run and reconnect-verification windows, including session traffic. Excludes connection/setup, idle gaps, fixture downloads and browser CORS traffic. HTTP status is not an acceptance result. Request time ends at response headers, excludes body reading and hashing; elapsed time covers the operation. In-flight attempts remain in their starting phase. Repeated reconnect attempts are cumulative. Metrics are unavailable after reload.',
    requestMetrics: safeLiveMetrics(metrics)
  }, null, 2);
}
