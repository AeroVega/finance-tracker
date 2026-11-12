#!/usr/bin/env bash
# Rebuild deliberately synthetic golden bytes with the historical writer only.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
git archive 1dc79ca | tar -x -C "$temporary"
export FIXTURE_OUTPUT="$root/tests/fixtures/migrated-v5"
mkdir -p "$FIXTURE_OUTPUT"
cat > "$temporary/generate-fixtures.mjs" <<'JS'
import {writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {GoogleDriveTransactionAdapter} from './js/drive-transaction-engine.mjs';
import {HttpCatalogDrive} from './tests/helpers/http-catalog-drive.mjs';
import {initializeCatalogCopy,verifyCatalogHistory} from './js/catalog-storage.mjs';
import {CatalogTransactionEngine} from './js/catalog-transaction-engine.mjs';
import {CanonicalLedgerStore} from './js/canonical-ledger-storage.mjs';
import {replayFixture} from './tests/helpers/ledger-replay-fixtures.mjs';
import {applyFinancialEvent} from './js/canonical-import.mjs';
import {exportCatalogArchive} from './js/catalog-backup.mjs';
import {validateSyntheticApplicationSnapshot} from './js/synthetic-application-structure.mjs';
const guard=async()=>{},gate=fn=>fn();
function target(name){const drive=new HttpCatalogDrive({folderId:name,idPrefix:name+'-file-'});return {drive,adapter:new GoogleDriveTransactionAdapter({folderId:name,accessToken:()=> 'invented-test-token',fetchImpl:drive.fetch,visibilityDelayMs:0,visibilityMaxDelayMs:0})};}
for(const layout of ['records-v1','fragments-v3']){
 const f=target('invented-legacy-'+layout),{manifestFileId}=await initializeCatalogCopy({adapter:f.adapter,guard});
 const engine=new CatalogTransactionEngine({adapter:f.adapter,assertWritable:guard,isOnline:()=>true});
 const lifecycle={manifestFileId,readManifest:()=>f.adapter.readJson(manifestFileId),readObject:async path=>{const m=await f.adapter.readJson(manifestFileId);return (await verifyCatalogHistory(f.adapter,m)).objects.get('data-object:'+m.snapshot[path]);},transact:t=>engine.transact(t)};
 const store=new CanonicalLedgerStore({lifecycle,layout});await store.load();let ledger=replayFixture(1).ledger;await store.save(ledger);
 ledger=applyFinancialEvent(ledger,{activityId:ledger.activities[0].activityId,type:'bank-correction',amountText:'-100',commandId:'invented-correct',evidence:{rationale:'Invented correction'}});await store.save(ledger);
 const original=await f.adapter.readJson(manifestFileId);
 const archive=await exportCatalogArchive({adapter:f.adapter,manifestFileId,withSourceLock:gate,validateStructure:validateSyntheticApplicationSnapshot});
 const fixture={provenance:'Baseline 1dc79ca invented one-activity archived history; two old saves.',layout,ledger,archive,sourceManifest:original};
 const raw=Buffer.from(JSON.stringify(fixture)),compressed=gzipSync(raw);await writeFile(process.env.FIXTURE_OUTPUT+'/existing-v5-'+layout+'.json.gz',compressed);console.log(layout,raw.length,compressed.length);
}
JS
node "$temporary/generate-fixtures.mjs"
