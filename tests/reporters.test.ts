import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonReport, markdownReport, prettyReport } from "../src/reporters.js";
import type { ScanResult } from "../src/types.js";

const result: ScanResult = {
  root: "/tmp/example",
  scannedFiles: 4,
  durationMs: 12.5,
  parserWarnings: [],
  findings: [
    {
      ruleId: "PORT002",
      severity: "error",
      title: "Ports disagree",
      message: "The configured ports disagree.",
      remediation: "Align the ports.",
      locations: [{ file: ".do/app.yaml", line: 7 }, { file: "Dockerfile" }],
    },
  ],
};

test("pretty reporter includes rule, location, and summary", () => {
  const output = prettyReport(result);
  assert.match(output, /PORT002/);
  assert.match(output, /\.do\/app\.yaml:7/);
  assert.match(output, /Found 1 error/);
});

test("markdown reporter produces a review-friendly report", () => {
  const output = markdownReport(result);
  assert.match(output, /^# Stack Accord/m);
  assert.match(output, /Suggested fix/);
});

test("JSON reporter round-trips", () => {
  assert.deepEqual(JSON.parse(jsonReport(result)), result);
});
