import {persistenceDataClass} from './persistence-data-class.mjs';
import {fail} from './app-error.mjs';
import {validateLedger,validateProspectiveProductionLedger} from './canonical-import.mjs';
import {canonicalizeJcs,sha256Hex} from './transaction-protocol.mjs';
import {copyOwnedBytes} from './byte-ownership.mjs';
import {utf8ByteLength} from './utf8-length.mjs';

// Portable logical history, not physical Drive commit ancestry. The caller must
// obtain a cold/full-audited saved ledger and fence source changes before export.
// This codec has no Drive access, credentials, save authority, or overwrite path.
// Unknown accepted domain fields remain intact: this is not a secrets scrubber.
const FORMAT='finance-tracker-full-snapshot-backup',PLAIN='checksum-sha256',SEALED='aes-256-gcm';
const ledgerBytes=8*1024*1024,plaintextBytes=ledgerBytes+1024;
export const FULL_SNAPSHOT_BACKUP_LIMITS=Object.freeze({ledgerBytes,plaintextBytes,
 archiveBytes:Math.ceil((plaintextBytes+16)/3)*4+2048,depth:64,passwordBytes:1024,pbkdf2Iterations:600000});
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const typedByteLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get;
const SYNTHETIC=Object.freeze({dataClass:'synthetic',version:1,field:'syntheticOnly',marker:true,validate:validateLedger});
const PROSPECTIVE=Object.freeze({dataClass:'reserved-production',version:2,field:'dataClass',marker:'production',validate:validateProspectiveProductionLedger});
const header=(protection,profile)=>({format:FORMAT,version:profile.version,[profile.field]:profile.marker,protection});
function shape(value,keys){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail('invalid-shape');
}
function canonical(value){try{return canonicalizeJcs(value);}catch(cause){fail('invalid-json',{cause});}}
function admitText(text,max){if(utf8ByteLength(text)>max)fail('byte-limit');}
function parse(text,max,maxDepth=FULL_SNAPSHOT_BACKUP_LIMITS.depth){
 admitText(text,max);
 // Bound nesting before JSON.parse and recursive canonical/domain validation.
 let depth=0,string=false,escape=false;
 for(const char of text){
  if(string){if(escape)escape=false;else if(char==='\\')escape=true;else if(char==='"')string=false;}
  else if(char==='"')string=true;
  else if(char==='{'||char==='['){if(++depth>maxDepth)fail('byte-limit');}
  else if(char==='}'||char===']')depth--;
 }
 let value;try{value=JSON.parse(text);}catch(cause){fail('invalid-json',{cause});}
 if(canonical(value)!==text)fail('noncanonical-json');
 return value;
}
function textOf(bytes){try{return dec.decode(bytes);}catch(cause){fail('invalid-json',{cause});}}
function own(bytes){
 let length;try{length=typedByteLength.call(bytes);}catch(cause){fail('invalid-bytes',{cause});}
 if(length>FULL_SNAPSHOT_BACKUP_LIMITS.archiveBytes)fail('byte-limit');
 try{return copyOwnedBytes(bytes);}catch(cause){fail('invalid-bytes',{cause});}
}
function ledger(text,profile){
 const value=parse(text,FULL_SNAPSHOT_BACKUP_LIMITS.ledgerBytes);
 try{profile.validate(value);}catch(cause){fail('invalid-backup-source',{cause});}
 return value;
}
function passwordBytes(password){
 if(typeof password!=='string'||!password.length)fail('backup-password-required');
 if(utf8ByteLength(password)>FULL_SNAPSHOT_BACKUP_LIMITS.passwordBytes)fail('byte-limit');
 // Reject unpaired surrogates rather than silently replacing password characters.
 canonical(password);
 return enc.encode(password);
}
function base64(bytes){
 let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return btoa(binary);
}
function unbase64(value,{exact,max}={}){
 if(typeof value!=='string'||!value.length||value.length%4||value.length>Math.ceil((max??exact)/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('invalid-base64');
 let binary;try{binary=atob(value);}catch(cause){fail('invalid-base64',{cause});}
 const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
 if((exact!==undefined&&bytes.length!==exact)||(max!==undefined&&bytes.length>max)||base64(bytes)!==value)fail('invalid-base64');
 return bytes;
}
async function keyFor(password,salt,cryptoImpl){
 const material=passwordBytes(password);
 try{
  if(!cryptoImpl?.subtle?.importKey||!cryptoImpl.subtle.deriveKey)fail('crypto-unavailable');
  const key=await cryptoImpl.subtle.importKey('raw',material,'PBKDF2',false,['deriveKey']);
  return await cryptoImpl.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:FULL_SNAPSHOT_BACKUP_LIMITS.pbkdf2Iterations},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 }finally{material.fill(0);}
}
function checkHeader(value,profile){
 if(persistenceDataClass('backup',value)!==profile.dataClass||![PLAIN,SEALED].includes(value.protection))fail('unsupported-archive');
}
async function decodePlain(value,cryptoImpl,profile){
 checkHeader(value,profile);if(value.protection!==PLAIN)fail('unsupported-archive');
 shape(value,['format','version',profile.field,'protection','sha256','ledger']);
 if(typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))fail('archive-hash-mismatch');
 const text=canonical(value.ledger);admitText(text,FULL_SNAPSHOT_BACKUP_LIMITS.ledgerBytes);
 if(await sha256Hex(text,cryptoImpl)!==value.sha256)fail('archive-hash-mismatch');
 return ledger(text,profile);
}

/** Snapshot the caller's fully verified saved logical ledger before any await.
 * Unencrypted SHA-256 detects accidental corruption, not authenticity. Encrypted
 * exports use WebCrypto AES-GCM with a fresh random salt/96-bit IV, 128-bit tag,
 * and authenticated canonical header. Passwords are never persisted or logged.
 * Temporary byte buffers are cleared where practical; JavaScript strings and
 * CryptoKey lifetime are garbage-collected, not a guaranteed secure-erasure API.
 * https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams
 * https://developer.mozilla.org/en-US/docs/Web/API/Pbkdf2Params
 * Entire bounded archive is held in memory; this is not a streaming/Safari claim.
 */
export function encodeFullSnapshotBackup(source,options){return encode(source,options,SYNTHETIC);}
// Deliberately unreachable from application import/export. This checkpoint
// only admits encrypted prospective archives to the detached fixture path.
export function encodeProspectiveProductionBackup(source,options){return encode(source,options,PROSPECTIVE);}
async function encode(source,{cryptoImpl=globalThis.crypto,password}={},profile){
 const text=canonical(source);admitText(text,FULL_SNAPSHOT_BACKUP_LIMITS.ledgerBytes);
 const detached=ledger(text,profile);
 if(profile===PROSPECTIVE&&password===undefined)fail('backup-password-required');
 if(password!==undefined)passwordBytes(password).fill(0);
 const value={...header(PLAIN,profile),sha256:await sha256Hex(text,cryptoImpl),ledger:detached};
 const clear=enc.encode(canonical(value));
 if(clear.length>FULL_SNAPSHOT_BACKUP_LIMITS.plaintextBytes)fail('byte-limit');
 if(password===undefined)return clear;
 try{
  if(!cryptoImpl?.getRandomValues||!cryptoImpl?.subtle?.encrypt)fail('crypto-unavailable');
  const salt=cryptoImpl.getRandomValues(new Uint8Array(16)),iv=cryptoImpl.getRandomValues(new Uint8Array(12));
  const metadata={...header(SEALED,profile),kdf:{name:'PBKDF2',hash:'SHA-256',iterations:FULL_SNAPSHOT_BACKUP_LIMITS.pbkdf2Iterations,salt:base64(salt)},iv:base64(iv)};
  const key=await keyFor(password,salt,cryptoImpl);
  const ciphertext=await cryptoImpl.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(canonical(metadata)),tagLength:128},key,clear);
  const result=enc.encode(canonical({...metadata,ciphertext:base64(new Uint8Array(ciphertext))}));
  if(result.length>FULL_SNAPSHOT_BACKUP_LIMITS.archiveBytes)fail('byte-limit');
  return result;
 }finally{clear.fill(0);}
}

/** Strict canonical envelope decoding returns only a detached validated ledger.
 * Restore must create a fresh empty copy with new physical lineage. No checksum
 * or password can prove a supplied file's external origin or missing revisions.
 */
export function decodeFullSnapshotBackup(input,options){return decode(input,options,SYNTHETIC);}
export function decodeProspectiveProductionBackup(input,options){return decode(input,options,PROSPECTIVE);}
async function decode(input,{cryptoImpl=globalThis.crypto,password}={},profile){
 // The plaintext envelope adds one container outside the bounded ledger.
 // Encrypted envelope shape is independently restricted to header/KDF scalars.
 const bytes=own(input),value=parse(textOf(bytes),FULL_SNAPSHOT_BACKUP_LIMITS.archiveBytes,FULL_SNAPSHOT_BACKUP_LIMITS.depth+1);checkHeader(value,profile);
 if(value.protection===PLAIN){if(profile===PROSPECTIVE||password!==undefined)fail('unsupported-archive');if(bytes.length>FULL_SNAPSHOT_BACKUP_LIMITS.plaintextBytes)fail('byte-limit');return decodePlain(value,cryptoImpl,profile);}
 shape(value,['format','version',profile.field,'protection','kdf','iv','ciphertext']);
 shape(value.kdf,['name','hash','iterations','salt']);
 if(value.kdf.name!=='PBKDF2'||value.kdf.hash!=='SHA-256'||value.kdf.iterations!==FULL_SNAPSHOT_BACKUP_LIMITS.pbkdf2Iterations)fail('unsupported-archive');
 const salt=unbase64(value.kdf.salt,{exact:16}),iv=unbase64(value.iv,{exact:12});
 const ciphertext=unbase64(value.ciphertext,{max:FULL_SNAPSHOT_BACKUP_LIMITS.plaintextBytes+16});
 if(ciphertext.length<17)fail('invalid-base64');
 const {ciphertext:ignored,...metadata}=value;
 const key=await keyFor(password,salt,cryptoImpl);let clear;
 try{clear=new Uint8Array(await cryptoImpl.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode(canonical(metadata)),tagLength:128},key,ciphertext));}
 catch(cause){fail('backup-decryption-failed',{cause});}
 try{return await decodePlain(parse(textOf(clear),FULL_SNAPSHOT_BACKUP_LIMITS.plaintextBytes,FULL_SNAPSHOT_BACKUP_LIMITS.depth+1),cryptoImpl,profile);}
 finally{clear.fill(0);}
}
