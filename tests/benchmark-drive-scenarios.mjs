// Synthetic provider cost report; modeled latency is not measured Google performance.
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {ScenarioFullSnapshotDrive} from './helpers/scenario-full-snapshot-drive.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
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

for (const profile of ['stable','slow-server-settling']) {
  const h = setup(profile);
  const run = async (phase, fn) => {
    h.http.phase = phase;
    const start = performance.now(); await fn();
    const {events, ...summary} = h.http.scenarioSummary(phase);
    console.log(JSON.stringify({phase, localElapsedMs:performance.now()-start, ...summary,
      versionSettlements:events.length}));
  };
  try {
    h.session.preview((await createSyntheticFinancialYear()).ledger);
    await run('seed',()=>h.session.savePreviewToNewCopy());
    h.session.correct({activityId:h.session.ledger.activities[0].activityId,type:'category-correction',categoryId:'invented',rationale:'Invented'});
    const expected=structuredClone(h.session.ledger);
    await run('save',()=>h.session.save());
    await run('release',()=>h.session.release());
    await run('reopen',async()=>{const fresh=h.create();h.storage.lifecycle=fresh;await fresh.start({initialize:false});assert.deepEqual(await fresh.load(),expected);});
  } finally {await h.storage.lifecycle?.release();}
}
