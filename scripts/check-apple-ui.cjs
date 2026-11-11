// Optional browser acceptance check. Requires a local server and Playwright.
// External HTTPS requests are blocked; all financial records are invented.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.FINANCE_UI_URL || 'http://127.0.0.1:4173/finance-tracker/';
(async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 for (const [width,height,large,safe] of [[320,568,false,false],[390,844,false,true],[740,390,false,true],[844,390,false,true],[820,1180,false,false],[1440,900,false,false],[320,700,true,false]]) {
  const page = await browser.newPage({viewport:{width,height},hasTouch:width<1000});
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());
  await page.goto(base);
  if (large) await page.addStyleTag({content:'html {font-size:200%}'});
  if (safe) await page.addStyleTag({content:':root {--safe-top:24px;--safe-right:24px;--safe-bottom:34px;--safe-left:24px}'});
  await page.click('#start-preview');
  await page.waitForFunction(()=>document.querySelector('#data-mode').dataset.mode==='preview');
  for (const name of ['overview','transactions','position','review','storage']) {
   await page.click('#nav-'+name);
   await page.waitForFunction(n=>!document.getElementById(n).hidden,name);
   await page.waitForTimeout(80);
   assert.equal(await page.locator('.workspace-page:visible').count(),1);
   const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   assert(dims.scroll<=dims.width+1,`overflow ${width}/${large} ${name}: ${JSON.stringify(dims)}`);
   if (width<=760) {
    for (const link of await page.locator('.primary-nav a').all()) {
     const box=await link.boundingBox(); assert(box.height>=44&&box.width>=44,'touch target');
    }
   }
  }
  await page.click('#nav-transactions');
  await page.locator('#transaction-rows button').first().click();
  await page.fill('#correction-rationale','Invented browser check, unfinished draft');
  await page.click('#nav-position'); await page.click('#nav-transactions'); await page.click('#resume-detail');
  assert.equal(await page.inputValue('#correction-rationale'),'Invented browser check, unfinished draft');
  await page.click('#stage-correction');
  await page.waitForSelector('#draft-bar:not([hidden])');
  await page.waitForTimeout(100);
  if (width<=760) {
   const nav=await page.locator('.primary-nav').boundingBox(),draft=await page.locator('#draft-bar').boundingBox();
   assert(draft.y+draft.height<=nav.y-6,`draft overlaps navigation ${width}/${large}`);
  }
  await page.click('#nav-storage');
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const last=await page.locator('footer a').boundingBox();
  const draft=await page.locator('#draft-bar').boundingBox();
  assert(last.y+last.height<draft.y,`footer hidden ${width}/${large}`);
  if (process.env.FINANCE_UI_SCREENSHOTS) await page.screenshot({path:`${process.env.FINANCE_UI_SCREENSHOTS}/finance-${width}${large?'-large':''}.png`});
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}x${height}, large text=${large}, injected insets=${safe}: routes, overflow, targets, draft continuity and clearance`);
  await page.close();
 }
 const p=await browser.newPage();
 const manifest=await (await p.request.get(new URL('manifest.webmanifest',base).href)).json();
 assert.equal(manifest.scope,'./'); assert.equal(manifest.start_url,'./');
 for(const icon of [...manifest.icons,{src:'assets/icons/apple-touch-icon.png'}]) {
  const response=await p.request.get(new URL(icon.src,base).href);
  assert.equal(response.status(),200);assert(response.headers()['content-type'].includes('image/png'));
 }
 console.log('PASS anonymous subpath manifest and icon delivery');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
