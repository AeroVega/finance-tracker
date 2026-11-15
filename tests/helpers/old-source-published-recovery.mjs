// Executes the actual separately checked-out baseline modules, never a modeled resume.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {webcrypto} from 'node:crypto';
const [repo,input]=process.argv.slice(2);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),'f183cdccc9a9710e29a0da6df9f615940de19334');
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim(),'');
const load=p=>import(pathToFileURL(resolve(repo,p)).href);
const {HttpCatalogDrive}=await load('tests/helpers/http-catalog-drive.mjs');
const {GoogleDriveTransactionAdapter}=await load('js/drive-transaction-engine.mjs');
const {PagedApplicationStorage}=await load('js/paged-application-storage.mjs');
const {canonicalPartitionVerificationPlans,readVerifiedPartitionedLedger}=await load('js/canonical-paged-storage.mjs');
const data=JSON.parse(await readFile(input,'utf8')),http=new HttpCatalogDrive();
http.nextId=data.nextId;http.files=new Map(data.files.map(([id,f])=>[id,{metadata:f.metadata,bytes:Uint8Array.from(f.bytes)}]));
const adapter=new GoogleDriveTransactionAdapter({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,cryptoImpl:webcrypto});
// This checks old protocol recovery and decoding, not session-marker adoption.
const app=new PagedApplicationStorage({adapter,assertWritable:async()=>{},verificationPlans:canonicalPartitionVerificationPlans(),manifestFileId:data.manifestFileId,cryptoImpl:webcrypto});
await app.recover();assert.equal(http.json(data.manifestFileId).pending,null);
const snapshot=await app.readSnapshot();
assert.deepEqual((await readVerifiedPartitionedLedger(snapshot.store,snapshot.rootHash)).ledger,data.ledger);
await app.finishSnapshot();process.stdout.write('old-source-recovery-ok\n');
