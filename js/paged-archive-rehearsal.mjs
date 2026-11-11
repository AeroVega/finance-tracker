/** Read-only acceptance rehearsal. The entire framed archive and its temporary
 * destination materialize in memory; no Drive files are created or changed.
 * This uses the production restore/audit path, not a framing-only shortcut. */
import {restorePagedCanonicalArchive} from './paged-canonical-backup.mjs';
import {partitionDigest} from './canonical-partitions.mjs';

export async function verifyPagedArchiveInMemory(source,{verificationPlans,signal}={}) {
  const files=new Map(),folderId='synthetic-memory-rehearsal-'+globalThis.crypto.randomUUID();let serial=0;
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  const check=()=>{if(signal?.aborted)throw new DOMException('Rehearsal cancelled.','AbortError');};
  const lookup=id=>{check();const file=files.get(id);if(!file)fail('object-not-found');return file;};
  const adapter={folderId,
    allocateFileId:async()=>{check();return folderId+'-'+(++serial);},
    readMetadata:async id=>structuredClone(lookup(id).metadata),
    readBytes:async(id,{maxBytes=65536}={})=>{const raw=lookup(id).raw;if(raw.length>maxBytes)fail('byte-limit');return raw.slice();},
    readJson:async id=>JSON.parse(new TextDecoder().decode(lookup(id).raw)),
    readMetadataSnapshot:async()=>new Map([...files].map(([id,file])=>[id,structuredClone(file.metadata)])),
    async *iterateChildren(){check();for(const file of files.values())yield structuredClone(file.metadata);},
    async createImmutable({fileId,content,name,kind,transactionId,expectedSha256,maxBytes=65536,beforeMutation}) {
      check();if(files.has(fileId)||!(content instanceof Uint8Array))fail('invalid-memory-write');
      const raw=content.slice();if(raw.length>maxBytes||await partitionDigest(raw)!==expectedSha256)fail('memory-write-hash-mismatch');
      await beforeMutation();check();
      files.set(fileId,{raw,metadata:{id:fileId,name,parents:[folderId],trashed:false,version:'1',size:String(raw.length),
        appProperties:{financeTrackerKind:kind,financeTrackerTransaction:transactionId,financeTrackerHash:expectedSha256}}});
      return {fileId};
    }
  };
  try {
    const result=await restorePagedCanonicalArchive({source,targetAdapter:adapter,withTargetLock:fn=>fn(),assertTargetWritable:async()=>check(),verificationPlans,signal});
    return {rootHash:result.manifest.root,revision:result.manifest.revision,objectCount:result.objectCount};
  } finally {files.clear();}
}
