import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function files(directory){return readdirSync(resolve(root,directory),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(directory+'/'+entry.name):/\.(?:m?js|cjs)$/.test(entry.name)?[directory+'/'+entry.name]:[]);}
// Repository-relative paths always use '/', including on Windows.
function imports(path){return [...readFileSync(resolve(root,path),'utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)].map(match=>relative(root,resolve(root,dirname(path),match[1].split(/[?#]/)[0])).split(sep).join('/'));}
const retired=['application-storage-lifecycle','canonical-ledger-storage','canonical-paged-storage','canonical-partition-reader','canonical-partitions','catalog-backup','catalog-segments','catalog-storage','catalog-transaction-engine','drive-locator-catalog','framed-backup-stream','immutable-page-tree','legacy-canonical-evidence','legacy-canonical-fragments','locator-codec','owned-preparation-reader','paged-application-storage','paged-canonical-backup','paged-canonical-format','paged-physical-locators','physical-drive-adapter','physical-root-binding','portable-backup','synthetic-year-seeder','drive-folder-discovery','drive-original-retention','original-retention-policy','paged-archive-rehearsal','storage-diagnostics','synthetic-application-structure','synthetic-folder-picker'];
test('remaining source and test imports resolve without retired storage modules',()=>{
 const missing=[];for(const path of ['js','tests','prototype'].flatMap(files))for(const target of imports(path))if(!existsSync(resolve(root,target)))missing.push(path+' -> '+target);
 assert.deepEqual(missing,[]);
 for(const name of retired)assert.equal(existsSync(resolve(root,'js',name+'.mjs')),false,name);
});
test('main app reaches current full-snapshot storage and no retired format',()=>{
 const html=readFileSync(resolve(root,'index.html'),'utf8');const pending=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match=>match[1]).filter(path=>path.startsWith('js/'));
 const seen=new Set();while(pending.length){const path=pending.pop();if(seen.has(path))continue;seen.add(path);assert.ok(existsSync(resolve(root,path)),path);pending.push(...imports(path));}
 assert.ok(seen.has('js/full-snapshot-storage.mjs'));assert.ok(seen.has('js/full-snapshot-application.mjs'));
 for(const name of retired)assert.equal(seen.has('js/'+name+'.mjs'),false,name);
});
test('shared primitives no longer expose obsolete journal engines or feasibility writers',async()=>{
 const adapter=await import('../js/drive-transaction-engine.mjs');
 const protocol=await import('../js/transaction-protocol.mjs');
 const listing=await import('../js/drive-feasibility-spike.mjs');
 assert.equal(adapter.DriveTransactionEngine,undefined);
 assert.equal(adapter.GoogleDriveTransactionAdapter.prototype.appendJournal,undefined);
 for(const name of ['createJournalEvent','verifyJournal','classifyTransactionRecovery','TRANSACTION_EVENT_TYPES'])assert.equal(protocol[name],undefined,name);
 for(const name of ['createSyntheticObject','createRaceTarget','readRaceTarget','attemptConditionalWrite','deleteSyntheticFile','probeRawIfMatch'])assert.equal(listing[name],undefined,name);
 assert.equal(typeof adapter.GoogleDriveTransactionAdapter,'function');
 assert.equal(typeof protocol.canonicalizeJcs,'function');assert.equal(typeof protocol.sha256Hex,'function');
 assert.equal(typeof listing.listFolderChildren,'function');
});
