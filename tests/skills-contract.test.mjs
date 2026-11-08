import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skillsRoot = path.join(root, 'skills');
const requested = [
  'code-review', 'codebase-design', 'diagnosing-bugs', 'grill-me',
  'grill-with-docs', 'pr', 'research', 'tdd', 'unslop',
];
const helpers = ['domain-modeling', 'grilling'];
const names = [...requested, ...helpers].sort();
const manifest = JSON.parse(readFileSync(path.join(skillsRoot, 'upstream.json'), 'utf8'));
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(filename) : [filename];
  });
}

function frontmatter(name) {
  const text = read(`skills/${name}/SKILL.md`);
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, `${name} needs YAML frontmatter`);
  return match[1];
}

test('skill selection contains the nine requested workflows and their two helpers', () => {
  const directories = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(directories, names);
  assert.deepEqual(manifest.requested_skills, requested);
  assert.deepEqual(manifest.support_skills, helpers);
  for (const name of names) {
    assert.match(frontmatter(name), new RegExp(`^name: ${name}$`, 'm'));
    assert.match(frontmatter(name), /^description: .+$/m);
    assert.ok(read(`skills/${name}/SKILL.md`).includes('../README.md#project-rules'));
    assert.match(read(`skills/${name}/agents/openai.yaml`), /^interface:\n/m);
  }
});

test('Codex discovery links resolve to the canonical skill folders without copies', () => {
  const discovery = path.join(root, '.agents', 'skills');
  assert.deepEqual(readdirSync(discovery).sort(), names);
  for (const name of names) {
    const link = path.join(discovery, name);
    assert.ok(lstatSync(link).isSymbolicLink(), `${name} must be a symlink`);
    assert.equal(readlinkSync(link), `../../skills/${name}`);
    assert.equal(realpathSync(link), realpathSync(path.join(skillsRoot, name)));
    assert.equal(readFileSync(path.join(link, 'SKILL.md'), 'utf8'), read(`skills/${name}/SKILL.md`));
  }
  assert.match(read('AGENTS.md'), /\[the skills index\]\(skills\/README\.md\)/);
});

test('upstream sources are pinned and every original file remains present', () => {
  assert.equal(manifest.sources.length, 2);
  assert.deepEqual(manifest.sources.map(({ repository, commit, license_file }) => ({ repository, commit, license_file })), [
    {
      repository: 'https://github.com/mattpocock/skills',
      commit: '4ae2317ddb22b046e26455e4f9c9b3aaaf62212d',
      license_file: 'skills/LICENSE',
    },
    {
      repository: 'https://github.com/cursor/plugins',
      commit: '6b0300214a09fd6029cfb7077043125758cd1fd2',
      license_file: 'skills/unslop/LICENSE',
    },
  ]);
  const seen = new Set();
  for (const source of manifest.sources) {
    assert.equal(source.license, 'MIT');
    for (const file of source.files) {
      assert.ok(!seen.has(file.path), `duplicate provenance for ${file.path}`);
      seen.add(file.path);
      assert.ok(file.path.startsWith('skills/') && !file.path.includes('..'));
      assert.ok(file.upstream_path && !file.upstream_path.includes('..'));
      assert.match(file.upstream_sha256, /^[a-f0-9]{64}$/);
      assert.ok(existsSync(path.join(root, file.path)), `missing imported file: ${file.path}`);
    }
  }
  for (const name of names) assert.ok(seen.has(`skills/${name}/SKILL.md`));
  assert.ok(seen.has('skills/pr/CREDITS.md'));
  assert.ok(seen.has('skills/diagnosing-bugs/scripts/hitl-loop.template.sh'));
  assert.ok(seen.has('skills/domain-modeling/ADR-FORMAT.md'));
  assert.ok(seen.has('skills/domain-modeling/GLOSSARY-FORMAT.md'));
});

test('MIT notices and the PR skill attribution are retained separately', () => {
  const matt = read('skills/LICENSE');
  const pstack = read('skills/unslop/LICENSE');
  assert.match(matt, /Copyright \(c\) 2026 Matt Pocock/);
  assert.match(pstack, /Copyright \(c\) 2026 Lauren Tan/);
  for (const license of [matt, pstack]) {
    assert.match(license, /MIT License/);
    assert.match(license, /The above copyright notice and this permission notice shall be included/);
    assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  }
  assert.match(read('skills/pr/CREDITS.md'), /Dex Horthy/);
  assert.match(read('skills/pr/CREDITS.md'), /humanlayer/);
});

test('local Markdown links and section references resolve outside illustrative code blocks', () => {
  const documents = filesUnder(skillsRoot).filter((filename) => filename.endsWith('.md'));
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

test('declared skill dependencies are present and linked by their consumers', () => {
  assert.deepEqual(manifest.dependencies, {
    tdd: ['codebase-design', 'code-review'],
    'grill-me': ['grilling'],
    'grill-with-docs': ['grilling', 'domain-modeling'],
  });
  for (const [consumer, dependencies] of Object.entries(manifest.dependencies)) {
    const text = read(`skills/${consumer}/SKILL.md`);
    for (const dependency of dependencies) {
      assert.ok(names.includes(dependency));
      assert.ok(text.includes(`../${dependency}/SKILL.md`), `${consumer} must link ${dependency}`);
    }
  }
  assert.doesNotMatch(read('skills/code-review/SKILL.md'), /run.*setup-matt-pocock-skills/);
  assert.match(read('skills/code-review/SKILL.md'), /git ls-files --others --exclude-standard/);
  assert.match(read('skills/code-review/SKILL.md'), /git diff <merge-base>/);
});

test('interview, documentation helper, and prose-editing skills stay opt-in', () => {
  for (const name of ['grill-me', 'grill-with-docs', ...helpers, 'unslop']) {
    assert.match(frontmatter(name), /^disable-model-invocation: true$/m);
    assert.match(read(`skills/${name}/agents/openai.yaml`), /^policy:\n  allow_implicit_invocation: false$/m);
  }
  assert.match(read('skills/grilling/SKILL.md'), /stop or narrow the session when asked/);
  assert.match(read('skills/domain-modeling/SKILL.md'), /Update existing documents rather than creating/);
  assert.match(read('skills/unslop/SKILL.md'), /approval boundaries/);
});

test('local safeguards preserve synthetic diagnostics and existing contract coverage', () => {
  assert.match(read('skills/diagnosing-bugs/SKILL.md'), /deliberately invented fixtures/);
  assert.match(read('skills/tdd/SKILL.md'), /financial-invariant/i);
  assert.match(read('skills/codebase-design/DEEPENING.md'), /equivalent replacement coverage/);
  const template = read('skills/diagnosing-bugs/scripts/hitl-loop.template.sh');
  assert.match(template, /^READY_FOR_SYNTHETIC_RUN=false$/m);
  assert.match(template, /exit 1/);
  assert.doesNotMatch(template, /capture ERROR_MSG|Paste the error/);
});
