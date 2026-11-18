import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CanonicalWorkspaceSession} from '../js/canonical-workspace-session.mjs';
import {pageController,deferred} from './helpers/page-controller.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';

async function setup(){
 let storage,session;const calls={exports:[],imports:[],saves:0,restores:0,rechecks:0,retries:0,gate:null,error:null};
 const imports={},source=await readFile(new URL('../js/canonical-workspace.mjs',import.meta.url),'utf8');
 for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){const module=await import(new URL('../js/'+match[2],import.meta.url));for(const name of match[1].split(',').map(x=>x.trim()))imports[name]=module[name];}
 imports.DashboardSyntheticStorage=class{constructor(options){storage=this;this.options=options;this.lifecycle=null;}async prepare(){return {};}};
 imports.CanonicalWorkspaceSession=class extends CanonicalWorkspaceSession{
  constructor(options){super(options);session=this;this.recoveryOutcome=null;this.backupPreview=false;}
  async exportBackup(options){calls.exports.push(options);if(calls.gate)await calls.gate.promise;if(calls.error)throw calls.error;return new TextEncoder().encode('{"invented":true}');}
  async importBackup(bytes,options){calls.imports.push({bytes,options});if(calls.gate)await calls.gate.promise;if(calls.error)throw calls.error;this.preview(replayFixture(1).ledger);this.backupPreview=true;}
  async restoreBackupToNewCopy(){calls.restores++;this.mode='saved';this.backupPreview=false;}
  async save(){calls.saves++;if(calls.error)throw calls.error;this.dirty=false;}
  async resolveUncertainSave(){calls.rechecks++;if(calls.gate)await calls.gate.promise;this.recoveryOutcome='not-saved';return {outcome:this.recoveryOutcome};}
  async retryUncertainSave(options){assert.equal(options.confirm,true);calls.retries++;this.recoveryOutcome='saved';this.unverified=false;this.dirty=false;}
 };
 const page=await pageController('canonical-workspace',imports,{htmlPath:'index.html',scriptPath:'js/canonical-workspace.mjs'});
 await page.until(()=>!page.get('preview-year').disabled);
 const refresh=async()=>{await page.event('online');};
 const saved=async({dirty=false,unverified=false}={})=>{storage.lifecycle={state:'ready',acceptingWrites:true,coordinator:{canWrite:true}};session.ledger=replayFixture(1).ledger;session.mode='saved';session.store={base:{},lifecycle:storage.lifecycle,valueCodec:'full-snapshot-v1'};session.dirty=dirty;session.unverified=unverified;session.needsReopen=false;await refresh();};
 return {page,calls,refresh,saved,get storage(){return storage;},get session(){return session;}};
}

test('dirty backup choices explicitly save first or exclude the draft, never silently save',async()=>{
 const h=await setup();await h.saved({dirty:true});
 assert.equal(h.page.get('export-backup').disabled,true);assert.equal(h.page.get('backup-saved-only').disabled,false);
 await h.page.click('backup-saved-only');assert.equal(h.calls.saves,0);assert.equal(h.calls.exports[0].excludeStaged,true);
 await h.page.click('backup-save-first');assert.equal(h.calls.saves,1);assert.equal(h.calls.exports[1].excludeStaged,false);
});

test('backup cancellation does not export and password is cleared on failure and repeat clicks',async()=>{
 const h=await setup();await h.saved();h.page.observed.confirm=false;
 await h.page.click('export-backup');assert.equal(h.calls.exports.length,0);
 h.page.observed.confirm=true;h.page.get('backup-encrypt').checked=true;await h.page.get('backup-encrypt').emit('change');h.page.get('backup-password').value='invented password';h.page.get('backup-password-confirm').value='invented password';
 h.calls.gate=deferred();h.calls.error=Object.assign(Error('invented'),{code:'offline'});
 const pending=h.page.click('export-backup');await h.page.until(()=>h.calls.exports.length===1);await h.page.click('export-backup');assert.equal(h.calls.exports.length,1);h.calls.gate.resolve();await pending;
 assert.equal(h.page.get('backup-password').value,'');assert.equal(h.page.get('backup-password-confirm').value,'');assert.equal(h.calls.exports[0].password,'invented password');
});

test('restore bounds bytes before reading and never picks a folder before local validation',async()=>{
 const h=await setup();let reads=0;
 h.page.get('backup-file').files=[{size:Number.MAX_SAFE_INTEGER,arrayBuffer(){reads++;throw Error('must not read');}}];await h.page.get('backup-file').emit('change');await h.page.click('stage-backup');assert.equal(reads,0);assert.equal(h.calls.imports.length,0);assert.equal(h.calls.restores,0);
 h.page.get('backup-file').files=[{size:2,async arrayBuffer(){reads++;return new TextEncoder().encode('{}').buffer;}}];await h.page.get('backup-file').emit('change');h.page.get('restore-password').value='invented restore password';
 await h.page.click('stage-backup');assert.equal(h.calls.imports.length,1);assert.equal(h.calls.restores,0);assert.equal(h.page.get('restore-password').value,'');assert.equal(h.session.mode,'preview');assert.equal(h.page.get('create-ledger').disabled,true);assert.equal(h.page.get('save-preview').disabled,true);
 await h.page.click('restore-backup');assert.equal(h.calls.restores,1);
});

test('restore is blocked by active session and cancellation preserves an existing draft',async()=>{
 const h=await setup();await h.saved();assert.equal(h.page.get('backup-file').disabled,true);assert.equal(h.page.get('stage-backup').disabled,true);
 h.storage.lifecycle=null;h.session.mode='preview';h.session.dirty=true;await h.refresh();h.page.observed.confirm=false;
 h.page.get('backup-file').files=[{size:2,async arrayBuffer(){assert.fail('cancel must not read');}}];await h.page.get('backup-file').emit('change');await h.page.click('stage-backup');assert.equal(h.calls.imports.length,0);assert.equal(h.session.dirty,true);
});

test('uncertain save permits a recheck, but retry requires conclusive not-saved and confirmation',async()=>{
 const h=await setup();await h.saved({dirty:true,unverified:true});h.session.recoveryOutcome='unverifiable';await h.refresh();assert.equal(h.page.get('retry-save').disabled,true);
 await h.page.click('verify-save-outcome');assert.equal(h.calls.rechecks,1);assert.equal(h.calls.retries,0);
 h.page.observed.confirm=false;await h.page.click('retry-save');assert.equal(h.calls.retries,0);
 h.page.observed.confirm=true;await h.page.click('retry-save');assert.equal(h.calls.retries,1);
});

test('restore failure clears password, retains draft, blocks repeats and warns before tab close',async()=>{
 const h=await setup();h.session.preview(replayFixture(1).ledger);h.session.dirty=true;const expected=structuredClone(h.session.ledger);await h.refresh();
 h.page.get('backup-file').files=[{size:2,async arrayBuffer(){return new TextEncoder().encode('{}').buffer;}}];await h.page.get('backup-file').emit('change');
 h.page.get('restore-password').value='invented secret';h.calls.gate=deferred();h.calls.error=Object.assign(Error('invented wrong password'),{code:'backup-decryption-failed'});
 const pending=h.page.click('stage-backup');await h.page.until(()=>h.calls.imports.length===1);await h.page.click('stage-backup');assert.equal(h.calls.imports.length,1);let warned=false;await h.page.event('beforeunload',{preventDefault(){warned=true;}});assert.equal(warned,true);
 h.calls.gate.resolve();await pending;assert.equal(h.page.get('restore-password').value,'');assert.deepEqual(h.session.ledger,expected);assert.equal(h.calls.restores,0);
});

test('different saved contents keep retry visible but disabled and encryption cannot silently use an empty password',async()=>{
 const h=await setup();await h.saved();h.page.get('backup-encrypt').checked=true;await h.page.get('backup-encrypt').emit('change');await h.page.click('export-backup');assert.equal(h.calls.exports.length,0);
 h.page.get('backup-password').value='do not persist';h.page.get('backup-encrypt').checked=false;await h.page.get('backup-encrypt').emit('change');assert.equal(h.page.get('backup-password').value,'');
 h.session.unverified=true;h.session.dirty=true;h.session.recoveryOutcome='different';await h.refresh();assert.equal(h.page.get('retry-save').disabled,true);assert.equal(h.page.get('retry-save').hidden,false);assert.match(h.page.get('retry-save-help').textContent,/must first prove this exact draft was not saved/);await h.page.click('retry-save');assert.equal(h.calls.retries,0);
});

test('mismatched backup password cannot save or export and clears both fields',async()=>{
 const h=await setup();await h.saved();h.page.get('backup-encrypt').checked=true;await h.page.get('backup-encrypt').emit('change');h.page.get('backup-password').value='invented one';h.page.get('backup-password-confirm').value='invented two';await h.page.click('export-backup');assert.equal(h.calls.exports.length,0);assert.equal(h.page.get('backup-password').value,'');assert.equal(h.page.get('backup-password-confirm').value,'');
});

test('outstanding restore verification blocks folder switching and release but allows verification',async()=>{
 const h=await setup();await h.saved({unverified:true});h.session.restoreExpected=structuredClone(h.session.ledger);h.session.restoreFolderId='invented-target';h.session.recoveryOutcome='unverifiable';await h.refresh();
 assert.equal(h.page.get('open-ledger').disabled,true);assert.equal(h.page.get('release-ledger').disabled,true);assert.equal(h.page.get('reopen-ledger').disabled,false);assert.equal(h.page.get('verify-save-outcome').disabled,false);
 h.session.restoreExpected=null;h.session.unverified=false;h.session.recoveryOutcome=null;await h.refresh();assert.equal(h.page.get('open-ledger').disabled,false);assert.equal(h.page.get('release-ledger').disabled,false);
});
