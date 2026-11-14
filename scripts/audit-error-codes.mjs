import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Deliberately small lexical audit, not a JavaScript parser. Comments and quoted
// strings are tokens, so prose/comments do not become fake throw sites. We inspect
// the first argument (including ternary branches) of the project's named helpers,
// Error constructors, and literal `code` properties/assignments. Computed codes,
// aliases and template interpolation remain review obligations, listed separately.
const helpers = new Set(['fail', 'error', 'failure', 'storageError', 'googleStartupError', 'poison']);
const slug = value => typeof value === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
function tokens(source) {
  const out=[];
  let i=0, line=1;
  while(i<source.length) {
    const c=source[i], start=i, at=line;
    if(c==='\n'){line++;i++;continue;}
    if(/\s/.test(c)){i++;continue;}
    if(c==='/'&&source[i+1]==='/'){while(i<source.length&&source[i]!=='\n')i++;continue;}
    if(c==='/'&&source[i+1]==='*') {i+=2;while(i<source.length&&!(source[i]==='*'&&source[i+1]==='/')){if(source[i++]==='\n')line++;}i+=2;continue;}
    // Regex literals may contain quotes and comment-like bytes. Recognize the
    // expression-start positions used by this repository; division is left alone.
    if(c==='/'&&(!out.length||['(','[','{','=',':',',','!','?',';','return','>','&','|'].includes(out.at(-1)?.value))) {
      i++;let inClass=false;
      while(i<source.length){const r=source[i++];if(r==='\\'){i++;continue;}if(r==='[')inClass=true;if(r===']')inClass=false;if(r==='/'&&!inClass)break;if(r==='\n')line++;}
      while(i<source.length&&/[a-z]/i.test(source[i]))i++;
      out.push({type:'regex',value:null,line:at,start});continue;
    }
    if(c==='"'||c==="'"||c==='`') {
      i++;let value='',escaped=false;
      while(i<source.length&&source[i]!==c){if(source[i]==='\\'){escaped=true;value+=source[i++];if(i<source.length)value+=source[i++];}else {if(source[i]==='\n')line++;value+=source[i++];}}
      i++;out.push({type:c==='`'?'template':'string',value:escaped?null:value,line:at,start});continue;
    }
    if(/[A-Za-z_$]/.test(c)){i++;while(i<source.length&&/[\w$]/.test(source[i]))i++;out.push({type:'id',value:source.slice(start,i),line:at,start});continue;}
    out.push({type:'punct',value:c,line:at,start});i++;
  }
  return out;
}
export function scanSource(source, file='source.mjs') {
  const ts=tokens(source), sites=[], dynamic=[];
  const add=(token, kind)=>{if(slug(token?.value)&&token.type==='string')sites.push({code:token.value,file,line:token.line,kind});};
  for(let i=0;i<ts.length;i++) {
    const t=ts[i];
    if(t.value==='code'&&[':', '='].includes(ts[i+1]?.value))add(ts[i+2],'code-field');
    if(t.type!=='id'||ts[i+1]?.value!=='(')continue;
    const constructor=ts[i-1]?.value==='new'&&/Error$/.test(t.value);
    if(!constructor&&!helpers.has(t.value))continue;
    if(['function','const','let'].includes(ts[i-1]?.value))continue;
    let depth=0,j=i+2,found=false;
    for(;j<ts.length;j++){
      const a=ts[j];
      if(depth===0&&(a.value===','||a.value===')'))break;
      if(['(','[','{'].includes(a.value))depth++;
      if([')',']','}'].includes(a.value))depth--;
      if(a.type==='string'&&slug(a.value)){add(a,constructor?'constructor':'helper');found=true;}
    }
    if(!found&&ts[i+2]?.value!==')'&&ts[i+2]?.type!=='string')dynamic.push({file,line:t.line,helper:t.value});
  }
  const seen=new Set();
  return {sites:sites.filter(s=>{const key=`${s.code}:${s.line}`;if(seen.has(key))return false;seen.add(key);return true;}),dynamic};
}
export function auditErrorCodes(root, entries) {
  const sites=[],dynamic=[];
  // Registry and message compatibility modules define codes rather than emit them.
  for(const file of fs.readdirSync(path.join(root,'js')).filter(f=>/\.(?:mjs|js)$/.test(f)&&!['error-registry.mjs','app-diagnostic-codes.mjs','app-diagnostic-messages.mjs'].includes(f)).sort()) {
    const result=scanSource(fs.readFileSync(path.join(root,'js',file),'utf8'),`js/${file}`);
    sites.push(...result.sites);dynamic.push(...result.dynamic);
  }
  const referenced=new Set(sites.map(s=>s.code));
  return {sites,dynamic,unregistered:sites.filter(s=>!Object.hasOwn(entries,s.code)),unused:Object.keys(entries).filter(c=>!referenced.has(c)).sort()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(process.argv[2]||fileURLToPath(new URL('..',import.meta.url)));
  const {ERRORS}=await import(new URL('../js/error-registry.mjs',import.meta.url));
  const result=auditErrorCodes(root,ERRORS);
  console.log(`Error-code audit: ${new Set(result.sites.map(s=>s.code)).size} literal codes; ${result.unregistered.length} unregistered sites.`);
  for(const s of result.unregistered)console.log(`UNREGISTERED ${s.code} ${s.file}:${s.line}`);
  console.log(`Computed/forwarded calls requiring review: ${result.dynamic.length}. Literal audit does not prove these paths.`);
  for(const s of result.dynamic)console.log(`DYNAMIC ${s.helper} ${s.file}:${s.line}`);
  console.log(`Registry entries not directly referenced (${result.unused.length}; not automatically removed): ${result.unused.join(', ')}`);
  for(const code of ['byte-limit','verification-scope-closed','invalid-plan','invalid-json','base-conflict'])console.log(`${code}: ${result.sites.filter(s=>s.code===code).map(s=>`${s.file}:${s.line}`).join(', ')}`);
  if(result.unregistered.length)process.exitCode=1;
}
