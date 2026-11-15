import {copyOwnedBytes} from './byte-ownership.mjs';
import {fail} from './app-error.mjs';

// Recognition certifies only the reader's implementation, never the correctness
// of its bytes or a physical absence/write. There is no arbitrary branding API.
const readers=new WeakMap();
const own=reader=>{Object.freeze(reader);readers.set(reader,reader);return reader;};
export const getOwnedPreparationReader=reader=>readers.get(reader);

export function createOwnedPreparationReader(entries) {
  const bytesByHash=new Map();
  for(const [hash,input] of entries) {
    if(typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash)||bytesByHash.has(hash))fail('invalid-preparation');
    let bytes;
    try {bytes=copyOwnedBytes(input);}catch(cause){fail('invalid-preparation',{cause});}
    if(bytes.length>65536)fail('byte-limit');
    bytesByHash.set(hash,bytes);
  }
  return own(async hash=>{
    const bytes=bytesByHash.get(hash);
    if(!bytes)fail('object-not-found');
    return bytes.slice();
  });
}

// Owned readers do not use `this`. Other callbacks retain their original bound
// receiver and observable behavior. Wrappers/proxies/bound copies do not inherit
// recognition merely because they forward to a known reader.
export function bindPreparationRead(store,read=store?.read) {
  return typeof read==='function'?(readers.has(read)?read:read.bind(store)):undefined;
}
export function typedPreparationRead(read) {
  const owned=readers.get(read);
  if(!owned)return (query,options)=>read(query.sha256,options);
  const typed=query=>{
    const descriptor=Object.getOwnPropertyDescriptor(query,'sha256');
    if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='string')fail('invalid-preparation');
    return owned(descriptor.value);
  };
  Object.freeze(typed);readers.set(typed,owned);return typed;
}
