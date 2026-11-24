import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = path.join(root, 'engineering-workflows');
const skillsRoot = path.join(packageRoot, 'skills');
const names = [
  'adversarial-review', 'debugging-and-change-impact', 'design-exploration',
  'durable-learning', 'engineering-design', 'formal-verification',
  'measurement-and-benchmarks', 'planning-and-execution', 'project-verification',
  'safe-execution-and-migrations', 'simplification', 'task-framing',
  'technical-explanation', 'technical-writing', 'typescript-guidance',
  'verification-and-testing',
];
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const readSkill = (name) => read(`engineering-workflows/skills/${name}/SKILL.md`);

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(filename) : [filename];
  });
}

function frontmatter(name, text = readSkill(name)) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, `${name} needs YAML frontmatter`);
  return match[1];
}

test('the root package replaces the old skills collection with all sixteen workflows', () => {
  assert.equal(existsSync(path.join(root, 'skills')), false, 'the old root skills directory must be removed');
  const directories = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(directories, names);
  for (const name of names) {
    assert.match(frontmatter(name), new RegExp(`^name: ${name}$`, 'm'));
    const description = /^description: (.+)$/m.exec(frontmatter(name));
    assert.ok(description, `${name} needs a description`);
    assert.equal(typeof JSON.parse(description[1]), 'string');
    assert.ok(JSON.parse(description[1]).trim());
  }
});

// Git for Windows defaults to core.symlinks=false and checks a symlink out as
// a small file holding its target. The repository must still record a real
// symlink: mode 120000 with exactly the expected target, never a copied folder.
function gitRecordedLinks() {
  let symlinks;
  try { symlinks = execFileSync('git', ['config', '--get', 'core.symlinks'], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return null; } // Unset means Git creates real symlinks.
  if (symlinks !== 'false') return null;
  const listing = execFileSync('git', ['ls-files', '-s', '-z', '--', '.agents/skills'], { cwd: root });
  return new Map(listing.toString('utf8').split('\0').filter(Boolean).map(entry => {
    const tab = entry.indexOf('\t');
    const metadata = entry.slice(0, tab), file = entry.slice(tab + 1);
    return [file, metadata.split(' ')[0]];
  }));
}

test('Codex discovery links resolve to the new canonical skill folders without copies', () => {
  const discovery = path.join(root, '.agents', 'skills');
  assert.deepEqual(readdirSync(discovery).sort(), names);
  const recorded = gitRecordedLinks();
  for (const name of names) {
    const link = path.join(discovery, name), target = `../../engineering-workflows/skills/${name}`;
    if (lstatSync(link).isSymbolicLink()) {
      assert.equal(readlinkSync(link), target);
      assert.equal(realpathSync(link), realpathSync(path.join(skillsRoot, name)));
      assert.equal(readFileSync(path.join(link, 'SKILL.md'), 'utf8'), readSkill(name));
    } else {
      assert.ok(recorded, `${name} must be a symlink`);
      assert.equal(recorded.get(`.agents/skills/${name}`), '120000', `${name} must be recorded as a symlink`);
      const indexedTarget = execFileSync('git', ['show', `:.agents/skills/${name}`], { cwd: root });
      assert.deepEqual(indexedTarget, Buffer.from(target, 'utf8'), `${name} index blob must contain exactly its symlink target`);
      assert.ok(lstatSync(link).isFile(), `${name} must not be a copied folder`);
      assert.equal(readFileSync(link, 'utf8'), target);
      assert.ok(existsSync(path.join(skillsRoot, name, 'SKILL.md')));
    }
  }
});

test('an isolated package copy preserves all sixteen self-contained skills and licenses', (t) => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'engineering-workflows-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const copy = path.join(temporaryRoot, 'engineering-workflows');
  cpSync(packageRoot, copy, { recursive: true, dereference: true });

  const copiedSkills = path.join(copy, 'skills');
  const directories = readdirSync(copiedSkills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(directories, names);
  for (const name of names) {
    const text = readFileSync(path.join(copiedSkills, name, 'SKILL.md'), 'utf8');
    assert.ok(text.startsWith(`---\nname: ${name}\n`), `${name} needs matching name frontmatter`);
    const metadata = frontmatter(name, text);
    const description = /^description: (.+)$/m.exec(metadata);
    assert.ok(description, `${name} needs a description`);
    const parsedDescription = JSON.parse(description[1]);
    assert.equal(typeof parsedDescription, 'string');
    assert.ok(parsedDescription.trim(), `${name} needs a nonempty description`);
    assert.doesNotMatch(metadata, /disable-model-invocation: true/);
    assert.doesNotMatch(text, /\.\.\//, `${name} must not depend on files outside its folder`);
  }
  for (const name of ['matt-pocock-MIT.txt', 'pstack-MIT.txt']) {
    const license = readFileSync(path.join(copy, 'licenses', name), 'utf8');
    assert.match(license, /MIT License/);
    assert.match(license, /Permission is hereby granted/);
  }
});

test('the agent entry point and package instructions describe local discovery', () => {
  assert.match(read('AGENTS.md'), /\[the skills index\]\(engineering-workflows\/README\.md\)/);
  const index = read('engineering-workflows/README.md');
  assert.ok(index.includes('.agents/skills/'));
  assert.ok(index.includes('engineering-workflows/skills/'));
  for (const name of names) assert.ok(index.includes(`\`${name}\``), `index missing ${name}`);
  assert.doesNotMatch(index, /ai-marketplace|three manifests|\.\.\/\.\.\/README\.md/);
});

test('the consolidated package retains pinned upstream provenance', () => {
  const provenance = read('engineering-workflows/PROVENANCE.md');
  assert.ok(provenance.includes('https://github.com/mattpocock/skills/tree/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d'));
  assert.ok(provenance.includes('https://github.com/cursor/plugins/tree/236e5481d05cbadc315b374a5de54971858c27bb/pstack'));
  for (const name of names) assert.ok(provenance.includes(name));
});

test('both upstream MIT notices remain with the package', () => {
  const matt = read('engineering-workflows/licenses/matt-pocock-MIT.txt');
  const pstack = read('engineering-workflows/licenses/pstack-MIT.txt');
  assert.match(matt, /Copyright \(c\) 2026 Matt Pocock/);
  assert.match(pstack, /Copyright \(c\) 2026 Lauren Tan/);
  for (const license of [matt, pstack]) {
    assert.match(license, /MIT License/);
    assert.match(license, /The above copyright notice and this permission notice shall be included/);
    assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  }
});

test('local Markdown links and section references resolve outside illustrative code blocks', () => {
  const documents = filesUnder(packageRoot).filter((filename) => filename.endsWith('.md'));
  for (const filename of documents) {
    const text = readFileSync(filename, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
    for (const match of text.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
      const href = match[1];
      if (/^[a-z]+:/i.test(href)) continue;
      const [relative, fragment] = href.split('#');
      const target = relative ? path.resolve(path.dirname(filename), decodeURIComponent(relative)) : filename;
      assert.ok(target.startsWith(root), `${href} escapes the repository`);
      assert.ok(existsSync(target), `${path.relative(root, filename)} links to missing ${href}`);
      if (fragment && target.endsWith('.md')) {
        const headings = [...readFileSync(target, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)]
          .map(([, heading]) => heading.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-'));
        assert.ok(headings.includes(fragment), `${path.relative(root, filename)} has missing anchor ${href}`);
      }
    }
  }
});

test('familiar workflow triggers remain discoverable in consolidated skills', () => {
  for (const [name, triggers] of Object.entries({
    'technical-writing': ['unslop'],
    'adversarial-review': ['pr-review', 'code review'],
    'task-framing': ['grill-me', 'grill-with-docs'],
  })) {
    for (const trigger of triggers) assert.ok(frontmatter(name).toLowerCase().includes(trigger));
  }
});

test('the new skills remain self-contained and subject to project approval rules', () => {
  for (const name of names) {
    assert.doesNotMatch(readSkill(name), /\.\.\//, `${name} must not rely on retired helper files`);
    assert.doesNotMatch(frontmatter(name), /disable-model-invocation: true/);
  }
  assert.match(read('AGENTS.md'), /never grant permission to merge, deploy, or use real financial data/);
  assert.match(read('engineering-workflows/README.md'), /Apply the target repository's rules and approved data scope/);
});
