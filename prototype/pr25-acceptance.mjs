import { clearDiagnostic, showDiagnostic } from "../js/app-diagnostics.mjs";
import { DashboardSyntheticStorage, requireEmptySyntheticFolder } from "../js/dashboard-synthetic-storage.mjs";
import { GoogleDriveTransactionAdapter } from "../js/drive-transaction-engine.mjs";
import { SessionCoordinator } from "../js/session-coordination.mjs";
import { createDriveSessionAdapter } from "../js/drive-session-adapter.mjs";
import { chooseSyntheticFolder } from "../js/synthetic-folder-picker.mjs";
import { inspectPagedCanonicalCopy } from "../js/paged-application-storage.mjs";
import { canonicalPartitionVerificationPlans } from "../js/canonical-paged-storage.mjs";
import { backupPagedCanonicalCopy, exportPagedCanonicalArchive, restorePagedCanonicalArchive } from "../js/paged-canonical-backup.mjs";
import { storageError } from "../js/catalog-storage.mjs";

function authorizeCopyGuide(storage) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({ client_id: storage.config.clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: response => {
        if (response?.error || !response?.access_token) return reject(storageError("authorization-required", "authorization-required"));
        storage.accessToken = response.access_token;
        const seconds = Number(response.expires_in);
        storage.tokenExpiresAt = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : Infinity;
        resolve();
      }, error_callback: () => reject(storageError("authorization-cancelled", "authorization-cancelled")) });
    client.requestAccessToken();
  });
}

mountCopyTools();

function mountCopyTools() {
  const $=id=>document.getElementById(id);
  let busy=false,configured=false;
  const storage=new DashboardSyntheticStorage({onStatus:status=>{if (!status.code) clearDiagnostic($("v5-result")); $("v5-result").textContent=status.code ? showDiagnostic({ code: status.code }, { surface: "developer-tool", target: $("v5-result") }) : status.message;refresh();}});
  const plans=()=>canonicalPartitionVerificationPlans();
  const say=(text,error=false)=>{if(!error)clearDiagnostic($("v5-result"));$("v5-result").textContent=text;};
  function refresh(){
    const ready=storage.lifecycle?.state==='ready'&&storage.lifecycle.acceptingWrites,paged=storage.lifecycle?.pagedCanonical;
    $("v5-connect").disabled=busy||!configured||ready;
    $("v5-release").disabled=busy||!storage.lifecycle?.coordinator?.canWrite;
    for(const name of ['backup','export']) $("v5-"+name).disabled=busy||!ready||!paged;
    $("v5-restore").disabled=busy||!configured||!$("v5-archive").files[0];
    $("v5-restore-backup").disabled=busy||!configured;
    $("v5-archive").disabled=busy;
  }
  const source=()=>({sourceAdapter:storage.lifecycle.transactionAdapter,sourceManifestFileId:storage.lifecycle.manifestFileId,
    withSourceLock:fn=>storage.lifecycle.coordinator.withWrite(fn),assertSourceWritable:async()=>{await storage.lifecycle.coordinator.assertCanWrite({online:navigator.onLine!==false});},verificationPlans:plans()});
  async function destination(operation){
    try{storage.token();}catch{await authorizeCopyGuide(storage);}
    const folder=await chooseSyntheticFolder({config:storage.config,token:()=>storage.token(),title:'Choose a new empty synthetic destination'});
    if(folder.id===storage.folderId) throw storageError('same-copy-folder','Select a different folder.');
    const adapter=new GoogleDriveTransactionAdapter({folderId:folder.id,accessToken:()=>storage.token()});
    await requireEmptySyntheticFolder(adapter);
    const coordinator=new SessionCoordinator({adapter:createDriveSessionAdapter({folderId:folder.id,accessToken:()=>storage.token()})});
    let stop;
    try{
      await coordinator.start();stop=coordinator.startHeartbeat();
      return await operation({targetAdapter:adapter,
        withTargetLock:fn=>coordinator.withWrite(fn),assertTargetWritable:async()=>{await coordinator.assertCanWrite({online:navigator.onLine!==false});},verificationPlans:plans()});
    }finally{try{if(coordinator.canWrite)await coordinator.release();}finally{stop?.();}}
  }
  function action(id,work){$(id).addEventListener('click',async()=>{
    if(busy)return;busy=true;refresh();say('Working. Keep this page open until verification finishes.');
    try{await work();}catch(error){
      say(showDiagnostic(error, { surface: 'developer-tool', target: $('v5-result') }), true);
    }
    finally{busy=false;refresh();}
  });}
  action('v5-connect',async()=>{await storage.connect({requireExisting:true});if(storage.lifecycle?.state!=='ready'||!storage.lifecycle.acceptingWrites){say('Source is not verified and ready. Release this session when available, then use workspace recovery for the same folder before copying.');return;}say('Verified canonical v5 source connected.');});
  action('v5-release',async()=>{await storage.release();say('Source released. File restore can still run without reading the source.');});
  action('v5-backup',async()=>{const result=await destination(target=>backupPagedCanonicalCopy({...source(),...target}));say('Verified paged backup created with separate physical locators. '+result.objectCount+' immutable objects.');});
  action('v5-export',async()=>{
    if(typeof window.showSaveFilePicker==='function'){
      const handle=await window.showSaveFilePicker({suggestedName:'finance-tracker-synthetic-paged.ftbs'});
      await exportPagedCanonicalArchive({...source(),sink:await handle.createWritable()});
      say('Framed archive written and closed. Select the saved file to test an independent restore.');
    }else{
      const chunks=[];await exportPagedCanonicalArchive({...source(),sink:{write:async chunk=>chunks.push(chunk)}});
      const url=URL.createObjectURL(new Blob(chunks,{type:'application/octet-stream'}));
      const link=document.createElement('a');link.href=url;link.download='finance-tracker-synthetic-paged.ftbs';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
      say('Download requested using the memory-buffered browser fallback. Saving is not confirmed; select the actual saved file to restore.');
    }
  });
  action('v5-restore-backup',async()=>{
    try{storage.token();}catch{await authorizeCopyGuide(storage);}
    const folder=await chooseSyntheticFolder({config:storage.config,token:()=>storage.token(),title:'Choose the existing read-only synthetic backup'});
    if(folder.id===storage.folderId&&storage.lifecycle?.state==='ready') throw storageError('source-already-connected','Release the connected source first.');
    const adapter=new GoogleDriveTransactionAdapter({folderId:folder.id,accessToken:()=>storage.token()});
    const selected=await inspectPagedCanonicalCopy(adapter);
    if(!selected||selected.manifest.role!=='backup') throw storageError('backup-copy-required','Select a completed paged backup.');
    const coordinator=new SessionCoordinator({adapter:createDriveSessionAdapter({folderId:folder.id,accessToken:()=>storage.token()})});let stop;
    try{
      await coordinator.start();stop=coordinator.startHeartbeat();
      await destination(target=>backupPagedCanonicalCopy({...target,sourceAdapter:adapter,sourceManifestFileId:selected.manifestFileId,
        withSourceLock:fn=>coordinator.withWrite(fn),assertSourceWritable:async()=>{await coordinator.assertCanWrite({online:navigator.onLine!==false});},role:'primary'}));
      say('Read-only backup restored to a separately verified primary copy. Neither the backup nor original source was changed.');
    }finally{try{if(coordinator.canWrite)await coordinator.release();}finally{stop?.();}}
  });
  action('v5-restore',async()=>{const file=$("v5-archive").files[0];await destination(target=>restorePagedCanonicalArchive({...target,source:file.stream()}));say('Saved framed file independently restored and verified. No source bytes were read.');});
  $("v5-archive").addEventListener('change',refresh);
  storage.prepare().then(()=>{configured=true;say('Ready. Choose an existing source or a saved framed file.');refresh();}).catch(error=>say(showDiagnostic(error, { surface: 'developer-tool', target: $('v5-result') }), true));
}
