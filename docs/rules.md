# Rule catalog

Rule IDs are stable identifiers intended for CI configuration and documentation. Error-level rules indicate a strong configuration contradiction. Warning-level rules indicate a likely problem that may be intentional.

| Rule | Severity | Purpose |
| --- | --- | --- |
| `K8S001` | error | Kubernetes Service selector matches no discovered workload |
| `K8S002` | error | Service `targetPort` is not exposed by a selected workload |
| `K8S003` | error | Health probe uses an undeclared numeric or named container port |
| `PORT001` | warning | Compose container-side ports disagree with the associated Dockerfile |
| `PORT002` | error | App Platform `http_port` disagrees with the associated Dockerfile |
| `NGINX001` | error | Nginx upstream port disagrees with a Compose or Kubernetes service |
| `BIND001` | error | A container command or environment value binds the server to loopback |
| `ENV001` | warning | Application code references an environment variable that is undocumented |

## `K8S001` — Service selector matches no workload

Stack Accord compares a Service's complete `spec.selector` map against pod-template labels from Deployments, StatefulSets, DaemonSets, ReplicaSets, and Pods in the same namespace.

Services without selectors are skipped because they may intentionally use manually managed EndpointSlices or external backends.

## `K8S002` — Service targetPort is not exposed

After resolving a Service to its selected workloads, Stack Accord checks numeric `targetPort` values against `containerPort` and string values against named container ports.

If no workload matches, `K8S001` reports the more fundamental error and this rule stays silent.

## `K8S003` — Probe port is not exposed

Liveness, readiness, and startup probes using HTTP, TCP, or gRPC ports are checked against the containing container's declared ports. Containers with no declared ports are skipped because the intended port cannot be inferred safely.

## `PORT001` — Compose and Dockerfile ports disagree

Stack Accord resolves a Compose build context and optional Dockerfile path. It compares container-side `ports` and `expose` values with Dockerfile `EXPOSE` declarations.

Dockerfile `EXPOSE` is documentation rather than a runtime port binding, so this rule is a warning.

## `PORT002` — App Platform and Dockerfile ports disagree

Stack Accord resolves `dockerfile_path` or `source_dir` and compares a service's `http_port` (default `8080`) with Dockerfile `EXPOSE` declarations.

## `NGINX001` — Upstream port disagrees

Direct `proxy_pass` targets and simple named upstream blocks are resolved against:

- Compose service container-side ports
- Kubernetes Service `port` values

Dynamic variables, DNS aliases, and generated configuration are currently skipped.

## `BIND001` — Application binds to loopback

Common `--host`, `--bind`, `HOST`, `BIND_ADDR`, and `LISTEN_ADDR` forms are inspected in Dockerfile commands, Compose commands, Kubernetes commands and arguments, and App Platform run commands.

The rule only flags explicit `127.0.0.1` or `localhost` values.

## `ENV001` — Environment variable is undocumented

Stack Accord recognizes common environment access patterns across supported application languages. A reference is considered documented when the same name appears in a scanned Dockerfile, Compose file, Kubernetes workload, App Platform spec, or `.env.example`.

This project-level check does not yet guarantee that every deployment target supplies the variable. It is intentionally a warning.
