import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionCoordinator,createNativeOwnershipGuard,getNativeOwnershipCapability,wrapNativeOwnershipGuard} from '../js/session-coordination.mjs';
import {createDriveSessionAdapter,isNativeDriveSessionAdapter} from '../js/drive-session-adapter.mjs';
import {HttpCatalogDrive} from './helpers/http-catalog-drive.mjs';

async function setup(){
 const http=new HttpCatalogDrive();let now=1000,online=true;
 const adapter=createDriveSessionAdapter({folderId:http.folderId,accessToken:()=> 'invented-test-token',fetchImpl:http.fetch});
 const coordinator=new SessionCoordinator({adapter,now:()=>now,createSessionId:()=> 'invented-native-owner'});
 await coordinator.start();
 const guard=createNativeOwnershipGuard(coordinator,{isOnline:()=>online}),cap=getNativeOwnershipCapability(guard);
 return {http,adapter,coordinator,guard,cap,setNow:v=>now=v,setOnline:v=>online=v};
}
test('native guard and its owned wrapper retain current capability; arbitrary wrappers cannot',async()=>{
 const h=await setup();assert.equal(isNativeDriveSessionAdapter(h.adapter),true);
 assert.equal(isNativeDriveSessionAdapter(new Proxy(h.adapter,{})),false);
 const wrapped=wrapNativeOwnershipGuard(h.guard);assert.equal(getNativeOwnershipCapability(wrapped),h.cap);
 assert.equal(getNativeOwnershipCapability(h.guard.bind(null)),null);
 assert.equal(getNativeOwnershipCapability(wrapNativeOwnershipGuard(()=>h.guard())),null);
 const check=h.cap.capture();await h.guard();check();
});
test('native heartbeat changes record without retiring stable lifetime',async()=>{
 const h=await setup(),check=h.cap.capture(),prior=h.coordinator.session;
 h.setNow(2000);await h.coordinator.heartbeat();assert.notEqual(h.coordinator.session,prior);check();
 await h.guard();check();
});
test('native resume retires old lifetime even for same session',async()=>{
 const h=await setup(),check=h.cap.capture(),id=h.coordinator.session.sessionId;
 await h.coordinator.resume();assert.equal(h.coordinator.session.sessionId,id);
 assert.throws(check,{code:'verification-scope-closed'});h.cap.capture()();
});
test('direct inspect uncertainty retires private lifetime without changing public ownership',async()=>{
 const h=await setup(),check=h.cap.capture();h.http.stopped=true;
 const result=await h.coordinator.inspect();assert.equal(result.status,'unknown');assert.equal(h.coordinator.ownership,'owned');
 h.http.reboot();await h.coordinator.resume();assert.throws(check);h.cap.capture()();
});
test('direct inspect foreign observation cannot revive old checker after restore and resume',async()=>{
 const h=await setup(),check=h.cap.capture(),file=[...h.http.files.values()].find(f=>f.metadata.appProperties?.financeTrackerSession==='v1');
 const raw=file.bytes.slice();const record=JSON.parse(new TextDecoder().decode(raw));record.sessionId='invented-other';
 file.bytes=new TextEncoder().encode(JSON.stringify(record));file.metadata.version=String(BigInt(file.metadata.version)+1n);
 assert.equal((await h.coordinator.inspect()).record.sessionId,'invented-other');
 file.bytes=raw;file.metadata.version=String(BigInt(file.metadata.version)+1n);
 await h.coordinator.resume();assert.throws(check);h.cap.capture()();
});
test('offline failure stays sticky across online restoration',async()=>{
 const h=await setup(),check=h.cap.capture();h.setOnline(false);assert.throws(check);h.setOnline(true);assert.throws(check);
});
test('offline native assert followed by native resume invalidates old proof',async()=>{
 const h=await setup(),check=h.cap.capture();
 await assert.rejects(h.coordinator.assertCanWrite({online:false}),{code:'offline'});await h.coordinator.resume();assert.throws(check);
});
test('custom adapter, subclass, proxy and overridden methods are not native capabilities',async()=>{
 const h=await setup();
 const custom=new SessionCoordinator({adapter:{read:()=>null,write:()=>{}}});assert.equal(createNativeOwnershipGuard(custom),null);
 class Child extends SessionCoordinator{};assert.equal(createNativeOwnershipGuard(new Child({adapter:h.adapter})),null);
 assert.equal(createNativeOwnershipGuard(new Proxy(h.coordinator,{})),null);
 const check=h.cap.capture();h.coordinator.inspect=async()=>({status:'active',record:h.coordinator.session});
 assert.equal(h.cap.isCurrent(),false);assert.throws(check);assert.equal(createNativeOwnershipGuard(h.coordinator),null);
});
test('queue replacement revokes native capability',async()=>{
 const h=await setup(),check=h.cap.capture();h.coordinator.sessionQueue=Promise.resolve();
 assert.equal(h.cap.isCurrent(),false);assert.throws(check);
});
test('release request preserves admitted writer until finalizing then retires it',async()=>{
 const h=await setup();let unblock,started;
 const hold=new Promise(r=>unblock=r),entered=new Promise(r=>started=r);
 const operation=h.coordinator.withWrite(async()=>{started();await hold;});
 await entered;const check=h.cap.capture(),release=h.coordinator.release();
 assert.equal(h.coordinator.releasing,true);check();unblock();await operation;await release;
 assert.throws(check);assert.equal(h.coordinator.ownership,'released');
});
test('native clock dependency replacement revokes capability',async()=>{
 const h=await setup(),check=h.cap.capture();h.coordinator.now=()=>1000;
 assert.equal(h.cap.isCurrent(),false);assert.throws(check);
});
test('local lease expiry poisons checker without changing public ownership',async()=>{
 const h=await setup(),check=h.cap.capture();h.setNow(121000);
 assert.throws(check,{code:'stale-session'});assert.equal(h.coordinator.ownership,'owned');
 h.setNow(1000);assert.throws(check,{code:'stale-session'});
});
test('future heartbeat beyond allowed clock skew refuses local audit',async()=>{
 const h=await setup(),check=h.cap.capture();h.setNow(-5000);
 assert.throws(check,{code:'stale-session'});
});
