// Presentation-only timing. Missing measurements never become zero or success.
export const safeElapsedMs = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function formatElapsed(value) {
  const elapsed = safeElapsedMs(value);
  if (elapsed === null) return 'unmeasured';
  if (elapsed < 1000) return 'less than 1 second';
  const seconds = Math.round(elapsed / 1000);
  return [[Math.floor(seconds / 3600), 'hour'], [Math.floor(seconds / 60) % 60, 'minute'], [seconds % 60, 'second']]
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${amount} ${unit}${amount === 1 ? '' : 's'}`).join(' ');
}

export function resultTiming(status, elapsedMs, { running = false, historical = false, shared = false, cumulative = false } = {}) {
  const label = status === 'passed' ? 'Passed' : status === 'failed' ? 'Failed' : 'Not run';
  if (historical) return label === 'Not run' ? label : `${label} earlier · time unmeasured`;
  const elapsed = formatElapsed(elapsedMs);
  if (running) return elapsed === 'unmeasured' ? 'Checking · time unmeasured' : `Checking · ${cumulative ? 'total ' : ''}${elapsed} elapsed`;
  if (label === 'Not run') return label;
  if (elapsed === 'unmeasured') return `${label} · time unmeasured`;
  if (shared) return `${label} · shared run ${elapsed}`;
  if (cumulative) return `${label} · total check time ${elapsed}`;
  return `${label} ${status === 'passed' ? 'in' : 'after'} ${elapsed}`;
}

// A clock failure must not prevent the fixture checks or fabricate a duration.
export function createElapsedTimer(now = () => globalThis.performance?.now?.()) {
  const read = () => { try { const value = now(); return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; } catch { return null; } };
  const start = read();
  let stopped = false, final = null;
  const elapsedMs = () => {
    if (stopped) return final;
    const end = read();
    return start !== null && end !== null && end >= start ? safeElapsedMs(Math.round(end - start)) : null;
  };
  return Object.freeze({ elapsedMs, stop() { if (!stopped) { final = elapsedMs(); stopped = true; } return final; } });
}
