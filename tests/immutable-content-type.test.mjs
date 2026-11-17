import test from 'node:test';
import assert from 'node:assert/strict';
import {immutableContentType} from '../js/immutable-content-type.mjs';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';

async function fixture({kind='snapshot-object',returnedMime,corrupt=false,ambiguous=false,guardFailure=false}={}) {
  const http=new HttpCatalogDrive();let posts=0;
  const fetchImpl=async(url,options={})=>{
    if(options.method==='POST'){
      posts++;
      const {metadata}=await http.multipart(options);
      const type=immutableContentType(kind);
      assert.equal(metadata.mimeType,type);
      assert.match(new TextDecoder().decode(options.body),new RegExp('Content-Type: '+type+'\\r\\n\\r\\n'));
      const response=await http.fetch(url,options);
      const file=http.files.get(metadata.id);
      if(returnedMime!==undefined)file.metadata.mimeType=returnedMime;
      if(corrupt)file.bytes[0]^=1;
      if(ambiguous)throw new TypeError('invented lost POST response');
      return response;
    }
    return http.fetch(url,options);
  };
  const adapter=new GoogleDriveTransactionAdapter({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl,visibilityDelayMs:0,visibilityMaxDelayMs:0});
  const fileId=await adapter.allocateFileId();
  const bytes=new TextEncoder().encode('{"synthetic":true}');
  const input={fileId,name:'synthetic-name.json',kind,transactionId:'synthetic-tx',content:bytes,expectedSha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),maxBytes:65536,
    mimeType:'application/vnd.google-apps.document', // Never an accepted override.
    beforeMutation:async()=>{if(guardFailure)throw Object.assign(new Error('invented ownership loss'),{code:'ownership-lost'});}};
  return {http,adapter,input,posts:()=>posts};
}


test('snapshot MIME is binary and ignores caller coercion or filename',()=>{
  for(const kind of ['snapshot-object',undefined,{}, {toString(){throw Error('no coercion')}}])assert.equal(immutableContentType(kind),'application/octet-stream');
});
test('snapshot requests exact MIME and verifies detached bytes',async()=>{
  const f=await fixture();const saved=await f.adapter.createImmutable(f.input);
  assert.equal(saved.readback.metadata.mimeType,'application/octet-stream');
  assert.deepEqual(saved.readback.bytes,f.input.content);assert.equal(f.posts(),1);
  saved.readback.bytes[0]^=1;assert.deepEqual(f.http.files.get(f.input.fileId).bytes,f.input.content);
});
test('snapshot resolves a lost POST response by exact ID without another create',async()=>{
  const f=await fixture({ambiguous:true});await f.adapter.createImmutable(f.input);assert.equal(f.posts(),1);
});
test('snapshot MIME cannot mask changed bytes or ownership failure',async()=>{
  const corrupt=await fixture({corrupt:true});await assert.rejects(corrupt.adapter.createImmutable(corrupt.input),{code:'immutable-readback-mismatch'});assert.equal(corrupt.posts(),1);
  const denied=await fixture({guardFailure:true});await assert.rejects(denied.adapter.createImmutable(denied.input),{code:'ownership-lost'});assert.equal(denied.posts(),0);
});
test('409 exact snapshot ID never overwrites existing bytes',async()=>{
  const f=await fixture();
  f.http.files.set(f.input.fileId,{bytes:f.input.content.slice(),metadata:{id:f.input.fileId,name:f.input.name,mimeType:'application/octet-stream',parents:[f.http.folderId],trashed:false,version:'1',size:String(f.input.content.length),appProperties:{financeTrackerKind:f.input.kind,financeTrackerTransaction:f.input.transactionId,financeTrackerHash:f.input.expectedSha256}}});
  await f.adapter.createImmutable(f.input);assert.equal(f.posts(),1);assert.equal(f.http.mutations,0);
});
for(const field of ['financeTrackerKind','financeTrackerTransaction','financeTrackerHash'])test(`snapshot rejects a rebound ${field}`,async()=>{
  const f=await fixture(),fetch=f.adapter.fetch;
  f.adapter.fetch=async(...args)=>{const response=await fetch(...args);if(args[1]?.method==='POST')f.http.files.get(f.input.fileId).metadata.appProperties[field]='invented-wrong-binding';return response;};
  await assert.rejects(f.adapter.createImmutable(f.input),{code:'immutable-metadata-mismatch'});assert.equal(f.posts(),1);
});
