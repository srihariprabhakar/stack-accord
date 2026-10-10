# Stack Accord

**Cross-layer deployment preflight checks for containers, proxies, Kubernetes, and App Platform.**

Most deployment tools validate one file at a time. Production failures often live *between* otherwise valid files: Nginx sends traffic to the wrong container port, a Service selects no pods, or a platform router cannot reach an app bound to loopback.

Stack Accord scans the repository as one system and reports those inconsistencies before deployment.

```text
$ stackaccord scan .

Stack Accord deployment preflight
Scanned 6 files in 18.3ms

ERROR PORT002 App Platform http_port and Dockerfile EXPOSE disagree
  App Platform service api sends traffic to 8080, while Dockerfile exposes 3000.
  .do/app.yaml, Dockerfile
  Fix: Set http_port to the application's listening port, or update the container configuration.
```

## What it checks

Stack Accord currently correlates:

- Kubernetes Service selectors with workload pod labels
- Service `targetPort` values with container ports
- Health probe ports with declared container ports
- Compose container-side ports with Dockerfile `EXPOSE`
- App Platform `http_port` with Dockerfile `EXPOSE`
- Nginx `proxy_pass` ports with Compose or Kubernetes services
- Container commands and environment for loopback-only binding
- Application environment-variable references with deployment configuration

See [the rule catalog](docs/rules.md) for exact behavior and limitations.

## Try it

Requires Node.js 20 or newer.

```bash
git clone https://github.com/srihariprabhakar/stack-accord.git
cd stack-accord
corepack enable
pnpm install
pnpm build

# Deliberately broken example: exits 1 and explains eight problems.
node dist/cli.js scan examples/broken-stack --fail-on never

# Corrected example: exits 0.
node dist/cli.js scan examples/healthy-stack
```

Once the package is published, the intended installation is:

```bash
npm install --global stack-accord
stackaccord scan .
```

## CLI

```text
stackaccord scan [directory] [options]
stackaccord rules [--format pretty|json]

--format <pretty|json|markdown>  Output format (default: pretty)
--fail-on <error|warning|never>  Exit-code threshold (default: error)
--ignore <RULE[,RULE...]>        Ignore one or more rule IDs
```

Examples:

```bash
# Human-readable local scan
stackaccord scan .

# Structured CI output
stackaccord scan . --format json

# Markdown suitable for a pull-request comment or job summary
stackaccord scan . --format markdown

# Enforce warnings, except for environment documentation
stackaccord scan . --fail-on warning --ignore ENV001
```

Exit codes are `0` for success, `1` when the configured finding threshold is reached, and `2` for invalid arguments or scan failures.

## Supported files

Stack Accord automatically discovers:

- `Dockerfile` and `Dockerfile.*`
- Compose YAML with a top-level service map
- Kubernetes YAML resources, including multi-document files
- DigitalOcean App Platform specs, including `spec`-wrapped deploy templates
- Nginx `.conf` files
- `.env.example`
- JavaScript, TypeScript, Go, Python, Rust, Ruby, PHP, Java, and Kotlin environment references

Generated output, dependencies, VCS metadata, and common build directories are ignored.

## Design principles

- **Cross-layer first:** a check should connect facts from multiple configuration surfaces whenever possible.
- **Evidence over scores:** every finding shows the files involved and an actionable remediation.
- **Local by default:** Stack Accord sends no source code or configuration to a remote service.
- **Conservative checks:** uncertain patterns should be warnings, not release-blocking errors.
- **CI-friendly:** stable rule IDs, deterministic sorting, structured output, and explicit exit semantics.

Read [the architecture notes](docs/architecture.md) to understand the scanner pipeline.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

Contributions should include a focused fixture and a test. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- Repository configuration in `.stackaccord.yaml`
- Dockerfile command-to-port inference
- Nginx path-rewrite and forwarded-header analysis
- Database connection-budget checks across replica counts
- Helm and Kustomize rendering
- SARIF output and a first-class GitHub Action
- Plugin API for platform-specific rules
- Browser report viewer backed by the JSON format

## Why this exists

Syntax validation answers “is this file legal?” Stack Accord asks “will these layers work together?”

That distinction comes from a common support pattern: every component can look healthy in isolation while the request path is broken at a boundary. Stack Accord turns those boundary checks into repeatable, reviewable code.

## License

[MIT](LICENSE)
