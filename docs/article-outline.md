# Article outline: Your YAML Is Valid—So Why Won't the App Start?

## Thesis

Production deployment failures often occur between configuration layers. Syntax validation is necessary, but it cannot prove that independently valid components agree about ports, paths, selectors, probes, or environment contracts.

## Opening demo

Show a repository where:

- the Dockerfile exposes `3000`
- Compose routes to `8080`
- Nginx proxies to `9090`
- App Platform expects `8080`
- Kubernetes probes `8080`

Every file parses. The application is still unreachable.

## Sections

1. **The boundary is the failure domain**
   Explain how a request crosses DNS, edge routing, reverse proxy, service discovery, container networking, application binding, and database access.
2. **Why file-by-file linting stops too early**
   Contrast schema validity with relational correctness.
3. **Building a normalized deployment model**
   Show why rules should operate on workloads, services, ports, and environment contracts instead of raw vendor syntax.
4. **Confidence matters**
   Explain the error-versus-warning policy and why operational tooling must avoid noisy guesses.
5. **CI as an operational feedback loop**
   Run the same boundary checks before merge instead of discovering them through a failed deployment.

## Live-talk sequence

1. Deploy the broken example and observe the failure.
2. Ask the audience which file is invalid—the answer is none.
3. Run Stack Accord and reveal the contradictions.
4. Fix one boundary at a time.
5. Run the healthy example and close with the normalized-model architecture.

## Suggested title variants

- The Failure Between the Files
- Your Manifests Are Valid. Your System Isn't.
- Static Analysis for the Request Path
- From Support Ticket to Deployment Rule
