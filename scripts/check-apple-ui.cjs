// Optional browser acceptance check. Requires a local server and Playwright.
// External HTTPS requests are blocked; all financial records are invented.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.FINANCE_UI_URL || 'http://127.0.0.1:4173/finance-tracker/';
(async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 for (const [width,height,large,safe] of [[320,568,false,false],[390,844,false,true],[740,390,false,true],[844,390,false,true],[820,1180,false,false],[1024,768,false,false],[1440,900,false,false],[320,700,true,false],[568,320,true,true]]) {
  const page = await browser.newPage({viewport:{width,height},hasTouch:width<1000});
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());
  await page.goto(base);
  if (large) await page.addStyleTag({content:'html {font-size:200%}'});
  if (safe) await page.addStyleTag({content:':root {--safe-top:24px;--safe-right:24px;--safe-bottom:34px;--safe-left:24px}'});
  await page.click('#start-preview');
  await page.waitForFunction(()=>document.querySelector('#data-mode').dataset.mode==='preview');
  assert.equal(await page.evaluate(()=>location.hash), '#overview');
  if (width === 390) {
   await page.locator('#recent-activities button').first().click();
   const title = await page.locator('#detail-title').innerText();
   await page.fill('#correction-rationale', 'INVENTED preserve this unfinished edit');
   await page.click('#nav-overview'); await page.locator('#recent-activities button').first().click();
   assert.equal(await page.inputValue('#correction-rationale'), 'INVENTED preserve this unfinished edit');
   await page.click('#nav-overview');
   page.once('dialog', dialog=>dialog.dismiss());
   await page.locator('#recent-activities button').nth(1).click();
   assert.equal(await page.locator('#detail-title').textContent(), title);
   await page.locator('#recent-activities button').first().click();
   await page.fill('#correction-rationale', ''); await page.click('#close-detail');
   const homeScroll = await page.evaluate(()=>{scrollTo(0,400);return scrollY});
   await page.click('#nav-transactions');
   const activityScroll = await page.evaluate(()=>{scrollTo(0,300);return scrollY});
   await page.click('#nav-overview'); assert.equal(await page.evaluate(()=>scrollY), homeScroll);
   await page.click('#nav-overview'); assert.equal(await page.evaluate(()=>scrollY), 0);
   await page.goBack(); assert.equal(await page.evaluate(()=>scrollY), activityScroll);
   await page.goForward(); assert.equal(await page.evaluate(()=>scrollY), 0);
  }
  await page.locator('#recent-activities button').first().click();
  await page.click('#close-detail');
  assert.equal(await page.evaluate(()=>location.hash), '#overview');
  await page.locator('#workspace-scope > summary').press('Enter');
  assert.equal(await page.locator('#account-filter').isVisible(), true);
  await page.selectOption('#account-filter', {label:'Invented checking'});
  assert((await page.locator('#scope-period-title').innerText()).includes('Invented checking'));
  await page.locator('#workspace-scope > summary').press('Enter');
  await page.click('#nav-position');
  await page.locator('.manage-accounts > summary').click();
  await page.getByText('Add or correct a dated synthetic balance', {exact:true}).click();
  await page.fill('#balance-source', 'Invented unfinished balance evidence');
  await page.click('#nav-overview'); await page.click('#nav-position');
  assert.equal(await page.inputValue('#balance-source'), 'Invented unfinished balance evidence');
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
  await page.locator('#transaction-rows td:nth-child(2)').first().click();
  await page.fill('#correction-rationale','Invented browser check, unfinished draft');
  await page.click('#nav-position'); await page.click('#nav-transactions'); await page.click('#resume-detail');
  assert.equal(await page.inputValue('#correction-rationale'),'Invented browser check, unfinished draft');
  await page.click('#stage-correction');
  await page.waitForSelector('#draft-bar:not([hidden])');
  await page.fill('#correction-rationale', 'Invented second unfinished correction');
  await page.waitForTimeout(100);
  if (width<=760) {
   const inFlow = await page.locator('#draft-bar').evaluate(el=>getComputedStyle(el).position==='static');
   if (inFlow) await page.locator('#draft-bar .primary-button:visible').first().scrollIntoViewIfNeeded();
   const nav=await page.locator('.primary-nav').boundingBox(),draft=await page.locator('#draft-bar').boundingBox();
   assert(draft.y+draft.height<=nav.y-6,`draft overlaps navigation ${width}/${large}`);
   if (height<=450) {
    assert.equal(inFlow, true, 'short windows need a scrolling draft bar');
    await page.locator('#correction-rationale').scrollIntoViewIfNeeded();
    const box=await page.locator('#correction-rationale').boundingBox();
    const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id,{x:box.x+box.width/2,y:box.y+box.height/2});
    assert.equal(hit,'correction-rationale','fixed chrome blocks editing');
   }
  }
  await page.click('#nav-storage');
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const last=await page.locator('footer a').boundingBox();
  const draft=await page.locator('#draft-bar').boundingBox();
  assert(last.y+last.height<draft.y,`footer hidden ${width}/${large}`);
  if (process.env.FINANCE_UI_SCREENSHOTS) await page.screenshot({path:`${process.env.FINANCE_UI_SCREENSHOTS}/finance-${width}${large?'-large':''}.png`});
  if (width === 820) {
   await page.setViewportSize({width:390,height:844});
   await page.waitForTimeout(100);
   assert.equal(await page.inputValue('#balance-source'), 'Invented unfinished balance evidence');
   assert.equal(await page.inputValue('#correction-rationale'), 'Invented second unfinished correction');
   const nav=await page.locator('.primary-nav').boundingBox(), bar=await page.locator('#draft-bar').boundingBox();
   assert(bar.y+bar.height<=nav.y-6, 'resized draft overlaps phone navigation');
   await page.setViewportSize({width,height});
   await page.waitForTimeout(100);
   assert.equal(await page.inputValue('#balance-source'), 'Invented unfinished balance evidence');
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}x${height}, large text=${large}, injected insets=${safe}: routes, overflow, targets, draft continuity and clearance`);
  await page.close();
 }
 const p=await browser.newPage();
 await p.route('https://**/*',r=>r.abort());
 await p.goto(base); await p.click('#nav-storage');
 await p.locator('.preview-choices > summary').click(); await p.click('#preview-year');
 await p.waitForFunction(()=>document.querySelector('#data-mode').dataset.mode==='preview');
 await p.locator('#workspace-scope > summary').click();
 await p.selectOption('#account-filter', {label:'Invented investment'});
 await p.selectOption('#month-filter', '2025-01');
 assert((await p.locator('#recent-activities').innerText()).includes('Unknown status · excluded'));
 await p.getByRole('button',{name:/Inspect INVENTED BROKERAGE FEE/}).click();
 await p.selectOption('#posting-status','pending');
 await p.fill('#correction-rationale','INVENTED pending evidence'); await p.click('#stage-correction');
 await p.selectOption('#correction-type','classification'); await p.selectOption('#classification','spending');
 await p.fill('#correction-rationale','INVENTED fee classification'); await p.click('#stage-correction');
 await p.click('#nav-overview');
 assert((await p.locator('#recent-activities').innerText()).includes('Pending · excluded'));
 assert((await p.locator('#summary-cards').innerText()).includes('Unavailable'));
 await p.click('#nav-transactions');
 assert((await p.locator('#transaction-rows').innerText()).includes('Pending · excluded'));
 console.log('PASS pending/unknown labels and excluded-value qualifications through the synthetic editor');
 const manifest=await (await p.request.get(new URL('manifest.webmanifest',base).href)).json();
 assert.equal(manifest.scope,'./'); assert.equal(manifest.start_url,'./');
 for(const icon of [...manifest.icons,{src:'assets/icons/apple-touch-icon.png'}]) {
  const response=await p.request.get(new URL(icon.src,base).href);
  assert.equal(response.status(),200);assert(response.headers()['content-type'].includes('image/png'));
 }
 console.log('PASS anonymous subpath manifest and icon delivery');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
