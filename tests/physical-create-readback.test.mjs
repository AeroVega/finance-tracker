import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalDriveAdapter} from '../js/physical-drive-adapter.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';

async function fixture() {
  const bytes=new TextEncoder().encode('invented immutable body'),hash=await partitionDigest(bytes);
  const m={id:'invented-id',name:'invented.bin',mimeType:'application/octet-stream',parents:['invented-folder'],trashed:false,
    version:'1',size:String(bytes.length),appProperties:{financeTrackerKind:'snapshot-object',financeTrackerTransaction:'invented-tx',financeTrackerHash:hash}};
  let exists=false,reads=0,receipt;
  const adapter={folderId:'invented-folder',readMetadataSnapshot:async()=>new Map(exists?[[m.id,structuredClone(m)]]:[]),
    readMetadata:async()=>{reads++;return structuredClone(m);},readBytes:async()=>{reads++;return bytes.slice();},
    createImmutable:async input=>{await input.beforeMutation();exists=true;receipt={metadata:structuredClone(m),bytes:bytes.slice()};return {readback:receipt};}};
  const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:async()=>{}});
  return {physical,m,bytes,adapter,reads:()=>reads,receipt:()=>receipt,
    input:{fileId:m.id,name:m.name,kind:'snapshot-object',transactionId:'invented-tx',expectedSha256:hash,maxBytes:65536,beforeMutation:async()=>{}}};
}

test('create reuses detached exact-ID readback inside a closing metadata bracket',async()=>{
  const f=await fixture(),token=await f.physical.beginVerification();
  await f.physical.createImmutable(f.input);
  f.receipt().bytes.fill(0);f.receipt().metadata.version='999';
  assert.equal((await f.physical.readMetadata(f.m.id)).version,'1');
  assert.deepEqual(await f.physical.readBytes(f.m.id),f.bytes);
  assert.equal(f.reads(),0);
  await f.physical.closeVerification(token);
});

test('create receipt cannot hide a later changed binding at closure',async()=>{
  const f=await fixture(),token=await f.physical.beginVerification();
  await f.physical.createImmutable(f.input);f.m.name='changed.bin';
  await assert.rejects(f.physical.closeVerification(token),{code:'verification-metadata-changed'});
});

test('invalid receipt bytes fail closed before reuse',async()=>{
  const f=await fixture(),create=f.adapter.createImmutable;
  f.adapter.createImmutable=async input=>{const result=await create(input);result.readback.bytes.fill(0);return result;};
  const token=await f.physical.beginVerification();
  await assert.rejects(f.physical.createImmutable(f.input),{code:'hash-mismatch'});
  await assert.rejects(f.physical.closeVerification(token),{code:'hash-mismatch'});
});

test('create cannot populate a successor scope after invalidation',async()=>{
  const f=await fixture(),create=f.adapter.createImmutable;
  f.adapter.createImmutable=async input=>{const result=await create(input);f.physical.invalidateReadCache();return result;};
  await f.physical.beginVerification();
  await assert.rejects(f.physical.createImmutable(f.input),{code:'verification-scope-closed'});
});

test('scope closure drains an issued create and rejects new create admission',async()=>{
  const f=await fixture(),create=f.adapter.createImmutable;let release;
  const gate=new Promise(resolve=>release=resolve);
  f.adapter.createImmutable=async input=>{const result=await create(input);await gate;return result;};
  const token=await f.physical.beginVerification(),pending=f.physical.createImmutable(f.input);
  await new Promise(resolve=>setImmediate(resolve));
  let closed=false;const closing=f.physical.closeVerification(token).then(()=>closed=true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);
  await assert.rejects(f.physical.createImmutable(f.input),{code:'verification-scope-closed'});
  release();await pending;await closing;assert.equal(closed,true);
});
