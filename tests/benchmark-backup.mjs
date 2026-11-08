import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as current from '../js/catalog-backup.mjs';
import { measureCanonicalBackupFlow } from './helpers/pr28-backup-scenario.mjs';

// Optional comparison runs only the old backup module with the same current
// adapters, source fixture and assertion code. No checkout or network is used.
// Example: node tests/benchmark-backup.mjs --baseline-ref=7072816 --latency-ms=2 --runs=3
const args = Object.fromEntries(process.argv.slice(2).map(argument => {
  const match = /^--(baseline-ref|latency-ms|runs)=(.+)$/.exec(argument);
  if (!match) throw new Error('Expected --baseline-ref=<commit>, --latency-ms=<number>, or --runs=<count>');
  return [match[1], match[2]];
}));
const latencyMs = Number(args['latency-ms'] || 0), runs = Number(args.runs || 1);
if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 20 ||
    !Number.isSafeInteger(runs) || runs < 1 || runs > 10) throw new Error('Use latency 0–20 ms and 1–10 runs');
const root = fileURLToPath(new URL('../', import.meta.url));
const variants = [];
let scratch;
try {
  if (args['baseline-ref']) {
    if (!/^[0-9a-f]{7,40}$/i.test(args['baseline-ref'])) throw new Error('The baseline must be a hexadecimal commit ID');
    const revision = execFileSync('git', ['rev-parse', '--verify', args['baseline-ref'] + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
    const original = execFileSync('git', ['show', revision + ':js/catalog-backup.mjs'], { cwd: root, encoding: 'utf8' });
    const source = original.replace(/from (["'])(\.\/[^"']+)\1/g,
      (_, quote, specifier) => 'from ' + quote + new URL('../js/' + specifier.slice(2), import.meta.url).href + quote);
    scratch = await mkdtemp(join(tmpdir(), 'finance-backup-benchmark-'));
    const path = join(scratch, 'baseline.mjs');
    await writeFile(path, source);
    variants.push({ name: revision, implementation: await import(pathToFileURL(path).href) });
  }
  variants.push({ name: 'current', implementation: current });
  const samples = [];
  for (let run = 0; run < runs; run++) samples.push(await measureCanonicalBackupFlow({ variants, latencyMs }));
  const median = numbers => {
    const sorted = [...numbers].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const summary = structuredClone(samples[0]);
  for (const { name } of variants) for (const [phase, result] of Object.entries(summary.variants[name])) {
    const counts = samples.map(sample => sample.variants[name][phase].requests);
    if (!counts.every(count => count === result.requests)) throw new Error('Request count changed between identical scenarios');
    result.medianSimulatedElapsedMs = Number(median(samples.map(sample => sample.variants[name][phase].simulatedElapsedMs)).toFixed(2));
    delete result.simulatedElapsedMs;
    result.peakMutations = Math.max(...samples.map(sample => sample.variants[name][phase].peakMutations));
  }
  console.log(JSON.stringify({ node: process.version, runs,
    note: 'Invented local transport delay only. Counts are HTTP adapter attempts; timings are not Google/Safari estimates. Periodic heartbeats are excluded.',
    ...summary }, null, 2));
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
