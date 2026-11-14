// Test-only physical genesis construction around independently frozen old archive bytes.
// This does not expose a migration operation or read any old live folder.
import {updatePartitionedCanonicalLedger,partitionDigest} from '../../js/canonical-partitions.mjs';
import {readVerifiedPartitionedLedger} from '../../js/canonical-paged-storage.mjs';
import {createPortableLogicalCommit,createPhysicalRootManifest,PORTABLE_COMMIT_FORMAT} from '../../js/physical-root-binding.mjs';
import {createPagedPhysicalLocators} from '../../js/paged-physical-locators.mjs';
import {PAGED_MANIFEST_NAME,PAGED_MANIFEST_KIND} from '../../js/paged-application-storage.mjs';
import {canonicalizeJcs} from '../../js/transaction-protocol.mjs';
const bytes=value=>new TextEncoder().encode(canonicalizeJcs(value));
export async function seedExistingMigration(fixture,dest) {
 const objects=new Map(),put=async raw=>{const hash=await partitionDigest(raw);objects.set(hash,{hash,bytes:raw,descriptor:{kind:'data-object',identity:hash}});return hash;};
 const store={write:put,read:async hash=>objects.get(hash).bytes};
 const {rootHash}=await updatePartitionedCanonicalLedger(fixture.ledger,store),reachable=new Set();
 await readVerifiedPartitionedLedger({read:async hash=>{reachable.add(hash);return store.read(hash);}},rootHash);
 for(const hash of objects.keys())if(!reachable.has(hash))objects.delete(hash);
 const raw=bytes({archive:fixture.archive,sourceManifest:fixture.sourceManifest});let next=null;
 for(let end=raw.length;end>0;){const start=Math.max(0,end-24000);next=await put(bytes({format:'finance-tracker-legacy-evidence-chunk',version:1,next,base64:Buffer.from(raw.subarray(start,end)).toString('base64')}));end=start;}
 const changeEvidenceRoot=await put(bytes({format:'finance-tracker-legacy-archive-evidence',version:1,databaseId:fixture.archive.manifest.databaseId,sourceCopyId:fixture.archive.sourceCopyId,sourceRevision:fixture.archive.manifest.revision,sourceManifestHash:await partitionDigest(bytes(fixture.sourceManifest)),archiveSha256:fixture.archive.archiveSha256,payloadSha256:await partitionDigest(raw),payloadBytes:String(raw.length),first:next}));
 const databaseId=fixture.archive.manifest.databaseId,copyId=crypto.randomUUID(),transactionId=crypto.randomUUID();
 const commit=createPortableLogicalCommit({databaseId,parent:null,revision:'0',previousRoot:null,root:rootHash,transactionId,operation:'migrate-legacy-v5',semanticVersion:'canonical-partitions-v5',changeEvidenceRoot});
 const commitBytes=bytes(commit),head=await partitionDigest(commitBytes);objects.set(head,{hash:head,bytes:commitBytes,descriptor:{kind:'commit-record',identity:head}});
 const entries=[];for(const item of objects.values()){
  const fileId=await dest.adapter.allocateFileId();await dest.adapter.createImmutable({fileId,name:'invented-existing-v5.bin',kind:item.descriptor.kind==='data-object'?'snapshot-object':item.descriptor.kind,transactionId,content:item.bytes,expectedSha256:item.hash,beforeMutation:async()=>{}});
  entries.push({...item.descriptor,fileId,sha256:item.hash});
 }
 const tree=createPagedPhysicalLocators(dest.adapter,{databaseId,copyId,folderId:dest.adapter.folderId,assertWritable:async()=>{}}),locatorRoot=await tree.build(entries.sort((a,b)=>(a.kind+':'+a.sha256).localeCompare(b.kind+':'+b.sha256)));
 const manifest=createPhysicalRootManifest({databaseId,copyId,folderId:dest.adapter.folderId,provider:'google-drive',revision:'0',root:rootHash,headCommit:{format:PORTABLE_COMMIT_FORMAT,version:4,sha256:head},locatorRoot});
 const manifestFileId=await dest.adapter.allocateFileId(),manifestBytes=bytes(manifest);await dest.adapter.createImmutable({fileId:manifestFileId,name:PAGED_MANIFEST_NAME,kind:PAGED_MANIFEST_KIND,transactionId,content:manifestBytes,expectedSha256:await partitionDigest(manifestBytes),beforeMutation:async()=>{}});
 return {manifest,manifestFileId,commit,objects};
}
