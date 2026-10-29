import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = async (name) => readFile(path.join(root, "fixtures", name), "utf8");
const csvRows = (text) => text.trimEnd().split(/\r?\n/).map((line) => line.split(","));

test("Wells Fargo synthetic fixture has expected columns, signed amounts, and blank optional check number", async () => {
  const rows = csvRows(await fixture("wells-fargo.csv"));
  assert.deepEqual(rows[0], ["DATE", "DESCRIPTION", "AMOUNT", "CHECK #", "STATUS"]);
  assert.equal(rows[1][2], "-12.34");
  assert.equal(rows[2][2], "1250.00");
  assert.equal(rows[1][3], "");
  assert.equal(rows[1][4], "Posted");
});

test("SoFi synthetic fixture keeps source type, balance, status, and ISO date", async () => {
  const rows = csvRows(await fixture("sofi.csv"));
  assert.deepEqual(rows[0], ["Date", "Description", "Type", "Amount", "Current balance", "Status"]);
  assert.match(rows[1][0], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(rows[1][3], "-23.41");
  assert.equal(rows[1][4], "976.59");
  assert.equal(rows[2][2], "Interest");
});

test("Fidelity synthetic fixture handles leading blank rows, 18 columns, optional fields, and footer boundary", async () => {
  const text = await fixture("fidelity.csv");
  const lines = text.trimEnd().split(/\r?\n/);
  assert.equal(lines[0].replace(/,/g, ""), "");
  assert.equal(lines[1].replace(/,/g, ""), "");
  const headerIndex = lines.findIndex((line) => line.startsWith("Run Date,Account,Account Number,Action,"));
  assert.ok(headerIndex >= 2);
  const header = lines[headerIndex].split(",");
  assert.equal(header.length, 18);
  assert.equal(header[0], "Run Date");
  assert.equal(header[16], "Amount");
  const contribution = lines[headerIndex + 1].split(",");
  assert.equal(contribution.length, 18);
  assert.equal(contribution[16], "150.00");
  assert.equal(lines.some((line) => line.startsWith("This is invented")), true);
});

test("fixture records are deliberately synthetic and contain no real identifiers", async () => {
  const all = [await fixture("wells-fargo.csv"), await fixture("sofi.csv"), await fixture("fidelity.csv")].join("\n");
  assert.match(all, /EXAMPLE/);
  assert.doesNotMatch(all, /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/);
  assert.doesNotMatch(all, /Bearer\s+[A-Za-z0-9._-]+/i);
});
