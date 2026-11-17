import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {ScenarioFullSnapshotDrive, DRIVE_PROFILES} from './helpers/scenario-full-snapshot-drive.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
const manifestKind = 'finance-tracker-full-snapshot-manifest';
function setup(profile = 'server-settling') {
  const http = new ScenarioFullSnapshotDrive({profile});
  const create = () => new FullSnapshotApplication({folderId: http.folderId, accessToken: () => 'invented-test-token',
    fetchImpl: http.fetch, cryptoImpl: webcrypto, visibilityDelayMs: 0, setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}, lifecycleTarget: null, isOnline: () => true});
  const storage = {lifecycle: null,
    async connect(){this.lifecycle = create(); await this.lifecycle.start({initialize: true});},
    createLedgerStore(){return this.lifecycle.createLedgerStore();},
    async release(){const result = await this.lifecycle.release(); this.lifecycle = null; return result;}};
  return {http, storage, create, session: new CanonicalWorkspaceSession({storage, online: () => true})};
}
const cleanup = async h => {h.http.rules = []; h.http.reboot(); await h.storage.lifecycle?.release().catch(() => {});};
for (const profile of Object.keys(DRIVE_PROFILES)) test('provider profile lifecycle: ' + profile, async () => {
  const h = setup(profile);
  try {
    h.http.phase = 'seed'; h.session.preview(replayFixture(1).ledger); await h.session.savePreviewToNewCopy();
    h.session.correct({activityId:h.session.ledger.activities[0].activityId, type:'category-correction', categoryId:'invented', rationale:'Invented'});
    const expected = structuredClone(h.session.ledger);
    h.http.phase = 'save'; await h.session.save(); assert.equal(h.session.dirty, false);
    h.http.phase = 'release'; await h.session.release();
    h.http.phase = 'reopen'; const fresh = h.create(); h.storage.lifecycle = fresh;
    await fresh.start({initialize:false}); assert.deepEqual(await fresh.load(), expected);
    if (profile !== 'stable') assert.ok(h.http.events.length >= 5, 'server drift actually exercised');
    const summary = h.http.scenarioSummary('save');
    assert.equal(summary.categories.update, 2, 'two authority publications');
    assert.ok(summary.requestBytes > 0 && summary.responseBytes > 0);
    if (profile === 'slow-server-settling') assert.ok(summary.modeledServiceMs > 0);
  } finally {await cleanup(h);}
});

for (const occurrence of [1, 2]) test('lost manifest response at publication ' + occurrence + ' retains draft and requires recovery', async () => {
  const h = setup();
  try {
    h.session.preview(replayFixture(1).ledger); await h.session.savePreviewToNewCopy();
    h.session.correct({activityId:h.session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented',rationale:'Invented'});
    const draft = structuredClone(h.session.ledger);
    h.http.fault({category:'update', kind:manifestKind, occurrence, after:true, effect:'lost-response'});
    await assert.rejects(h.session.save()); assert.equal(h.http.rules[0].fired, true);
    assert.deepEqual(h.session.ledger,draft); assert.equal(h.session.unverified,true);
    assert.equal(h.storage.lifecycle.state,'recovery-required');
    await h.session.recover(); assert.equal(h.session.canSave(),false); assert.equal(h.session.needsReopen,true);
    await h.session.reopen(); assert.deepEqual(h.session.ledger,draft);
  } finally {await cleanup(h);}
});

for (const status of [401, 403, 429, 503]) test('provider refuses initial listing with ' + status + ' without writes', async () => {
  const h = setup();
  try {
    h.http.fault({category:'list', effect:'status', status});
    h.session.preview(replayFixture(1).ledger); await assert.rejects(h.session.savePreviewToNewCopy());
    assert.equal(h.http.rules[0].fired,true); assert.equal(h.http.mutations,0); assert.equal(h.session.mode,'preview');
  } finally {await cleanup(h);}
});

test('transport corruption is not accepted as benign version settling', async () => {
  const h = setup();
  try {
    h.session.preview(replayFixture(1).ledger); await h.session.savePreviewToNewCopy();
    h.http.fault({category:'media', kind:manifestKind, after:true, effect:'corrupt-media'});
    const before = h.http.mutations; await assert.rejects(h.session.reopen());
    assert.equal(h.http.rules[0].fired,true); assert.equal(h.http.mutations,before);
    assert.equal(h.storage.lifecycle.state,'recovery-required');
  } finally {await cleanup(h);}
});
