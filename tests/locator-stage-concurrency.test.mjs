import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalDriveAdapter} from '../js/physical-drive-adapter.mjs';
import {createPagedPhysicalLocators} from '../js/paged-physical-locators.mjs';
import {LocatorBatchAdapter,ordered,assertUnion,assertFinalWrites} from './helpers/paged-locator-batch-fixture.mjs';

async function fixture() {
  const adapter=new LocatorBatchAdapter(),tree=adapter.tree({maxEntries:4,maxChildren:3,maxNodeBytes:4096});
  const initial=ordered(Array.from({length:12},(_,i)=>adapter.object(i)));
  const root=await tree.build(initial);
  const additions=ordered(Array.from({length:24},(_,i)=>adapter.object(100+i)));
  adapter.reset();
  return {adapter,tree,initial,root,additions};
}

function ownedTree(adapter) {
  adapter.readMetadataSnapshot=async()=>new Map([...adapter.files].map(([id,file])=>[id,structuredClone(file.metadata)]));
  const guard=async()=>{adapter.guards++;if(!adapter.writable)throw new Error('invented ownership lost');};
  const physical=createPhysicalDriveAdapter(adapter,{manifestFileId:'unused',assertWritable:guard});
  return createPagedPhysicalLocators(physical,{databaseId:adapter.databaseId,copyId:adapter.copyId,folderId:adapter.folderId,
    maxEntries:4,maxChildren:3,maxNodeBytes:4096,assertWritable:guard});
}

test('catalog staging overlaps at most four independent pages and retains child-before-parent durability',async()=>{
  const {adapter,tree,initial,root,additions}=await fixture();
  const create=adapter.createImmutable.bind(adapter);let active=0,peak=0;
  adapter.createImmutable=async args=>{active++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,5));return await create(args);}finally{active--;}};
  // The tree snapshots its adapter methods, so create another view after wrapping.
  const next=await ownedTree(adapter).setMany(root,additions);
  assert.equal(peak,4);assert.equal(active,0);
  assertUnion(adapter,next,[...initial,...additions]);assertFinalWrites(adapter,next);
  assertUnion(adapter,root,initial);
});

for(const mode of ['failure','abort','ownership'])test(`catalog staging drains issued siblings and stops before parent publication after ${mode}`,async()=>{
  const {adapter,initial,root,additions}=await fixture();
  const controller=new AbortController(),create=adapter.createImmutable.bind(adapter);let active=0,started=0,finished=0;
  adapter.createImmutable=async args=>{
    const ordinal=++started;active++;
    try {
      await new Promise(r=>setTimeout(r,ordinal===1?1:15));
      if(ordinal===1) {
        if(mode==='failure')throw new Error('invented write failure');
        if(mode==='abort')controller.abort();
        if(mode==='ownership')adapter.writable=false;
      }
      return await create(args);
    }finally{active--;finished++;}
  };
  await assert.rejects(ownedTree(adapter).setMany(root,additions,{signal:controller.signal}));
  assert.equal(started,4);assert.equal(finished,4);assert.equal(active,0);
  assert.ok(adapter.created.every(id=>adapter.json({fileId:id}).nodeType==='leaf'));
  assertUnion(adapter,root,initial);
});
