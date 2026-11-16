export async function load(url,context,nextLoad){
 const result=await nextLoad(url,context);let source=String(result.source);
 if(url.endsWith('/js/physical-root-binding.mjs'))source=source.replace('#nativePublishedGuard(value,signal,observation) {','#nativePublishedGuard(value,signal,observation) {\n    if(globalThis.__publishedForceLegacy)return null;').replace("if (current.pending?.state === 'admitted') {","if (current.pending?.state === 'admitted') {\n      await globalThis.__publishedPendingHook?.('admitted');").replace('const pending = current.pending;','const pending = current.pending;\n    await globalThis.__publishedPendingHook?.(pending?.state);');
 if(url.endsWith('/js/physical-root-binding.mjs')){
  const start=source.indexOf('  #nativePublishedGuard(value,signal,observation) {'),end=source.indexOf('  transact({',start);
  if(start<0||end<0)throw new Error('Native publication method anchor missing');
  const method=source.slice(start,end),anchor='check();return check;';
  if(method.split(anchor).length!==2)throw new Error('Native publication capture anchor must occur exactly once');
  source=source.slice(0,start)+method.replace(anchor,'check();globalThis.__publishedCapturedHook?.();return check;')+source.slice(end);
 }
 if(url.endsWith('/js/paged-application-storage.mjs'))source=source.replace("operation:'genesis',semanticVersion:PAGED_CANONICAL_VERIFIER","operation:'genesis',semanticVersion:globalThis.__publishedMixedHistory?'invented-custom-genesis':PAGED_CANONICAL_VERIFIER");
 if(url.endsWith('/js/canonical-paged-storage.mjs'))source=source.replace('const plans=new Map([[PAGED_CANONICAL_VERIFIER,verify]]);',`const plans=new Map([[PAGED_CANONICAL_VERIFIER,verify]]);
 if(globalThis.__publishedMixedHistory)plans.set('invented-custom-genesis',async input=>{globalThis.__publishedCustomCalls=(globalThis.__publishedCustomCalls??0)+1;return verify({...input,commit:{...input.commit,semanticVersion:PAGED_CANONICAL_VERIFIER}});});`);
 if(url.endsWith('/js/canonical-paged-storage.mjs'))source=source.replace('if(parent.semanticVersion!==profile.verifier)',"if(parent.semanticVersion!==profile.verifier&&parent.semanticVersion!=='invented-custom-genesis')");
 if(url.endsWith('/js/paged-canonical-format.mjs'))source=source.replace('export function canonicalProfileForVerifier(verifier) {',"export function canonicalProfileForVerifier(verifier) {\n if(verifier==='invented-custom-genesis')verifier=PAGED_CANONICAL_VERIFIER;");
 return {...result,source};
}
