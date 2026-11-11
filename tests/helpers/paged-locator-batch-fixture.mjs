import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalizeJcs} from '../../js/transaction-protocol.mjs';
import {createPagedPhysicalLocators} from '../../js/paged-physical-locators.mjs';

const encoder=new TextEncoder(),decoder=new TextDecoder();
export const encode=value=>encoder.encode(canonicalizeJcs(value));
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const primary=e=>e.kind+':'+e.sha256;
export const ordered=values=>[...values].sort((a,b)=>primary(a)<primary(b)?-1:primary(a)>primary(b)?1:0);
export const collect=async iterable=>{const result=[];for await(const value of iterable)result.push(value);return result;};

// Invented bytes only. Allocation, attempt, durable-create and reachable sets
// are separate so tests cannot mistake an intermediate upload for a final page.
export class LocatorBatchAdapter {
  constructor(scope={}) {
    Object.assign(this,{databaseId:'invented-database',copyId:'invented-copy',folderId:'invented-folder'},scope);
    this.files=new Map();this.next=0;this.writable=true;this.reset();
  }
  reset() {this.allocations=[];this.attempts=[];this.created=[];this.guards=0;this.reads=0;this.events=[];this.missingMetadata=[];}
  async allocateFileId() {const id='invented-locator-'+String(this.next++).padStart(8,'0');this.allocations.push(id);this.events.push({operation:'allocate',fileId:id});return id;}
  async readMetadata(id) {const file=this.files.get(id);if(!file){this.missingMetadata.push(id);this.events.push({operation:'absence',fileId:id});throw Object.assign(new Error('invented missing file'),{code:'object-not-found'});}return file.metadata;}
  async readBytes(id,{maxBytes}) {this.reads++;const file=this.files.get(id);if(!file)throw Object.assign(new Error('invented missing file'),{code:'object-not-found'});assert.ok(file.bytes.length<=maxBytes);return file.bytes;}
  save(id,bytes,kind,transactionId='invented-transaction') {
    this.files.set(id,{bytes:new Uint8Array(bytes),metadata:{id,parents:[this.folderId],trashed:false,version:'1',size:String(bytes.length),
      appProperties:{financeTrackerHash:hash(bytes),financeTrackerKind:kind==='data-object'?'snapshot-object':kind,financeTrackerTransaction:transactionId}}});
    return {fileId:id,sha256:hash(bytes)};
  }
  async createImmutable(args) {
    this.events.push({operation:'create',fileId:args.fileId});
    this.attempts.push({fileId:args.fileId,kind:args.kind,sha256:args.expectedSha256});
    await args.beforeMutation();
    assert.equal(hash(args.content),args.expectedSha256);
    assert.ok(!this.files.has(args.fileId),'a batch must allocate a new fixed physical ID');
    const node=JSON.parse(decoder.decode(args.content));
    const children=node.nodeType==='branch'?node.children:args.kind==='locator-catalog'?['objects','identities','files'].map(index=>node[index]).filter(Boolean):[];
    for(const child of children) {
      assert.ok(this.files.has(child.fileId),'every child must exist before its parent is created');
      assert.equal(hash(this.files.get(child.fileId).bytes),child.sha256);
    }
    this.save(args.fileId,args.content,args.kind,args.transactionId);this.created.push(args.fileId);
  }
  object(n,{kind='data-object',identity,fileId='invented-body-'+String(n).padStart(8,'0'),transactionId='invented-transaction',sequence=n}={}) {
    const ref=this.save(fileId,encode({inventedRecord:n,text:'synthetic only'}),kind,transactionId);
    return {kind,identity:identity??(kind==='data-object'?ref.sha256:'invented-id-'+n),...ref,...(kind==='journal-event'?{transactionId,sequence}:{})};
  }
  tree(options={}) {return createPagedPhysicalLocators(this,{databaseId:this.databaseId,copyId:this.copyId,folderId:this.folderId,
    assertWritable:async()=>{this.guards++;if(!this.writable)throw new Error('invented ownership lost');},...options});}
  json(ref) {return JSON.parse(decoder.decode(this.files.get(ref.fileId).bytes));}
}

// A separate raw-JSON walker, not tree.entries/verify, checks both physical
// closure and complete index unions. Previous roots are deliberately excluded.
export function enumerateCatalog(adapter,ref) {
  const root=adapter.json(ref),pages=new Set([ref.fileId]),indexes={objects:[],identities:[],files:[]};
  function walk(ref,index) {
    assert.ok(!pages.has(ref.fileId),'a page appears only once in the selected closure');pages.add(ref.fileId);
    const stored=adapter.files.get(ref.fileId);assert.equal(hash(stored.bytes),ref.sha256);
    const node=adapter.json(ref);assert.equal(node.index,index);
    if(node.nodeType==='leaf')indexes[index].push(...node.entries);
    else for(const child of node.children)walk(child,index);
  }
  for(const index of Object.keys(indexes))if(root[index])walk(root[index],index);
  return {root,pages,indexes};
}
export function assertUnion(adapter,ref,expected) {
  const found=enumerateCatalog(adapter,ref),values=ordered(expected);
  const sort=pairs=>pairs.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  assert.equal(found.root.entryCount,String(values.length));
  assert.deepEqual(found.indexes.objects,values.map(e=>[primary(e),e]));
  assert.deepEqual(found.indexes.identities,sort(values.map(e=>[e.kind+':'+e.identity,primary(e)])));
  assert.deepEqual(found.indexes.files,sort(values.map(e=>[e.fileId,primary(e)])));
  return found;
}
export function assertFinalWrites(adapter,ref) {
  const {pages}=enumerateCatalog(adapter,ref);
  const firstCreate=adapter.events.findIndex(event=>event.operation==='create');
  assert.ok(firstCreate>=0);
  assert.ok(adapter.events.slice(firstCreate).every(event=>event.operation==='create'),'the whole candidate is planned before the first create');
  assert.deepEqual(new Set(adapter.allocations),new Set(adapter.created),'every successful allocation became exactly one durable page');
  assert.equal(adapter.attempts.length,adapter.created.length);
  assert.deepEqual(new Set(adapter.missingMetadata),new Set(adapter.created),'every planned physical ID was checked for absence before creation');
  for(const id of adapter.created)assert.ok(pages.has(id),'every new durable page is reachable from the one final catalog');
  return {generated:adapter.allocations.length,durableCreated:adapter.created.length,finalReachable:adapter.created.filter(id=>pages.has(id)).length,totalReachable:pages.size};
}
