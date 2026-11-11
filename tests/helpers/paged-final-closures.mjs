import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Independent fixture inspection. No production tree reader, verifier or
// builder defines these sets, and no real storage/network is accessed.
export function inspectFinalClosures(drive,manifest) {
  const canonicalHashes=new Set(),locatorFileIds=new Set(),retainedData=new Map();
  const hash=raw=>createHash('sha256').update(raw).digest('hex');
  const physical=ref=>{const file=drive.files.get(ref.fileId);assert.ok(file,'final physical object exists');assert.equal(hash(file.bytes),ref.sha256);return JSON.parse(new TextDecoder().decode(file.bytes));};
  const catalog=physical(manifest.locatorRoot);locatorFileIds.add(manifest.locatorRoot.fileId);
  function locator(ref,index) {
    if(ref===null)return;
    assert.ok(!locatorFileIds.has(ref.fileId),'no repeated final locator page');locatorFileIds.add(ref.fileId);
    const node=physical(ref);assert.equal(node.index,index);
    if(node.nodeType==='branch')for(const child of node.children)locator(child,index);
    else if(index==='objects')for(const [,entry] of node.entries)if(entry.kind==='data-object')retainedData.set(entry.sha256,entry);
  }
  for(const index of ['objects','identities','files'])locator(catalog[index],index);
  function read(hashValue) {
    canonicalHashes.add(hashValue);const ref=retainedData.get(hashValue);assert.ok(ref,'canonical reference is retained');return physical(ref);
  }
  function tree(root,visit) {
    const node=read(root);
    if(node.kind==='branch')for(const child of node.children)tree(child.hash,visit);
    else for(const [key,value] of node.entries)visit(key,value);
  }
  function value(ref) {
    if(ref.kind==='scalar'||ref.kind==='json')return;
    tree(ref.root,(_key,child)=>{
      if(ref.kind==='array')value(child);
      else if(ref.kind==='object'){value(child.key);value(child.value);}
      else assert.equal(typeof child,'string');
    });
  }
  const root=read(manifest.root);
  if(root.format==='finance-tracker-empty-canonical-root')return {canonicalHashes,locatorFileIds,retainedData};
  const source=read(root.source);value(source.metadata);
  tree(source.collections,(_name,collection)=>{tree(collection.byId,(_key,ref)=>value(ref));tree(collection.order,()=>{});});
  const derived=read(root.derived);
  for(const name of ['effectiveActivities','summaries'])tree(derived[name],(_key,ref)=>value(ref));
  tree(derived.monthActivities,()=>{});
  return {canonicalHashes,locatorFileIds,retainedData};
}
