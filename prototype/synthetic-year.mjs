import { showDiagnostic, clearDiagnostic } from '../js/app-diagnostics.mjs';
import { DashboardSyntheticStorage } from '../js/dashboard-synthetic-storage.mjs';
import { SyntheticYearSeeder } from '../js/synthetic-year-seeder.mjs';

const $ = id => document.getElementById(id);
let busy = false, configured = false, writes = 0, started = 0, phase = '', phaseCode = 'starting', timer = null;
const messages = {
  preparing: 'Preparing the invented year locally…',
  checking: 'Checking the selected copy and existing canonical records…',
  saving: 'Saving invented canonical records with canonical v5 and recoverable root publication…',
  reopening: 'Independently reopening and comparing every canonical record…',
  verified: 'Exact saved year verified.'
};
function result(text, state = '') { $('result').textContent = text; $('result').dataset.state = state; }
function refresh() {
  const lifecycle = storage.lifecycle;
  const online = navigator.onLine !== false;
  const ready = lifecycle?.state === 'ready' && lifecycle.acceptingWrites && online;
  $('preview').disabled = busy;
  $('empty-confirmed').disabled = busy;
  $('upload').disabled = busy || !configured || !online || !$('empty-confirmed').checked || Boolean(lifecycle);
  $('reconnect').disabled = busy || !configured || !online;
  $('verify').disabled = busy || !ready;
  $('stale').disabled = busy || !online || lifecycle?.state !== 'stale-session';
  $('recover').disabled = busy || !online || lifecycle?.state !== 'recovery-required' || !lifecycle?.coordinator?.canWrite;
  $('release').disabled = busy || !lifecycle?.coordinator?.canWrite;
}
function progress() {
  if (!started) return;
  const seconds = Math.floor((Date.now() - started) / 1000);
  $('progress').textContent = `${phase} ${writes} verified durable writes in this operation. Elapsed ${Math.floor(seconds / 60)}m ${seconds % 60}s. This is not a completion percentage.`;
}
const storage = new DashboardSyntheticStorage({
  maintainOriginals: false,
  onStatus: status => {
    if (!status.code) clearDiagnostic($('connection'));
    $('connection').textContent = status.state === 'ready' ? 'Synthetic storage connected. Use the year result below to confirm the upload.' : status.code ? showDiagnostic({code: status.code}, {surface: 'synthetic-year', target: $('connection')}) : status.message;
    refresh();
  },
  afterMutation: () => { writes += 1; progress(); }
});
const seeder = new SyntheticYearSeeder({ onProgress: state => {
  phaseCode = state; phase = messages[state] || 'Checking…'; result(phase); progress();
} });
function previewResult(recipe) {
  const ledger = recipe.ledger;
  $('preview-result').textContent = `${ledger.accounts.length} invented accounts, ${ledger.imports.length} source imports, ${ledger.activities.length} activities, ${ledger.observations.length} source observations and ${ledger.events.length} audit events. New copies use canonical v5 with compact values and paged fallback. January–December 2025. No Drive write is needed for this preview.`;
}
async function verify() {
  const recipe = await seeder.verifyOrSeed(storage.lifecycle);
  previewResult(recipe);
  result(recipe.alreadySaved
    ? 'Verified: this copy already contains the exact invented year. No financial records were added or replaced. Release the session before opening another tool.'
    : 'Uploaded and independently verified the complete invented year. Release the session before opening another tool.', 'success');
}
async function run(operation) {
  if (busy) return;
  busy = true; writes = 0; started = Date.now(); phase = 'Starting…';
  phaseCode = 'starting';
  clearDiagnostic($('result'));
  refresh(); progress();
  timer = setInterval(progress, 1000);
  try { await operation(); }
  catch (error) {
    result(showDiagnostic(error, {surface: 'synthetic-year', target: $('result'), phase: phaseCode, verifiedDurableWrites: writes}), 'error');
  } finally { clearInterval(timer); timer = null; progress(); busy = false; refresh(); }
}
$('preview').addEventListener('click', () => run(async () => {
  phaseCode = 'preparing'; phase = 'Preparing local preview…'; progress(); previewResult(await seeder.preview());
  result('Invented year prepared locally. No Google connection or Drive write was requested.');
}));
$('upload').addEventListener('click', () => {
  if (!$('empty-confirmed').checked || storage.lifecycle || !configured || navigator.onLine === false) return;
  void run(async () => {
    result('Choose your newly created empty synthetic folder.');
    // Keep the Google authorization invocation in the user activation path.
    phaseCode = 'connecting'; phase = 'Acquiring the storage session and verifying initial setup…'; progress();
    await storage.connect({ requireEmpty: true, canonicalLayout: 'partitions-v5' });
    await seeder.admitFreshConnection(storage.lifecycle);
    await verify();
  });
});
$('reconnect').addEventListener('click', () => run(async () => {
  phaseCode = 'reconnecting';
  result('Choose the same synthetic year folder to verify it.');
  await storage.connect({ requireExisting: true });
  await verify();
}));
$('verify').addEventListener('click', () => run(verify));
$('recover').addEventListener('click', () => run(async () => { phaseCode = 'recovering'; await storage.lifecycle.recover(); await verify(); }));
$('stale').addEventListener('click', () => {
  if (!confirm('Confirm all prior tabs and devices using this synthetic folder have stopped.')) return;
  void run(async () => { phaseCode = 'recovering'; await storage.recoverStaleSession(); await verify(); });
});
$('release').addEventListener('click', () => run(async () => {
  phaseCode = 'releasing';
  const released = await storage.release();
  if (released?.released !== true) throw Object.assign(new Error('release-unconfirmed'), { code: 'release-unconfirmed' });
  result('Storage session released and verified. Saved records are unchanged. You can now open another tool.','success');
}));
$('empty-confirmed').addEventListener('change', refresh);
window.addEventListener('online', refresh);
window.addEventListener('offline', refresh);
window.addEventListener('beforeunload', event => {
  if (busy || storage.lifecycle?.started || storage.lifecycle?.releasePending) {
    event.preventDefault(); event.returnValue = '';
  }
});
refresh();
// Configuration/library loading is read-only. No token, Picker or Drive request
// starts until the user presses Upload or Reconnect.
storage.prepare().then(() => {
  configured = true; $('configuration').textContent = 'Google setup loaded. Nothing uploads until you choose a folder and confirm.'; refresh();
}).catch(error => {
  $('configuration').textContent = showDiagnostic(error, {surface: 'synthetic-year', target: $('configuration'), phase: 'configuration'});
  refresh();
});
