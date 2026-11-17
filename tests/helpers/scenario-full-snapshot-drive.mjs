import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {HttpFullSnapshotDrive} from './http-full-snapshot-drive.mjs';

export const DRIVE_PROFILES = Object.freeze({
  stable: {settleVersions: false, pageSize: Infinity},
  'server-settling': {settleVersions: true, pageSize: 2},
  'slow-server-settling': {settleVersions: true, pageSize: 2,
    timing: {readMs: 250, writeMs: 1300, uploadBytesPerSecond: 1_000_000, downloadBytesPerSecond: 5_000_000}}
});

// Test-only HTTP-shaped fetch replacement, not a server or a complete Drive
// emulator. It cannot contact a real endpoint. Schedule assumptions are explicit
// adversarial scenarios, not a claim about the frequency of Google behavior.
export class ScenarioFullSnapshotDrive extends HttpFullSnapshotDrive {
  constructor({profile = 'server-settling', timing = {}, wallClock = false, ...options} = {}) {
    assert.ok(Object.hasOwn(DRIVE_PROFILES, profile), 'unknown provider profile');
    super(options);
    this.profile = profile;
    this.pageSize = DRIVE_PROFILES[profile].pageSize;
    this.timing = {...DRIVE_PROFILES[profile].timing, ...timing};
    for (const value of Object.values(this.timing)) assert.ok(Number.isFinite(value) && value > 0);
    this.wallClock = wallClock;
    this.settleVersions = DRIVE_PROFILES[profile].settleVersions;
    this.pendingSettlement = new Set();
    this.events = [];
    this.rules = [];
  }

  // Rules target semantic boundaries rather than brittle global request counts.
  // occurrence is relative to rule installation, allowing seed and save faults.
  fault({category, kind, occurrence = 1, after = false, effect, status = 503}) {
    assert.ok(Number.isSafeInteger(occurrence) && occurrence > 0);
    assert.ok(['status', 'lost-response', 'version', 'corrupt-media'].includes(effect));
    this.rules.push({category, kind, occurrence, after, effect, status, seen: 0, fired: false});
  }

  async applyRules(category, row, file, after, response) {
    for (const rule of this.rules) {
      if (rule.fired || rule.after !== after || rule.category !== category || (rule.kind && rule.kind !== row.kind)) continue;
      if (++rule.seen !== rule.occurrence) continue;
      rule.fired = true;
      this.events.push({phase: this.phase, category, kind: row.kind, effect: rule.effect});
      if (rule.effect === 'version') {
        assert.ok(file); file.metadata.version = String(BigInt(file.metadata.version) + 1n);
      } else if (rule.effect === 'lost-response') {
        throw new TypeError('Invented transport failure');
      } else if (rule.effect === 'status') {
        const body = JSON.stringify({error: {code: rule.status, message: 'Invented provider error'}});
        return new Response(body, {status: rule.status, headers: {'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body))}});
      } else {
        assert.equal(category, 'media'); assert.equal(after, true);
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert.ok(bytes.length); bytes[0] ^= 1;
        return new Response(bytes, {status: 200, headers: {'Content-Length': String(bytes.length)}});
      }
    }
    return response;
  }

  async respond(target, options, category, id, row) {
    let file = this.files.get(id);
    if (category === 'media' && this.pendingSettlement.delete(id)) {
      file.metadata.version = String(BigInt(file.metadata.version) + 1n);
      this.events.push({phase: this.phase, category, kind: row.kind, effect: 'server-version-settled'});
    }
    let result = await this.applyRules(category, row, file, false, undefined);
    if (!result) {
      result = await super.respond(target, options, category, id, row);
      file = this.files.get(row.fileId);
      if (this.settleVersions && ['create', 'update'].includes(category) && result.ok && file)
        this.pendingSettlement.add(row.fileId);
      result = await this.applyRules(category, row, file, true, result);
    }
    const write = category === 'create' || category === 'update';
    const bytes = Number(result.headers.get('Content-Length')) || 0;
    row.modeledDelayMs = (write ? this.timing.writeMs : this.timing.readMs) || 0;
    if (this.timing.uploadBytesPerSecond) row.modeledDelayMs += row.requestBytes / this.timing.uploadBytesPerSecond * 1000;
    if (this.timing.downloadBytesPerSecond) row.modeledDelayMs += bytes / this.timing.downloadBytesPerSecond * 1000;
    if (this.wallClock && row.modeledDelayMs) await delay(row.modeledDelayMs);
    return result;
  }

  scenarioSummary(phase) {
    const rows = this.requests.filter(row => !phase || row.phase === phase);
    return {...this.summary(phase), profile: this.profile, wallClock: this.wallClock,
      // Sum of modeled service time, NOT critical-path wall time when concurrent.
      modeledServiceMs: rows.reduce((sum, row) => sum + (row.modeledDelayMs || 0), 0),
      events: this.events.filter(row => !phase || row.phase === phase),
      faultsFired: this.rules.filter(rule => rule.fired).length};
  }
}
