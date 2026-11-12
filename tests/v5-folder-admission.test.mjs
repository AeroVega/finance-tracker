import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPagedCanonicalCopy,initializePagedCanonicalCopy,PAGED_MANIFEST_NAME,PAGED_MANIFEST_KIND} from '../js/paged-application-storage.mjs';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';
import {partitionDigest} from '../js/canonical-partitions.mjs';

function fixture() {
  const drive=new HttpCatalogDrive();
  const adapter=new GoogleDriveTransactionAdapter({folderId:drive.folderId,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,visibilityDelayMs:0,visibilityMaxDelayMs:0});
  return {drive,adapter};
}
const guard=async()=>{};
for(const [version,canonicalProfile] of [[1,undefined],[2,'partitions-v4'],[3,'partitions-v5']]) {
  test(`unsupported initialization marker ${version}/${canonicalProfile} is refused without writes`,async()=>{
    const {drive,adapter}=fixture();
    const raw=new TextEncoder().encode(JSON.stringify({format:'finance-tracker-paged-initialization',version,syntheticOnly:true,...(canonicalProfile?{canonicalProfile}:{})}));
    await adapter.createImmutable({fileId:await adapter.allocateFileId(),name:PAGED_MANIFEST_NAME,kind:PAGED_MANIFEST_KIND,transactionId:'invented-transaction',content:raw,expectedSha256:await partitionDigest(raw),beforeMutation:guard});
    const before=structuredClone(drive.files),mutations=drive.mutations;
    await assert.rejects(inspectPagedCanonicalCopy(adapter),{code:'unsupported-canonical-profile'});
    await assert.rejects(initializePagedCanonicalCopy({adapter,guard}),{code:'unsupported-canonical-profile'});
    assert.equal(drive.mutations,mutations);assert.deepEqual(drive.files,before);
  });
}
test('v5 initialization and preflight preserve physical protocol 4 without writes',async()=>{
  const {drive,adapter}=fixture();
  const id=await initializePagedCanonicalCopy({adapter,guard});
  const before=structuredClone(drive.files),mutations=drive.mutations;
  const found=await inspectPagedCanonicalCopy(adapter);
  assert.equal(found.manifestFileId,id);assert.equal(found.manifest.version,4);
  assert.equal(drive.mutations,mutations);assert.deepEqual(drive.files,before);
});
for(const [name,mutate] of [
  ['unknown physical version',m=>{m.version=999;}],
  ['unknown head version',m=>{m.headCommit.version=999;}],
  ['unknown manifest field',m=>{m.unknown=true;}],
  ['foreign folder binding',m=>{m.storageBinding.folderId='invented-other-folder';}],
  ['unknown pending state',m=>{m.pending={state:'unknown'};}]
])test(`${name} is refused by preflight before any writes`,async()=>{
  const {drive,adapter}=fixture(),id=await initializePagedCanonicalCopy({adapter,guard});
  const manifest=await adapter.readJson(id);mutate(manifest);
  await adapter.publishManifest(id,manifest,{beforeMutation:guard});
  const before=structuredClone(drive.files),mutations=drive.mutations;
  await assert.rejects(inspectPagedCanonicalCopy(adapter));
  await assert.rejects(initializePagedCanonicalCopy({adapter,guard}));
  assert.equal(drive.mutations,mutations);assert.deepEqual(drive.files,before);
});
for(const [name,mutate] of [
  ['missing identity',m=>{delete m.databaseId;}],
  ['extra field',m=>{m.unknown=true;}],
  ['foreign folder',m=>{m.folderId='invented-other-folder';}],
  ['duplicate object IDs',m=>{m.commitFileId=m.rootFileId;}]
])test(`v5 initialization ${name} fails read-only admission`,async()=>{
  const {drive,adapter}=fixture();
  const marker={format:'finance-tracker-paged-initialization',version:2,canonicalProfile:'partitions-v5',syntheticOnly:true,
    folderId:adapter.folderId,databaseId:'invented-db',copyId:'invented-copy',transactionId:'invented-transaction',rootFileId:'invented-root',commitFileId:'invented-commit'};
  mutate(marker);const raw=new TextEncoder().encode(JSON.stringify(marker));
  await adapter.createImmutable({fileId:await adapter.allocateFileId(),name:PAGED_MANIFEST_NAME,kind:PAGED_MANIFEST_KIND,transactionId:'invented-transaction',content:raw,expectedSha256:await partitionDigest(raw),beforeMutation:guard});
  const before=structuredClone(drive.files),mutations=drive.mutations;
  await assert.rejects(inspectPagedCanonicalCopy(adapter),{code:'invalid-initialization'});
  await assert.rejects(initializePagedCanonicalCopy({adapter,guard}),{code:'invalid-initialization'});
  assert.equal(drive.mutations,mutations);assert.deepEqual(drive.files,before);
});
