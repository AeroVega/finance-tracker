import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {ScenarioFullSnapshotDrive} from './helpers/scenario-full-snapshot-drive.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
function setup(){
 const http=new ScenarioFullSnapshotDrive(),calls={fresh:0,connect:0};
 const create=()=>new FullSnapshotApplication({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,cryptoImpl:webcrypto,visibilityDelayMs:0,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null,isOnline:()=>true});
 const storage={lifecycle:null,async connect(){calls.connect++;this.lifecycle=create();await this.lifecycle.start({initialize:true});},createLedgerStore(){return this.lifecycle.createLedgerStore();},async reopenIndependent(){await this.lifecycle.release();this.lifecycle=create();calls.fresh++;await this.lifecycle.start();return this.lifecycle;},async release(){const result=await this.lifecycle.release();this.lifecycle=null;return result;}};
 return {http,storage,calls,session:new CanonicalWorkspaceSession({storage})};
}
test('backup excludes staged changes only after explicit consent and never replaces the draft',async()=>{
 const h=setup();h.session.preview(replayFixture(1).ledger);await h.session.savePreviewToNewCopy();const saved=structuredClone(h.session.ledger);
 h.session.correct({activityId:saved.activities[0].activityId,type:'category-correction',categoryId:'invented',rationale:'Invented'});const draft=structuredClone(h.session.ledger);
 await assert.rejects(h.session.exportBackup(),{code:'backup-staged-changes'});
 const raw=await h.session.exportBackup({excludeStaged:true});assert.deepEqual(h.session.ledger,draft);assert.equal(h.session.dirty,true);
 const target=setup();await target.session.importBackup(raw);assert.deepEqual(target.session.ledger,saved);assert.equal(target.http.mutations,0);assert.equal(target.session.backupPreview,true);
 await h.session.release();
});
test('restore validates locally then writes empty copy and uses fresh-instance reopen',async()=>{
 const source=setup();source.session.preview(replayFixture(2).ledger);await source.session.savePreviewToNewCopy();const raw=await source.session.exportBackup();const before=source.http.mutations;
 const target=setup();await target.session.importBackup(raw);assert.equal(target.calls.connect,0);await target.session.restoreBackupToNewCopy();assert.equal(target.calls.fresh,1);assert.deepEqual(target.session.ledger,source.session.ledger);assert.equal(target.session.backupPreview,false);assert.equal(source.http.mutations,before);
 await source.session.release();await target.session.release();
});
test('invalid backup never chooses a destination or changes the preview',async()=>{
 const h=setup();h.session.preview(replayFixture(1).ledger);const original=structuredClone(h.session.ledger);
 await assert.rejects(h.session.importBackup(new TextEncoder().encode('{}')));assert.deepEqual(h.session.ledger,original);assert.equal(h.calls.connect,0);assert.equal(h.http.mutations,0);
});
test('independent restore verification failure cannot report completed restore',async()=>{
 const s=setup();s.session.preview(replayFixture(1).ledger);await s.session.savePreviewToNewCopy();const raw=await s.session.exportBackup();
 const h=setup();await h.session.importBackup(raw);h.storage.reopenIndependent=async()=>{throw Object.assign(new Error('invented'),{code:'authorization-required'});};
 await assert.rejects(h.session.restoreBackupToNewCopy());assert.equal(h.session.unverified,true);assert.equal(h.session.needsReopen,true);assert.equal(h.session.backupPreview,true);await s.session.release();await h.storage.lifecycle.release().catch(()=>{});
});

test('encrypted backup validation precedes connection and preserves preview on wrong password',async()=>{
 const source=setup();source.session.preview(replayFixture(1).ledger);await source.session.savePreviewToNewCopy();const raw=await source.session.exportBackup({password:'invented-only-passphrase'});
 const target=setup();target.session.preview(replayFixture(2).ledger);const old=structuredClone(target.session.ledger);
 await assert.rejects(target.session.importBackup(raw,{password:'wrong-invented-password'}),{code:'backup-decryption-failed'});
 assert.deepEqual(target.session.ledger,old);assert.equal(target.calls.connect,0);assert.equal(target.http.mutations,0);
 await target.session.importBackup(raw,{password:'invented-only-passphrase'});assert.equal(target.calls.connect,0);assert.equal(target.http.mutations,0);assert.deepEqual(target.session.ledger,source.session.ledger);await source.session.release();
});
test('failed cold verification retains imported source and recheck uses a new instance',async()=>{
 const source=setup();source.session.preview(replayFixture(1).ledger);await source.session.savePreviewToNewCopy();const raw=await source.session.exportBackup();const sourceBefore=source.http.mutations;
 const h=setup();await h.session.importBackup(raw);const imported=structuredClone(h.session.ledger),reopen=h.storage.reopenIndependent;
 h.storage.reopenIndependent=async()=>{throw Object.assign(new Error('invented interruption'),{code:'authorization-required'});};
 await assert.rejects(h.session.restoreBackupToNewCopy());assert.deepEqual(h.session.backupSource,imported);assert.deepEqual(h.session.restoreExpected,imported);assert.equal(h.session.unverified,true);assert.equal(h.session.canSave(),false);
 const previous=h.storage.lifecycle;h.storage.reopenIndependent=reopen;assert.deepEqual(await h.session.resolveUncertainSave(),{outcome:'saved'});assert.notEqual(h.storage.lifecycle,previous);assert.equal(h.calls.fresh,1);assert.equal(h.session.backupPreview,false);assert.equal(h.session.unverified,false);assert.deepEqual(h.session.ledger,imported);assert.equal(source.http.mutations,sourceBefore);
 await source.session.release();await h.session.release();
});
test('changed restored contents fail independent verification without destroying backup source',async()=>{
 const source=setup();source.session.preview(replayFixture(1).ledger);await source.session.savePreviewToNewCopy();const raw=await source.session.exportBackup();const h=setup();await h.session.importBackup(raw);const imported=structuredClone(h.session.ledger),createStore=h.storage.createLedgerStore;
 const reopen=h.storage.reopenIndependent;h.storage.reopenIndependent=async function(){await reopen.call(this);this.createLedgerStore=()=>({load:async()=>replayFixture(2).ledger});};
 await assert.rejects(h.session.restoreBackupToNewCopy(),{code:'restore-verification-mismatch'});assert.equal(h.session.unverified,true);assert.deepEqual(h.session.backupSource,imported);assert.equal(h.session.backupPreview,true);
 h.storage.createLedgerStore=createStore;h.storage.reopenIndependent=reopen;await h.session.resolveUncertainSave();assert.equal(h.session.unverified,false);assert.deepEqual(h.session.ledger,imported);await source.session.release();await h.session.release();
});

for(const [name,rule,outcome] of [
 ['snapshot before',{category:'create',occurrence:1},'not-saved'],
 ['snapshot after',{category:'create',occurrence:1,after:true},'saved'],
 ['commit before',{category:'create',occurrence:2},'not-saved'],
 ['commit after',{category:'create',occurrence:2,after:true},'saved'],
 ['pending before',{category:'update',occurrence:1},'unverifiable'],
 ['pending after',{category:'update',occurrence:1,after:true},'saved'],
 ['final before',{category:'update',occurrence:2},'saved'],
 ['final after',{category:'update',occurrence:2,after:true},'saved'],
])test(`restore interruption ${name} preserves backup and requires independent verification`,async()=>{
 const {encodeFullSnapshotBackup}=await import('../js/full-snapshot-backup.mjs');const expected=replayFixture(1).ledger,raw=await encodeFullSnapshotBackup(expected),h=setup();await h.session.importBackup(raw);
 const connect=h.storage.connect;h.storage.connect=async function(...args){await connect.apply(this,args);h.http.phase='restore';h.http.fault({...rule,...(rule.category==='update'?{kind:'finance-tracker-full-snapshot-manifest'}:{}),effect:rule.after?'lost-response':'status',status:503});};
 try {
  if(outcome==='saved')await h.session.restoreBackupToNewCopy();else await assert.rejects(h.session.restoreBackupToNewCopy());
  assert.equal(h.http.rules[0].fired,true);assert.deepEqual(h.session.ledger,expected);
  if(outcome==='saved'){assert.equal(h.calls.fresh,1);assert.equal(h.session.backupPreview,false);assert.equal(h.session.unverified,false);}
  else {assert.equal(h.session.recoveryOutcome,outcome);assert.deepEqual(h.session.backupSource,expected);assert.equal(h.calls.fresh,0);assert.equal(h.session.backupPreview,true);
   if(outcome==='not-saved'){await h.session.retryUncertainSave({confirm:true});assert.equal(h.session.recoveryOutcome,'saved');assert.equal(h.calls.fresh,1);assert.equal(h.session.backupPreview,false);assert.deepEqual(h.session.ledger,expected);}
   else await assert.rejects(h.session.retryUncertainSave({confirm:true}),{code:'verified-retry-required'});
  }
 }finally {h.http.rules=[];h.http.reboot();await h.storage.lifecycle?.recover().catch(()=>{});await h.storage.lifecycle?.release().catch(()=>{});}
});

test('explicit restore recheck refreshes expired authorization after saved publication but before cold verification',async()=>{
 const {encodeFullSnapshotBackup}=await import('../js/full-snapshot-backup.mjs');const h=setup(),raw=await encodeFullSnapshotBackup(replayFixture(1).ledger);await h.session.importBackup(raw);
 const reopen=h.storage.reopenIndependent;let expired=true,refreshes=0;
 h.storage.reopenIndependent=async function(){if(expired)throw Object.assign(new Error('invented expiry'),{code:'authorization-required'});return reopen.call(this);};
 h.storage.refreshRecoveryAuthorization=async()=>{refreshes++;expired=false;};
 await assert.rejects(h.session.restoreBackupToNewCopy(),{code:'authorization-required'});assert.equal(h.session.pendingSave,null);assert.ok(h.session.restoreExpected);assert.equal(refreshes,0,'automatic recovery never asks for sign-in');
 try{assert.deepEqual(await h.session.resolveUncertainSave(),{outcome:'saved'});assert.equal(refreshes,1);assert.equal(h.calls.fresh,1);assert.equal(h.session.unverified,false);}
 finally{await h.storage.lifecycle?.release().catch(()=>{});}
});


test('restore recheck rejects changed destination before authorization or cold reopen',async()=>{
 const {encodeFullSnapshotBackup}=await import('../js/full-snapshot-backup.mjs');const h=setup();const backup=await encodeFullSnapshotBackup(replayFixture(1).ledger);await h.session.importBackup(backup);
 h.storage.reopenIndependent=async()=>{throw Object.assign(new Error('invented expiry'),{code:'authorization-required'});};await assert.rejects(h.session.restoreBackupToNewCopy());const original=h.storage.lifecycle;let auth=0,cold=0;
 h.storage.refreshRecoveryAuthorization=async()=>{auth++;};h.storage.reopenIndependent=async()=>{cold++;};h.storage.lifecycle={folderId:'invented-other-folder'};
 try{await assert.rejects(h.session.resolveUncertainSave(),{code:'verified-backup-required'});assert.equal(auth,0);assert.equal(cold,0);assert.equal(h.session.backupPreview,true);assert.equal(h.session.unverified,true);}
 finally{h.storage.lifecycle=original;await original.release().catch(()=>{});}
});

test('ordinary reopen cannot waive an incomplete independent restore verification',async()=>{
 const {encodeFullSnapshotBackup}=await import('../js/full-snapshot-backup.mjs');const h=setup();const backup=await encodeFullSnapshotBackup(replayFixture(1).ledger);await h.session.importBackup(backup);
 const reopen=h.storage.reopenIndependent;let checks=0;
 h.storage.reopenIndependent=async()=>{checks++;throw Object.assign(new Error('invented interruption'),{code:'authorization-required'});};
 await assert.rejects(h.session.restoreBackupToNewCopy());const expected=structuredClone(h.session.restoreExpected);
 await assert.rejects(h.session.reopen(),{code:'authorization-required'});
 await assert.rejects(h.session.loadVerified(),{code:'authorization-required'});
 assert.equal(checks,3);assert.equal(h.session.unverified,true);assert.deepEqual(h.session.restoreExpected,expected);assert.equal(h.session.canEdit(),false);
 h.storage.reopenIndependent=reopen;await h.session.reopen();assert.equal(h.calls.fresh,1);assert.equal(h.session.unverified,false);assert.equal(h.session.restoreExpected,null);
 await h.session.release();
});

test('open and release cannot discard outstanding restore verification',async()=>{
 const {encodeFullSnapshotBackup}=await import('../js/full-snapshot-backup.mjs');const h=setup();const backup=await encodeFullSnapshotBackup(replayFixture(1).ledger);await h.session.importBackup(backup);
 h.storage.reopenIndependent=async()=>{throw Object.assign(new Error('invented interruption'),{code:'authorization-required'});};await assert.rejects(h.session.restoreBackupToNewCopy());
 const original=h.storage.lifecycle,connects=h.calls.connect,expected=structuredClone(h.session.restoreExpected);
 await assert.rejects(h.session.open(),{code:'recovery-required'});await assert.rejects(h.session.release(),{code:'recovery-required'});
 assert.equal(h.calls.connect,connects);assert.equal(h.storage.lifecycle,original);assert.deepEqual(h.session.restoreExpected,expected);assert.equal(h.session.unverified,true);
 await original.release();
});

test('prewrite restore failure preserves preview until privacy release; retry imports the original backup again',async()=>{
 const {encodeFullSnapshotBackup}=await import('../js/full-snapshot-backup.mjs');const h=setup();const backup=await encodeFullSnapshotBackup(replayFixture(1).ledger);await h.session.importBackup(backup);
 const connect=h.storage.connect;h.storage.connect=async()=>{throw Object.assign(new Error('invented cancel'),{code:'picker-cancelled'});};
 await assert.rejects(h.session.restoreBackupToNewCopy());assert.equal(h.session.restoreFolderId,null);assert.equal(h.session.backupPreview,true);
 h.storage.connect=async function(){await connect.call(this);throw Object.assign(new Error('invented prewrite failure'),{code:'offline'});};
 await assert.rejects(h.session.restoreBackupToNewCopy());assert.equal(h.session.restoreFolderId,null);await h.session.release();assert.equal(h.storage.lifecycle,null);assert.equal(h.session.backupPreview,false);assert.equal(h.session.backupSource,null);assert.equal(h.session.ledger,null);
 // A new destination remains available; do not reuse the initialized partial folder.
 const target=setup();await target.session.importBackup(backup);await target.session.restoreBackupToNewCopy();assert.equal(target.session.unverified,false);await target.session.release();
});
