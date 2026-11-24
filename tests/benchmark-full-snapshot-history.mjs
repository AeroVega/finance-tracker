// Invented workload only. No Google account, network or live quota use.
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {ScenarioFullSnapshotDrive} from './helpers/scenario-full-snapshot-drive.mjs';

const stages = [0, 4, 12];
const http = new ScenarioFullSnapshotDrive({profile:'slow-server-settling'});
const create = () => new FullSnapshotApplication({
  folderId:http.folderId, accessToken:()=>'invented-test-token', fetchImpl:http.fetch,
  cryptoImpl:webcrypto, visibilityDelayMs:0, setIntervalImpl:()=>1, clearIntervalImpl:()=>{},
  lifecycleTarget:null, isOnline:()=>true
});
let initialized = false;
const storage = {
  lifecycle:null,
  async connect() {
    this.lifecycle = create();
    await this.lifecycle.start({initialize:!initialized});
    initialized = true;
  },
  createLedgerStore() { return this.lifecycle.createLedgerStore(); },
  async release() {
    const result = await this.lifecycle.release();
    this.lifecycle = null;
    return result;
  }
};
const session = new CanonicalWorkspaceSession({storage,online:()=>true});
try {
  session.preview((await createSyntheticFinancialYear()).ledger);
  await session.savePreviewToNewCopy();
  for (let revision = 0; revision <= stages.at(-1); revision++) {
    if (revision) {
      http.phase = 'save-' + revision;
      session.correct({activityId:session.ledger.activities[0].activityId,type:'category-correction',
        categoryId:'invented-category-'+revision,rationale:'Invented capacity measurement'});
      await session.save();
    }
    if (!stages.includes(revision)) continue;
    const ledger = structuredClone(session.ledger);
    await session.release();
    http.phase = 'cold-open-' + revision;
    const reopened = create();
    try {
      await reopened.start({initialize:false});
      assert.deepEqual(await reopened.load(),ledger);
      const stats = http.scenarioSummary(http.phase);
      const snapshots = [...http.files.values()].filter(f =>
        f.metadata.appProperties?.financeTrackerKind === 'snapshot-object');
      assert.equal(snapshots.length, revision + 1);
      const snapshotBytes = snapshots.reduce((sum,f) => sum + Number(f.metadata.size),0);
      assert.ok(Number.isSafeInteger(snapshotBytes) && snapshotBytes > 0);
      console.log(JSON.stringify({
        changedSaves:revision, retainedSnapshots:snapshots.length, snapshotBytes,
        coldOpenRequests:stats.requests, coldOpenResponseBytes:stats.responseBytes,
        modeledServiceMs:Math.round(stats.modeledServiceMs)
      }));
    } finally {
      await reopened.release();
    }
    if (revision < stages.at(-1)) {
      http.phase = 'continue-' + revision;
      await session.open();
    }
  }
} finally {
  if (storage.lifecycle) await session.release();
}
