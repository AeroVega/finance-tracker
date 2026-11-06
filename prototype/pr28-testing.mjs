import { LIVE_CHECKS, LIVE_IDS, blankLive, createLiveRunner, prepareInterruption } from './pr28-live-checks.mjs';
import { PLAN_VERSION, CHECKS, AUTOMATED_IDS, STATUS_LABELS, BROWSER_LABELS, blankResults, safeStatuses, safeAutomated, verifiedSource, createSafeReport } from './pr28-testing-plan.mjs';
import { runFixtureChecks } from './pr28-testing-checks.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
const sourceStamp = $('build-sha').textContent.trim();
const hasSourceStamp = /^[0-9a-f]{40}$/.test(sourceStamp);
$('source-confirmed').disabled = !hasSourceStamp;
if (!hasSourceStamp) $('checklist-storage').textContent = 'A deployed source stamp is unavailable. Checklist choices will not restore after reload because this source cannot be identified. Copy the safe report before leaving.';
const sessionKey = 'finance-tracker-' + PLAN_VERSION;
let live = blankLive(), liveState = 'not-run', liveRunner = null, livePreparing = false, workbenchReady = false;
let selected = 0, manual = blankResults(), automated = safeAutomated(), checking = false;
let date = new Date().toISOString().slice(0, 10);
function option(select, value, label) { const item = node('option', label); item.value = value; select.append(item); }
for (const browser of BROWSER_LABELS) option($('test-browser'), browser, browser);
for (const [value, label] of Object.entries(STATUS_LABELS)) option($('step-status'), value, label);
for (const [index, check] of CHECKS.entries()) option($('step-choice'), String(index), `${index + 1}. ${check.title}`);
function persist() {
  try {
    // Only allowlisted status/selection fields. Never read the workbench state.
    sessionStorage.setItem(sessionKey, JSON.stringify({ version: PLAN_VERSION, source: /^[0-9a-f]{40}$/.test(sourceStamp) ? sourceStamp : 'unverified', date, selected, manual: safeStatuses(manual), live: blankLive(live), liveState: ['running', 'complete', 'failed', 'stopped', 'blocked', 'historical'].includes(liveState) ? liveState : 'not-run', browser: BROWSER_LABELS.includes($('test-browser').value) ? $('test-browser').value : 'Not recorded', sourceConfirmed: verifiedSource(sourceStamp, $('source-confirmed').checked) !== 'unverified' }));
  } catch { $('checklist-storage').textContent = 'Session storage is unavailable. Your checklist works in this open page, but may not survive a reload. Copy the safe report before leaving.'; }
}
try {
  const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
  const currentSource = /^[0-9a-f]{40}$/.test(sourceStamp) ? sourceStamp : 'unverified';
  if (hasSourceStamp && saved?.version === PLAN_VERSION && saved.source === currentSource) {
    manual = safeStatuses(saved.manual);
    live = blankLive(saved.live);
    if (Object.values(live).some(status => status !== 'not-run')) liveState = 'historical';
    if (Number.isInteger(saved.selected) && saved.selected >= 0 && saved.selected < CHECKS.length) selected = saved.selected;
    if (BROWSER_LABELS.includes(saved.browser)) $('test-browser').value = saved.browser;
    $('source-confirmed').checked = verifiedSource(sourceStamp, saved.sourceConfirmed) !== 'unverified';
    if (typeof saved.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.date) && Number.isFinite(Date.parse(saved.date)) && new Date(saved.date).toISOString().slice(0, 10) === saved.date) date = saved.date;
  }
} catch { $('checklist-storage').textContent = 'Previous checklist choices could not be loaded. All manual checks start Not run. Copy your safe report before closing this tab.'; }
function report() {
  $('safe-report').value = createSafeReport({ manual, automated, browser: $('test-browser').value, source: sourceStamp, sourceConfirmed: $('source-confirmed').checked, date, live, liveState });
}
function render(focus = false) {
  const check = CHECKS[selected];
  $('step-choice').value = String(selected);
  $('step-title').textContent = `${selected + 1}. ${check.title}`;
  $('step-actions').replaceChildren(...check.actions.map(text => node('li', text)));
  $('step-expected').textContent = check.expected;
  $('step-workbench').href = '#' + check.target;
  $('step-status').value = manual[check.id];
  $('previous-step').disabled = selected === 0;
  $('next-step').disabled = selected === CHECKS.length - 1;
  const passed = Object.values(manual).filter(value => value === 'passed').length;
  const pending = Object.values(manual).filter(value => value === 'not-run').length;
  $('manual-progress').textContent = `${passed} of ${CHECKS.length} manual checks marked passed by you. ${pending} not run. No automated result changes these choices.`;
  $('manual-results').replaceChildren(...CHECKS.map((item, index) => {
    const li = node('li'), button = node('button', `${index + 1}. ${item.title} · ${STATUS_LABELS[manual[item.id]]}`);
    button.type = 'button'; if (index === selected) button.setAttribute('aria-current', 'step');
    button.addEventListener('click', () => { selected = index; render(true); }); li.append(button); return li;
  }));
  persist(); report();
  if (focus) $('step-title').focus();
}
$('step-choice').addEventListener('change', () => { const next = Number($('step-choice').value); if (Number.isInteger(next) && next >= 0 && next < CHECKS.length) selected = next; render(true); });
$('step-status').addEventListener('change', () => { manual[CHECKS[selected].id] = Object.hasOwn(STATUS_LABELS, $('step-status').value) ? $('step-status').value : 'not-run'; render(); });
$('previous-step').addEventListener('click', () => { if (selected > 0) selected -= 1; render(true); });
$('next-step').addEventListener('click', () => { if (selected < CHECKS.length - 1) selected += 1; render(true); });
for (const id of ['test-browser', 'source-confirmed']) $(id).addEventListener('change', () => { persist(); report(); });
$('run-fixture-checks').addEventListener('click', async () => {
  if (checking || liveRunner?.isRunning() || livePreparing) return;
  checking = true; refreshLiveControls(); $('run-fixture-checks').disabled = true; $('reset-checklist').disabled = true;
  automated = safeAutomated(); report();
  $('fixture-check-result').textContent = 'Running bundled invented-fixture checks. No Drive operations…';
  $('fixture-check-result').dataset.result = 'running';
  try {
    automated = await runFixtureChecks();
    const passed = Object.values(automated).filter(value => value === 'passed').length;
    const failed = Object.entries(automated).find(([, value]) => value === 'failed');
    $('fixture-check-result').textContent = failed ? `${passed}/${AUTOMATED_IDS.length} checks passed. Check ${failed[0]} failed or its fixture was unavailable; later checks were not run. Retry when connected. Manual results are unchanged.` : `${passed}/${AUTOMATED_IDS.length} local fixture checks passed in this page. These local checks do not replace the separate live runner or human device checks.`;
    $('fixture-check-result').dataset.result = failed ? 'failed' : 'passed';
  } finally { checking = false; refreshLiveControls(); $('run-fixture-checks').disabled = false; $('reset-checklist').disabled = false; report(); }
});
function selectReport() { report(); $('safe-report').focus(); $('safe-report').select(); $('safe-report').setSelectionRange(0, $('safe-report').value.length); }
$('select-report').addEventListener('click', () => { selectReport(); $('report-status').textContent = 'Report selected. Use your device Copy command, then paste it where you choose.'; });
$('copy-report').addEventListener('click', async () => {
  report();
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable');
    await navigator.clipboard.writeText($('safe-report').value);
    $('report-status').textContent = 'Safe report copied. Nothing was sent.';
  } catch { selectReport(); $('report-status').textContent = 'Clipboard permission was unavailable. The report is selected; use your device Copy command.'; }
});
$('reset-checklist').addEventListener('click', () => {
  if (checking || liveRunner?.isRunning() || livePreparing || !confirm('Reset only this tab’s recorded test results and same-run comparison? Saved Drive data, staged changes and the active session are unchanged.')) return;
  liveRunner?.forgetResults();
  manual = blankResults(); automated = safeAutomated(); live = blankLive(); liveState = 'not-run'; renderLive(); selected = 0; date = new Date().toISOString().slice(0, 10);
  $('source-confirmed').checked = false; $('test-browser').value = BROWSER_LABELS[0];
  $('fixture-check-result').textContent = 'Not run in this page.'; $('fixture-check-result').dataset.result = 'not-run';
  $('report-status').textContent = 'Checklist reset. Saved data, staged changes and the session are unchanged.'; render();
});
function refreshLiveControls() {
  const active = Boolean(liveRunner?.isRunning() || livePreparing);
  $('run-live-checks').disabled = !workbenchReady || active || checking;
  $('verify-live-reconnect').disabled = !workbenchReady || active || checking || !liveRunner?.canVerifyReconnect();
  $('stop-live-checks').disabled = !liveRunner?.isRunning();
  $('prepare-interruption').disabled = !workbenchReady || active || checking;
  $('reset-checklist').disabled = active || checking;
  $('run-fixture-checks').disabled = active || checking;
}
function renderLive(current = null) {
  $('live-results').replaceChildren(...LIVE_CHECKS.map(check => node('li', `${check.label}: ${live[check.id] === 'passed' ? 'Passed programmatically' : live[check.id] === 'failed' ? 'Failed' : 'Not run'}${current === check.id && liveState === 'running' ? ' · checking now' : ''}`)));
  $('live-progress').value = Object.values(live).filter(status => status === 'passed').length;
  if (liveState === 'historical') $('live-result').textContent = 'Historical results restored from this tab and source. No live checks ran after reload. These results are not evidence about a newly connected folder; same-run reconnect comparison is unavailable.';
  if (liveState === 'not-run') $('live-result').textContent = 'Not run. Connect a fresh empty synthetic folder to begin.';
  refreshLiveControls();
}
$('stop-live-checks').addEventListener('click', () => {
  liveRunner?.stop(); $('stop-live-checks').disabled = true;
  $('live-result').textContent = 'Stopping after the current check finishes. An admitted save must finish or fail before the page stops. Do not close or retry while it is working.';
});
$('run-live-checks').addEventListener('click', async () => {
  if (!liveRunner || checking || livePreparing || liveRunner.isRunning()) return;
  await liveRunner.run(); refreshLiveControls(); persist(); report();
});
$('verify-live-reconnect').addEventListener('click', async () => {
  if (!liveRunner || checking || livePreparing || liveRunner.isRunning()) return;
  await liveRunner.verifyReconnect(); refreshLiveControls(); persist(); report();
});
render(); renderLive();

// Mount the existing static controls exactly once, then start their existing module.
// This is one document/session, not an iframe or another finance/storage engine.
async function mountWorkbench() {
  try {
    const response = await fetch(new URL('./pr28-import.html', import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error('workbench-unavailable');
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    const sections = [...parsed.querySelectorAll('main > section')];
    if (sections.length !== 6 || !parsed.getElementById('save') || !parsed.getElementById('connect')) throw new Error('workbench-unavailable');
    $('connection-slot').replaceChildren(document.importNode(sections[0], true));
    $('workbench').replaceChildren(...sections.slice(1).map(section => document.importNode(section, true)));
    const rehearsal = node('details'); rehearsal.id = 'canonical-interruption';
    rehearsal.append(node('summary', 'Optional canonical interruption rehearsal'), node('p', 'Only for the disposable-folder recovery step. Use Prepare interruption test above to save a baseline and stage one change. This button deliberately stops after the first durable write and requires closing this tab. It does not clear a session or finish recovery.'));
    const pause = node('button', 'Save and pause after first durable write'); pause.id = 'pause-canonical'; pause.disabled = true; rehearsal.append(pause);
    $('save-records').append(rehearsal);
    for (const section of $('workbench').querySelectorAll('section')) { const back = node('a', 'Back to current test step'); back.href = '#guided-step'; section.append(back); }
    const workbench = await import('./pr28-import.mjs');
    liveRunner = createLiveRunner({ withWorkbench: workbench.withAcceptanceWorkbench, recordedResults: live, onUpdate: update => {
      live = blankLive(update.results);
      if (update.current === 'fresh-base' && update.state === 'running' && live['fresh-base'] === 'not-run') date = new Date().toISOString().slice(0, 10);
      liveState = update.state === 'checking-base' ? 'running' : update.state;
      const passed = Object.values(live).filter(status => status === 'passed').length;
      const label = LIVE_CHECKS.find(check => check.id === update.current)?.label || 'Live checks';
      if (update.state === 'checking-base') $('live-result').textContent = 'Checking the verified empty base. No recipe writes have started.';
      else if (update.state === 'running') $('live-result').textContent = `${passed}/${LIVE_IDS.length} passed. ${label}. Keep this tab open while Drive operations finish.`;
      else if (update.state === 'complete') $('live-result').textContent = live['reconnect-same-copy'] === 'passed' ? 'Same-copy reconnect verified. The complete saved graph matches this tab’s run. Release the session when finished.' : `${passed}/${LIVE_IDS.length} passed. Saved checkpoints, retained history, in-memory portable export and session release verified. Reconnect to the same folder, then press Verify saved run after reconnect. Human checks remain separate.`;
      else if (update.state === 'blocked') $('live-result').textContent = 'No run started. Connect a verified fresh, empty synthetic copy with no unsaved changes. A nonempty copy cannot be reset by this runner. Previous results, if any, are unchanged.';
      else if (update.state === 'stopped') $('live-result').textContent = `Stopped before ${label}. Completed checks are retained. No save will be repeated. Inspect saved or local changes below, release safely, and use a new empty folder for a new run.`;
      else $('live-result').textContent = `Stopped at ${label}. Later checks did not run. Do not repeat a save. Reconnect, use recovery if offered, and reopen verified saved records before deciding what to do next. Previous passed checks do not mean the whole run succeeded.`;
      renderLive(update.current); persist(); report();
    } });
    workbench.subscribeAcceptanceStatus(status => { workbenchReady = status.ready && !status.busy; refreshLiveControls(); });
    $('prepare-interruption').addEventListener('click', async () => {
      if (checking || livePreparing || liveRunner.isRunning()) return;
      if (!confirm('Prepare a separate fresh empty synthetic folder for interruption? This saves four invented rows and stages one classification. It does not pause a write or mark recovery passed.')) return;
      livePreparing = true; refreshLiveControls();
      $('interruption-result').textContent = 'Preparing the saved baseline and one unsaved change. Keep this tab open.';
      try {
        await prepareInterruption(workbench.withAcceptanceWorkbench);
        $('interruption-result').textContent = 'Baseline saved and independently reopened. One classification is staged but not saved. Open the optional workbench, then choose Save and pause after first durable write. Follow the human interruption check.';
        $('workbench-details').open = true;
      } catch { $('interruption-result').textContent = 'Preparation did not complete. No recovery result was recorded. Inspect the workbench, reconnect/recover/reopen as needed, and use a fresh empty synthetic folder for a new preparation. Do not repeat an uncertain save.'; }
      finally { livePreparing = false; refreshLiveControls(); }
    });
    refreshLiveControls();
  } catch {
    // No retries that could initialize a second module/session. Reload explicitly.
    const warning = node('p', 'The workbench could not be loaded. No manual test is marked passed. Reload when the deployment is available; keep this checklist report first.'); warning.className = 'notice'; warning.setAttribute('role', 'alert');
    $('workbench').replaceChildren(warning);
  }
}
void mountWorkbench();
