export async function load(url,context,nextLoad){
 const result=await nextLoad(url,context);if(!url.endsWith('/js/physical-root-binding.mjs'))return result;
 let source=String(result.source);
 const once=(anchor,replacement)=>{if(source.split(anchor).length!==2)throw new Error('Local audit anchor must occur exactly once');source=source.replace(anchor,replacement);};
 once('async #guard(expected,signal) {','async #guard(expected,signal) {globalThis.__localAuditGuards=(globalThis.__localAuditGuards??0)+1;');
 once('if(nativeGuard&&nativeHistory&&getOwnedPreparationReader(preparation))','if(!globalThis.__localAuditDisabled&&nativeGuard&&nativeHistory&&getOwnedPreparationReader(preparation))');
 const anchor='if(!this.#incremental)await this.#receiptChain(current, current, signal,audit);';
 if(source.split(anchor).length!==2)throw new Error('Local-audit entry hook anchor must occur exactly once');
 once('if(!this.#incremental)await this.#receiptChain(current, current, signal,audit);','if(audit)await globalThis.__localAuditEntered?.();\n        if(!this.#incremental)await this.#receiptChain(current, current, signal,audit);');
 once('audit?.afterOwnPublication(current);','audit?.afterOwnPublication(current);if(audit)await globalThis.__localAuditPublished?.();');
 return {...result,source};
}
