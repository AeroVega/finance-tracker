// Deliberately excludes arbitrary strings, errors, request URLs, IDs and data.
const EVENTS = new Set(["status", "release-click", "release-request", "release-refused", "release-complete", "pagehide"]);
const REASONS = new Set(["handoff", "dashboard-handoff", "synthetic-folder-change", "pagehide"]);
const STATES = new Set(["disconnected", "connecting", "recovering", "ready", "reconnecting", "recovering-session", "recovery-required", "stale-session", "session-active", "connection-error", "ownership-unknown", "offline", "releasing", "released", "release-unconfirmed"]);

export function createStorageDiagnostics({ limit = 40, now = Date.now } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid diagnostic limit.");
  const entries = [];
  let sequence = 0;
  return {
    record(input = {}) {
      if (!EVENTS.has(input.event)) return;
      const entry = { sequence: ++sequence, time: new Date(now()).toISOString(), event: input.event };
      if (REASONS.has(input.reason)) entry.reason = input.reason;
      if (STATES.has(input.state)) entry.state = input.state;
      if (typeof input.isTrusted === "boolean") entry.isTrusted = input.isTrusted;
      if (typeof input.persisted === "boolean") entry.persisted = input.persisted;
      if (input.visibility === "visible" || input.visibility === "hidden") entry.visibility = input.visibility;
      entries.push(entry);
      if (entries.length > limit) entries.shift();
    },
    snapshot() { return entries.map((entry) => ({ ...entry })); },
    format(build) {
      const sha = /^[a-f0-9]{40}$/i.test(String(build || "").trim()) ? String(build).trim() : "unavailable (check source commit below)";
      return `Source commit: ${sha}\n` + (entries.length ? entries.map((entry) => JSON.stringify(entry)).join("\n") : "No storage events recorded.");
    }
  };
}
