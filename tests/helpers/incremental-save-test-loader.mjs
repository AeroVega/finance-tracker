// Test-only observation/fault injection. No production flag can mint or disable a proof.
export async function load(url,context,nextLoad){
 const result=await nextLoad(url,context);let source=String(result.source??'');
 const replace=(anchor,replacement)=>{if(source.split(anchor).length!==2)throw new Error('Incremental test anchor must occur exactly once');source=source.replace(anchor,replacement);};
 if(url.endsWith('/js/paged-application-storage.mjs')){
  replace('const result=await engine.transact({intent,preparationStore:typedStore});','await globalThis.__incrementalPrepared?.(intent);const result=await engine.transact({intent,preparationStore:typedStore});');
  replace('  #retainBaseline(manifest) {','  #retainBaseline(manifest) {globalThis.__incrementalRetaining?.();');
 }
 if(url.endsWith('/js/physical-root-binding.mjs')){
 replace('      await tree.verify(m.locatorRoot, {signal});\n      let allOwned=false;', '      await tree.verify(m.locatorRoot, {signal});\n      if(this.#incremental)await globalThis.__incrementalStructural?.(this.#adapter,m,signal);\n      let allOwned=false;');
 replace('audit?.afterOwnPublication(current);','audit?.afterOwnPublication(current);await globalThis.__incrementalPublished?.();');
 replace('    check();return check;\n  }\n  async #currentState', '    check();globalThis.__incrementalCaptured?.();return check;\n  }\n  async #currentState');
 }
 return source===String(result.source??'')?result:{...result,source};
}
