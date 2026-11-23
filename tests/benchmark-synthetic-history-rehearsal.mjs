// Local rehearsal only. HTTP-shaped simulator cannot contact Google.
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {createLedger, registerAccount, prepareCanonicalImport} from '../js/canonical-import.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {replayOptions, replayInput, replayRow} from './helpers/ledger-replay-fixtures.mjs';
import {ScenarioFullSnapshotDrive} from './helpers/scenario-full-snapshot-drive.mjs';

const options = replayOptions();
let ledger = registerAccount(createLedger(options),{institutionId:'sofi',name:'Invented household rehearsal',currency:'USD',accountType:'checking'},options);
const account = ledger.accounts[0], rows = [];
for (let month=0; month<36; month++) {
  const year = 2023+Math.floor(month/12);
  for (let row=0; row<50; row++) {
    const date = `${year}-${String(month%12+1).padStart(2,'0')}-${String(row%28+1).padStart(2,'0')}`;
    rows.push(replayRow(rows.length,{effectiveDate:date}));
  }
}
const input = replayInput(account,rows,'invented-three-year-rehearsal');
Object.assign(input.coverageByAccount[account.accountId],{start:'2023-01-01',end:'2025-12-31'});
ledger = prepareCanonicalImport(ledger,input,options).ledger;
assert.equal(ledger.activities.length,1800);

function setup(){
  const http = new ScenarioFullSnapshotDrive({profile:'stable'});
  const create = () => new FullSnapshotApplication({folderId:http.folderId,accessToken:()=> 'invented-test-token',
    fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,
    clearIntervalImpl:()=>{},lifecycleTarget:null,isOnline:()=>true});
  const storage = {lifecycle:null,
    async connect(){this.lifecycle = create(); await this.lifecycle.start({initialize:true});},
    createLedgerStore(){return this.lifecycle.createLedgerStore();},
    async release(){const result=await this.lifecycle.release(); this.lifecycle=null; return result;},
    async reopenIndependent(){await this.release(); this.lifecycle=create(); await this.lifecycle.start({initialize:false});}
  };
  return {http,storage,create,session:new CanonicalWorkspaceSession({storage,online:()=>true})};
}
async function run(h,phase,work){
  h.http.phase=phase;
  const start=performance.now(), value=await work();
  const {events,...metrics}=h.http.scenarioSummary(phase);
  console.log(JSON.stringify({phase,localElapsedMs:Math.round(performance.now()-start),...metrics}));
  return value;
}
const source=setup(), target=setup(), password='invented rehearsal only';
try {
  source.session.preview(ledger);
  console.log(JSON.stringify({months:36,activities:rows.length,accounts:1,changedSaves:6,initialLedgerBytes:Buffer.byteLength(canonicalizeJcs(ledger))}));
  await run(source,'seed',()=>source.session.savePreviewToNewCopy());
  for(let i=0;i<6;i++){
    source.session.correct({activityId:source.session.ledger.activities[i].activityId,type:'category-correction',
      categoryId:'invented-rehearsal',rationale:'Invented corrected category '+i});
    await run(source,'save-'+(i+1),()=>source.session.save());
  }
  const expected=structuredClone(source.session.ledger);
  await run(source,'release',()=>source.session.release());
  source.storage.lifecycle=source.create();
  await run(source,'cold-reopen',async()=>{
    await source.storage.lifecycle.start({initialize:false});
    await source.session.loadVerified();
    assert.deepEqual(source.session.ledger,expected);
  });
  const backup=await run(source,'encrypted-export',()=>source.session.exportBackup({password}));
  console.log(JSON.stringify({finalLedgerBytes:Buffer.byteLength(canonicalizeJcs(expected)),encryptedBackupBytes:backup.length}));
  await run(target,'local-backup-preview',()=>target.session.importBackup(backup,{password}));
  assert.equal(target.http.requests.length,0);
  await run(target,'restore-with-fresh-verification',()=>target.session.restoreBackupToNewCopy());
  assert.deepEqual(target.session.ledger,expected);
  assert.equal(target.session.unverified,false);
} finally {
  await source.storage.lifecycle?.release();
  await target.storage.lifecycle?.release();
}
