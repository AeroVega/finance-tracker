// Local-only browser acceptance. No real Google credentials or network traffic.
// Usage: node scripts/check-drive-simulator.mjs [chromium|webkit]
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {ScenarioFullSnapshotDrive} from '../tests/helpers/scenario-full-snapshot-drive.mjs';
const require = createRequire(import.meta.url);
const playwright = require('playwright');
const engine = process.argv[2] || 'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const root = resolve(new URL('..',import.meta.url).pathname);
const types = {'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server = createServer(async(req,res)=>{
 try {
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local.invalid').pathname));
  if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  const file=path===root?resolve(root,'index.html'):path;
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
let browser;
try {
 browser=await playwright[engine].launch(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}:{});
 for(const scenario of ['popup_closed','popup_failed_to_open','access_denied','picker-error','picker-cancel','seed-reopen']){
  const http=new ScenarioFullSnapshotDrive();
  const context=await browser.newContext({viewport:{width:440,height:796},hasTouch:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({scenario,folderId})=>{
   window.google={accounts:{oauth2:{initTokenClient:({callback,error_callback})=>({requestAccessToken:()=>{
    if(scenario.startsWith('popup_'))error_callback({type:scenario});
    else if(scenario==='access_denied')callback({error:scenario});
    else callback({access_token:'invented-test-token',expires_in:3600});
   }})}},picker:{}};
   class View{setIncludeFolders(){return this;}setSelectFolderEnabled(){return this;}setMimeTypes(){return this;}}
   class Picker{addView(){return this;}setOAuthToken(){return this;}setDeveloperKey(){return this;}setAppId(){return this;}setOrigin(){return this;}setTitle(){return this;}setCallback(cb){this.cb=cb;return this;}build(){return this;}setVisible(){queueMicrotask(()=>this.cb(scenario==='picker-error'?{action:'error'}:scenario==='picker-cancel'?{action:'cancel'}:{action:'picked',docs:[{id:folderId}]}));}}
   Object.assign(window.google.picker,{DocsView:View,ViewId:{FOLDERS:'folders'},PickerBuilder:Picker,Action:{PICKED:'picked',CANCEL:'cancel',ERROR:'error',LOADED:'loaded'}});
   window.gapi={load:(_name,options)=>options.callback()};
  },{scenario,folderId:http.folderId});
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.href===base+'js/google-config.json')return route.fulfill({json:{clientId:'invented',apiKey:'invented',projectNumber:'1'}});
   if(url.origin===new URL(base).origin)return route.continue();
   if(['https://accounts.google.com/gsi/client','https://apis.google.com/js/api.js'].includes(url.href))return route.fulfill({contentType:'text/javascript',body:'/* Stub supplied by init script. */'});
   if(url.origin==='https://www.googleapis.com'){
    if(url.search==='?fields=id,name,mimeType,trashed')return route.fulfill({json:{id:http.folderId,name:'invented synthetic',mimeType:'application/vnd.google-apps.folder',trashed:false}});
    const response=await http.fetch(url.href,{method:request.method(),headers:request.headers(),body:request.postDataBuffer()||undefined});
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
   }
   throw Error('Unmodeled external request blocked: '+url.origin);
  });
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(base);await page.click('#nav-storage');await page.click('#create-ledger');
  if(scenario==='seed-reopen'){
   await page.waitForFunction(()=>document.querySelector('#data-mode').dataset.mode==='saved',{},{timeout:20000});
   await page.click('#nav-storage');await page.click('#release-ledger');
   await page.waitForFunction(()=>!document.querySelector('#open-ledger').disabled);
   await page.click('#open-ledger');
   await page.waitForFunction(()=>document.querySelector('#data-mode').dataset.mode==='saved',{},{timeout:20000});
   assert.ok(http.events.length>0);await page.click('#nav-storage');await page.click('#release-ledger');
  }else{
   await page.waitForFunction(()=>!document.querySelector('#create-ledger').disabled);
   assert.equal(http.mutations,0);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({engine,scenario,result:'passed',requests:http.requests.length,serverEvents:http.events.length}));
  await context.close();
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
