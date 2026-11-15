// Synthetic benchmark telemetry only. Never emits URLs, IDs, bodies or errors.
export const CATEGORIES=Object.freeze(['list','generate-id','metadata','media','create','update','other']);
export const KINDS=Object.freeze(['paged-canonical-manifest','protocol-object','commit-record','snapshot-object','locator-catalog-page','locator-catalog','session-marker','unknown']);
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
export function summarizeRequests(rows) {
  const categories=Object.fromEntries(CATEGORIES.map(k=>[k,{requests:0,requestBytes:0,responseBytes:0}]));
  const kinds=Object.fromEntries(KINDS.map(k=>[k,{requests:0,requestBytes:0,responseBytes:0}]));
  for(const row of rows) {
    const category=CATEGORIES.includes(row.category)?row.category:'other';
    const kind=KINDS.includes(row.kind)?row.kind:'unknown';
    for(const bucket of [categories[category],kinds[kind]]) {
      bucket.requests++;bucket.requestBytes+=count(row.requestBytes);bucket.responseBytes+=count(row.responseBytes);
    }
  }
  return {requests:rows.length,categories,kinds};
}
// Save delay is restored even on rejection. Sequential benchmark operations only;
// this is not a concurrency-safe global latency controller for application code.
export async function withSaveLatency(http,latencyMs,operation) {
  if(!Number.isFinite(latencyMs)||latencyMs<0)throw new TypeError('Invalid synthetic save latency');
  const previous=http.latencyMs;http.latencyMs=latencyMs;
  try{return await operation();}finally{http.latencyMs=previous;}
}
export function complexityObservation({fixture,revision,metrics}) {
  if(!['standard-one-year','dense-one-year'].includes(fixture)||!Number.isSafeInteger(revision)||revision<0)throw new TypeError('Invalid benchmark case');
  return {fixture,revision,requests:metrics.requests,
    requestBytes:Object.values(metrics.categories).reduce((n,x)=>n+x.requestBytes,0),
    responseBytes:Object.values(metrics.categories).reduce((n,x)=>n+x.responseBytes,0),
    targetStatus:'not-enforced',acceptance:'measurement-only'};
}
