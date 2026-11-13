import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalDriveAdapter,getOwnedLocatorDecoder} from '../js/physical-drive-adapter.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';
async function fixture({persistent=false,corrupt=false,invalidate=false,field='size',recheckCorrupt=false,rejectOwnership=false,abort=false,mutateInput=false,changeDestination=false,invalidateMedia=false}={}) {
  const bytes=new TextEncoder().encode('synthetic locator'),hash=await partitionDigest(bytes);
  const metadata={id:'synthetic-id',name:'synthetic.json',mimeType:'application/octet-stream',parents:['synthetic-folder'],trashed:false,version:'1',size:String(bytes.length),appProperties:{financeTrackerKind:'locator-page',financeTrackerTransaction:'synthetic-tx',financeTrackerHash:hash}};
  const changed={size:'0',name:'other.json',mimeType:'application/json',appProperties:{...metadata.appProperties,financeTrackerKind:'wrong-kind'}};
  let creates=0,reads=0,physical;
  const adapter={folderId:'synthetic-folder',readMetadataSnapshot:async()=>new Map(creates?[[metadata.id,structuredClone(metadata)]]:[]),
    createImmutable:async input=>{creates++;if(mutateInput){input.name='changed-input';input.fileId='changed-input-id';input.expectedSha256='0'.repeat(64);}return {readback:{metadata:{...metadata,[field]:changed[field]},bytes:corrupt?new Uint8Array(bytes.length):bytes}};},
    readMetadata:async(id)=>{assert.equal(id,metadata.id);reads++;if(changeDestination)adapter.folderId='changed-folder';if(invalidate)physical.invalidateReadCache();return {...metadata,...(persistent?{[field]:changed[field]}:{})};},
    readBytes:async(id)=>{assert.equal(id,metadata.id);if(invalidateMedia)physical.invalidateReadCache();return recheckCorrupt?new Uint8Array(bytes.length):bytes.slice();}};
  const controller=new AbortController();
  physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{if(rejectOwnership)throw Object.assign(new Error('synthetic ownership loss'),{code:'ownership-lost'});if(abort)controller.abort();}});
  const token=await physical.beginVerification();
  return {physical,token,metadata,counts:()=>({creates,reads}),input:{fileId:metadata.id,name:metadata.name,kind:'locator-page',transactionId:'synthetic-tx',expectedSha256:hash,maxBytes:65536,signal:controller.signal}};
}
test('new immutable metadata convergence rereads same ID without rewriting or invalidating locator owner',async()=>{
  const f=await fixture(),owner=getOwnedLocatorDecoder(f.physical).captureRead();
  await f.physical.createImmutable(f.input);owner.assertCurrent();
  assert.deepEqual(f.counts(),{creates:1,reads:1});
});
test('persistent metadata mismatch is bounded and invalidates locator readback owner secondarily',async()=>{
  const f=await fixture({persistent:true}),owner=getOwnedLocatorDecoder(f.physical).captureRead();
  await assert.rejects(f.physical.createImmutable(f.input),e=>e.code==='hash-mismatch'&&e.details.fields.includes('size'));
  assert.throws(()=>owner.assertCurrent(),{code:'verification-scope-closed'});
  assert.deepEqual(f.counts(),{creates:1,reads:2});
});
test('corrupt create body never receives metadata convergence retries',async()=>{
  const f=await fixture({corrupt:true});await assert.rejects(f.physical.createImmutable(f.input),{code:'hash-mismatch'});
  assert.deepEqual(f.counts(),{creates:1,reads:0});
});
test('scope invalidation during fresh receipt metadata read refuses admission',async()=>{
  const f=await fixture({invalidate:true});await assert.rejects(f.physical.createImmutable(f.input),{code:'verification-scope-closed'});
  assert.deepEqual(f.counts(),{creates:1,reads:1});
});

for(const field of ['name','mimeType','appProperties'])test(`persistent ${field} binding mismatch is never normalized away`,async()=>{
  const f=await fixture({persistent:true,field});
  await assert.rejects(f.physical.createImmutable(f.input),e=>e.code==='hash-mismatch'&&e.details.fields.includes(field));
  assert.deepEqual(f.counts(),{creates:1,reads:2});
});

for(const [option,code] of [['rejectOwnership','ownership-lost'],['abort',undefined],['recheckCorrupt','hash-mismatch']])test(`revalidation refuses ${option}`,async()=>{
  const f=await fixture({[option]:true});
  await assert.rejects(f.physical.createImmutable(f.input),e=>code?e.code===code:e.name==='AbortError');
  assert.equal(f.counts().creates,1);
  assert.equal(f.counts().reads,option==='recheckCorrupt'?1:0);
});
test('converged create still requires unchanged metadata at scope closure',async()=>{
  const f=await fixture();await f.physical.createImmutable(f.input);
  f.metadata.name='changed-later.json';
  await assert.rejects(f.physical.closeVerification(f.token),{code:'verification-metadata-changed'});
});

test('HTTP create receipt with transient size converges through exact-ID GETs, one POST, and verified closure',async()=>{
  const {HttpCatalogDrive}=await import('./helpers/http-catalog-drive.mjs');
  const {GoogleDriveTransactionAdapter}=await import('../js/drive-transaction-engine.mjs');
  const http=new HttpCatalogDrive();let altered=false;const metadataIDs=[];
  const fetchImpl=async(url,options)=>{
    const response=await http.fetch(url,options),parsed=new URL(url);
    if((options?.method||'GET')==='GET'&&/\/files\/[^/]+$/.test(parsed.pathname)&&!parsed.searchParams.has('alt')&&!parsed.pathname.endsWith('/generateIds')){
      metadataIDs.push(parsed.pathname.split('/').at(-1));
      if(!altered&&response.ok){altered=true;const metadata=await response.json();return new Response(JSON.stringify({...metadata,size:'0'}),{status:200,headers:{'Content-Type':'application/json'}});}
    }
    return response;
  };
  const adapter=new GoogleDriveTransactionAdapter({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl});
  const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}});
  const token=await physical.beginVerification(),fileId=await adapter.allocateFileId();
  const bytes=new TextEncoder().encode('synthetic locator HTTP body'),hash=await partitionDigest(bytes);
  await physical.createImmutable({fileId,name:'synthetic.json',kind:'locator-page',transactionId:'synthetic-tx',content:bytes,expectedSha256:hash,maxBytes:65536,beforeMutation:async()=>{}});
  await physical.closeVerification(token);
  assert.equal(altered,true);assert.deepEqual(metadataIDs,[fileId,fileId]);assert.equal(http.mutations,1);
});

test('returned converged receipt is detached and retains captured binding despite input mutation',async()=>{
  const f=await fixture({mutateInput:true});
  const receipt=await f.physical.createImmutable(f.input);
  assert.equal(receipt.readback.metadata.id,'synthetic-id');
  assert.equal(receipt.readback.metadata.name,'synthetic.json');
  assert.equal(receipt.readback.metadata.size,String(receipt.readback.bytes.length));
  receipt.readback.metadata.name='mutated-receipt';receipt.readback.bytes.fill(0);
  const m=await f.physical.readMetadata('synthetic-id');
  assert.equal(m.name,'synthetic.json');
  assert.equal(new TextDecoder().decode(await f.physical.readBytes('synthetic-id')),'synthetic locator');
});
for(const [option,code] of [['changeDestination','copy-mismatch'],['invalidateMedia','verification-scope-closed']])test(`revalidation rejects ${option}`,async()=>{
  const f=await fixture({[option]:true});
  await assert.rejects(f.physical.createImmutable(f.input),{code});
  assert.equal(f.counts().creates,1);
});
