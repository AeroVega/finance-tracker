import test from 'node:test';
import assert from 'node:assert/strict';
import {LocatorBatchAdapter} from './helpers/paged-locator-batch-fixture.mjs';
import {createPhysicalDriveAdapter} from '../js/physical-drive-adapter.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';
async function fixture(count=16){const a=new LocatorBatchAdapter(),es=Array.from({length:count},(_,i)=>a.object(i)).sort((a,b)=>a.sha256.localeCompare(b.sha256));const root=await a.tree().build(es);a.readMetadataSnapshot=async()=>new Map([...a.files].map(([id,x])=>[id,structuredClone(x.metadata)]));const p=createPhysicalDriveAdapter(a,{manifestFileId:'unused',assertWritable:async()=>{}}),tree=createPagedPhysicalLocators(p,{databaseId:a.databaseId,copyId:a.copyId,folderId:a.folderId});return {a,p,tree,root};}
test('owned verification overlaps at most eight bodies and verifies all entries',async()=>{const {a,p,tree,root}=await fixture();const read=a.readBytes.bind(a);let active=0,peak=0,release;const barrier=new Promise(resolve=>{release=resolve;}); a.readBytes=async(id,o)=>{if(!id.startsWith('invented-body'))return read(id,o);active++;peak=Math.max(peak,active);if(active===8)release();await barrier;try{return await read(id,o);}finally{active--;}};const t=await p.beginVerification();assert.equal((await tree.verify(root)).entryCount,'16');await p.closeVerification(t);assert.equal(peak,8);assert.equal(active,0);});
test('a corrupt concurrent body refuses verification and drains issued reads',async()=>{const {a,p,tree,root}=await fixture();const read=a.readBytes.bind(a);let active=0,completed=0; a.readBytes=async(id,o)=>{if(!id.startsWith('invented-body'))return read(id,o);active++;await new Promise(r=>setTimeout(r,id.endsWith('00000000')?1:15));try{const b=await read(id,o);if(id.endsWith('00000000')){const c=b.slice();c[0]^=1;return c;}return b;}finally{active--;completed++;}};const t=await p.beginVerification();await assert.rejects(tree.verify(root),{code:'hash-mismatch'});assert.equal(active,0);assert.ok(completed>0);await assert.rejects(p.closeVerification(t));});
for(const mode of ['abort','invalidate'])test(`concurrent verification drains issued reads after ${mode}`,async()=>{const {a,p,tree,root}=await fixture();const read=a.readBytes.bind(a),controller=new AbortController();let active=0,triggered=false;a.readBytes=async(id,o)=>{if(!id.startsWith('invented-body'))return read(id,o);active++;await new Promise(r=>setTimeout(r,5));try{if(!triggered){triggered=true;if(mode==='abort')controller.abort();else p.invalidateReadCache();}return await read(id,o);}finally{active--;}};const t=await p.beginVerification();await assert.rejects(tree.verify(root,{signal:controller.signal}));assert.equal(active,0);assert.equal(triggered,true);await assert.rejects(p.closeVerification(t));});

for(const mode of ['rate-limit','corrupt','cancel'])test(`eight admitted body reads drain without another batch: ${mode}`,async()=>{
 const {a,p,tree,root}=await fixture(),read=a.readBytes.bind(a),controller=new AbortController();
 let issued=0,finished=0,active=0,release;
 const barrier=new Promise(resolve=>{release=resolve;});
 a.readBytes=async(id,options)=>{
  if(!id.startsWith('invented-body'))return read(id,options);
  const ordinal=++issued;active++;if(issued===8)release();
  try{
   await barrier;
   if(ordinal===1&&mode==='rate-limit')throw Object.assign(new Error('invented rate limit'),{code:'drive-request-failed',details:{status:429}});
   if(ordinal===1&&mode==='cancel')controller.abort();
   const bytes=await read(id,options);
   if(ordinal===1&&mode==='corrupt'){const corrupt=bytes.slice();corrupt[0]^=1;return corrupt;}
   return bytes;
  }finally{active--;finished++;}
 };
 const token=await p.beginVerification();
 await assert.rejects(tree.verify(root,{signal:controller.signal}),error=>{
  if(mode==='rate-limit'){assert.equal(error.code,'drive-request-failed');assert.equal(error.details.status,429);}
  if(mode==='corrupt')assert.equal(error.code,'hash-mismatch');
  return true;
 });
 assert.equal(issued,8);assert.equal(finished,8);assert.equal(active,0);
 await assert.rejects(p.closeVerification(token));
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(issued,8);
});

for(const count of [9,17])test(`owned verification drains a partial final batch: ${count} bodies`,async()=>{
 const {a,p,tree,root}=await fixture(count),read=a.readBytes.bind(a);
 let active=0,peak=0,issued=0,finished=0;
 a.readBytes=async(id,options)=>{
  if(!id.startsWith('invented-body'))return read(id,options);
  issued++;active++;peak=Math.max(peak,active);
  try{await new Promise(resolve=>setTimeout(resolve,5));return await read(id,options);}
  finally{active--;finished++;}
 };
 const token=await p.beginVerification();
 assert.equal((await tree.verify(root)).entryCount,String(count));
 await p.closeVerification(token);
 assert.equal(issued,count);assert.equal(finished,count);assert.equal(active,0);assert.ok(peak<=8);assert.ok(peak>1);
});
