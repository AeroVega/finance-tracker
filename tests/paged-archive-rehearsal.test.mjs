import test from 'node:test';
import assert from 'node:assert/strict';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {initializePagedCanonicalCopy} from '../js/paged-application-storage.mjs';
import {canonicalPartitionVerificationPlans} from '../js/canonical-paged-storage.mjs';
import {exportPagedCanonicalArchive} from '../js/paged-canonical-backup.mjs';
import {verifyPagedArchiveInMemory} from '../js/paged-archive-rehearsal.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';

test('guided archive rehearsal independently restores framed bytes in memory after source goes offline',async()=>{
  const drive=new HttpCatalogDrive(),adapter=new GoogleDriveTransactionAdapter({folderId:drive.folderId,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,visibilityDelayMs:0,visibilityMaxDelayMs:0});
  const manifestFileId=await initializePagedCanonicalCopy({adapter,guard:async()=>{}}),chunks=[];
  const exported=await exportPagedCanonicalArchive({sourceAdapter:adapter,sourceManifestFileId:manifestFileId,withSourceLock:fn=>fn(),assertSourceWritable:async()=>{},verificationPlans:canonicalPartitionVerificationPlans(),sink:{write:async chunk=>chunks.push(chunk)}});
  const mutations=drive.mutations;drive.stopped=true;
  const result=await verifyPagedArchiveInMemory(chunks,{verificationPlans:canonicalPartitionVerificationPlans()});
  assert.equal(result.rootHash,exported.root.canonical.sha256);assert.equal(result.revision,'0');assert.equal(drive.mutations,mutations);
  await assert.rejects(verifyPagedArchiveInMemory(chunks.slice(0,-1),{verificationPlans:canonicalPartitionVerificationPlans()}));
});
