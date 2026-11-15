import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {setupHttpCanonicalWorkbench} from './helpers/pr28-http-workbench.mjs';
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
import {createOwnedPreparationReader,typedPreparationRead} from '../js/owned-preparation-reader.mjs';
import {createPhysicalDriveAdapter} from '../js/physical-drive-adapter.mjs';

let source=await readFile(new URL('../js/physical-root-binding.mjs',import.meta.url),'utf8');
source=source.replace('export class PhysicalRootBinding {','export class PhysicalRootBinding { testStage(value,manifest,preparation,signal) { return this.#stage(value,manifest,preparation,signal,true); }');
source=source.replace(/from '(\.\/[^']+)'/g,(_,path)=>'from '+JSON.stringify(new URL('../js/'+path.slice(2),import.meta.url).href));
source+='\n//# sourceURL=stage-probe-test-binding.mjs';
const {PhysicalRootBinding}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

// Exercise the real HTTP adapter with exactly eight held probes/creates.
for(const mode of ['success','eighth-probe-failure','cancel','late-write-failure','lost-response','collision'])test(`eight-way owned stage drains before returning: ${mode}`,async()=>{
 const h=await setupHttpCanonicalWorkbench();await h.driver.save(replayFixture(10).ledger);
 const manifest=h.http.json(h.manifestFileId),value=h.http.json(manifest.receiptHead.fileId).intent;
 const entries=[];let plan=value.planRoot;
 while(plan){const page=h.http.json(plan.fileId);entries.push(...page.entries);plan=page.previous;}
 assert.ok(entries.length>=8);
 const originals=new Map(entries.map(e=>[e.fileId,structuredClone(h.http.files.get(e.fileId))]));
 for(const e of entries)h.http.files.delete(e.fileId);
 const physical=createPhysicalDriveAdapter(h.lifecycle.transactionAdapter,{manifestFileId:h.manifestFileId,assertWritable:async()=>{}});
 const binding=new PhysicalRootBinding({adapter:physical,assertWritable:async()=>{},verificationPlans:new Map([[value.verificationPlan,async()=>{}]])});
 const preparation=typedPreparationRead(createOwnedPreparationReader(entries.map(e=>[e.sha256,originals.get(e.fileId).bytes])));
 const controller=new AbortController(),probed=new Set();let probes=0,probePeak=0,creates=0,createPeak=0,issued=0;
 let releaseProbe,releaseCreate;
 const probeGate=new Promise(r=>releaseProbe=r),createGate=new Promise(r=>releaseCreate=r);
 // Watchdog releases barriers on a concurrency regression, allowing useful assertions.
 const watchdog=setTimeout(()=>{releaseProbe();releaseCreate();},2000);
 const respond=h.http.respond.bind(h.http);let lost=false,collided=false,collisionId,collisionBytes;
 h.http.respond=async(target,options,category,id,row)=>{
  const createdId=category==='create'?(await h.http.multipart(options)).metadata.id:null;
  if(category==='create'&&originals.has(createdId)&&mode==='collision'&&!collided){
   collided=true;collisionId=createdId;const file=structuredClone(originals.get(createdId));file.bytes[0]^=1;collisionBytes=file.bytes.slice();h.http.files.set(createdId,file);
  }
  const result=await respond(target,options,category,id,row);
  if(category==='create'&&originals.has(createdId)&&mode==='lost-response'&&!lost){lost=true;throw new Error('Invented response lost after durable create');}
  return result;
 };
 h.http.beforeResponse=async({category,fileId})=>{
  if(category==='update')assert.equal(creates,0);
  if(category==='metadata'&&originals.has(fileId)&&!probed.has(fileId)&&probed.size<8){
   probed.add(fileId);const ordinal=probed.size;probes++;probePeak=Math.max(probePeak,probes);
   if(ordinal===8)releaseProbe();
   try{await probeGate;if(mode==='eighth-probe-failure'&&ordinal===8)throw Object.assign(new Error('Invented eighth probe refusal'),{code:'drive-request-failed',details:{status:403}});}
   finally{probes--;}
  }
  if(category==='create'){
   assert.equal(probes,0,'no create overlaps absence probes');
   const ordinal=++issued;creates++;createPeak=Math.max(createPeak,creates);
   if(ordinal===8){if(mode==='cancel')controller.abort();releaseCreate();}
   try{if(ordinal<=8)await createGate;if(mode==='late-write-failure'&&ordinal===8){await delay(20);throw Object.assign(new Error('Invented eighth create refusal'),{code:'drive-request-failed',details:{status:400}});}}
   finally{creates--;}
  }
 };
 const start=h.http.requests.length;
 try{
  const operation=binding.testStage(value,manifest,preparation,controller.signal);
  if(['success','lost-response'].includes(mode))await operation;else await assert.rejects(operation);
  assert.equal(probePeak,8);assert.equal(probes,0);assert.equal(creates,0);
  if(mode==='eighth-probe-failure')assert.equal(issued,0);else assert.equal(createPeak,8);
  assert.ok(createPeak<=8);
  if(!['success','lost-response'].includes(mode))assert.ok(issued<=8,`failure must not issue a second wave: ${issued}`);
  assert.deepEqual(h.http.json(h.manifestFileId),manifest);
  assert.equal(h.http.requests.slice(start).filter(r=>r.category==='update').length,0);
  if(['success','lost-response'].includes(mode))for(const e of entries)assert.deepEqual(h.http.files.get(e.fileId).bytes,originals.get(e.fileId).bytes);
  if(mode==='lost-response')assert.equal(lost,true);if(mode==='collision'){assert.equal(collided,true);assert.deepEqual(h.http.files.get(collisionId).bytes,collisionBytes,'collision bytes must not be overwritten');}
  const count=h.http.requests.length;await delay(30);assert.equal(h.http.requests.length,count,'all issued work drained');
 }finally{clearTimeout(watchdog);releaseProbe();releaseCreate();h.http.beforeResponse=null;h.http.respond=respond;await h.lifecycle.release().catch(()=>{});}
});
