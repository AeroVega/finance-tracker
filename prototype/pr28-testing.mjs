import { PLAN_VERSION, CHECKS, AUTOMATED_IDS, STATUS_LABELS, BROWSER_LABELS, blankResults, safeStatuses, safeAutomated, verifiedSource, createSafeReport } from './pr28-testing-plan.mjs';
import { runFixtureChecks } from './pr28-testing-checks.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
const sourceStamp = $('build-sha').textContent.trim();
const hasSourceStamp = /^[0-9a-f]{40}$/.test(sourceStamp);
$('source-confirmed').disabled = !hasSourceStamp;
if (!hasSourceStamp) $('checklist-storage').textContent = 'A deployed source stamp is unavailable. Checklist choices will not restore after reload because this source cannot be identified. Copy the safe report before leaving.';
const sessionKey = 'finance-tracker-' + PLAN_VERSION;
let selected = 0, manual = blankResults(), automated = safeAutomated(), checking = false;
let date = new Date().toISOString().slice(0, 10);
function option(select, value, label) { const item = node('option', label); item.value = value; select.append(item); }
for (const browser of BROWSER_LABELS) option($('test-browser'), browser, browser);
for (const [value, label] of Object.entries(STATUS_LABELS)) option($('step-status'), value, label);
for (const [index, check] of CHECKS.entries()) option($('step-choice'), String(index), `${index + 1}. ${check.title}`);
function persist() {
  try {
    // Only allowlisted status/selection fields. Never read the workbench state.
    sessionStorage.setItem(sessionKey, JSON.stringify({ version: PLAN_VERSION, source: /^[0-9a-f]{40}$/.test(sourceStamp) ? sourceStamp : 'unverified', date, selected, manual: safeStatuses(manual), browser: BROWSER_LABELS.includes($('test-browser').value) ? $('test-browser').value : 'Not recorded', sourceConfirmed: verifiedSource(sourceStamp, $('source-confirmed').checked) !== 'unverified' }));
  } catch { $('checklist-storage').textContent = 'Session storage is unavailable. Your checklist works in this open page, but may not survive a reload. Copy the safe report before leaving.'; }
}
try {
  const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
  const currentSource = /^[0-9a-f]{40}$/.test(sourceStamp) ? sourceStamp : 'unverified';
  if (hasSourceStamp && saved?.version === PLAN_VERSION && saved.source === currentSource) {
    manual = safeStatuses(saved.manual);
    if (Number.isInteger(saved.selected) && saved.selected >= 0 && saved.selected < CHECKS.length) selected = saved.selected;
    if (BROWSER_LABELS.includes(saved.browser)) $('test-browser').value = saved.browser;
    $('source-confirmed').checked = verifiedSource(sourceStamp, saved.sourceConfirmed) !== 'unverified';
    if (typeof saved.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.date) && Number.isFinite(Date.parse(saved.date)) && new Date(saved.date).toISOString().slice(0, 10) === saved.date) date = saved.date;
  }
} catch { $('checklist-storage').textContent = 'Previous checklist choices could not be loaded. All manual checks start Not run. Copy your safe report before closing this tab.'; }
function report() {
  $('safe-report').value = createSafeReport({ manual, automated, browser: $('test-browser').value, source: sourceStamp, sourceConfirmed: $('source-confirmed').checked, date });
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
  if (checking) return;
  checking = true; $('run-fixture-checks').disabled = true; $('reset-checklist').disabled = true;
  automated = safeAutomated(); report();
  $('fixture-check-result').textContent = 'Running bundled invented-fixture checks. No Drive operations…';
  $('fixture-check-result').dataset.result = 'running';
  try {
    automated = await runFixtureChecks();
    const passed = Object.values(automated).filter(value => value === 'passed').length;
    const failed = Object.entries(automated).find(([, value]) => value === 'failed');
    $('fixture-check-result').textContent = failed ? `${passed}/${AUTOMATED_IDS.length} checks passed. Check ${failed[0]} failed or its fixture was unavailable; later checks were not run. Retry when connected. Manual results are unchanged.` : `${passed}/${AUTOMATED_IDS.length} local fixture checks passed in this page. Browser layout, OAuth and live Drive acceptance remain manual.`;
    $('fixture-check-result').dataset.result = failed ? 'failed' : 'passed';
  } finally { checking = false; $('run-fixture-checks').disabled = false; $('reset-checklist').disabled = false; report(); }
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
  if (checking || !confirm('Reset only this tab’s checklist and local test results? Saved Drive data, staged changes and the active session are unchanged.')) return;
  manual = blankResults(); automated = safeAutomated(); selected = 0; date = new Date().toISOString().slice(0, 10);
  $('source-confirmed').checked = false; $('test-browser').value = BROWSER_LABELS[0];
  $('fixture-check-result').textContent = 'Not run in this page.'; $('fixture-check-result').dataset.result = 'not-run';
  $('report-status').textContent = 'Checklist reset. Saved data, staged changes and the session are unchanged.'; render();
});
render();

// Mount the existing static controls exactly once, then start their existing module.
// This is one document/session, not an iframe or another finance/storage engine.
async function mountWorkbench() {
  try {
    const response = await fetch(new URL('./pr28-import.html', import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error('workbench-unavailable');
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    const sections = [...parsed.querySelectorAll('main > section')];
    if (sections.length !== 6 || !parsed.getElementById('save') || !parsed.getElementById('connect')) throw new Error('workbench-unavailable');
    $('workbench').replaceChildren(...sections.map(section => document.importNode(section, true)));
    const rehearsal = node('details'); rehearsal.id = 'canonical-interruption';
    rehearsal.append(node('summary', 'Optional canonical interruption rehearsal'), node('p', 'Only for the disposable-folder recovery step. First save a baseline, then stage one change. This button deliberately stops after the first durable write and requires closing this tab. It does not clear a session or finish recovery.'));
    const pause = node('button', 'Save and pause after first durable write'); pause.id = 'pause-canonical'; pause.disabled = true; rehearsal.append(pause);
    $('save-records').append(rehearsal);
    for (const section of $('workbench').querySelectorAll('section')) { const back = node('a', 'Back to current test step'); back.href = '#guided-step'; section.append(back); }
    await import('./pr28-import.mjs');
  } catch {
    // No retries that could initialize a second module/session. Reload explicitly.
    const warning = node('p', 'The workbench could not be loaded. No manual test is marked passed. Reload when the deployment is available; keep this checklist report first.'); warning.className = 'notice'; warning.setAttribute('role', 'alert');
    $('workbench').replaceChildren(warning);
  }
}
void mountWorkbench();
