import {createFullSnapshotStorage,FULL_SNAPSHOT_MANIFEST_NAME,inspectSyntheticManifest} from './full-snapshot-storage.mjs';
import {createDriveRequestMetrics} from './drive-request-metrics.mjs';
import {fail} from './app-error.mjs';

// New-format selection is explicit. Reject old folders before acquiring a marker.
export async function inspectFullSnapshotFolder(adapter,{requireEmpty=false,requireExisting=false}={}){
 const files=await adapter.listChildren();
 if(requireEmpty&&files.length)fail('new-empty-folder-required');
 const candidates=files.filter(file=>file.name===FULL_SNAPSHOT_MANIFEST_NAME||file.appProperties?.financeTrackerKind==='finance-tracker-full-snapshot-manifest');
 if(candidates.length>1)fail('ambiguous-manifest');
 if(!candidates.length&&files.length)fail('unsupported-canonical-layout');
 if(requireExisting&&!candidates.length)fail('existing-copy-required');
 return {manifestFileId:candidates[0]?.id??null,
  admission:requireExisting?await inspectSyntheticManifest(adapter,candidates[0].id):undefined};
}

export class FullSnapshotApplication {
 #transfer=null;#generation=0;#busy=false;#onStatus;#online;#target;#offline;#onlineEvent;
 constructor({folderId,accessToken,fetchImpl=globalThis.fetch,onStatus=()=>{},isOnline=()=>globalThis.navigator?.onLine!==false,lifecycleTarget=globalThis, ...options}){
  this.folderId=folderId;this.fullSnapshot=true;this.state='disconnected';this.started=false;this.acceptingWrites=false;
  this.#onStatus=onStatus;this.#online=isOnline;this.#target=lifecycleTarget;
  this.requestMetrics=createDriveRequestMetrics();
  this.engine=createFullSnapshotStorage({...options,folderId,accessToken,fetchImpl:this.requestMetrics.wrapFetch(fetchImpl)});
  this.coordinator=this.engine.coordinator;this.transactionAdapter=this.engine.adapter;
  this.#offline=()=>{this.invalidate();this.coordinator.cancelPending?.();this.#status('offline');};
  this.#onlineEvent=()=>{this.invalidate();this.#status('reconnecting');};
  this.#target?.addEventListener?.('offline',this.#offline);this.#target?.addEventListener?.('online',this.#onlineEvent);
 }
 #status(state,error){this.state=state;this.acceptingWrites=state==='ready'&&this.#online();this.#onStatus({state,code:error?.code});}
 invalidate(){this.#generation++;this.#transfer=null;this.acceptingWrites=false;this.engine.invalidate();}
 #assert(generation){if(generation!==this.#generation||!this.#online())fail('reconnect-required');}
 async #operation(callback,{starting=false}={}){
  if(this.#busy)fail('operation-in-progress');if(!this.#online())fail('offline');
  this.#busy=true;this.#transfer=null;const generation=this.#generation;
  try{const result=await callback();this.#assert(generation);return result;}
  catch(error){this.invalidate();this.#status(error.code==='stale-session'?'stale-session':this.engine.recoveryRequired?'recovery-required':starting?'error':'reconnecting',error);throw error;}
  finally{this.#busy=false;}
 }
 async start({initialize=false,recoverStale=false,admission}={}){
  return this.#operation(async()=>{
   const generation=this.#generation,ledger=await this.engine.start({initialize,recoverStale,admission}),manifest=this.engine.verifiedManifest;
   this.#assert(generation);this.engine.assertVerifiedBaseline(manifest);this.started=true;
   this.#status('ready');this.#assert(generation);this.engine.assertVerifiedBaseline(manifest);
   this.#transfer={generation,manifest:structuredClone(manifest),ledger:structuredClone(ledger)};
   return structuredClone(ledger);
  },{starting:true});
 }
 async load({cold=false}={}){
  const transfer=cold?null:this.#transfer;this.#transfer=null;
  if(transfer){try{this.#assert(transfer.generation);this.engine.assertVerifiedBaseline(transfer.manifest);const ledger=structuredClone(transfer.ledger);this.#assert(transfer.generation);this.engine.assertVerifiedBaseline(transfer.manifest);return ledger;}catch(error){this.invalidate();throw error;}}
  return this.#operation(async()=>{const ledger=await this.engine.open(),m=this.engine.verifiedManifest;this.#status('ready');this.engine.assertVerifiedBaseline(m);return ledger;});
 }
 async save(ledger){return this.#operation(async()=>{const result=await this.engine.save(ledger),m=this.engine.verifiedManifest;this.#status('ready');this.engine.assertVerifiedBaseline(m);return result;});}
 async readManifest(){const m=this.engine.verifiedManifest;if(!m)fail('verified-base-required');this.engine.assertVerifiedBaseline(m);return m;}
 async recover({admission}={}){return this.#operation(async()=>{const ledger=await this.engine.recover({admission});this.#status('ready');return ledger;});}
 async recoverStaleSession({confirm,admission}={}){if(confirm!==true)fail('stale-session');this.invalidate();return this.start({recoverStale:true,admission});}
 async handleOnline({admission}={}){
  this.invalidate();
  // Resume can fail before start() enters its state-reporting operation. Keep
  // those failures observable without authorizing takeover or discarding drafts.
  try{await this.coordinator.resume();}
  catch(error){this.invalidate();this.#status(error.code==='stale-session'?'stale-session':this.engine.recoveryRequired?'recovery-required':'reconnecting',error);throw error;}
  return this.start({admission});
 }
 async release(){
  this.acceptingWrites=false;this.#transfer=null;
  try{const result=await this.engine.release();if(result?.released!==true)fail('release-unconfirmed');this.invalidate();this.started=false;this.#status('released');this.#target?.removeEventListener?.('offline',this.#offline);this.#target?.removeEventListener?.('online',this.#onlineEvent);return result;}
  catch(error){this.invalidate();this.#status(this.engine.recoveryRequired?'recovery-required':'release-unconfirmed',error);throw error;}
 }
 createLedgerStore(){return new FullSnapshotLedgerStore(this);}
}
class FullSnapshotLedgerStore {
 constructor(lifecycle){this.lifecycle=lifecycle;this.base=null;this.ledger=null;this.valueCodec='full-snapshot-v1';this.monthIndex=undefined;}
 async load(options){this.base=null;const ledger=await this.lifecycle.load(options),manifest=await this.lifecycle.readManifest();this.lifecycle.engine.assertVerifiedBaseline(manifest);this.base=manifest;this.ledger=structuredClone(ledger);return structuredClone(ledger);}
 async save(ledger){const base=this.base;if(!base)fail('verified-base-required');this.lifecycle.engine.assertVerifiedBaseline(base);
  this.base=null;const saved=await this.lifecycle.save(ledger),manifest=await this.lifecycle.readManifest();this.lifecycle.engine.assertVerifiedBaseline(manifest);this.base=manifest;this.ledger=structuredClone(saved);return structuredClone(saved);}
}
