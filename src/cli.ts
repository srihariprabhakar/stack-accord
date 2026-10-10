#!/usr/bin/env node
import process from "node:process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { jsonReport, markdownReport, prettyReport } from "./reporters.js";
import { rules } from "./rules.js";
import { scanProject } from "./scanner.js";
import type { Severity } from "./types.js";

type Format = "pretty" | "json" | "markdown";
type FailOn = "error" | "warning" | "never";

interface CliOptions {
  command: "scan" | "rules" | "help" | "version";
  target: string;
  format: Format;
  failOn: FailOn;
  ignoredRules: string[];
}

const usage = `Stack Accord — cross-layer deployment preflight checks

Usage:
  stackaccord scan [directory] [options]
  stackaccord rules [--format pretty|json]
  stackaccord --help

Options:
  --format <pretty|json|markdown>  Output format (default: pretty)
  --fail-on <error|warning|never>  Exit-code threshold (default: error)
  --ignore <RULE[,RULE...]>        Ignore one or more rule IDs
  -h, --help                       Show help
  -v, --version                    Show version

Examples:
  stackaccord scan .
  stackaccord scan ./service --format json
  stackaccord scan . --ignore ENV001 --fail-on warning
`;

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    return { command: "help", target: ".", format: "pretty", failOn: "error", ignoredRules: [] };
  }
  if (args.includes("--version") || args.includes("-v")) {
    return { command: "version", target: ".", format: "pretty", failOn: "error", ignoredRules: [] };
  }

  let command: CliOptions["command"] = "scan";
  if (args[0] === "scan" || args[0] === "rules") command = args.shift() as "scan" | "rules";
  let target = ".";
  let format: Format = "pretty";
  let failOn: FailOn = "error";
  const ignoredRules: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) continue;
    if (argument === "--format") {
      const value = takeValue(args, index, argument);
      if (!["pretty", "json", "markdown"].includes(value)) throw new Error(`Unknown format: ${value}`);
      format = value as Format;
      index += 1;
    } else if (argument === "--fail-on") {
      const value = takeValue(args, index, argument);
      if (!["error", "warning", "never"].includes(value)) throw new Error(`Unknown threshold: ${value}`);
      failOn = value as FailOn;
      index += 1;
    } else if (argument === "--ignore") {
      ignoredRules.push(...takeValue(args, index, argument).split(","));
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (command === "scan" && target === ".") {
      target = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }
  if (command === "rules" && format === "markdown") throw new Error("rules supports pretty or json output");
  return { command, target, format, failOn, ignoredRules };
}

function shouldFail(severities: Severity[], threshold: FailOn): boolean {
  if (threshold === "never") return false;
  if (threshold === "warning") return severities.includes("error") || severities.includes("warning");
  return severities.includes("error");
}

async function version(): Promise<string> {
  const current = path.dirname(fileURLToPath(import.meta.url));
  const packagePath = path.resolve(current, "../package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { version: string };
  return packageJson.version;
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`stackaccord: ${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
    process.exitCode = 2;
    return;
  }

  if (options.command === "help") {
    process.stdout.write(usage);
    return;
  }
  if (options.command === "version") {
    process.stdout.write(`${await version()}\n`);
    return;
  }
  if (options.command === "rules") {
    if (options.format === "json") {
      process.stdout.write(`${JSON.stringify(rules.map(({ evaluate: _evaluate, ...rule }) => rule), null, 2)}\n`);
    } else {
      for (const rule of rules) {
        process.stdout.write(`${rule.id.padEnd(8)} ${rule.defaultSeverity.padEnd(7)} ${rule.title}\n`);
      }
    }
    return;
  }

  try {
    const result = await scanProject(options.target, { ignoredRules: options.ignoredRules });
    switch (options.format) {
      case "json":
        process.stdout.write(jsonReport(result));
        break;
      case "markdown":
        process.stdout.write(markdownReport(result));
        break;
      case "pretty":
        process.stdout.write(prettyReport(result));
        break;
    }
    if (shouldFail(result.findings.map((finding) => finding.severity), options.failOn)) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`stackaccord: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

await main();
