import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const markdownFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) markdownFiles.push(full);
  }
}
walk(root);

const errors = [];
function headingSlugs(source) {
  const slugs = new Set();
  const counts = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const title = match[1].replace(/\[(.*?)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '').replace(/[`*_~]/g, '').trim().toLowerCase();
    const base = title.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-').replace(/-+/g, '-');
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    slugs.add(count ? `${base}-${count}` : base);
  }
  return slugs;
}
const contents = new Map();
for (const file of markdownFiles) contents.set(file, fs.readFileSync(file, 'utf8'));

for (const [file, original] of contents) {
  const source = original.replace(/^```[\s\S]*?^```\s*$/gm, '').replace(/`[^`]*`/g, '');
  const links = [...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)];
  for (const match of links) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (!target || /^(?:https?:|mailto:|tel:|data:)/i.test(target) || target.startsWith('#')) continue;
    target = target.split(/[?#]/, 1)[0];
    try { target = decodeURIComponent(target); } catch { errors.push(`${path.relative(root,file)}: malformed link encoding: ${target}`); continue; }
    const resolved = path.resolve(path.dirname(file), target);
    let actual = resolved;
    if (fs.existsSync(actual) && fs.statSync(actual).isDirectory()) {
      if (!match[1].includes('#')) continue;
      actual = path.join(actual, 'README.md');
    }
    if (!fs.existsSync(actual) || !fs.statSync(actual).isFile()) {
      errors.push(`${path.relative(root,file)}: missing local link target ${match[1]}`);
      continue;
    }
    const fragment = match[1].includes('#') ? match[1].slice(match[1].indexOf('#') + 1) : '';
    if (fragment && actual.toLowerCase().endsWith('.md')) {
      const headings = headingSlugs(contents.get(actual) ?? fs.readFileSync(actual, 'utf8'));
      let decoded = fragment;
      try { decoded = decodeURIComponent(fragment); } catch {}
      if (!headings.has(decoded)) errors.push(`${path.relative(root,file)}: missing heading anchor #${decoded} in ${path.relative(root,actual)}`);
    }
  }
}

// Guard a small set of high-impact, machine-checkable current-state facts.
// This is intentionally not a general-purpose semantic contradiction detector.
const required = [
  ['README.md', /Financial position and reconciled coverage were implemented in PR36/],
  ['docs/PROJECT_STATUS.md', /PR36[\s\S]{0,250}financial position/i],
  ['docs/AGENT_QUICK_START.md', /Production financial-data persistence is \*\*NO-GO\*\*/],
  ['docs/STORAGE_TERMINOLOGY.md', /Grouped v2 \\(canonical\\)[\s\S]*?Rejected/i],
];
for (const [relative, pattern] of required) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !pattern.test(fs.readFileSync(file, 'utf8'))) {
    errors.push(`${relative}: required current-state statement missing or stale (${pattern})`);
  }
}
const activeStatus = ['README.md','AGENTS.md','docs/PROJECT_STATUS.md','docs/AGENT_QUICK_START.md','docs/NEXT_STEPS.md','docs/README.md'];
const staleClaims = [
  /financial position and reconciled coverage (?:remain|are still outstanding)/i,
  /balances, holdings, migration and production authorization remain later work/i,
];
for (const relative of activeStatus) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of staleClaims) if (pattern.test(source)) errors.push(`${relative}: stale current-status wording: ${pattern}`);
}

if (errors.length) {
  console.error(`Documentation checks failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation checks passed: ${markdownFiles.length} Markdown files, local links/anchors and current-state contracts.`);
}
