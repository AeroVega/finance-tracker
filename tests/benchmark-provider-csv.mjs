// Deliberately invented data only. An optional module path permits comparison
// with a preserved baseline module. Timings are observations, not test gates.
import { performance } from 'node:perf_hooks';
const { parseProviderCsv } = await import(process.argv[2] || '../js/provider-csv.mjs');
for (const n of [1000, 10000, 50000]) {
  const bytes = new TextEncoder().encode('DATE,DESCRIPTION,AMOUNT,CHECK #,STATUS\r\n' +
    Array.from({ length: n }, (_, i) => `03/${String(i % 28 + 1).padStart(2, '0')}/2026,"Invented merchant ${i % 173}, location ${i % 37}",-12.34,,Posted`).join('\r\n'));
  const wallMs = [], cpuMs = [];
  let maximumEndHeap = 0;
  for (let repetition = 0; repetition < 3; repetition++) {
    global.gc?.();
    const cpu = process.cpuUsage(), start = performance.now();
    let result = await parseProviderCsv({ bytes, sourceFormat: 'wells-fargo-csv-v1' });
    wallMs.push(Math.round(performance.now() - start));
    const used = process.cpuUsage(cpu);
    cpuMs.push(Math.round((used.user + used.system) / 1000));
    maximumEndHeap = Math.max(maximumEndHeap, process.memoryUsage().heapUsed);
    if (result.records.length !== n) throw new Error('Unexpected benchmark row count');
    result = null;
  }
  console.log(JSON.stringify({ rows: n, wallMs, cpuMs,
    maximumEndHeapMiB: Math.round(maximumEndHeap / 1048576), rssMiB: Math.round(process.memoryUsage().rss / 1048576) }));
}
