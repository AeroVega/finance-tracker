import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationStorageLifecycle} from '../js/application-storage-lifecycle.mjs';
import {DashboardSyntheticStorage} from '../js/dashboard-synthetic-storage.mjs';
import {GoogleDriveTransactionAdapter} from '../js/drive-transaction-engine.mjs';
import {SessionCoordinator} from '../js/session-coordination.mjs';
import {createDriveSessionAdapter, SESSION_MARKER_NAME, SESSION_MARKER_PROPERTY} from '../js/drive-session-adapter.mjs';
import {readBoundedDriveJson} from '../js/drive-response-transport.mjs';
import {getReport} from '../js/error-reporting.mjs';
import {createDriveRequestMetrics, markRequestEndpoint} from '../js/drive-request-metrics.mjs';

const secret = 'PRIVATE-CANARY-https://private.invalid/account/4417';
test('lifecycle and dashboard forward the same safe report instead of collapsing its cause', () => {
  const statuses=[];
  const dashboard=new DashboardSyntheticStorage({onStatus:status=>statuses.push(status)});
  const cause=Object.assign(new TypeError(secret),{code:'drive-network-error'});
  const failure=Object.assign(new Error(secret,{cause}),{code:'ownership-unknown',sessionCheck:'coordinator-read-failed'});
  const lifecycle={onStatus:status=>dashboard.publish(status.state,status.message,'error',{code:status.code},status.reportId)};
  ApplicationStorageLifecycle.prototype.publish.call(lifecycle,'ownership-unknown',secret,'ownership-unknown',failure);
  assert.equal(statuses.length,1);
  const report=getReport(statuses[0].reportId);
  assert.ok(report);
  assert.match(report.report,/drive-network-error/);
  assert.match(report.report,/coordinator-read-failed/);
  assert.doesNotMatch(JSON.stringify(statuses)+report.report,/PRIVATE-CANARY|private.invalid/);
  assert.equal(lifecycle.state,'ownership-unknown');
});
test('transport keeps rejection identity as cause without changing its established code', async () => {
  for(const cause of [new TypeError(secret),new DOMException(secret,'AbortError')]) {
    const adapter=new GoogleDriveTransactionAdapter({folderId:'synthetic',accessToken:()=> 'synthetic',fetchImpl:async()=>{throw cause}});
    await assert.rejects(adapter.request('https://www.googleapis.com/drive/v3/files'),failure=>failure.code==='drive-network-error'&&failure.cause===cause);
  }
});
test('bounded JSON decoding retains native failure type, never changes the fixed code', async () => {
  await assert.rejects(readBoundedDriveJson(new Response('{not-json-private}'),{kind:'session-marker'}),failure=>failure.code==='invalid-json-object'&&failure.cause instanceof SyntaxError);
  await assert.rejects(readBoundedDriveJson(new Response(new Uint8Array([0xff])),{kind:'session-marker'}),failure=>failure.code==='invalid-json-object'&&failure.cause instanceof TypeError);
});
test('session claim failures retain causal chain and a fixed check while refusing writes', async () => {
  const cause=new TypeError(secret);
  const coordinator=new SessionCoordinator({adapter:{read:async()=>null,write:async()=>{throw cause}},now:()=>1000,createSessionId:()=> 'synthetic-session'});
  await assert.rejects(coordinator.start(),failure=>failure.code==='ownership-unknown'&&failure.cause===cause&&failure.sessionCheck==='coordinator-claim-write-failed');
  assert.equal(coordinator.canWrite,false);
  const inspection=new SessionCoordinator({adapter:{read:async()=>{throw cause},write:async()=>{}},now:()=>1000,createSessionId:()=> 'synthetic-session'});
  await assert.rejects(inspection.start(),failure=>failure.code==='ownership-unknown'&&failure.cause===cause&&failure.sessionCheck==='coordinator-read-failed');
  assert.equal(inspection.canWrite,false);
});
test('session media read preserves the original native failure', async () => {
  const cause=new TypeError(secret);let calls=0;
  const file={id:'marker-1',name:SESSION_MARKER_NAME,mimeType:'application/json',parents:['folder-1'],appProperties:{[SESSION_MARKER_PROPERTY]:'v1'}};
  const adapter=createDriveSessionAdapter({folderId:'folder-1',accessToken:'synthetic',fetchImpl:async()=>{if(calls++===0)return new Response(JSON.stringify({files:[file],incompleteSearch:false}));throw cause;}});
  await assert.rejects(adapter.read(),failure=>failure.code==='network-error'&&failure.cause===cause);
});
test('request ring is bounded, private, independent of aggregate counts and safe under hostile observers', async () => {
  const entries=[];let time=0;
  const metrics=createDriveRequestMetrics({now:()=>time++,onRequest:entry=>{entries.push(entry);throw new Error(secret)}});
  const fetch=metrics.wrapFetch(async()=>({status:201}));
  for(let i=0;i<65;i++)await fetch(secret,{method:'POST',headers:{Authorization:secret}});
  assert.equal(entries.length,65);assert.equal(metrics.recentRequests().length,60);assert.equal(metrics.snapshot().requests,65);
  assert.deepEqual(Object.keys(entries[0]),['e','ep','m','s','ms','outcome']);
  assert.equal(entries[0].m,'post');assert.equal(entries[0].ep,'unknown');assert.equal(entries[0].outcome,'ok');
  const copy=metrics.recentRequests();copy[0].ep=secret;
  assert.doesNotMatch(JSON.stringify(metrics.recentRequests()),/PRIVATE-CANARY/);
});

test('request endpoints are fixed caller metadata, never guessed from private URLs', async () => {
  const metrics=createDriveRequestMetrics({now:()=>0});
  const fetch=metrics.wrapFetch(async()=>({status:200}));
  const options={method:'GET'};
  markRequestEndpoint(options,'files.get');
  await fetch(secret,options);
  await fetch('https://www.googleapis.com/drive/v3/files/private',{method:'GET'});
  markRequestEndpoint(options,secret);
  assert.equal(metrics.recentRequests()[0].ep,'files.get');
  assert.equal(metrics.recentRequests()[1].ep,'unknown');
  assert.deepEqual(options,{method:'GET'});
});

test('seeder and import surfaces survive lifecycle status forwarding; invalid surfaces default safely', () => {
  for (const requested of ['synthetic-year', 'import', secret]) {
    const expected = requested === secret ? 'workspace' : requested;
    const statuses = [];
    const dashboard = new DashboardSyntheticStorage({diagnosticSurface: requested, onStatus: status => statuses.push(status)});
    const lifecycle = new ApplicationStorageLifecycle({
      diagnosticSurface: dashboard.diagnosticSurface,
      syntheticOnly: true, folderName: 'synthetic fixture', folderId: 'fixture', manifestFileId: 'fixture-manifest',
      accessToken: () => 'fixture', makeManifest: () => ({}), fetchImpl: async () => { throw new Error('unused'); },
      onStatus: status => dashboard.publish(status.state, status.message, 'error', {code:status.code}, status.reportId)
    });
    lifecycle.publish('ownership-unknown', 'Verification failed', 'ownership-unknown');
    assert.equal(JSON.parse(getReport(statuses.at(-1).reportId).report).where.surface, expected);
    dashboard.publish('error', 'Verification failed', 'error', {code:'ownership-unknown'});
    assert.equal(JSON.parse(getReport(statuses.at(-1).reportId).report).where.surface, expected);
    assert.doesNotMatch(JSON.stringify(statuses), /PRIVATE-CANARY/);
  }
});
