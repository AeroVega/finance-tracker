import test from 'node:test';
import assert from 'node:assert/strict';
import {immutableContentType} from '../js/immutable-content-type.mjs';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {createPhysicalDriveAdapter} from '../js/physical-drive-adapter.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';

async function fixture({kind='locator-catalog-page',returnedMime,corrupt=false,ambiguous=false,guardFailure=false}={}) {
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
  const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}});
  const token=await physical.beginVerification(),fileId=await adapter.allocateFileId();
  const bytes=new TextEncoder().encode('{"synthetic":true}');
  const input={fileId,name:'synthetic-name.json',kind,transactionId:'synthetic-tx',content:bytes,expectedSha256:await partitionDigest(bytes),maxBytes:65536,
    mimeType:'application/vnd.google-apps.document', // Never an accepted override.
    beforeMutation:async()=>{if(guardFailure)throw Object.assign(new Error('invented ownership loss'),{code:'ownership-lost'});}};
  return {http,adapter,physical,token,input,posts:()=>posts};
}

test('MIME selection uses exact internal kinds only, never coercion or filename',()=>{
  for(const kind of ['locator-catalog','locator-catalog-page'])assert.equal(immutableContentType(kind),'application/json');
  for(const kind of ['snapshot-object','protocol-object','journal-event','locator-page','locator-catalog-private',undefined,{}, {toString(){throw Error('no coercion')}}])assert.equal(immutableContentType(kind),'application/octet-stream');
});
for(const kind of ['locator-catalog','locator-catalog-page','snapshot-object'])test(`${kind} requests and verifies its exact MIME and detached bytes`,async()=>{
  const f=await fixture({kind});const saved=await f.physical.createImmutable(f.input);
  assert.equal(saved.readback.metadata.mimeType,immutableContentType(kind));
  assert.deepEqual(saved.readback.bytes,f.input.content);
  await f.physical.closeVerification(f.token);assert.equal(f.posts(),1);
});
for(const kind of ['locator-catalog','locator-catalog-page'])test(`${kind} resolves a lost POST response by exact ID without another create`,async()=>{
  const f=await fixture({kind,ambiguous:true});await f.physical.createImmutable(f.input);
  await f.physical.closeVerification(f.token);assert.equal(f.posts(),1);
});
for(const returnedMime of ['application/octet-stream','text/plain','application/vnd.google-apps.document','application/json; charset=utf-8'])test(`new JSON receipt refuses unrequested type ${returnedMime}`,async()=>{
  const f=await fixture({returnedMime});
  await assert.rejects(f.physical.createImmutable(f.input),error=>error.code==='hash-mismatch'&&error.details.fields.includes('mimeType')&&error.details.expectedMimeClass==='json');
  assert.equal(f.posts(),1);await assert.rejects(f.physical.closeVerification(f.token));
});
test('binary object cannot borrow the JSON locator receipt allowance',async()=>{
  const f=await fixture({kind:'snapshot-object',returnedMime:'application/json'});
  await assert.rejects(f.physical.createImmutable(f.input),error=>error.code==='hash-mismatch'&&error.details.expectedMimeClass==='octet-stream');
  assert.equal(f.posts(),1);
});
test('JSON MIME cannot mask changed bytes or ownership failure',async()=>{
  const corrupt=await fixture({corrupt:true});await assert.rejects(corrupt.physical.createImmutable(corrupt.input),{code:'immutable-readback-mismatch'});assert.equal(corrupt.posts(),1);
  const denied=await fixture({guardFailure:true});await assert.rejects(denied.physical.createImmutable(denied.input),{code:'ownership-lost'});assert.equal(denied.posts(),0);
});
test('legacy octet-stream locator roots and pages reopen without rewriting; mixed catalog remains readable',async()=>{
  const http=new HttpCatalogDrive();
  const adapter=new GoogleDriveTransactionAdapter({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch});
  const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}});
  const scope={databaseId:'synthetic-database',copyId:'synthetic-copy',folderId:http.folderId,assertWritable:async()=>{}};
  let token=await physical.beginVerification();
  const bytes=new TextEncoder().encode('synthetic payload'),sha256=await partitionDigest(bytes),fileId=await adapter.allocateFileId();
  await physical.createImmutable({fileId,name:'synthetic.bin',kind:'snapshot-object',transactionId:'synthetic-tx',content:bytes,expectedSha256:sha256,maxBytes:65536,beforeMutation:async()=>{}});
  const entry={kind:'data-object',identity:sha256,fileId,sha256};
  const tree=createPagedPhysicalLocators(physical,scope),root=await tree.build([entry]);
  assert.ok([...http.files.values()].some(file=>file.metadata.appProperties.financeTrackerKind==='locator-catalog-page'));
  await physical.closeVerification(token);
  for(const file of http.files.values())file.metadata.mimeType='application/octet-stream';
  const mutations=http.mutations;
  physical.invalidateReadCache();token=await physical.beginVerification();
  assert.equal((await tree.verify(root)).entryCount,'1');
  await physical.closeVerification(token);assert.equal(http.mutations,mutations);
  // A new JSON catalog can coexist with and retain readable legacy pages.
  token=await physical.beginVerification();const next=await tree.build([entry]);await physical.closeVerification(token);
  physical.invalidateReadCache();token=await physical.beginVerification();
  await tree.verify(root);await tree.verify(next);await physical.closeVerification(token);
});

for(const mimeType of ['application/json','application/octet-stream'])test(`409 exact ID with ${mimeType} never overwrites or relaxes new receipt type`,async()=>{
  const f=await fixture();
  f.http.files.set(f.input.fileId,{bytes:f.input.content.slice(),metadata:{id:f.input.fileId,name:f.input.name,mimeType,parents:[f.http.folderId],trashed:false,version:'1',size:String(f.input.content.length),appProperties:{financeTrackerKind:f.input.kind,financeTrackerTransaction:f.input.transactionId,financeTrackerHash:f.input.expectedSha256}}});
  if(mimeType==='application/json'){await f.physical.createImmutable(f.input);await f.physical.closeVerification(f.token);}
  else await assert.rejects(f.physical.createImmutable(f.input),error=>error.code==='hash-mismatch'&&error.details.fields.includes('mimeType'));
  assert.equal(f.posts(),1);assert.equal(f.http.mutations,0);
  assert.equal(f.http.files.get(f.input.fileId).metadata.mimeType,mimeType);
});
test('MIME changes within a verification bracket still poison closure',async()=>{
  const f=await fixture();await f.physical.createImmutable(f.input);
  f.http.files.get(f.input.fileId).metadata.mimeType='application/octet-stream';
  await assert.rejects(f.physical.closeVerification(f.token),error=>error.code==='verification-metadata-changed'&&error.details.fields.includes('mimeType'));
  assert.equal(f.posts(),1);
});
for(const field of ['financeTrackerKind','financeTrackerTransaction','financeTrackerHash'])test(`JSON cannot mask a rebound ${field}`,async()=>{
  const f=await fixture(),create=f.adapter.createImmutable.bind(f.adapter);
  f.adapter.createImmutable=async input=>{
    const result=await create(input);
    result.readback.metadata.appProperties[field]='invented-wrong-binding';
    f.http.files.get(input.fileId).metadata.appProperties[field]='invented-wrong-binding';
    return result;
  };
  await assert.rejects(f.physical.createImmutable(f.input),error=>error.code==='hash-mismatch'&&error.details.fields.includes('appProperties'));
  assert.equal(f.posts(),1);
});
