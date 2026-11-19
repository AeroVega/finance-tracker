import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { classify, plan } from "../scripts/check-guarded-code.mjs";

const policyPath = ".github/guarded-code.json";
const scriptPath = "scripts/check-guarded-code.mjs";
const policy = JSON.parse(readFileSync(new URL(`../${policyPath}`, import.meta.url), "utf8"));
const fixture = () => ({
  version: 1,
  controlPaths: [".github/", "tests/helpers/"],
  areas: {
    save: { name: "Save", paths: ["js/save.mjs"], tests: ["save"], manual: "Verify synthetic save." },
    backup: { name: "Backup", paths: ["js/backup.mjs"], tests: ["backup"], manual: "Verify synthetic restore." },
  },
});

function repo(t) {
  const cwd = mkdtempSync(join(tmpdir(), "guarded-review-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "guarded-fixtures@example.invalid");
  git("config", "user.name", "Guarded synthetic fixture");
  const write = (file, content = "invented fixture\n") => {
    const absolute = join(cwd, file);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  };
  const commit = () => {
    git("add", "-A");
    git("commit", "-m", "Invented test tree");
    return git("rev-parse", "HEAD");
  };
  const addControls = (value = fixture()) => {
    write(policyPath, JSON.stringify(value));
    write(scriptPath);
  };
  return { cwd, git, write, commit, addControls };
}

test("unchanged and converter-only files leave the regular checks unchanged", () => {
  for (const paths of [[], ["docs/README.md", "scripts/convert-legacy-workbook.py", "fixtures/invented-workbook.xlsx"]]) {
    assert.deepEqual(classify(paths, policy), { controlPaths: [], areas: [], tests: [] });
  }
});

test("real guarded files map to focused suites and an independent manual checklist", () => {
  const cases = [
    ["js/google-config.js", ["google-boundary"], "privacy-account"],
    ["js/drive-request-metrics.mjs", ["verified-storage"], "drive-request-metrics"],
    ["js/drive-feasibility-spike.mjs", ["verified-storage"], "drive-feasibility-spike"],
    ["js/success-metrics.mjs", ["session-privacy", "verified-storage"], "success-metrics"],
    ["js/historical-monthly-summary.mjs", ["session-privacy", "verified-storage", "backup-restore"], "historical-workspace-persistence"],
    ["js/import-reconciliation.mjs", ["verified-storage", "backup-restore"], "historical-workspace-persistence"],
    ["js/session-coordination.mjs", ["session-privacy", "verified-storage"], "session-write-guard-race"],
    ["js/full-snapshot-backup.mjs", ["backup-restore"], "full-snapshot-backup"],
  ];
  for (const [path, areaIds, testName] of cases) {
    const result = classify([path], policy);
    assert.deepEqual(result.areas.map(value => value.id), areaIds);
    assert.equal(result.tests.includes(testName), true);
    assert.ok(result.areas.every(area => area.manual));
  }
  for (const test of new Set(Object.values(policy.areas).flatMap(area => area.tests))) {
    assert.ok(existsSync(new URL(`./${test}.test.mjs`, import.meta.url)), test);
  }
});

test("guard infrastructure and shared fixtures require all groups", () => {
  for (const path of [scriptPath, policyPath, ".github/workflows/deploy-pages.yml", "docs/GUARDED_CODE.md", "tests/helpers/sample.mjs"]) {
    const result = classify([path], policy);
    assert.deepEqual(result.areas.map(area => area.id), Object.keys(policy.areas));
    assert.equal(result.tests.includes("guarded-code"), true);
  }
  const areaTest = classify(["tests/full-snapshot-backup-session.test.mjs"], policy);
  assert.deepEqual(areaTest.areas.map(area => area.id), ["backup-restore"]);
});

test("base policy survives candidate removal and added groups are also scheduled", t => {
  const r = repo(t);
  r.addControls();
  r.write("js/save.mjs");
  const base = r.commit();

  const proposed = fixture();
  delete proposed.areas.save;
  proposed.areas.oauth = { name: "OAuth", paths: ["js/oauth.mjs"], tests: ["oauth"], manual: "Verify synthetic sign-in." };
  r.write(policyPath, JSON.stringify(proposed));
  r.write("js/oauth.mjs");
  const weakened = r.commit();
  assert.deepEqual(plan({ cwd: r.cwd, base, head: weakened }).tests, ["guarded-code", "save", "backup", "oauth"]);

  rmSync(join(r.cwd, policyPath));
  const deleted = r.commit();
  assert.throws(() => plan({ cwd: r.cwd, base, head: deleted }), /Command failed/);
});

test("deletion and rename guard the old path, even on a branch behind main", t => {
  const r = repo(t);
  r.addControls();
  r.write("js/save.mjs");
  r.write("js/backup.mjs");
  const commonBase = r.commit();
  r.git("switch", "-c", "candidate");
  renameSync(join(r.cwd, "js/save.mjs"), join(r.cwd, "js/new name.mjs"));
  rmSync(join(r.cwd, "js/backup.mjs"));
  const head = r.commit();

  r.git("switch", "main");
  r.write("js/backup.mjs", "change only on main");
  const base = r.commit();
  const result = plan({ cwd: r.cwd, base, head });
  assert.equal(result.commonBase, commonBase);
  assert.deepEqual(result.areas.map(area => area.paths), [["js/save.mjs"], ["js/backup.mjs"]]);
});

test("unrelated change does not inherit a guarded modification already on the updated base", t => {
  const r = repo(t);
  r.addControls();
  const commonBase = r.commit();
  r.git("switch", "-c", "candidate");
  r.write("docs/tutorial.md");
  const head = r.commit();
  r.git("switch", "main");
  r.write("js/save.mjs");
  const base = r.commit();
  assert.deepEqual(plan({ cwd: r.cwd, base, head }).areas, []);
  assert.notEqual(base, commonBase);
});

test("bootstrap must introduce both controls; incomplete baseline and non-SHA inputs fail closed", t => {
  const r = repo(t);
  r.write("README.md");
  const base = r.commit();
  r.write(scriptPath);
  const incomplete = r.commit();
  assert.throws(() => plan({ cwd: r.cwd, base, head: incomplete }), /complete bootstrap/);
  r.write(policyPath, JSON.stringify(fixture()));
  const head = r.commit();
  const result = plan({ cwd: r.cwd, base, head });
  assert.equal(result.bootstrap, true);
  assert.deepEqual(result.tests, ["guarded-code", "save", "backup"]);
  assert.throws(() => plan({ cwd: r.cwd, base: incomplete, head }), /base is missing part/);
  assert.throws(() => plan({ cwd: r.cwd, base: "main", head }), /exact Git commit SHA/);
});
