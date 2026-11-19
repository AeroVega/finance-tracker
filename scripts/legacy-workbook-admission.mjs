import {createLedger} from '../js/canonical-import.mjs';
import {previewHistoricalMonthlySummaries} from '../js/historical-monthly-summary.mjs';

// Called only by the offline converter. Do not echo input, file paths, or
// exceptions: a private conversion report can be shared without raw values.
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error();
    chunks.push(chunk);
  }
  const input = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)));
  const preview = previewHistoricalMonthlySummaries(createLedger(), input);
  const findings = preview.findings.filter(item => item.code !== 'missing-month-summary')
    .map(({code, recordIndex, field}) => ({code, recordIndex, field}));
  process.stdout.write(JSON.stringify({
    accepted: preview.rows.length > 0 && preview.rows.every(row => row.eligible) && findings.length === 0,
    findings
  }));
} catch {
  process.exitCode = 2;
}
