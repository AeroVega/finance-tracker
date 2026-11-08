import { PLAN_VERSION, PHASES, STATUSES, BROWSERS, validSource, cleanState, restoreState, prerequisitesMet, createReport, recordObservation } from './acceptance-plan.mjs';
const $ = id => document.getElementById(id);
const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
const source = $('build-sha').textContent.trim();
const key = `finance-${PLAN_VERSION}`;
let state = cleanState({}, source);
const continuity = 'Only fixed checklist choices are kept in this tab’s session storage for Back/reload. No tokens, folders or financial data. A changed source resets them.';
$('continuity').textContent = continuity;
try { state = restoreState(JSON.parse(sessionStorage.getItem(key) || 'null'), source); }
catch { $('continuity').textContent = 'Saved choices unavailable. This checklist starts fresh; copy the report before leaving.'; }
if (!validSource(source)) $('continuity').textContent = 'No full deployed source stamp. Live acceptance is blocked; choices will not restore. Use a separately authorized, verified deployment.';
$('source-confirmed').disabled = !validSource(source);
$('source-confirmed').checked = state.sourceConfirmed;
for (const browser of BROWSERS) { const option = el('option', browser); option.value = browser; $('browser').append(option); }
$('browser').value = state.browser;
function save() {
  try { if (validSource(source)) sessionStorage.setItem(key, JSON.stringify(cleanState(state, source))); else sessionStorage.removeItem(key); }
  catch { $('continuity').textContent = 'Session storage unavailable. Copy the report before leaving; Back/reload may lose choices.'; }
}
function render() {
  $('phases').replaceChildren();
  $('phase-jumps').replaceChildren();
  for (const [index, phase] of PHASES.entries()) {
    const section = el('section'); section.id = `phase-${phase.id}`;
    const jump = el('a', `${index + 1}. ${phase.title}`); jump.href = `#${section.id}`; $('phase-jumps').append(jump);
    section.setAttribute('aria-labelledby', `${phase.id}-title`);
    const title = el('h2', `${index + 1}. ${phase.title}`); title.id = `${phase.id}-title`; section.append(title, el('p', phase.folder));
    const ready = prerequisitesMet(phase.id, state);
    const prerequisite = el('p', ready ? 'Prerequisites recorded. Continue only after verified session release.' : `Before this phase: confirm deployed source and browser${phase.requires.length ? `; finish ${phase.requires.map(id => PHASES.find(p => p.id === id).title).join(', ')}` : ''}.`); prerequisite.className = 'prerequisite'; section.append(prerequisite);
    const list = el('ol'); for (const step of phase.steps) list.append(el('li', step)); section.append(list);
    const expected = el('p', `Expected: ${phase.expected}`); expected.className = 'expected'; section.append(expected);
    const link = el('a', 'Open existing tool in this tab'); link.href = phase.href; link.className = 'tool-link'; section.append(link);
    const label = el('label', 'My observation (not a programmatic result)'); label.htmlFor = `${phase.id}-status`;
    const select = el('select'); select.id = label.htmlFor;
    for (const status of STATUSES) { const option = el('option', { 'not-run': 'Not run', pass: 'Pass, observed by me', fail: 'Fail', blocked: 'Blocked' }[status]); option.value = status; option.disabled = status === 'pass' && !ready; select.append(option); }
    select.value = state.manual[phase.id];
    select.addEventListener('change', () => { state = recordObservation(state, phase.id, select.value); save(); render(); $(select.id).focus(); });
    section.append(label, select); $('phases').append(section);
  }
  const count = Object.values(state.manual).filter(status => status === 'pass').length;
  $('summary').textContent = `${count} of ${PHASES.length} manual observations marked Pass. No automatic pass is inferred.`;
  $('report').value = createReport(state, source);
}
$('source-confirmed').addEventListener('change', () => { state = cleanState({ browser: state.browser, sourceConfirmed: $('source-confirmed').checked }, source); save(); render(); });
$('browser').addEventListener('change', () => { state = cleanState({ browser: $('browser').value, sourceConfirmed: state.sourceConfirmed }, source); save(); render(); });
$('fresh').addEventListener('click', () => { if (!window.confirm('Clear only this checklist? Copy its safe report first. No Drive data will change.')) return; state = cleanState({}, source); $('browser').value = state.browser; $('source-confirmed').checked = false; save(); render(); });
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(createReport(state, source)); $('report-status').textContent = 'Safe report copied.'; } catch { $('report').focus(); $('report').select(); $('report-status').textContent = 'Copy unavailable. Select and copy the report above.'; } });
$('download').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([createReport(state, source)], { type: 'application/json' })); const link = el('a'); link.href = url; link.download = 'synthetic-owner-acceptance.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); $('report-status').textContent = 'Download requested. Check Files to confirm it saved.'; });
window.addEventListener('pageshow', event => { if (event.persisted) render(); });
save(); render();
