import {ApplicationStorageLifecycle} from '../../js/application-storage-lifecycle.mjs';
import {GoogleDriveTransactionAdapter} from '../../js/drive-transaction-engine.mjs';
import {canonicalPartitionVerificationPlans} from '../../js/canonical-paged-storage.mjs';
import {CanonicalLedgerStore} from '../../js/canonical-ledger-storage.mjs';
import {exportPagedCanonicalArchive,restorePagedCanonicalArchive,withSourceEvidenceVerification} from '../../js/paged-canonical-backup.mjs';
import {HttpCatalogDrive} from './http-catalog-drive.mjs';
const plans=()=>withSourceEvidenceVerification(canonicalPartitionVerificationPlans());
export async function restorePagedLedger(source) {
 const chunks=[];
 await exportPagedCanonicalArchive({sourceAdapter:source.transactionAdapter,sourceManifestFileId:source.manifestFileId,
   withSourceLock:fn=>source.coordinator.withWrite(fn),assertSourceWritable:async()=>{await source.coordinator.assertCanWrite({online:true});},verificationPlans:plans(),sink:{write:async bytes=>chunks.push(bytes)}});
 const target=new HttpCatalogDrive({folderId:'invented-restore-'+crypto.randomUUID()});
 const adapter=new GoogleDriveTransactionAdapter({folderId:target.folderId,accessToken:()=> 'invented-test-token',fetchImpl:target.fetch});
 const restored=await restorePagedCanonicalArchive({source:chunks,targetAdapter:adapter,withTargetLock:fn=>fn(),assertTargetWritable:async()=>{},verificationPlans:plans()});
 const lifecycle=new ApplicationStorageLifecycle({syntheticOnly:true,pagedCanonical:true,verificationPlans:plans(),folderName:'invented synthetic restore',folderId:target.folderId,
   manifestFileId:restored.manifestFileId,accessToken:()=> 'invented-test-token',fetchImpl:target.fetch,makeManifest:()=>{},setIntervalImpl:()=>1,clearIntervalImpl:()=>{},lifecycleTarget:null});
 await lifecycle.start();try{return await new CanonicalLedgerStore({lifecycle}).load();}finally{await lifecycle.release();}
}
