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

for(const mode of ['success','generic','permission','cancel-probe','callback-error','callback-cancel','exact-collision','wrong-collision','wrong-preparation','owned-wrong-preparation'])test(`owned stage probe gate preserves custom callback occurrence and evidence: ${mode}`,async()=>{
  const h=await setupHttpCanonicalWorkbench();await h.driver.save(replayFixture(10).ledger);
  const manifest=h.http.json(h.manifestFileId),value=h.http.json(manifest.receiptHead.fileId).intent;
  const entries=[];let plan=value.planRoot;
  while(plan){const page=h.http.json(plan.fileId);entries.push(...page.entries);plan=page.previous;}
  const originals=new Map(entries.map(e=>[e.fileId,structuredClone(h.http.files.get(e.fileId))]));
  const byHash=new Map(entries.map(e=>[e.sha256,e]));
  for(const e of entries)h.http.files.delete(e.fileId);
  const physical=createPhysicalDriveAdapter(h.lifecycle.transactionAdapter,{manifestFileId:h.manifestFileId,assertWritable:async()=>{}});
  const binding=new PhysicalRootBinding({adapter:mode==='generic'?{...physical}:physical,assertWritable:async()=>{},verificationPlans:new Map([[value.verificationPlan,async()=>{}]])});
  const controller=new AbortController(),seen=new Set(),calls=[];let probes=0,peak=0,inPreparation=0,triggered=false;
  h.http.beforeResponse=async({category,fileId})=>{
    if(category!=='metadata'||!originals.has(fileId)||seen.has(fileId))return;
    seen.add(fileId);probes++;peak=Math.max(peak,probes);
    const fail=['permission','cancel-probe'].includes(mode)&&!triggered&&probes===2;if(fail)triggered=true;
    try {await delay(fail?1:15);if(fail&&mode==='permission')throw Object.assign(new Error('invented permission rejection'),{code:'drive-request-failed',details:{status:403}});if(fail&&mode==='cancel-probe')controller.abort();}finally{probes--;}
  };
  const expectedCalls=entries.filter(e=>e.kind!=='commit-record'&&!(e.kind==='protocol-object'&&e.sha256===value.baseManifestHash)).map(e=>e.sha256);
  const preparation=async q=>{
    assert.equal(inPreparation,0);inPreparation++;calls.push(q.sha256);
    try {
      await delay(2);
      if(mode==='callback-error'&&calls.length===2)throw new Error('invented preparation failed');
      if(mode==='callback-cancel'&&calls.length===2)controller.abort();
      if(['exact-collision','wrong-collision'].includes(mode)&&calls.length===1){
        const next=byHash.get(expectedCalls[1]),file=structuredClone(originals.get(next.fileId));
        if(mode==='wrong-collision')file.bytes[0]^=1;
        h.http.files.set(next.fileId,file);
      }
      const bytes=originals.get(byHash.get(q.sha256).fileId).bytes.slice();
      if(mode==='wrong-preparation'&&calls.length===1)bytes[0]^=1;
      return bytes;
    }finally{inPreparation--;}
  };
  const trusted=['success','permission','cancel-probe','owned-wrong-preparation'].includes(mode);
  const ownedEntries=entries.map(e=>{const bytes=originals.get(e.fileId).bytes.slice();if(mode==='owned-wrong-preparation'&&e.sha256===expectedCalls[0])bytes[0]^=1;return [e.sha256,bytes];});
  const selected=trusted?typedPreparationRead(createOwnedPreparationReader(ownedEntries)):preparation;
  const before=h.http.requests.length;
  if(['success','generic','exact-collision'].includes(mode)){
    await binding.testStage(value,manifest,selected,controller.signal);
    assert.deepEqual(calls,trusted?[]:mode==='exact-collision'?expectedCalls.filter((_,i)=>i!==1):expectedCalls);
    for(const e of entries)assert.deepEqual(h.http.files.get(e.fileId).bytes,originals.get(e.fileId).bytes);
  }else{
    await assert.rejects(binding.testStage(value,manifest,selected,controller.signal));
    assert.deepEqual(calls,expectedCalls.slice(0,calls.length));
    if(['permission','cancel-probe'].includes(mode)){
      assert.equal(calls.length,0);assert.equal(seen.size,4);
      assert.equal(h.http.requests.slice(before).filter(r=>r.category==='create').length,0);
    }
  }
  assert.equal(probes,0);assert.equal(inPreparation,0);assert.ok(peak<=4);
  if(trusted)assert.equal(peak,4);if(mode==='generic')assert.equal(peak,1);
  assert.deepEqual(h.http.json(h.manifestFileId),manifest);
  assert.equal(h.http.requests.slice(before).filter(r=>r.category==='update').length,0);
  const count=h.http.requests.length;await delay(40);assert.equal(h.http.requests.length,count,'all issued work must drain');
  h.http.beforeResponse=null;
});
