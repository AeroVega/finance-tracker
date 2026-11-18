import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,pbkdf2Sync,createDecipheriv,createHash} from 'node:crypto';
import {encodeFullSnapshotBackup,decodeFullSnapshotBackup,FULL_SNAPSHOT_BACKUP_LIMITS as LIMITS} from '../js/full-snapshot-backup.mjs';
import {createLedger,summarizeLedger,getEffectiveActivities} from '../js/canonical-import.mjs';
import {createSyntheticFinancialYear} from '../js/synthetic-financial-year.mjs';
import {denseLedgerFixture} from './helpers/dense-ledger-fixture.mjs';
import {canonicalizeJcs,sha256Hex} from '../js/transaction-protocol.mjs';
const enc=new TextEncoder(),dec=new TextDecoder(),options={cryptoImpl:webcrypto};
const encode=value=>enc.encode(canonicalizeJcs(value));
const unpack=bytes=>JSON.parse(dec.decode(bytes));
const empty=()=>createLedger({now:()=> '2026-11-17T00:00:00Z',idFactory:()=> '00000000-0000-4000-8000-000000000001'});
const report=ledger=>summarizeLedger(ledger,{start:'2015-01-01',end:'2026-12-31',currency:'USD'});
for(const kind of ['empty','representative','dense'])test(kind+' backup preserves complete logical records, evidence and reports',async()=>{
 const ledger=kind==='empty'?empty():kind==='representative'?(await createSyntheticFinancialYear()).ledger:denseLedgerFixture(1).ledger;
 const bytes=await encodeFullSnapshotBackup(ledger,options),restored=await decodeFullSnapshotBackup(bytes,options);
 assert.deepEqual(restored,ledger);assert.deepEqual(report(restored),report(ledger));assert.deepEqual(getEffectiveActivities(restored),getEffectiveActivities(ledger));
 assert.notEqual(restored,ledger);assert.notEqual(restored.events,ledger.events);
 const envelope=unpack(bytes);assert.equal(envelope.protection,'checksum-sha256');assert.equal(envelope.version,1);
 assert.deepEqual(Object.keys(envelope).sort(),['format','ledger','protection','sha256','syntheticOnly','version']);
 restored.accounts.push({invented:true});assert.deepEqual(await decodeFullSnapshotBackup(bytes,options),ledger);
});
test('export captures detached source before asynchronous digest',async()=>{
 const ledger=empty();let unblock,entered;const gate=new Promise(r=>unblock=r),started=new Promise(r=>entered=r);
 const cryptoImpl={subtle:{async digest(...args){entered();await gate;return webcrypto.subtle.digest(...args);}}};
 const pending=encodeFullSnapshotBackup(ledger,{cryptoImpl});await started;ledger.accounts.push({invalid:true});unblock();
 assert.deepEqual(await decodeFullSnapshotBackup(await pending,options),empty());
});
test('corruption, truncation, unknown format, duplicate keys and malformed UTF8 fail closed',async()=>{
 const bytes=await encodeFullSnapshotBackup(empty(),options),envelope=unpack(bytes);
 for(const bad of [bytes.slice(0,-1),enc.encode('{'),new Uint8Array([0xff]),new Uint8Array([0xef,0xbb,0xbf,...bytes]),enc.encode(dec.decode(bytes)+' '),enc.encode(dec.decode(bytes).replace('{','{"version":1,'))])await assert.rejects(decodeFullSnapshotBackup(bad,options));
 envelope.ledger.createdAt='2026-11-18T00:00:00Z';await assert.rejects(decodeFullSnapshotBackup(encode(envelope),options),{code:'archive-hash-mismatch'});
 envelope.version=2;await assert.rejects(decodeFullSnapshotBackup(encode(envelope),options),{code:'unsupported-archive'});
});
test('checksum is not authenticity but rehashed invalid domain history is still rejected',async()=>{
 const envelope=unpack(await encodeFullSnapshotBackup(empty(),options));
 envelope.ledger.createdAt='2026-11-18T00:00:00Z';envelope.sha256=await sha256Hex(canonicalizeJcs(envelope.ledger),webcrypto);
 assert.deepEqual(await decodeFullSnapshotBackup(encode(envelope),options),envelope.ledger,'an unkeyed checksum cannot authenticate origin');
 envelope.ledger.events.push({eventId:'invented-bad'});
 envelope.sha256=await sha256Hex(canonicalizeJcs(envelope.ledger),webcrypto);
 await assert.rejects(decodeFullSnapshotBackup(encode(envelope),options),{code:'invalid-backup-source'});
 await assert.rejects(encodeFullSnapshotBackup({...empty(),syntheticOnly:false},options),{code:'invalid-backup-source'});
});
test('input size, source size, deep JSON and unknown envelope fields are refused',async()=>{
 await assert.rejects(decodeFullSnapshotBackup(new Uint8Array(LIMITS.archiveBytes+1),options),{code:'byte-limit'});
 await assert.rejects(encodeFullSnapshotBackup({...empty(),inventedNote:'a'.repeat(LIMITS.ledgerBytes)},options),{code:'byte-limit'});
 await assert.rejects(decodeFullSnapshotBackup(enc.encode('['.repeat(100)+'0'+']'.repeat(100)),options),{code:'byte-limit'});
 const envelope=unpack(await encodeFullSnapshotBackup(empty(),options));envelope.accessToken='invented-token';await assert.rejects(decodeFullSnapshotBackup(encode(envelope),options),{code:'invalid-shape'});
});
test('encrypted backups roundtrip, hide ledger text, and use fresh salts and IVs',async()=>{
 const ledger=(await createSyntheticFinancialYear()).ledger,password='Invented fixture password 🌱';
 const a=await encodeFullSnapshotBackup(ledger,{...options,password}),b=await encodeFullSnapshotBackup(ledger,{...options,password});
 const aa=unpack(a),bb=unpack(b);assert.equal(aa.protection,'aes-256-gcm');assert.notEqual(aa.kdf.salt,bb.kdf.salt);assert.notEqual(aa.iv,bb.iv);assert.notEqual(aa.ciphertext,bb.ciphertext);
 assert.equal(aa.kdf.iterations,LIMITS.pbkdf2Iterations);assert.equal(Buffer.from(aa.iv,'base64').length,12);assert.equal(Buffer.from(aa.kdf.salt,'base64').length,16);
 assert.ok(!dec.decode(a).includes(ledger.ledgerId));assert.ok(!dec.decode(a).includes(password));
 assert.deepEqual(await decodeFullSnapshotBackup(a,{...options,password}),ledger);
 await assert.rejects(decodeFullSnapshotBackup(a,options),{code:'backup-password-required'});
 await assert.rejects(decodeFullSnapshotBackup(a,{...options,password:'wrong invented password'}),{code:'backup-decryption-failed'});
});
test('encrypted tampering and bounded KDF/header/base64 validation fail closed',async()=>{
 const password='Invented test password',bytes=await encodeFullSnapshotBackup(empty(),{...options,password});
 for(const field of ['ciphertext','iv']){const e=unpack(bytes);const raw=Buffer.from(e[field],'base64');raw[0]^=1;e[field]=raw.toString('base64');await assert.rejects(decodeFullSnapshotBackup(encode(e),{...options,password}),{code:'backup-decryption-failed'});}
 const salt=unpack(bytes);const raw=Buffer.from(salt.kdf.salt,'base64');raw[0]^=1;salt.kdf.salt=raw.toString('base64');await assert.rejects(decodeFullSnapshotBackup(encode(salt),{...options,password}),{code:'backup-decryption-failed'});
 let kdfCalls=0;const forbiddenCrypto={subtle:{importKey(){kdfCalls++;assert.fail('invalid envelope must not reach KDF');}}};
 for(const [mutate,code] of [[e=>e.kdf.iterations=1e9,'unsupported-archive'],[e=>e.kdf.hash='SHA-1','unsupported-archive'],[e=>e.iv+='!','invalid-base64'],[e=>e.kdf.salt='','invalid-base64'],[e=>e.ciphertext=e.ciphertext.slice(0,-1),'invalid-base64'],[e=>e.extra=true,'invalid-shape']]){const e=unpack(bytes);mutate(e);await assert.rejects(decodeFullSnapshotBackup(encode(e),{cryptoImpl:forbiddenCrypto,password}),{code});}
 assert.equal(kdfCalls,0);
 for(const password of ['', 'a'.repeat(LIMITS.passwordBytes+1)])await assert.rejects(encodeFullSnapshotBackup(empty(),{...options,password}));
});

test('dense encrypted archive roundtrips within fixed envelope bounds',async()=>{
 const ledger=denseLedgerFixture(1).ledger,password='Invented dense fixture passphrase';
 const bytes=await encodeFullSnapshotBackup(ledger,{...options,password});assert.ok(bytes.length<=LIMITS.archiveBytes);
 assert.deepEqual(await decodeFullSnapshotBackup(bytes,{...options,password}),ledger);
});
test('an explicitly password-protected restore cannot silently downgrade to checksum-only',async()=>{
 const bytes=await encodeFullSnapshotBackup(empty(),options);
 await assert.rejects(decodeFullSnapshotBackup(bytes,{...options,password:'invented password'}),{code:'unsupported-archive'});
});
test('decoder owns input bytes and accepted optional domain fields survive unchanged',async()=>{
 const original={...empty(),positionEvents:[],inventedExtension:{provenance:'invented optional model metadata'}};
 const bytes=Buffer.from(await encodeFullSnapshotBackup(original,options));
 let unblock,entered;const gate=new Promise(r=>unblock=r),started=new Promise(r=>entered=r);
 const cryptoImpl={subtle:{async digest(...args){entered();await gate;return webcrypto.subtle.digest(...args);}}};
 const pending=decodeFullSnapshotBackup(bytes,{cryptoImpl});await started;bytes.fill(0);unblock();assert.deepEqual(await pending,original);
 await assert.rejects(decodeFullSnapshotBackup(new Uint8Array(new SharedArrayBuffer(4)),options),{code:'invalid-bytes'});
});

test('encrypted export interoperates with independent Node crypto derivation and authenticated decryption',async()=>{
 const source=empty(),password='compatibility-only test password';let next=0;
 const cryptoImpl={subtle:webcrypto.subtle,getRandomValues(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=next++;return bytes;}};
 const envelope=unpack(await encodeFullSnapshotBackup(source,{cryptoImpl,password}));
 const {ciphertext,...metadata}=envelope;
 assert.equal(envelope.kdf.name,'PBKDF2');assert.equal(envelope.kdf.hash,'SHA-256');assert.equal(envelope.kdf.iterations,600000);
 assert.equal(envelope.protection,'aes-256-gcm');
 assert.deepEqual(Buffer.from(envelope.kdf.salt,'base64'),Buffer.from(Array.from({length:16},(_,i)=>i)));
 assert.deepEqual(Buffer.from(envelope.iv,'base64'),Buffer.from(Array.from({length:12},(_,i)=>16+i)));
 const key=pbkdf2Sync(Buffer.from(password,'utf8'),Buffer.from(envelope.kdf.salt,'base64'),600000,32,'sha256');
 const sealed=Buffer.from(ciphertext,'base64'),tag=sealed.subarray(-16),payload=sealed.subarray(0,-16);
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'),{authTagLength:16});
 decipher.setAAD(Buffer.from(canonicalizeJcs(metadata),'utf8'));decipher.setAuthTag(tag);
 const clear=Buffer.concat([decipher.update(payload),decipher.final()]);
 const decoded=JSON.parse(clear.toString('utf8'));
 assert.deepEqual(decoded.ledger,source);
 assert.equal(decoded.protection,'checksum-sha256');
 assert.equal(decoded.sha256,createHash('sha256').update(canonicalizeJcs(source),'utf8').digest('hex'));
 assert.equal(clear.toString('utf8'),canonicalizeJcs(decoded));
 key.fill(0);clear.fill(0);
});

for(const password of [undefined,'Invented depth-boundary password'])test(`${password===undefined?'plaintext':'encrypted'} backup roundtrips maximum ledger depth without spending it on the archive wrapper`,async()=>{
 const source=empty();let extension={};
 // Root ledger + extension objects consume exactly the public ledger depth.
 for(let i=0;i<LIMITS.depth-2;i++)extension={nested:extension};
 source.inventedExtension=extension;
 const bytes=await encodeFullSnapshotBackup(source,{...options,password});
 assert.deepEqual(await decodeFullSnapshotBackup(bytes,{...options,password}),source);
 source.inventedExtension={nested:extension};
 await assert.rejects(encodeFullSnapshotBackup(source,{...options,password}),{code:'byte-limit'});
});
