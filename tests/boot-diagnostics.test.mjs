import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../js/boot-diagnostics.js', import.meta.url), 'utf8');
function boot() {
  const listeners = {}, children = [];
  const document = {currentScript:{src:'https://example.test/finance-tracker/js/boot-diagnostics.js'},
    body:{append(node){children.push(node)}},
    createElement(tag){return {tag, children:[],setAttribute(){}, append(node){this.children.push(node)}}},
    addEventListener(name, fn){listeners[name]=fn}
  };
  const window = {addEventListener(name, fn, capture){assert.equal(capture,true);listeners[name]=fn}};
  const context = {window, document, URL}; vm.runInNewContext(source, context);
  const fail = src => listeners.error({target:{tagName:'SCRIPT',src,getAttribute(){return src}}});
  return {context,children,fail,listeners};
}
test('boot failure records only known local entry scripts and renders once', () => {
  const b=boot(); b.fail('https://example.test/finance-tracker/js/canonical-workspace.mjs');
  assert.equal(b.children.length,1);
  assert.equal(b.context.__FT_BOOT_DIAGNOSTICS__[0].file,'js/canonical-workspace.mjs');
  b.fail('https://example.test/finance-tracker/js/canonical-workspace.mjs');
  assert.equal(b.children.length,1);assert.equal(b.context.__FT_BOOT_DIAGNOSTICS__.length,1);
  assert.match(b.children[0].children[0].textContent,/module-load-failed/);
});
test('boot fallback ignores foreign, unknown, query-bearing and hostile resources', () => {
  const b=boot();
  for(const src of ['https://evil.invalid/finance-tracker/js/canonical-workspace.mjs',
    'https://example.test/finance-tracker/js/private-account.mjs',
    'https://example.test/finance-tracker/js/canonical-workspace.mjs?token=secret',
    'https://example.test/finance-tracker/js/%63anonical-workspace.mjs'])b.fail(src);
  b.listeners.error(new Proxy({}, {get(){throw new Error('secret')}}));
  assert.equal(b.children.length,0);assert.equal(b.context.__FT_BOOT_DIAGNOSTICS__.length,0);
});
test('main app loads dependency-free diagnostics before its application modules',async()=>{
  const files=['index.html'];
  for(const file of files){
    const html=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.ok(html.includes('boot-diagnostics.js'),file);
    const firstModule=html.indexOf('type="module"');
    if(firstModule>=0)assert.ok(html.indexOf('boot-diagnostics.js')<firstModule,file);
    assert.ok(html.includes('diagnostics.css'),file);
    assert.ok(html.includes('build-info.js'),file);
  }
});

test('main-app boot fallback ignores legacy tool scripts',()=>{
 const b=boot();b.fail('https://example.test/finance-tracker/prototype/drive-folder-discovery.mjs?v=standalone-discovery-2');
 assert.equal(b.children.length,0);assert.equal(b.context.__FT_BOOT_DIAGNOSTICS__.length,0);
});
