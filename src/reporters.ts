import type { Finding, ScanResult, Severity } from "./types.js";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const color = {
  red: (value: string) => (useColor ? `\u001b[31m${value}\u001b[0m` : value),
  yellow: (value: string) => (useColor ? `\u001b[33m${value}\u001b[0m` : value),
  blue: (value: string) => (useColor ? `\u001b[36m${value}\u001b[0m` : value),
  bold: (value: string) => (useColor ? `\u001b[1m${value}\u001b[0m` : value),
  dim: (value: string) => (useColor ? `\u001b[2m${value}\u001b[0m` : value),
};

function severityLabel(severity: Severity): string {
  switch (severity) {
    case "error":
      return color.red("ERROR");
    case "warning":
      return color.yellow("WARN ");
    case "info":
      return color.blue("INFO ");
  }
}

function locationLabel(finding: Finding): string {
  return finding.locations
    .map((location) => `${location.file}${location.line ? `:${location.line}` : ""}`)
    .join(", ");
}

export function prettyReport(result: ScanResult): string {
  const lines: string[] = [];
  lines.push(color.bold("Stack Accord deployment preflight"));
  lines.push(color.dim(`Scanned ${result.scannedFiles} files in ${result.durationMs}ms`));
  lines.push("");

  for (const finding of result.findings) {
    lines.push(
      `${severityLabel(finding.severity)} ${color.bold(finding.ruleId)} ${finding.title}`,
    );
    lines.push(`  ${finding.message}`);
    lines.push(`  ${color.dim(locationLabel(finding))}`);
    lines.push(`  Fix: ${finding.remediation}`);
    lines.push("");
  }

  for (const warning of result.parserWarnings) {
    lines.push(`${color.yellow("PARSE")} ${warning}`);
  }
  if (result.parserWarnings.length > 0) lines.push("");

  const errors = result.findings.filter((item) => item.severity === "error").length;
  const warnings = result.findings.filter((item) => item.severity === "warning").length;
  const infos = result.findings.filter((item) => item.severity === "info").length;
  if (result.findings.length === 0) {
    lines.push(color.bold("✓ No deployment inconsistencies found."));
  } else {
    lines.push(
      color.bold(
        `Found ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}, and ${infos} info finding${infos === 1 ? "" : "s"}.`,
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function jsonReport(result: ScanResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function markdownReport(result: ScanResult): string {
  const lines = [
    "# Stack Accord deployment preflight",
    "",
    `Scanned ${result.scannedFiles} files in ${result.durationMs}ms.`,
    "",
  ];
  if (result.findings.length === 0) {
    lines.push("✅ No deployment inconsistencies found.", "");
  }
  for (const finding of result.findings) {
    const icon = finding.severity === "error" ? "❌" : finding.severity === "warning" ? "⚠️" : "ℹ️";
    lines.push(
      `## ${icon} ${finding.ruleId}: ${finding.title}`,
      "",
      finding.message,
      "",
      `**Location:** ${locationLabel(finding)}`,
      "",
      `**Suggested fix:** ${finding.remediation}`,
      "",
    );
  }
  if (result.parserWarnings.length > 0) {
    lines.push("## Parser warnings", "");
    for (const warning of result.parserWarnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
