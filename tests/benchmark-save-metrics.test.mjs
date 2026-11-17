import test from 'node:test';
import assert from 'node:assert/strict';
import {withSaveLatency,summarizeRequests,complexityObservation,CATEGORIES,KINDS} from './helpers/benchmark-save-metrics.mjs';
test('initial and every retained save receives latency, then restores prior setting',async()=>{
 const http={latencyMs:7};const observed=[];
 for(let revision=0;revision<=5;revision++){
  assert.equal(await withSaveLatency(http,120,async()=>{observed.push(http.latencyMs);await Promise.resolve();assert.equal(http.latencyMs,120);return revision;}),revision);
  assert.equal(http.latencyMs,7);
 }
 assert.deepEqual(observed,[120,120,120,120,120,120]);
});
test('failed save restores latency and preserves exact causal error',async()=>{
 const http={latencyMs:0},failure=new Error('invented failure');
 await assert.rejects(withSaveLatency(http,120,async()=>{throw failure;}),error=>error===failure);assert.equal(http.latencyMs,0);
});
test('invalid delay does not dispatch or change fixture',async()=>{
 for(const delay of [-1,NaN,Infinity]){const http={latencyMs:3};await assert.rejects(withSaveLatency(http,delay,()=>assert.fail('dispatched')),TypeError);assert.equal(http.latencyMs,3);}
});
test('telemetry is fixed label and does not serialize private fields or unknown labels',()=>{
 const secret='do-not-export';const rows=[{category:'media',kind:'snapshot-object',requestBytes:3,responseBytes:7,fileId:secret,url:secret,body:secret,error:secret},{category:secret,kind:secret,requestBytes:-1,responseBytes:Infinity}];
 const value=summarizeRequests(rows);assert.equal(JSON.stringify(value).includes(secret),false);
 assert.deepEqual(Object.keys(value.categories),CATEGORIES);assert.deepEqual(Object.keys(value.kinds),KINDS);
 assert.deepEqual(value.categories.media,{requests:1,requestBytes:3,responseBytes:7});assert.equal(value.categories.other.requests,1);assert.equal(value.kinds.unknown.requests,1);
});
test('category and kind aggregates preserve counts/bytes including session traffic',()=>{
 const rows=[{category:'list',kind:'unknown',requestBytes:0,responseBytes:4},{category:'update',kind:'session-marker',requestBytes:5,responseBytes:8}];
 const m=summarizeRequests(rows);for(const buckets of [m.categories,m.kinds]){assert.equal(Object.values(buckets).reduce((n,x)=>n+x.requests,0),2);assert.equal(Object.values(buckets).reduce((n,x)=>n+x.responseBytes,0),12);}
 assert.equal(m.kinds['session-marker'].requests,1);
});
test('complexity observation explicitly does not enforce target and accepts only fixed fixture labels',()=>{
 const metrics=summarizeRequests([{category:'media',responseBytes:12}]);const result=complexityObservation({fixture:'standard-one-year',revision:5,metrics});
 assert.equal(result.targetStatus,'not-enforced');assert.equal(result.acceptance,'measurement-only');assert.equal(result.responseBytes,12);
 assert.throws(()=>complexityObservation({fixture:'private-id',revision:0,metrics}),TypeError);
});
