import { clearDiagnostic, showDiagnostic } from "../js/app-diagnostics.mjs";
import { LIVE_CHECKS, LIVE_IDS, blankLive, safeLiveMetrics, createLiveRunner, prepareInterruption, verifyInterruption } from './pr28-live-checks.mjs';
import { PLAN_VERSION, CHECKS, AUTOMATED_IDS, AUTOMATED_LABELS, STATUS_LABELS, BROWSER_LABELS, blankResults, safeStatuses, safeAutomated, verifiedSource, createSafeReport } from './pr28-testing-plan.mjs';
import { runFixtureChecks } from './pr28-testing-checks.mjs';
import { formatElapsed, resultTiming, createElapsedTimer } from './pr28-testing-timing.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
const sourceStamp = $('build-sha').textContent.trim();
const hasSourceStamp = /^[0-9a-f]{40}$/.test(sourceStamp);
$('source-confirmed').disabled = !hasSourceStamp;
if (!hasSourceStamp) $('checklist-storage').textContent = 'A deployed source stamp is unavailable. Checklist choices will not restore after reload because this source cannot be identified. Copy the safe report before leaving.';
const sessionKey = 'finance-tracker-' + PLAN_VERSION;
let live = blankLive(), liveState = 'not-run', liveRunner = null, livePreparing = false, workbenchReady = false;
let liveMetrics = safeLiveMetrics(), metricPhase = null;
let workbenchStatus = {}, preparedInterruption = null;
let interruption = { preparation: 'not-run', verification: 'not-run' };
let interruptionTimer = null, interruptionTimings = { preparation: null, pause: null, verification: null };
let selected = 0, manual = blankResults(), automated = safeAutomated(), checking = false;
let fixtureTimer = null, fixtureElapsedMs = null, checkingBase = false, historicalLive = false;
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
    if (Object.values(live).some(status => status !== 'not-run')) { liveState = 'historical'; historicalLive = true; }
    if (Number.isInteger(saved.selected) && saved.selected >= 0 && saved.selected < CHECKS.length) selected = saved.selected;
    if (BROWSER_LABELS.includes(saved.browser)) $('test-browser').value = saved.browser;
    $('source-confirmed').checked = verifiedSource(sourceStamp, saved.sourceConfirmed) !== 'unverified';
    if (typeof saved.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.date) && Number.isFinite(Date.parse(saved.date)) && new Date(saved.date).toISOString().slice(0, 10) === saved.date) date = saved.date;
  }
} catch { $('checklist-storage').textContent = 'Previous checklist choices could not be loaded. All manual checks start Not run. Copy your safe report before closing this tab.'; }
function report() {
  $('safe-report').value = createSafeReport({ manual, automated, browser: $('test-browser').value, source: sourceStamp, sourceConfirmed: $('source-confirmed').checked, date, live, liveState: historicalLive ? 'historical' : liveState, metrics: liveMetrics, fixtureElapsedMs, interruption, interruptionTimings: currentInterruptionTimings() });
}
function render(focus = false) {
  const check = CHECKS[selected];
  $('step-choice').value = String(selected);
  $('step-title').textContent = `${selected + 1}. ${check.title}`;
  $('step-actions').replaceChildren(...check.actions.map(text => node('li', text)));
  $('step-expected').textContent = check.expected;
  $('step-workbench').href = '#' + check.target;
  $('step-workbench').hidden = check.id === 'recovery' || check.id === 'backup-restore';
  $('step-live-controls').hidden = check.id !== 'setup';
  $('step-interruption').hidden = check.id !== 'recovery';
  $('step-device-controls').hidden = check.id !== 'device-usability';
  $('step-copy-controls').hidden = check.id !== 'backup-restore';
  $('step-folder-role').textContent = check.id === 'recovery' ? 'Folder for this step: a separate disposable interruption folder. Do not select your completed live-check source.' : check.id === 'backup-restore' ? 'Folder for this step: your completed source with its intended saved corrections. Backup and restore each need their own new empty destination.' : 'Folder for live checks: a fresh empty synthetic source. Keep the completed source for backup and restore; use a different folder for interruption.';
  refreshStepControls();
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
  automated = safeAutomated(); fixtureElapsedMs = null; fixtureTimer = createElapsedTimer(); report(); renderFixture();
  $('fixture-check-result').dataset.result = 'running';
  try {
    automated = safeAutomated(await runFixtureChecks());
  } finally { fixtureElapsedMs = fixtureTimer.stop(); fixtureTimer = null; checking = false; renderFixture(); refreshLiveControls(); $('run-fixture-checks').disabled = false; $('reset-checklist').disabled = false; report(); }
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
  liveMetrics = safeLiveMetrics(); metricPhase = null; fixtureElapsedMs = null; checkingBase = false; historicalLive = false;
  interruption = { preparation: 'not-run', verification: 'not-run' };
  interruptionTimings = { preparation: null, pause: null, verification: null }; renderInterruptionTimings();
  $('interruption-result').dataset.result = 'not-run';
  $('interruption-result').textContent = 'Recorded interruption results reset. Saved data, staged changes and any prepared Pause are unchanged. No preparation result is recorded now.';
  $('interruption-verification').dataset.result = 'not-run';
  clearDiagnostic($('interruption-verification')); clearDiagnostic($('interruption-result'));
  $('interruption-verification').textContent = 'Not checked after reset. Reconnect/recover if needed, then verify the selected interruption folder.';
  manual = blankResults(); automated = safeAutomated(); live = blankLive(); liveState = 'not-run'; renderLive(); selected = 0; date = new Date().toISOString().slice(0, 10);
  $('source-confirmed').checked = false; $('test-browser').value = BROWSER_LABELS[0];
  renderFixture();
  $('report-status').textContent = 'Checklist reset. Saved data, staged changes and the session are unchanged.'; render();
});
function refreshLiveControls() {
  const active = Boolean(liveRunner?.isRunning() || livePreparing);
  $('run-live-checks').disabled = !workbenchReady || active || checking;
  $('verify-live-reconnect').disabled = !workbenchReady || active || checking || !liveRunner?.canVerifyReconnect();
  $('stop-live-checks').disabled = !liveRunner?.isRunning();
  $('prepare-interruption').disabled = !workbenchReady || active || checking;
  $('pause-prepared-interruption').disabled = !preparedInterruption || !workbenchStatus.connected || !workbenchStatus.dirty || active || checking;
  $('verify-interruption').disabled = !workbenchReady || active || checking;
  refreshStepControls();
  $('step-run-live').disabled = $('run-live-checks').disabled;
  $('step-verify-live').disabled = $('verify-live-reconnect').disabled;
  $('reset-checklist').disabled = active || checking;
  $('run-fixture-checks').disabled = active || checking;
}
function currentInterruptionTimings() {
  return { ...interruptionTimings, ...(interruptionTimer ? { [interruptionTimer.id]: interruptionTimer.timer.elapsedMs() } : {}) };
}
function renderInterruptionTimings() {
  const times = currentInterruptionTimings();
  for (const [id, label] of [['preparation', 'Preparation'], ['pause', 'Pause operation'], ['verification', 'Recovery verification']]) {
    const text = `${label} ${interruptionTimer?.id === id ? 'elapsed' : 'time'}: ${formatElapsed(times[id])}.`;
    if ($('interruption-' + id + '-time').textContent !== text) $('interruption-' + id + '-time').textContent = text;
  }
}
function startInterruptionTimer(id) { interruptionTimings[id] = null; interruptionTimer = { id, timer: createElapsedTimer() }; renderInterruptionTimings(); }
function stopInterruptionTimer() { if (interruptionTimer) { interruptionTimings[interruptionTimer.id] = interruptionTimer.timer.stop(); interruptionTimer = null; } renderInterruptionTimings(); }
const INTERRUPTION_PHASES = Object.freeze({ 'fresh-check': 'Checking that the selected synthetic folder is fresh and empty.', fixture: 'Preparing the exact invented interruption recipe.', 'baseline-save': 'Saving and verifying the baseline checkpoint. This can take several minutes.', 'baseline-reopen': 'Independently reopening and comparing the saved baseline.', stage: 'Staging exactly one unsaved classification.', 'recovered-reopen': 'Independently reopening recovered records.', 'recipe-compare': 'Comparing the complete recovered graph with the recognized recipe.', 'retry-save': 'Saving and verifying the one missing classification. This can take several minutes.', 'retry-reopen': 'Independently reopening the saved single-classification graph.', 'graph-totals': 'Checking the complete graph and exact qualified January totals.' });
function showInterruptionPhase(id, phase) {
  if (Object.hasOwn(INTERRUPTION_PHASES, phase)) $('interruption-' + id).textContent = INTERRUPTION_PHASES[phase] + ' Keep this tab open.';
}
function refreshStepControls() {
  for (const [target, source] of [['step-connect', 'connect'], ['step-stale', 'stale'], ['step-recover', 'recover'], ['step-release', 'release']]) {
    $(target).disabled = !$(source) || $(source).disabled || livePreparing || checking;
  }
  $('step-connect').textContent = CHECKS[selected].id === 'recovery' ? 'Choose interruption folder' : 'Choose synthetic folder';
  const state = workbenchStatus.lifecycleState;
  let text = 'Choose a synthetic folder. The helper checks that it is suitable before writing.';
  if (workbenchStatus.saveState === 'paused') text = 'PAUSED. Fully close this tab now. This is not a verified save. Reopen this page and reconnect to the same interruption folder.';
  else if (workbenchStatus.busy || livePreparing) text = 'An operation is running. One saved checkpoint can take several minutes. Keep this tab open.';
  else if (state === 'stale-session') text = 'Stopped session detected. Wait for stale-session recovery to be offered; confirm all earlier tabs and devices have stopped.';
  else if (state === 'recovery-required') text = 'Interrupted save needs recovery. Use Recover interrupted save when enabled, then verify the recovered recipe.';
  else if (workbenchStatus.connected) text = workbenchStatus.dirty ? 'Connected with unsaved local changes. Save or use the prepared Pause action before leaving.' : 'Connected with no unsaved changes. The selected helper will verify this folder before writing.';
  else if (state && !['disconnected', 'released'].includes(state)) text = 'Connection is not ready. Use these connection controls; no guided write can start.';
  if ($('step-connection-state').textContent !== text) $('step-connection-state').textContent = text;
  const cannotLeave = Boolean(workbenchStatus.busy || workbenchStatus.dirty || workbenchStatus.sessionActive || livePreparing);
  $('step-copy-guide').setAttribute('aria-disabled', String(cannotLeave));
}
for (const [target, source] of [['step-connect', 'connect'], ['step-stale', 'stale'], ['step-recover', 'recover'], ['step-release', 'release']]) {
  $(target).addEventListener('click', () => { if (!$(target).disabled && !$(source).disabled) $(source).click(); });
}
for (const id of ['step-copy-guide', 'extended-copy-guide']) $(id).addEventListener('click', event => {
  if (workbenchStatus.busy || workbenchStatus.dirty || workbenchStatus.sessionActive || livePreparing) {
    event.preventDefault(); $('step-connection-state').textContent = 'Save or explicitly discard local changes, then release the current session before opening the copy guide.';
  }
});
$('step-run-live').addEventListener('click', () => { if (!$('step-run-live').disabled) $('run-live-checks').click(); });
$('step-verify-live').addEventListener('click', () => { if (!$('step-verify-live').disabled) $('verify-live-reconnect').click(); });
$('step-workbench').addEventListener('click', () => { $('workbench-details').open = true; });
const metricText = value => value ? `${value.requests} requests, ${value.completed} completed, ${value.inFlight} in flight, peak ${value.peakConcurrency}; elapsed ${(value.elapsedMs / 1000).toFixed(1)} s; summed fetch-to-headers ${(value.requestMs / 1000).toFixed(1)} s, slowest ${(value.maxRequestMs / 1000).toFixed(1)} s. HTTP 2xx ${value.http2xx}, 3xx ${value.http3xx}, 4xx ${value.http4xx}, 5xx ${value.http5xx}, other ${value.httpOther}; rejected ${value.networkErrors}.` : 'Not measured.';
const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
function resultRows(target, checks) {
  const rows = new Map(checks.map(({ id, label }) => {
    const li = node('li'), result = node('span'); result.className = 'check-result';
    li.append(node('span', label), result);
    return [id, { li, result }];
  }));
  $(target).replaceChildren(...[...rows.values()].map(row => row.li));
  return rows;
}
const liveRows = resultRows('live-results', LIVE_CHECKS);
const fixtureRows = resultRows('fixture-results', AUTOMATED_IDS.map((id, index) => ({ id, label: AUTOMATED_LABELS[index] })));
const requestRows = new Map(LIVE_CHECKS.map(check => [check.id, node('li')]));
$('request-phase-results').replaceChildren(...requestRows.values());
function renderFixture() {
  const passed = Object.values(automated).filter(value => value === 'passed').length;
  const failed = Object.entries(automated).find(([, value]) => value === 'failed');
  const elapsed = formatElapsed(checking ? fixtureTimer?.elapsedMs() : fixtureElapsedMs);
  if (checking) $('fixture-check-result').textContent = `Running bundled invented-fixture checks · ${elapsed === 'unmeasured' ? 'time unmeasured' : elapsed + ' elapsed'}. No Drive operations.`;
  else if (failed) $('fixture-check-result').textContent = `${passed}/${AUTOMATED_IDS.length} checks passed. Shared run time: ${elapsed}. Check ${failed[0]} failed or its fixture was unavailable; later checks were not run. Retry when connected. Manual results are unchanged.`;
  else if (passed) $('fixture-check-result').textContent = `${passed}/${AUTOMATED_IDS.length} local fixture checks passed. Shared run time: ${elapsed}. These local checks do not replace the separate live runner or human device checks.`;
  else $('fixture-check-result').textContent = 'Not run in this page.';
  $('fixture-check-result').dataset.result = checking ? 'running' : failed ? 'failed' : passed ? 'passed' : 'not-run';
  $('fixture-results').hidden = checking || (!passed && !failed);
  for (const [id, row] of fixtureRows) {
    row.li.dataset.result = automated[id];
    setText(row.result, resultTiming(automated[id], fixtureElapsedMs, { shared: true }));
  }
}
function renderMetrics() {
  setText($('live-elapsed'), 'Active run time: ' + formatElapsed(liveMetrics.available ? liveMetrics.total?.elapsedMs : null) + '.');
  setText($('request-totals'), liveMetrics.available ? 'Measured run total: ' + metricText(liveMetrics.total) : 'Request metrics are unavailable. They start with Run live checks and are not restored after reload.');
  const label = LIVE_CHECKS.find(check => check.id === metricPhase)?.label;
  const active = liveState === 'running' && (checkingBase || live[metricPhase] === 'not-run');
  setText($('live-current'), active && label ? `${label}: ${resultTiming('not-run', liveMetrics.phases[metricPhase]?.elapsedMs, { running: true, cumulative: metricPhase === 'reconnect-same-copy' })}.` : 'No check is running.');
  setText($('request-phase'), label ? `${active ? 'Current' : 'Last'} check, ${label}: ${metricText(liveMetrics.phases[metricPhase])}` : 'No phase is running.');
  for (const check of LIVE_CHECKS) {
    const row = liveRows.get(check.id), running = active && metricPhase === check.id;
    // During a fresh-base preflight, previous results still belong to the old run.
    const historical = !running && (historicalLive || checkingBase);
    row.li.dataset.result = running ? 'running' : live[check.id];
    setText(row.result, resultTiming(live[check.id], liveMetrics.phases[check.id]?.elapsedMs, { running, historical, cumulative: check.id === 'reconnect-same-copy' }));
    setText(requestRows.get(check.id), `${check.label}: ${metricText(liveMetrics.phases[check.id])}`);
  }
}
function renderLive(current = null) {
  metricPhase = current;
  renderMetrics();
  $('live-progress').value = Object.values(live).filter(status => status === 'passed').length;
  if (liveState === 'historical') $('live-result').textContent = 'Historical results restored from this tab and source. No live checks ran after reload. These results are not evidence about a newly connected folder; same-run reconnect comparison is unavailable.';
  if (liveState === 'not-run') $('live-result').textContent = 'Not run. Connect a fresh empty synthetic folder to begin.';
  if ($('step-live-result').textContent !== $('live-result').textContent) $('step-live-result').textContent = $('live-result').textContent;
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
render(); renderLive(); renderFixture();
// Update long in-flight operation time without adding requests or changing any
// stored acceptance evidence. No metrics are persisted to session storage.
globalThis.setInterval?.(() => {
  if (checking) renderFixture();
  if (interruptionTimer) renderInterruptionTimings();
  if (!liveRunner?.isRunning()) return;
  liveMetrics = safeLiveMetrics(liveRunner.getMetrics()); renderMetrics();
}, 1000);

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
    rehearsal.append(node('summary', 'Advanced manual canonical interruption'), node('p', 'For a manually prepared disposable test only. The guided interruption step has its own Prepare and Pause buttons. This advanced button pauses the current unsaved canonical ledger after the first durable write and requires closing the tab. It does not clear a session or finish recovery.'));
    const pause = node('button', 'Save and pause after first durable write'); pause.id = 'pause-canonical'; pause.disabled = true; rehearsal.append(pause);
    $('save-records').append(rehearsal);
    for (const section of $('workbench').querySelectorAll('section')) { const back = node('a', 'Back to current test step'); back.href = '#guided-step'; section.append(back); }
    const workbench = await import('./pr28-import.mjs');
    liveRunner = createLiveRunner({ withWorkbench: workbench.withAcceptanceWorkbench, recordedResults: live, onUpdate: update => {
      liveMetrics = safeLiveMetrics(update.metrics);
      if (update.metricsOnly) { renderMetrics(); return; }
      live = blankLive(update.results);
      checkingBase = update.state === 'checking-base';
      if (Object.values(live).every(status => status === 'not-run')) historicalLive = false;
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
    workbench.subscribeAcceptanceStatus(status => {
      workbenchStatus = status; workbenchReady = status.ready && !status.busy;
      if (status.saveState === 'paused') {
        if (interruptionTimer?.id === 'pause') { stopInterruptionTimer(); report(); }
        $('interruption-result').textContent = 'PAUSED after the first durable write. This is not a verified save. Copy your safe report, fully close this tab, reopen this page and reconnect to this same interruption folder.';
        clearDiagnostic($('interruption-result'));
        $('interruption-result').dataset.result = 'running';
      }
      refreshLiveControls();
    });
    $('prepare-interruption').addEventListener('click', async () => {
      if (!workbenchReady || checking || livePreparing || liveRunner.isRunning()) return;
      if (!confirm('Prepare the selected fresh empty synthetic interruption folder? This saves four invented rows and stages one classification. Use a separate folder, not the completed live-check source.')) return;
      preparedInterruption = null; livePreparing = true; startInterruptionTimer('preparation'); interruption.preparation = 'running'; interruption.verification = 'not-run'; refreshLiveControls(); report();
      clearDiagnostic($('interruption-result'));
      $('interruption-result').dataset.result = 'running';
      $('interruption-result').textContent = 'Preparing the baseline, saving and independently reopening it. One checkpoint can take several minutes. Keep this tab open.';
      clearDiagnostic($('interruption-verification'));
      $('interruption-verification').textContent = 'Not checked. After the pause and whole-tab close, reconnect here and verify recovery.';
      $('interruption-verification').dataset.result = 'not-run';
      try {
        preparedInterruption = await prepareInterruption(workbench.withAcceptanceWorkbench, undefined, phase => showInterruptionPhase('result', phase));
        interruption.preparation = 'passed';
        $('interruption-result').dataset.result = 'passed';
        $('interruption-result').textContent = 'Baseline saved and independently reopened. Exactly one classification is staged, unsaved. Next: press 2. Save and pause this prepared test right here.';
      } catch (error) {
        interruption.preparation = 'failed'; $('interruption-result').dataset.result = 'failed';
        $('interruption-result').textContent = showDiagnostic(error, { surface: 'developer-tool', target: $('interruption-result') });
      } finally { stopInterruptionTimer(); livePreparing = false; refreshLiveControls(); report(); }
    });
    $('pause-prepared-interruption').addEventListener('click', async () => {
      if (!preparedInterruption || checking || livePreparing || liveRunner.isRunning() || !workbenchStatus.connected || !workbenchStatus.dirty) return;
      if (!confirm('Pause this exact prepared interruption save after its first durable write? Wait for PAUSED, then fully close this tab. Reopen the page and reconnect to the same interruption folder.')) return;
      livePreparing = true; startInterruptionTimer('pause'); refreshLiveControls();
      clearDiagnostic($('interruption-result'));
      $('interruption-result').dataset.result = 'running'; $('interruption-result').textContent = 'Saving until the first durable write. Keep this tab open until PAUSED appears.';
      try { await workbench.pausePreparedInterruption(preparedInterruption); }
      catch (error) {
        preparedInterruption = null; interruption.preparation = 'failed'; $('interruption-result').dataset.result = 'failed';
        $('interruption-result').textContent = showDiagnostic(error, { surface: 'developer-tool', target: $('interruption-result') });
      } finally { stopInterruptionTimer(); livePreparing = false; refreshLiveControls(); report(); }
    });
    $('verify-interruption').addEventListener('click', async () => {
      if (!workbenchReady || checking || livePreparing || liveRunner.isRunning()) return;
      if (!confirm('Verify the recovered interruption recipe in this selected folder? If its exact saved baseline is found, save the one missing classification, reopen and check the full graph and totals. Modified or older recipes will not be rewritten.')) return;
      livePreparing = true; startInterruptionTimer('verification'); interruption.verification = 'running'; refreshLiveControls(); report();
      clearDiagnostic($('interruption-verification'));
      $('interruption-verification').dataset.result = 'running';
      $('interruption-verification').textContent = 'Independently reopening and checking the entire recovered recipe. If the classification is absent, one checkpoint will be saved and reopened. This can take several minutes.';
      try {
        const result = await verifyInterruption(workbench.withAcceptanceWorkbench, undefined, phase => showInterruptionPhase('verification', phase));
        interruption.verification = 'passed'; $('interruption-verification').dataset.result = 'passed';
        $('interruption-verification').textContent = (result === 'baseline-retried' ? 'Exact baseline recovered. The one missing classification was saved once and independently reopened.' : 'Exact single-classification graph recovered and independently reopened. No save was repeated.') + ' Complete graph verified; exactly 1 audit event; January spending 100.00, incomplete. Mark your human observation separately, then release this session.';
      } catch (error) {
        interruption.verification = 'failed'; $('interruption-verification').dataset.result = 'failed';
        $('interruption-verification').textContent = showDiagnostic(error, { surface: 'developer-tool', target: $('interruption-verification') });
      } finally { stopInterruptionTimer(); livePreparing = false; refreshLiveControls(); report(); }
    });
    refreshLiveControls();
  } catch (error) {
    // No retries that could initialize a second module/session. Reload explicitly.
    const warning = node('p', 'The workbench could not be loaded. No manual test is marked passed. Reload when the deployment is available; keep this checklist report first.'); warning.className = 'notice'; warning.setAttribute('role', 'alert');
    $('workbench').replaceChildren(warning);
    warning.textContent = showDiagnostic(error, { surface: 'developer-tool', target: warning });
  }
}
void mountWorkbench();
