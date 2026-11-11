import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalDriveAdapter,getOwnedLocatorDecoder,snapshotPhysicalAdapter} from '../js/physical-drive-adapter.mjs';
import {canonicalizeJcs} from '../js/transaction-protocol.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';
import {PagedLocatorError} from '../js/paged-physical-locators.mjs';
const enc=new TextEncoder();
const profile={schema:'root',version:3,databaseId:'invented-db',copyId:'invented-copy',index:null,maxNodeBytes:65536,maxEntries:128,maxChildren:128};
const root={format:'finance-tracker-locator-catalog',version:3,databaseId:'invented-db',copyId:'invented-copy',generation:'0',previous:null,entryCount:'0',objects:null,identities:null,files:null};
async function fixture(){const bytes=enc.encode(canonicalizeJcs(root)),sha256=await partitionDigest(bytes);const physical=createPhysicalDriveAdapter({folderId:'invented-folder',readMetadataSnapshot:async()=>new Map()},{manifestFileId:'invented-manifest',assertWritable:async()=>{}});return {physical,decoder:getOwnedLocatorDecoder(physical),query:{bytes,sha256,profile}};}
test('owned locator decoder validates every hash and returns no mutable aliases',async()=>{
 const {physical,decoder,query}=await fixture();assert.equal(getOwnedLocatorDecoder({...physical}),null);assert.equal(getOwnedLocatorDecoder(snapshotPhysicalAdapter(physical)),decoder);
 const a=await decoder.decode(query);a.databaseId='changed';assert.deepEqual(await decoder.decode(query),root);
 await assert.rejects(decoder.decode({...query,bytes:new Uint8Array(query.bytes.length)}),{code:'hash-mismatch'});
 const bad=enc.encode(canonicalizeJcs({...root,extra:true}));await assert.rejects(decoder.decode({...query,bytes:bad,sha256:await partitionDigest(bad)}),{code:'invalid-shape'});
 for(const changed of [{copyId:'other'},{databaseId:'other'},{schema:'page',version:1,index:'objects'},{maxEntries:1},{index:'objects'}])await assert.rejects(decoder.decode({...query,profile:{...profile,...changed}}));
 await assert.rejects(decoder.decode({...query,profile:{...profile,copyId:'other'}}),e=>e instanceof PagedLocatorError);
});
test('locator decoder refuses cancelled and late invalidated hash completions',async()=>{
 const {physical,decoder,query}=await fixture();const controller=new AbortController();controller.abort();await assert.rejects(decoder.decode({...query,signal:controller.signal}),{name:'AbortError'});
 const original=crypto.subtle.digest.bind(crypto.subtle);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 crypto.subtle.digest=async(...args)=>{entered();await gate;return original(...args);};
 try{const pending=decoder.decode(query);await started;physical.invalidateReadCache();release();await assert.rejects(pending,{code:'verification-scope-closed'});}finally{crypto.subtle.digest=original;}
 assert.deepEqual(await decoder.decode(query),root);
});
test('locator decoder closure drains admitted hash work and rejects new admissions',async()=>{
 const {physical,decoder,query}=await fixture(),token=await physical.beginVerification();const original=crypto.subtle.digest.bind(crypto.subtle);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 crypto.subtle.digest=async(...args)=>{entered();await gate;return original(...args);};
 try{const pending=decoder.decode(query);await started;let done=false;const closing=physical.closeVerification(token).then(()=>done=true);await new Promise(r=>setTimeout(r,5));assert.equal(done,false);release();await pending;await closing;}finally{crypto.subtle.digest=original;}
});

test('locator decoder entry eviction falls back to real decoding without a storage ceiling',async()=>{
 const {decoder}=await fixture(),queries=[];
 for(let i=0;i<130;i++){const value={...root,generation:String(i+1),previous:{fileId:'invented-'+i,sha256:'1'.repeat(64)}},bytes=enc.encode(canonicalizeJcs(value));queries.push({bytes,sha256:await partitionDigest(bytes),profile});}
 const original=JSON.parse,text=new TextDecoder().decode(queries[0].bytes);let parses=0;
 JSON.parse=function(value,...args){if(value===text)parses++;return original(value,...args);};
 try{await decoder.decode(queries[0]);await decoder.decode(queries[0]);assert.equal(parses,1);for(const q of queries.slice(1))await decoder.decode(q);await decoder.decode(queries[0]);assert.equal(parses,2);}finally{JSON.parse=original;}
});

test('locator decoder serialized-byte eviction precedes its entry ceiling',async()=>{
 const {decoder}=await fixture(),queries=[],pageProfile={...profile,schema:'page',version:1,index:'identities'};
 for(let page=0;page<60;page++){
  const entries=Array.from({length:128},(_,i)=>['migration-record:'+String(page).padStart(3,'0')+String(i).padStart(3,'0')+'x'.repeat(230),'migration-record:'+'a'.repeat(64)]);
  const value={format:'finance-tracker-physical-locator-page',version:1,databaseId:profile.databaseId,copyId:profile.copyId,index:'identities',nodeType:'leaf',height:'0',count:'128',min:entries[0][0],max:entries.at(-1)[0],entries};
  const bytes=enc.encode(canonicalizeJcs(value));queries.push({bytes,sha256:await partitionDigest(bytes),profile:pageProfile});
 }
 assert.ok(queries.reduce((n,q)=>n+q.bytes.length,0)>2*1024*1024);
 const original=JSON.parse,text=new TextDecoder().decode(queries[0].bytes);let parses=0;
 JSON.parse=function(value,...args){if(value===text)parses++;return original(value,...args);};
 try{for(const q of queries)await decoder.decode(q);await decoder.decode(queries[0]);assert.equal(parses,2);}finally{JSON.parse=original;}
});

test('locator decode captures original cancellation despite request mutation',async()=>{
 const {decoder,query}=await fixture(),controller=new AbortController();const input={...query,signal:controller.signal};
 const original=crypto.subtle.digest.bind(crypto.subtle);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 crypto.subtle.digest=async(...args)=>{entered();await gate;return original(...args);};
 try{const pending=decoder.decode(input);await started;input.signal=undefined;controller.abort();release();await assert.rejects(pending,{name:'AbortError'});}finally{crypto.subtle.digest=original;}
});
