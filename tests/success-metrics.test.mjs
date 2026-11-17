import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveRequestMetrics,markManifestRequest,transferManifestRequest} from '../js/drive-request-metrics.mjs';
import {successfulActionSummary} from '../js/success-metrics.mjs';
import {FullSnapshotApplication} from '../js/full-snapshot-application.mjs';
import {HttpFullSnapshotDrive} from './helpers/http-full-snapshot-drive.mjs';
async function setupHttpCanonicalWorkbench(){const http=new HttpFullSnapshotDrive();const lifecycle=new FullSnapshotApplication({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch,lifecycleTarget:null,setIntervalImpl:()=>1,clearIntervalImpl:()=>{},visibilityDelayMs:0});await lifecycle.start({initialize:true});const driver=lifecycle.createLedgerStore();await driver.load();return {http,lifecycle,driver};}
import {replayFixture} from './helpers/ledger-replay-fixtures.mjs';
test('manifest attempt observations exclude session PATCH and count retries without inspecting URLs',async()=>{
 const metrics=createDriveRequestMetrics(),other=createDriveRequestMetrics(),a=metrics.openWindow(),b=other.openWindow();let calls=0;
 const fetch=metrics.wrapFetch(async()=>{if(++calls===1)throw new Error('SECRET');return new Response('private');});
 const source=markManifestRequest({method:'PATCH'}),request={method:'PATCH'};transferManifestRequest(source,request);
 await assert.rejects(fetch('private-url',request));await fetch('private-url',request);await fetch('private-session',{method:'PATCH'});
 assert.equal(a.manifestPatches(),2);assert.equal(a.snapshot().patch,3);assert.equal(b.manifestPatches(),0);
 const summary=successfulActionSummary({actionId:'save-ledger',elapsedMs:5,requests:a.close(),manifestPatches:a.manifestPatches(),publication:{path:'native',reason:'none',id:'SECRET'}});
 assert.equal(summary.manifestPatches,2);assert.doesNotMatch(JSON.stringify(summary),/SECRET|private/);summary.requests.patch=0;assert.equal(a.snapshot().patch,3);
 assert.equal(successfulActionSummary({actionId:'SECRET',elapsedMs:0}),null);
 assert.equal(successfulActionSummary({get actionId(){throw Error('SECRET');}}),null);
});
test('purpose attempts retain exact status bins, overlapping header times and detached private output',async()=>{
 const {markRequestPurpose,safePurposeMetrics}=await import('../js/drive-request-metrics.mjs');
 let time=0;const metrics=createDriveRequestMetrics({now:()=>time}),window=metrics.openWindow();
 const statuses=[404,409,429,403,200];
 const fetch=metrics.wrapFetch(async()=>{time+=7;return new Response('SECRET',{status:statuses.shift()});});
 const options=markRequestPurpose({method:'GET'},'metadata');
 const transferred={method:'GET'};transferManifestRequest(options,transferred);
 for(let i=0;i<5;i++)await fetch({toString(){throw Error('must not read URL');}},transferred);
 const rows=window.purposes(),metadata=rows.find(row=>row.purpose==='metadata');
 assert.deepEqual(metadata,{purpose:'metadata',count:5,completed:5,headerMs:35,maxHeaderMs:7,http404:1,http409:1,http429:1,other4xx:1,networkErrors:0});
 rows[0].count=999;assert.equal(window.purposes()[0].count,5);
 const summary=successfulActionSummary({actionId:'save-ledger',elapsedMs:35,requests:window.close(),purposes:window.purposes()});
 assert.doesNotMatch(JSON.stringify(summary),/SECRET|URL/);assert.equal(summary.purposes[0].count,5);
 assert.equal(safePurposeMetrics([{purpose:'SECRET'}]),null);
 assert.equal(safePurposeMetrics(window.purposes().map(row=>({...row,headerMs:-1}))),null);
});
test('full-snapshot save classifies every fetch and preserves two publications',async()=>{
 const h=await setupHttpCanonicalWorkbench();try{
 const window=h.lifecycle.requestMetrics.openWindow();await h.driver.save(replayFixture(1).ledger);
 const rows=window.purposes(),by=Object.fromEntries(rows.map(row=>[row.purpose,row]));
 assert.equal(rows.reduce((n,row)=>n+row.count,0),window.snapshot().requests);
 assert.equal(by.unknown.count,0);assert.equal(by['manifest-patch'].count,2);
 for(const purpose of ['owner-list','metadata','media','immutable-create'])assert.ok(by[purpose].count>0,purpose);
 }finally{await h.lifecycle.release();}
});

test('owner and inventory enumeration count each page and never classify from a URL',async()=>{
 const {listFolderChildren}=await import('../js/drive-feasibility-spike.mjs');
 const metrics=createDriveRequestMetrics(),window=metrics.openWindow();
 for(const owner of [false,true]){let page=0;await listFolderChildren({accessToken:'PRIVATE',folderId:'PRIVATE',...(owner?{markerFilter:{name:'PRIVATE',property:'PRIVATE',value:'PRIVATE'}}:{}),fetchImpl:metrics.wrapFetch(async()=>new Response(JSON.stringify({incompleteSearch:false,files:[],...(page++===0?{nextPageToken:'PRIVATE'}:{})})))});}
 const rows=window.purposes();assert.equal(rows.find(r=>r.purpose==='owner-list').count,2);assert.equal(rows.find(r=>r.purpose==='inventory-list').count,2);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE/);
});
test('unknown and network attempts remain bounded and cross-tab independent',async()=>{
 const {markRequestPurpose}=await import('../js/drive-request-metrics.mjs');
 const metrics=createDriveRequestMetrics(),window=metrics.openWindow(),other=createDriveRequestMetrics().openWindow();
 const fetch=metrics.wrapFetch(()=>{throw Error('SECRET');});
 for(let i=0;i<75;i++)assert.throws(()=>fetch('SECRET',markRequestPurpose({method:'PATCH'},'SECRET')));
 const row=window.purposes().find(r=>r.purpose==='unknown');assert.equal(row.count,75);assert.equal(row.networkErrors,75);assert.equal(window.purposes().length,10);assert.equal(other.purposes().reduce((n,r)=>n+r.count,0),0);assert.doesNotMatch(JSON.stringify(window.purposes()),/SECRET/);
});

test('a request completing after window close remains attributed to its captured window only',async()=>{
 const {markRequestPurpose}=await import('../js/drive-request-metrics.mjs');let resolve,time=0;
 const metrics=createDriveRequestMetrics({now:()=>time}),window=metrics.openWindow();
 const fetch=metrics.wrapFetch(()=>new Promise(done=>{resolve=done;}));
 const pending=fetch('SECRET',markRequestPurpose({method:'PATCH'},'session-patch'));
 window.close();const next=metrics.openWindow();time=9;resolve(new Response('',{status:409}));await pending;
 const row=window.purposes().find(r=>r.purpose==='session-patch');assert.equal(row.count,1);assert.equal(row.completed,1);assert.equal(row.http409,1);assert.equal(row.headerMs,9);assert.equal(window.manifestPatches(),0);assert.equal(next.snapshot().requests,0);
});
