import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../src/scanner.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const examples = path.resolve(directory, "../examples");

test("finds cross-layer inconsistencies in the broken example", async () => {
  const result = await scanProject(path.join(examples, "broken-stack"));
  const ruleIds = new Set(result.findings.map((finding) => finding.ruleId));

  assert.deepEqual(
    [...ruleIds].sort(),
    ["BIND001", "ENV001", "K8S001", "K8S002", "K8S003", "NGINX001", "PORT001", "PORT002"],
  );
  assert.equal(result.parserWarnings.length, 0);
});

test("healthy example produces no findings", async () => {
  const result = await scanProject(path.join(examples, "healthy-stack"));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.parserWarnings, []);
});

test("can ignore a rule by ID", async () => {
  const result = await scanProject(path.join(examples, "broken-stack"), {
    ignoredRules: ["env001"],
  });
  assert.equal(result.findings.some((finding) => finding.ruleId === "ENV001"), false);
  assert.equal(result.findings.some((finding) => finding.ruleId === "K8S001"), true);
});
