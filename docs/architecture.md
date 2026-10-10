# Architecture

Stack Accord has a deliberately small pipeline:

```text
repository files
      │
      ▼
format parsers ──► normalized project model ──► cross-layer rules
                                                   │
                                                   ▼
                                      pretty / JSON / Markdown
```

## Discovery

The scanner walks the target directory while excluding dependency, VCS, coverage, and build-output directories. Format detection is content-aware for YAML: Kubernetes documents, Compose files, and App Platform specs are distinguished by their structure rather than filename alone.

## Normalized model

Parsers reduce platform-specific syntax to a shared model of:

- workloads and containers
- services and ports
- proxies and upstreams
- commands and listening addresses
- environment declarations and references

Rules operate on that model rather than raw YAML. This keeps a check focused on the relationship it validates and makes it possible to add another deployment platform without rewriting every rule.

## Rule contract

Each rule has a stable ID, title, default severity, description, and pure evaluation function. Findings include:

- a concise explanation
- one or more evidence locations
- an actionable remediation

Rule output is sorted deterministically by severity, rule ID, and source path.

## Error philosophy

Stack Accord distinguishes three concepts:

1. **Parser warnings:** a relevant file could not be interpreted completely.
2. **Findings:** a rule found a configuration relationship worth reporting.
3. **Scan errors:** the target is inaccessible or the CLI invocation is invalid.

Only findings at or above the configured `--fail-on` threshold make a scan exit with status `1`. Invocation and scan errors use status `2`.

## Adding a parser

Extend `src/model.ts` to recognize the format and populate existing model types where possible. Only add platform-specific model types when the concept cannot be represented generically.

## Adding a rule

Add a `RuleDefinition` to `src/rules.ts`, register it in the exported rule list, and add both broken and healthy fixtures. High-confidence contradictions should be errors; incomplete documentation or uncertain inference should be warnings.
