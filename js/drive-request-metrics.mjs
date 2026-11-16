// In-memory observation only. Never inspect or retain request URLs, headers,
// bodies, response bodies, identifiers, credentials or errors.
export const REQUEST_METRIC_FIELDS = Object.freeze([
  'requests', 'completed', 'inFlight', 'peakConcurrency', 'elapsedMs', 'requestMs', 'maxRequestMs',
  'http2xx', 'http3xx', 'http4xx', 'http5xx', 'httpOther', 'networkErrors',
  'get', 'post', 'patch', 'delete', 'otherMethod'
]);
const statuses = ['http2xx', 'http3xx', 'http4xx', 'http5xx', 'httpOther', 'networkErrors'];
const methods = ['get', 'post', 'patch', 'delete', 'otherMethod'];
// Endpoint classes come from the code constructing the request, not from URLs.
// Weak metadata never changes the request options passed to fetch.
const requestEndpoints = new WeakMap(), manifestRequests = new WeakSet(), requestPurposes = new WeakMap();
export const REQUEST_PURPOSES=Object.freeze(['metadata','media','owner-list','inventory-list','id-generation','immutable-create','manifest-patch','session-create','session-patch','unknown']);
const purposeFields=Object.freeze(['count','completed','headerMs','maxHeaderMs','http404','http409','http429','other4xx','networkErrors']);
export function markRequestPurpose(options,purpose){try{if(REQUEST_PURPOSES.includes(purpose))requestPurposes.set(options,purpose);}catch{}return options;}
export function safePurposeMetrics(input){try{
 if(!Array.isArray(input)||input.length!==REQUEST_PURPOSES.length)return null;
 return REQUEST_PURPOSES.map((purpose,index)=>{const row=input[index];if(row.purpose!==purpose)throw 0;const out={purpose};for(const field of purposeFields){const value=row[field];if(!Number.isSafeInteger(value)||value<0)throw 0;out[field]=value;}
 if(out.completed>out.count||out.maxHeaderMs>out.headerMs||out.http404+out.http409+out.http429+out.other4xx+out.networkErrors>out.completed)throw 0;return out;});
}catch{return null;}}
const emptyPurposes=()=>REQUEST_PURPOSES.map(purpose=>({purpose,...Object.fromEntries(purposeFields.map(field=>[field,0]))}));
export function markManifestRequest(options){try{manifestRequests.add(options);}catch{}return options;}
export function transferManifestRequest(from,to){try{if(manifestRequests.has(from))manifestRequests.add(to);if(requestPurposes.has(from))requestPurposes.set(to,requestPurposes.get(from));}catch{}}
const endpoints = new Set(['files.get', 'files.list', 'files.create', 'files.update', 'files.generateIds']);
export function markRequestEndpoint(options, endpoint) {
  try { if (options && typeof options === 'object' && endpoints.has(endpoint)) requestEndpoints.set(options, endpoint); }
  catch { /* best-effort: endpoint observation must not affect requests */ }
  return options;
}

// Rebuild from scalar allowlists even for our own snapshots. Invalid/missing
// measurements are unavailable, never a fabricated zero-request result.
export function safeRequestMetrics(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const result = {};
    for (const field of REQUEST_METRIC_FIELDS) {
      const value = input[field];
      if (!Number.isSafeInteger(value) || value < 0) return null;
      result[field] = value;
    }
    if (result.requests !== result.completed + result.inFlight ||
        result.peakConcurrency < result.inFlight || result.peakConcurrency > result.requests ||
        statuses.reduce((sum, field) => sum + result[field], 0) !== result.completed ||
        methods.reduce((sum, field) => sum + result[field], 0) !== result.requests ||
        result.maxRequestMs > result.requestMs) return null;
    return result;
  } catch { return null; }
}

// Only combine separate capture windows, never a total with its own phases.
export function combineRequestMetrics(inputs) {
  if (!inputs.length) return null;
  const result = Object.fromEntries(REQUEST_METRIC_FIELDS.map(field => [field, 0]));
  for (const input of inputs) {
    const value = safeRequestMetrics(input);
    if (!value) return null;
    for (const field of REQUEST_METRIC_FIELDS) result[field] = ['peakConcurrency', 'maxRequestMs'].includes(field) ? Math.max(result[field], value[field]) : result[field] + value[field];
  }
  return safeRequestMetrics(result);
}

export function createDriveRequestMetrics({ now = () => globalThis.performance.now(), onRequest = () => {} } = {}) {
  let lastTime = 0;
  const clock = () => {
    try { const time = now(); if (typeof time === 'number' && Number.isFinite(time)) lastTime = Math.max(lastTime, time); } catch { /* metrics must not affect fetch */ }
    return lastTime;
  };
  const makeBucket = () => ({ values: Object.fromEntries(REQUEST_METRIC_FIELDS.map(field => [field, 0])), start: clock(), end: null, manifestPatches:0, purposes:emptyPurposes() });
  const overall = makeBucket(), windows = new Set(), listeners = new Set(), recent = [];
  const snapshot = bucket => ({ ...bucket.values, elapsedMs: Math.round((bucket.end ?? clock()) - bucket.start) });
  const notify = () => { for (const listener of listeners) { try { listener(); } catch { /* observational only */ } } };
  const quietly = operation => { try { return operation(); } catch { /* observational only */ } };
  return Object.freeze({
    snapshot: () => snapshot(overall),
    recentRequests: () => recent.map(entry => ({...entry})),
    subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    openWindow() {
      const bucket = makeBucket(); windows.add(bucket);
      return Object.freeze({
        snapshot: () => snapshot(bucket),
        manifestPatches: () => bucket.manifestPatches,
        purposes: () => safePurposeMetrics(bucket.purposes),
        close() { if (bucket.end === null) { bucket.end = clock(); windows.delete(bucket); } return snapshot(bucket); }
      });
    },
    wrapFetch(fetchImpl) {
      return function measuredFetch(...args) {
        let measurement;
        quietly(() => {
          let method = args[1]?.method ?? args[0]?.method ?? 'GET';
          method = typeof method === 'string' ? method.toLowerCase() : '';
          const category = methods.includes(method) && method !== 'otherMethod' ? method : 'otherMethod';
          measurement = { purpose:requestPurposes.get(args[1]) || 'unknown', started: clock(), endpoint: requestEndpoints.get(args[1]) || 'unknown', method: category === 'otherMethod' ? 'other' : category, buckets: [overall, ...windows] };
          for (const bucket of measurement.buckets) {
            const value = bucket.values;
            value.requests++; value.inFlight++; value[category]++;
            bucket.purposes[REQUEST_PURPOSES.indexOf(measurement.purpose)].count++;
            if(category==='patch'&&manifestRequests.has(args[1]))bucket.manifestPatches++;
            value.peakConcurrency = Math.max(value.peakConcurrency, value.inFlight);
          }
        });
        const finish = (response, rejected = false) => quietly(() => {
          if (!measurement) return;
          let category = 'networkErrors', statusCode = null;
          if (!rejected) {
            category = 'httpOther';
            // A hostile/unusual response getter cannot mask the original outcome.
            quietly(() => { const status = response?.status; if (Number.isInteger(status) && status >= 100 && status < 600) statusCode = status; if (Number.isInteger(status) && status >= 200 && status < 600) category = 'http' + Math.floor(status / 100) + 'xx'; });
          }
          const duration = Math.round(clock() - measurement.started);
          for (const bucket of measurement.buckets) {
            const value = bucket.values;
            value.inFlight--; value.completed++; value[category]++;
            value.requestMs += duration; value.maxRequestMs = Math.max(value.maxRequestMs, duration);
            const purpose=bucket.purposes[REQUEST_PURPOSES.indexOf(measurement.purpose)];
            purpose.completed++;purpose.headerMs+=duration;purpose.maxHeaderMs=Math.max(purpose.maxHeaderMs,duration);
            if(rejected)purpose.networkErrors++;else if([404,409,429].includes(statusCode))purpose['http'+statusCode]++;else if(statusCode>=400&&statusCode<500)purpose.other4xx++;
          }
          const entry = Object.freeze({ e: 'request', ep: measurement.endpoint, m: measurement.method,
            s: statusCode, ms: Math.min(duration, 86_400_000), outcome: rejected ? 'network-error' : statusCode >= 200 && statusCode < 400 ? 'ok' : 'http-error' });
          recent.push(entry); if (recent.length > 60) recent.shift();
          quietly(() => onRequest(entry));
          notify();
        });
        let pending;
        try { pending = fetchImpl.apply(this, args); }
        catch (error) { finish(undefined, true); throw error; }
        quietly(notify);
        return Promise.resolve(pending).then(response => { finish(response); return response; }, error => { finish(undefined, true); throw error; });
      };
    }
  });
}
