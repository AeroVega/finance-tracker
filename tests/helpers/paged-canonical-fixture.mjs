import assert from 'node:assert/strict';
import {verifyPartitionedCanonicalCommit} from '../../js/canonical-paged-storage.mjs';
import {EMPTY_CANONICAL_BYTES,emptyCanonicalRootHash,PAGED_CANONICAL_VERIFIER} from '../../js/paged-canonical-format.mjs';
import {replayFixture} from './ledger-replay-fixtures.mjs';
export async function createPagedFixture() {
  const initial=await emptyCanonicalRootHash(),objects=new Map([[initial,EMPTY_CANONICAL_BYTES.slice()]]),commits=[];
  let manifest={format:'finance-tracker-physical-root-manifest',version:4,syntheticOnly:true,revision:'0',root:initial,pending:null,databaseId:'invented-db',copyId:'invented-copy',role:'primary'};
  const lifecycle={pagedCanonical:true,state:'ready',acceptingWrites:true,folderId:'invented-folder',
    readManifest:async()=>structuredClone(manifest),
    assertCurrentManifest:async expected=>{if(JSON.stringify(expected)!==JSON.stringify(manifest))throw Object.assign(new Error('base-conflict'),{code:'base-conflict'});},
    readPartitionedSnapshot:async()=>({manifest:structuredClone(manifest),rootHash:manifest.root,semanticVersion:PAGED_CANONICAL_VERIFIER,
      store:{read:async hash=>{assert.ok(objects.has(hash));return objects.get(hash).slice();}}}),
    async savePartitionedRoot({expectedBase,rootHash,objects:descriptors,preparationStore,semanticVersion,prepare}) {
      await lifecycle.assertCurrentManifest(expectedBase);assert.equal(semanticVersion,PAGED_CANONICAL_VERIFIER);
      if(prepare)({rootHash,objects:descriptors,preparationStore}=await prepare({rootHash:manifest.root,semanticVersion,store:{read:async hash=>{assert.ok(objects.has(hash));return objects.get(hash).slice();}}}));
      for(const d of descriptors)objects.set(d.sha256,await preparationStore.read(d.sha256));
      const commit={root:rootHash,previousRoot:manifest.root,revision:String(BigInt(manifest.revision)+1n),semanticVersion,operation:'synthetic-canonical-import',changeEvidenceRoot:null};
      const next={...manifest,root:rootHash,revision:commit.revision};
      await verifyPartitionedCanonicalCommit({manifest:next,commit,readObject:async q=>objects.get(q.sha256)});
      Object.assign(manifest,next);commits.push(commit);
    }};
  return {lifecycle,objects,commits,get manifest(){return manifest;},async reset(){objects.clear();objects.set(initial,EMPTY_CANONICAL_BYTES.slice());commits.length=0;Object.assign(manifest,{root:initial,revision:'0',pending:null});},ledger:replayFixture(2).ledger};
}
