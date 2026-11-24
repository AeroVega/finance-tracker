// Detached hash-only fixture, superseded for provider-format work by the
// native full-snapshot simulation profile. Not a second durable codec.
// No Drive, UI, credential or activation path.
import { fail } from './app-error.mjs';
import { validateProspectiveProductionLedger } from './canonical-import.mjs';
import { assertCanonicalLedgerTransition } from './canonical-history.mjs';
import { canonicalizeJcs, sha256Hex } from './transaction-protocol.mjs';
import { utf8ByteLength } from './utf8-length.mjs';

const manifestFormat='finance-tracker-prospective-fixture-manifest';
const commitFormat='finance-tracker-prospective-fixture-commit';
const profile='canonical-ledger-production-fixture-v3';
const snapshotLimit=8*1024*1024;
const maxFrames=128;
const maxTotalBytes=64*1024*1024;
const sha=/^[a-f0-9]{64}$/;
const own=(value,fields)=>value&&Object.getPrototypeOf(value)===Object.prototype&&
 Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value);
const validHash=value=>typeof value==='string'&&sha.test(value);
const textOf=ledger=>{
 const text=canonicalizeJcs(ledger);
 if(utf8ByteLength(text)>snapshotLimit)fail('byte-limit');
 return text;
};
const hash=(value,cryptoImpl)=>sha256Hex(canonicalizeJcs(value),cryptoImpl);

export function createProspectiveGenesis({databaseId,copyId}={}){
 if(!identity(databaseId)||!identity(copyId))fail('invalid-identity');
 return {format:manifestFormat,version:2,dataClass:'production',databaseId,copyId,revision:'0',head:null,pending:null};
}

function assertManifest(m){
 if(!own(m,['format','version','dataClass','databaseId','copyId','revision','head','pending'])||
  m.format!==manifestFormat||m.version!==2||m.dataClass!=='production')fail('unsupported-canonical-layout');
 if(!identity(m.databaseId)||!identity(m.copyId)||typeof m.revision!=='string'||
  !/^(0|[1-9][0-9]{0,2})$/.test(m.revision)||Number(m.revision)>maxFrames||
  (m.revision==='0'?m.head!==null:!validHash(m.head))||m.pending!==null)fail('invalid-shape');
}

async function assertFrame(previous,frame,previousLedger,cryptoImpl){
 if(!own(frame,['manifest','commit','ledger']))fail('invalid-shape');
 const {manifest,commit,ledger}=frame;
 assertManifest(manifest);
 if(!own(commit,['format','version','dataClass','profile','databaseId','copyId','revision','parent','previousManifestHash','snapshotHash'])||
  commit.format!==commitFormat||commit.version!==2||commit.dataClass!=='production'||commit.profile!==profile)fail('unsupported-canonical-profile');
 if(commit.databaseId!==previous.databaseId||manifest.databaseId!==previous.databaseId||
  commit.copyId!==previous.copyId||manifest.copyId!==previous.copyId||
  commit.revision!==manifest.revision||manifest.revision!==String(Number(previous.revision)+1)||
  commit.parent!==previous.head||commit.previousManifestHash!==await hash(previous,cryptoImpl)||
  !validHash(commit.snapshotHash)||manifest.head!==await hash(commit,cryptoImpl))fail('history-mismatch');
 const text=textOf(ledger);
 validateProspectiveProductionLedger(ledger);
 assertCanonicalLedgerTransition(previousLedger,ledger);
 if(commit.snapshotHash!==await sha256Hex(text,cryptoImpl))fail('history-mismatch');
 return utf8ByteLength(text);
}

// Complete in-memory proof for a deliberately small invented-data checkpoint.
// Does not define provider pending-publication or recovery semantics for v2.
export async function verifyProspectiveSnapshotChain(genesis,frames,{cryptoImpl=globalThis.crypto}={}){
 assertManifest(genesis);
 if(genesis.revision!=='0'||!Array.isArray(frames)||frames.length>maxFrames)fail('history-mismatch');
 // Clone all inputs before asynchronous hashing only after checking aggregate
 // ledger size, so caller changes cannot swap accepted data after verification.
 let budget=0;
 for(const frame of frames){
  if(!own(frame,['manifest','commit','ledger']))fail('invalid-shape');
  budget+=utf8ByteLength(textOf(frame.ledger));
  if(budget>maxTotalBytes)fail('byte-limit');
 }
 const copied=structuredClone(frames);
 let previous=structuredClone(genesis),previousLedger=null;
 for(const frame of copied){
  await assertFrame(previous,frame,previousLedger,cryptoImpl);
  previous=frame.manifest;
  previousLedger=frame.ledger;
 }
 return {manifest:previous,ledger:previousLedger,verifiedLedgerBytes:budget};
}

export async function appendProspectiveSnapshot(genesis,frames,source,{cryptoImpl=globalThis.crypto}={}){
 const text=textOf(source),ledger=JSON.parse(text);
 validateProspectiveProductionLedger(ledger);
 if(!Array.isArray(frames)||frames.length>=maxFrames)fail('byte-limit');
 const {manifest:previous,ledger:before,verifiedLedgerBytes}=await verifyProspectiveSnapshotChain(genesis,frames,{cryptoImpl});
 if(verifiedLedgerBytes+utf8ByteLength(text)>maxTotalBytes)fail('byte-limit');
 assertCanonicalLedgerTransition(before,ledger);
 const revision=String(Number(previous.revision)+1);
 const commit={format:commitFormat,version:2,dataClass:'production',profile,databaseId:previous.databaseId,
  copyId:previous.copyId,revision,parent:previous.head,previousManifestHash:await hash(previous,cryptoImpl),
  snapshotHash:await sha256Hex(text,cryptoImpl)};
 return {manifest:{...previous,revision,head:await hash(commit,cryptoImpl)},commit,ledger};
}
