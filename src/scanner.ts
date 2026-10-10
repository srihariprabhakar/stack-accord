import { buildProjectModel } from "./model.js";
import { rules } from "./rules.js";
import type { ScanResult, Severity } from "./types.js";

const severityRank: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export interface ScanOptions {
  ignoredRules?: Iterable<string>;
}

export async function scanProject(
  root: string,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const started = performance.now();
  const ignored = new Set(
    [...(options.ignoredRules ?? [])].map((rule) => rule.trim().toUpperCase()).filter(Boolean),
  );
  const model = await buildProjectModel(root);
  const findings = rules
    .filter((rule) => !ignored.has(rule.id))
    .flatMap((rule) => rule.evaluate(model))
    .sort((left, right) => {
      const severity = severityRank[left.severity] - severityRank[right.severity];
      if (severity !== 0) return severity;
      const rule = left.ruleId.localeCompare(right.ruleId);
      if (rule !== 0) return rule;
      return (left.locations[0]?.file ?? "").localeCompare(right.locations[0]?.file ?? "");
    });

  return {
    root: model.root,
    scannedFiles: model.files.length,
    findings,
    parserWarnings: model.warnings,
    durationMs: Math.round((performance.now() - started) * 10) / 10,
  };
}
