import assert from 'node:assert/strict';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {CanonicalLedgerStore} from '../js/canonical-ledger-storage.mjs';
import {PagedApplicationStorage,initializePagedCanonicalCopy} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {withSourceEvidenceVerification} from '../js/paged-canonical-backup.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
import {applyFinancialEvent} from '../js/canonical-import.mjs';
// Synthetic adapter only: this never reads credentials or contacts Drive.
// Subphases are nested/inclusive, not additive. FAST_SEED excludes setup latency.
const delay=Number(process.env.DELAY||0),http=new HttpCatalogDrive({latencyMs:process.env.FAST_SEED?0:delay});
const subphases=[],profiledBindings=new WeakSet();
const profile=async(name,fn)=>{
  const start=performance.now(),requestStart=http.requests.length;
  try{return await fn();}finally{
    const rows=http.requests.slice(requestStart);
    subphases.push({action:http.phase,name,ms:performance.now()-start,requests:rows.length});
  }
};
class ProfiledStorage extends PagedApplicationStorage {
  binding(...args){
    const binding=super.binding(...args);
    if(profiledBindings.has(binding))return binding;
    profiledBindings.add(binding);
    for(const name of ['verifyBaseline','prepare','transact','recover']){
      const original=binding[name].bind(binding);
      binding[name]=(...args)=>profile(name,()=>original(...args));
    }
    return binding;
  }
  transact(options){
    const original=options.prepare;
    return super.transact({...options,...(original?{prepare:(...args)=>profile('prepare-financial-root',()=>original(...args))}:{})});
  }
}
const make=()=>new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,factories:{createEngine:options=>new ProfiledStorage({...options,assertWritable:(...args)=>profile('remote-ownership',()=>options.assertWritable(...args))})},verificationPlans:withSourceEvidenceVerification(canonicalPartitionVerificationPlans()),folderName:'Invented synthetic benchmark',folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,lifecycleTarget:null,adapterOptions:{visibilityDelayMs:0,visibilityMaxDelayMs:0},makeManifest:()=>{},initializeManifest:({adapter,guard})=>initializePagedCanonicalCopy({adapter,guard})});
const phase=async(name,fn)=>{http.phase=name;const t=performance.now();await fn();console.log(JSON.stringify({name,delay,effectiveDelayMs:http.latencyMs,ms:performance.now()-t,...http.summary(name),subphases:subphases.filter(p=>p.action===name)}));};
let app=make(),store;let {ledger}=await createSyntheticFinancialYear();let changed;
const priorEdits=Number(process.env.PRIOR_EDITS||0);assert.ok(Number.isSafeInteger(priorEdits)&&priorEdits>=0&&priorEdits<=20);
console.log(JSON.stringify({benchmark:'open-save-v1',node:process.version,delayMs:delay,fastSeed:!!process.env.FAST_SEED,priorEdits,accounts:ledger.accounts.length,activities:ledger.activities.length,events:ledger.events.length}));
try{
await phase('initialize',async()=>{await app.start();store=new CanonicalLedgerStore({lifecycle:app});await store.load();});
await phase('seed',async()=>{
  await store.save(ledger);
  for(let i=0;i<priorEdits;i++){
    ledger=applyFinancialEvent(ledger,{activityId:ledger.activities[i].activityId,type:'posting-status-correction',lifecycleStatus:'pending',postedDate:null,commandId:'invented-prior-'+i,evidence:{rationale:'Invented earlier correction'}});
    await store.save(ledger);
  }
});
http.latencyMs=delay;
changed=applyFinancialEvent(ledger,{activityId:ledger.activities[priorEdits].activityId,type:'posting-status-correction',lifecycleStatus:'pending',postedDate:null,commandId:'invented-benchmark-correction',evidence:{rationale:'Invented correction'}});
await phase('single-save',()=>store.save(changed));
await phase('release',()=>app.release());
app=make();await phase('cold-reopen',async()=>{await profile('open-lifecycle',()=>app.start());store=new CanonicalLedgerStore({lifecycle:app});assert.deepEqual(await profile('load-ledger',()=>store.load()),changed);});
}finally{if(app.started)await app.release();}
