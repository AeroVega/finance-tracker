// In-memory observation only. Never inspect or retain request URLs, headers,
// bodies, response bodies, identifiers, credentials or errors.
export const REQUEST_METRIC_FIELDS = Object.freeze([
  'requests', 'completed', 'inFlight', 'peakConcurrency', 'elapsedMs', 'requestMs', 'maxRequestMs',
  'http2xx', 'http3xx', 'http4xx', 'http5xx', 'httpOther', 'networkErrors',
  'get', 'post', 'patch', 'delete', 'otherMethod'
]);
const statuses = ['http2xx', 'http3xx', 'http4xx', 'http5xx', 'httpOther', 'networkErrors'];
const methods = ['get', 'post', 'patch', 'delete', 'otherMethod'];

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

export function createDriveRequestMetrics({ now = () => globalThis.performance.now() } = {}) {
  let lastTime = 0;
  const clock = () => {
    try { const time = now(); if (typeof time === 'number' && Number.isFinite(time)) lastTime = Math.max(lastTime, time); } catch { /* metrics must not affect fetch */ }
    return lastTime;
  };
  const makeBucket = () => ({ values: Object.fromEntries(REQUEST_METRIC_FIELDS.map(field => [field, 0])), start: clock(), end: null });
  const overall = makeBucket(), windows = new Set(), listeners = new Set();
  const snapshot = bucket => ({ ...bucket.values, elapsedMs: Math.round((bucket.end ?? clock()) - bucket.start) });
  const notify = () => { for (const listener of listeners) { try { listener(); } catch { /* observational only */ } } };
  const quietly = operation => { try { return operation(); } catch { /* observational only */ } };
  return Object.freeze({
    snapshot: () => snapshot(overall),
    subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    openWindow() {
      const bucket = makeBucket(); windows.add(bucket);
      return Object.freeze({
        snapshot: () => snapshot(bucket),
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
          measurement = { started: clock(), buckets: [overall, ...windows] };
          for (const bucket of measurement.buckets) {
            const value = bucket.values;
            value.requests++; value.inFlight++; value[category]++;
            value.peakConcurrency = Math.max(value.peakConcurrency, value.inFlight);
          }
        });
        const finish = (response, rejected = false) => quietly(() => {
          if (!measurement) return;
          let category = 'networkErrors';
          if (!rejected) {
            category = 'httpOther';
            // A hostile/unusual response getter cannot mask the original outcome.
            quietly(() => { const status = response?.status; if (Number.isInteger(status) && status >= 200 && status < 600) category = 'http' + Math.floor(status / 100) + 'xx'; });
          }
          const duration = Math.round(clock() - measurement.started);
          for (const bucket of measurement.buckets) {
            const value = bucket.values;
            value.inFlight--; value.completed++; value[category]++;
            value.requestMs += duration; value.maxRequestMs = Math.max(value.maxRequestMs, duration);
          }
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
