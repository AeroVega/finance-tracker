import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {initializePagedCanonicalCopy,PagedApplicationStorage} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {applyFinancialEvent} from '../js/canonical-import.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
function appFor(drive) { return new ApplicationStorageLifecycle({syntheticOnly:true,folderName:'invented synthetic',folderId:drive.folderId,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,makeManifest:()=>{},pagedCanonical:true,verificationPlans:canonicalPartitionVerificationPlans(),initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard}),adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null}); }
function cloneDrive(base) { const drive=new HttpCatalogDrive();drive.files=structuredClone(base.files);drive.nextId=base.nextId;return drive; }
async function open(drive) {const app=appFor(drive);await app.start();const store=new CanonicalLedgerStore({lifecycle:app});await store.load();return {app,store};}
for(const scenario of ['seed','correction']) test(`canonical two-activity ${scenario} survives every durable mutation before and after with a reconstructed binding`,async t=>{
 const ledger=replayFixture(2).ledger;
 const proposal=scenario==='seed'?ledger:applyFinancialEvent(ledger,{activityId:ledger.activities[0].activityId,type:'bank-correction',amountText:'-123.45',commandId:'invented-http-correction',evidence:{rationale:'Invented test correction'}});
 const base=new HttpCatalogDrive(), initial=await open(base);if(scenario==='correction')await initial.store.save(ledger);await initial.app.release();
 const probe=cloneDrive(base), baseline=await open(probe), events=[];const mutation=probe.mutate.bind(probe);
 probe.mutate=()=>{mutation();const row=probe.requests.at(-1),value=probe.json(row.fileId);events.push({at:events.length+1,key:row.kind==='paged-canonical-manifest'?'manifest-'+(value.pending?.state??'clean'):row.kind==='protocol-object'?value.format:row.kind});};
 const baselineOldRoot=baseline.store.base.root;await baseline.store.save(proposal); const expectedRoot=baseline.store.base.root;assert.notEqual(expectedRoot,baselineOldRoot); await baseline.app.release();
 const boundaries=events.filter(e=>e.key!=='session-marker');
 assert.ok(boundaries.length>=10);for(const required of ['finance-tracker-copy-object-plan','snapshot-object','locator-catalog-page','locator-catalog','manifest-admitted','finance-tracker-copy-root-receipt','manifest-ready','manifest-published','manifest-clean'])assert.ok(boundaries.some(e=>e.key===required),required);
 for(const phase of ['before','after'])for(const boundary of boundaries){
  const drive=cloneDrive(base),{app,store}=await open(drive),oldRoot=store.base.root;
  if(phase==='after')drive.stopAfterMutation=drive.mutations+boundary.at;
  else {let writes=0;drive.beforeResponse=({category})=>{if(['create','update'].includes(category)&&++writes===boundary.at){drive.stopped=true;drive.check();}};}
  await assert.rejects(store.save(proposal),`${phase} ${boundary.key}`);
  drive.beforeResponse=null;drive.reboot();
  // Deliberately discard all binding state and original preparation bodies.
  app.engine=new PagedApplicationStorage({adapter:app.transactionAdapter,manifestFileId:app.manifestFileId,verificationPlans:canonicalPartitionVerificationPlans(),assertWritable:()=>app.coordinator.assertCanWrite({online:true})});
  await app.recover();const recovered=new CanonicalLedgerStore({lifecycle:app});const actual=await recovered.load();
  assert.ok([oldRoot,expectedRoot].includes(recovered.base.root),`${phase} ${boundary.key}: exact old/new root`);
  assert.deepEqual(actual,recovered.base.root===expectedRoot?proposal:scenario==='seed'?null:ledger);
  await app.release();const reopened=await open(drive);assert.equal(reopened.store.base.root,recovered.base.root);await reopened.app.release();
 }
 t.diagnostic(JSON.stringify({scenario,categories:boundaries.map(e=>e.key),faultCases:boundaries.length*2,baseline:probe.summary()}));
});

for(const mutation of ['body-change','body-removal','locator-binding'])test(`semantic memo reuse cannot hide ${mutation} after durable readiness`,async()=>{
 const drive=new HttpCatalogDrive(),{app,store}=await open(drive),ledger=replayFixture(2).ledger;await store.save(ledger);
 const base=structuredClone(store.base),proposal=applyFinancialEvent(ledger,{activityId:ledger.activities[0].activityId,type:'bank-correction',amountText:'-77.00',commandId:'invented-memo-correction',evidence:{rationale:'Invented correction'}});
 const id=mutation==='locator-binding'?base.locatorRoot.fileId:[...drive.files].find(([,f])=>f.metadata.appProperties?.financeTrackerHash===base.root)[0];
 const original=structuredClone(drive.files.get(id));let attacked=false;
 app.transactionAdapter.afterMutation=({kind})=>{
  if(kind==='manifest' && drive.json(app.manifestFileId).pending?.state==='ready' && !attacked){
   attacked=true;if(mutation==='body-removal')drive.files.delete(id);
   else if(mutation==='body-change'){drive.files.get(id).bytes[0]^=1;drive.files.get(id).metadata.version=String(Number(original.metadata.version)+1);}
   else drive.files.get(id).metadata.appProperties.financeTrackerKind='unrelated';
  }
 };
 await assert.rejects(store.save(proposal));assert.ok(attacked);assert.equal(app.state,'recovery-required');
 app.transactionAdapter.afterMutation=null;original.metadata.version=String(Number(original.metadata.version)+2);drive.files.set(id,original);
 await app.recover();assert.deepEqual(await new CanonicalLedgerStore({lifecycle:app}).load(),proposal);await app.release();
});
