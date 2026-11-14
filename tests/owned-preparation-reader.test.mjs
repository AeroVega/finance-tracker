import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOwnedPreparationReader,bindPreparationRead,typedPreparationRead,getOwnedPreparationReader} from '../js/owned-preparation-reader.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('owned preparation copies input/output bytes and has no fallback',async()=>{
  const input=Buffer.from([1,2,3]),key=hash(input),reader=createOwnedPreparationReader([[key,input]]);
  input.fill(9);const out=await reader(key);assert.deepEqual([...out],[1,2,3]);out.fill(8);
  assert.deepEqual([...await reader(key)],[1,2,3]);assert.equal(Object.isFrozen(reader),true);
  await assert.rejects(reader('0'.repeat(64)),{code:'object-not-found'});
  assert.throws(()=>createOwnedPreparationReader([[key,new Uint8Array(65537)]]),{code:'byte-limit'});
  assert.throws(()=>createOwnedPreparationReader([[key,new Uint8Array(new SharedArrayBuffer(4))]]),{code:'invalid-preparation'});
});
test('only exact factory reader and internal typed adaptation carry owned bytes',async()=>{
  const input=new Uint8Array([4]),key=hash(input),reader=createOwnedPreparationReader([[key,input]]);
  assert.equal(bindPreparationRead({read:reader}),reader);
  const typed=typedPreparationRead(reader);assert.equal(getOwnedPreparationReader(typed),reader);
  assert.deepEqual(await typed({sha256:key}),input);
  let invoked=false;assert.throws(()=>typed({get sha256(){invoked=true;return key;}}),{code:'invalid-preparation'});assert.equal(invoked,false);
  for(const forged of [reader.bind(null),new Proxy(reader,{}),async(...args)=>reader(...args),Object.assign(async()=>input,{owned:true,read:reader})]) {
    assert.equal(getOwnedPreparationReader(forged),undefined);
    assert.equal(getOwnedPreparationReader(typedPreparationRead(forged)),undefined);
  }
});
test('binding captures one read function and only genuine owned results survive a custom bind',async()=>{
  let reads=0;const store={value:7,get read(){reads++;return function(){return this.value;};}};
  const bound=bindPreparationRead(store);assert.equal(reads,1);assert.equal(bound(),7);assert.equal(getOwnedPreparationReader(bound),undefined);
  const bytes=new Uint8Array([6]),key=hash(bytes),owned=createOwnedPreparationReader([[key,bytes]]);
  const fake=()=>{};fake.bind=()=>owned;
  // Returning a genuinely pure reader is safe; an arbitrary wrapper cannot be registered.
  assert.equal(bindPreparationRead({read:fake}),owned);
  const fake2=()=>{};fake2.bind=()=>Object.assign(()=>bytes,{trusted:true});
  assert.equal(getOwnedPreparationReader(bindPreparationRead({read:fake2})),undefined);
});
