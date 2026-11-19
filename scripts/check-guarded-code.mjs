import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const POLICY = ".github/guarded-code.json";
const CHECKER = "scripts/check-guarded-code.mjs";
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const MAX_DIFF_BYTES = 8 * 1024 * 1024;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_DIFF_BYTES, stdio: ["ignore", "pipe", "pipe"] });
}

function verifyCommit(cwd, sha) {
  if (!SHA_PATTERN.test(sha) || git(cwd, ["cat-file", "-t", sha]).trim() !== "commit") {
    throw new Error("Expected an exact Git commit SHA.");
  }
}

function readPolicy(cwd, revision) {
  return JSON.parse(git(cwd, ["show", `${revision}:${POLICY}`]));
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function pathsAreValid(values) {
  return Array.isArray(values) && values.length > 0 && values.every(value =>
    typeof value === "string" && /^(?:[.\w-]+\/)*[.\w-]+\/?$/.test(value) &&
    !value.split("/").some(segment => segment === "." || segment === ".."));
}

function validatePolicy(policy) {
  if (!isRecord(policy) || policy.version !== 1 || !pathsAreValid(policy.controlPaths) ||
      !isRecord(policy.areas) || Object.keys(policy.areas).length === 0) {
    throw new Error("Invalid guarded-code policy.");
  }
  for (const [key, area] of Object.entries(policy.areas)) {
    if (!/^[a-z0-9-]+$/.test(key) || !isRecord(area) || typeof area.name !== "string" || !area.name.trim() ||
        !pathsAreValid(area.paths) || typeof area.manual !== "string" || !area.manual.trim() ||
        !Array.isArray(area.tests) || !area.tests.length ||
        !area.tests.every(test => typeof test === "string" && /^[a-z0-9-]+$/.test(test))) {
      throw new Error("Invalid guarded-code area.");
    }
  }
  return policy;
}

function contains(paths, file) {
  return paths.some(path => path.endsWith("/") ? file.startsWith(path) : file === path);
}

export function classify(changedPaths, policy) {
  validatePolicy(policy);
  const controlPaths = changedPaths.filter(path => contains([CHECKER, POLICY, ...policy.controlPaths], path));
  const areas = [];
  const tests = new Set(controlPaths.length ? ["guarded-code"] : []);
  for (const [id, area] of Object.entries(policy.areas)) {
    const testFiles = area.tests.map(test => `tests/${test}.test.mjs`);
    const paths = changedPaths.filter(path => contains([...area.paths, ...testFiles], path));
    if (paths.length || controlPaths.length) {
      areas.push({ id, name: area.name, paths, manual: area.manual });
      area.tests.forEach(test => tests.add(test));
    }
  }
  return { controlPaths, areas, tests: [...tests] };
}

export function plan({ cwd = process.cwd(), base, head }) {
  verifyCommit(cwd, base);
  verifyCommit(cwd, head);
  const commonBase = git(cwd, ["merge-base", base, head]).trim();
  verifyCommit(cwd, commonBase);

  // Diff on both sides of a rename (old path deleted, new path added). -z
  // keeps spaces and line breaks from changing the path boundaries.
  const paths = git(cwd, ["diff", "--no-ext-diff", "--name-only", "-z", "--no-renames", commonBase, head, "--"])
    .split("\0").filter(Boolean);

  const baselineControls = git(cwd, ["ls-tree", "--name-only", base, "--", POLICY, CHECKER]).trim().split("\n").filter(Boolean);
  const bootstrap = baselineControls.length === 0;
  if (bootstrap && !(paths.includes(POLICY) && paths.includes(CHECKER))) {
    throw new Error("Guarded code must already be on the base or be introduced as a complete bootstrap.");
  }
  if (!bootstrap && baselineControls.length !== 2) {
    throw new Error("The base is missing part of its guarded-code policy.");
  }
  const baseline = readPolicy(cwd, bootstrap ? head : base);
  const result = classify(paths, baseline);

  // Validate the proposed controls when present. A policy edit cannot remove
  // a baseline test from this run. Include candidate groups when adding one.
  const policyChanged = bootstrap || paths.includes(POLICY);
  if (policyChanged) {
    const proposed = classify(paths, readPolicy(cwd, head));
    result.tests = [...new Set([...result.tests, ...proposed.tests])];
    const priorIds = new Set(result.areas.map(area => area.id));
    result.areas.push(...proposed.areas.filter(area => !priorIds.has(area.id)));
  }
  return { base, head, commonBase, bootstrap, ...result };
}

function summarize(result, testedCommit) {
  const lines = [
    "## Guarded code checks",
    "",
    `PR head: \`${result.head}\`  `,
    `Tested merge revision: \`${testedCommit}\`  `,
    `Policy base: \`${result.base}\`  `,
    "",
  ];
  if (result.bootstrap) lines.push("**Bootstrap:** The base has no guard. Review the initial policy and workflow independently.", "");
  if (!result.areas.length) {
    lines.push("No guarded changes detected. The normal PR checks still apply.");
    return lines.join("\n") + "\n";
  }
  if (result.controlPaths.length) {
    lines.push("Guard, shared fixtures, or CI changed. Inspect this change against the trusted base and rerun all selected groups.", "");
  }
  lines.push("The selected automated suites run separately from the full PR suite.", "");
  lines.push("### Manual evidence (not verified by this check)", "");
  for (const area of result.areas) lines.push(`- **${area.name}:** ${area.manual}`);
  lines.push("", "Record results against the exact PR head and obtain independent review before merging. This check does not grant real-data approval.");
  return lines.join("\n") + "\n";
}

function cli(args) {
  const [base, head, flag] = args;
  if (!base || !head || (flag !== undefined && flag !== "--run") || args.length > 3) {
    throw new Error("Usage: node scripts/check-guarded-code.mjs BASE_SHA HEAD_SHA [--run]");
  }
  const result = plan({ base, head });
  console.log(JSON.stringify(result, null, 2));
  if (flag !== "--run") return;
  const testedCommit = git(process.cwd(), ["rev-parse", "HEAD"]).trim();
  verifyCommit(process.cwd(), testedCommit);
  // Do not label tests on the wrong checkout as evidence for this PR.
  for (const revision of [base, head]) {
    if (git(process.cwd(), ["merge-base", revision, testedCommit]).trim() !== revision) {
      throw new Error("Test checkout must contain both the requested base and head.");
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summarize(result, testedCommit));
  }
  if (!result.tests.length) return;
  const files = result.tests.map(test => `tests/${test}.test.mjs`);
  const run = spawnSync(process.execPath,
    ["--max-old-space-size=768", "--test", "--test-concurrency=1", ...files],
    { stdio: "inherit" });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    cli(process.argv.slice(2));
  } catch (error) {
    // Keep the message on one physical line (Git diagnostics may contain paths).
    console.error("Guarded code check failed:", JSON.stringify(error.message));
    process.exitCode = 1;
  }
}
