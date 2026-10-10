import path from "node:path";
import type {
  AppPlatformService,
  ComposeService,
  DockerfileModel,
  EnvironmentValue,
  Finding,
  RuleDefinition,
  Severity,
  SourceLocation,
} from "./types.js";
import { matchesSelector } from "./util.js";

function finding(
  rule: Pick<RuleDefinition, "id" | "title" | "defaultSeverity">,
  message: string,
  remediation: string,
  locations: SourceLocation[],
  severity: Severity = rule.defaultSeverity,
): Finding {
  return {
    ruleId: rule.id,
    severity,
    title: rule.title,
    message,
    remediation,
    locations,
  };
}

const serviceSelectorRule: RuleDefinition = {
  id: "K8S001",
  title: "Service selector matches no workload",
  description:
    "Checks that each Kubernetes Service selector matches at least one workload's pod labels.",
  defaultSeverity: "error",
  evaluate(model) {
    return model.kubernetesServices.flatMap((service) => {
      if (Object.keys(service.selector).length === 0) return [];
      const matches = model.workloads.filter(
        (workload) =>
          workload.namespace === service.namespace &&
          matchesSelector(workload.labels, service.selector),
      );
      if (matches.length > 0) return [];
      return [
        finding(
          serviceSelectorRule,
          `Service ${service.namespace}/${service.name} selects ${JSON.stringify(service.selector)}, but no workload has those pod labels.`,
          "Make the Service selector and workload template labels identical.",
          [service.source],
        ),
      ];
    });
  },
};

const serviceTargetPortRule: RuleDefinition = {
  id: "K8S002",
  title: "Service targetPort is not exposed by its workload",
  description:
    "Resolves Kubernetes Service selectors and verifies numeric or named target ports against selected containers.",
  defaultSeverity: "error",
  evaluate(model) {
    const findings: Finding[] = [];
    for (const service of model.kubernetesServices) {
      const workloads = model.workloads.filter(
        (workload) =>
          workload.namespace === service.namespace &&
          matchesSelector(workload.labels, service.selector),
      );
      if (workloads.length === 0) continue;
      for (const servicePort of service.ports) {
        const valid = workloads.some((workload) =>
          workload.containers.some((container) =>
            container.ports.some((port) =>
              typeof servicePort.targetPort === "number"
                ? port.port === servicePort.targetPort
                : port.name === servicePort.targetPort,
            ),
          ),
        );
        if (valid) continue;
        findings.push(
          finding(
            serviceTargetPortRule,
            `Service ${service.namespace}/${service.name} targets port ${String(servicePort.targetPort)}, but selected workload containers expose ${workloads
              .flatMap((workload) => workload.containers.flatMap((container) => container.ports))
              .map((port) => port.name ? `${port.name}:${port.port}` : String(port.port))
              .join(", ") || "no declared ports"}.`,
            "Set targetPort to a numeric containerPort or a declared named port.",
            [service.source, ...workloads.map((workload) => workload.source)],
          ),
        );
      }
    }
    return findings;
  },
};

const probePortRule: RuleDefinition = {
  id: "K8S003",
  title: "Health probe references an undeclared container port",
  description:
    "Verifies liveness, readiness, and startup probe ports against their container's declared ports.",
  defaultSeverity: "error",
  evaluate(model) {
    const findings: Finding[] = [];
    for (const workload of model.workloads) {
      for (const container of workload.containers) {
        if (container.ports.length === 0) continue;
        for (const probe of container.probes) {
          if (probe.port === undefined) continue;
          const valid = container.ports.some((port) =>
            typeof probe.port === "number" ? port.port === probe.port : port.name === probe.port,
          );
          if (valid) continue;
          findings.push(
            finding(
              probePortRule,
              `${workload.kind} ${workload.namespace}/${workload.name} container ${container.name} has a ${probe.kind} probe on ${String(probe.port)}, but exposes ${container.ports.map((port) => port.name ? `${port.name}:${port.port}` : String(port.port)).join(", ")}.`,
              "Point the probe at a declared container port or correct the containerPort declaration.",
              [workload.source],
            ),
          );
        }
      }
    }
    return findings;
  },
};

function normalizeRelative(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

function dockerfileForCompose(
  service: ComposeService,
  dockerfiles: DockerfileModel[],
): DockerfileModel | undefined {
  if (!service.buildContext && !service.dockerfile) return undefined;
  const composeDirectory = path.posix.dirname(service.source.file);
  const context = normalizeRelative(path.posix.join(composeDirectory, service.buildContext ?? "."));
  const dockerfilePath = normalizeRelative(
    path.posix.join(context, service.dockerfile ?? "Dockerfile"),
  );
  return dockerfiles.find((candidate) => normalizeRelative(candidate.source.file) === dockerfilePath);
}

function dockerfileForAppPlatform(
  service: AppPlatformService,
  dockerfiles: DockerfileModel[],
): DockerfileModel | undefined {
  if (service.dockerfilePath) {
    const expected = normalizeRelative(service.dockerfilePath);
    return dockerfiles.find((candidate) => normalizeRelative(candidate.source.file) === expected);
  }
  if (service.sourceDir) {
    const expected = normalizeRelative(path.posix.join(service.sourceDir, "Dockerfile"));
    return dockerfiles.find((candidate) => normalizeRelative(candidate.source.file) === expected);
  }
  return dockerfiles.length === 1 ? dockerfiles[0] : undefined;
}

const composePortRule: RuleDefinition = {
  id: "PORT001",
  title: "Compose and Dockerfile ports disagree",
  description:
    "Compares each Compose service's internal ports with the Dockerfile used by its build context.",
  defaultSeverity: "warning",
  evaluate(model) {
    const findings: Finding[] = [];
    for (const service of model.composeServices) {
      const dockerfile = dockerfileForCompose(service, model.dockerfiles);
      if (!dockerfile || dockerfile.exposePorts.length === 0) continue;
      const composePorts = [
        ...service.ports.map((port) => port.target),
        ...service.exposePorts,
      ];
      if (composePorts.length === 0 || composePorts.some((port) => dockerfile.exposePorts.includes(port))) {
        continue;
      }
      findings.push(
        finding(
          composePortRule,
          `Compose service ${service.name} routes to ${composePorts.join(", ")}, while ${dockerfile.source.file} exposes ${dockerfile.exposePorts.join(", ")}.`,
          "Align the Compose container-side port with the port the image documents and application listens on.",
          [service.source, dockerfile.source],
        ),
      );
    }
    return findings;
  },
};

const appPlatformPortRule: RuleDefinition = {
  id: "PORT002",
  title: "App Platform http_port and Dockerfile EXPOSE disagree",
  description:
    "Compares App Platform service http_port with the associated Dockerfile's exposed ports.",
  defaultSeverity: "error",
  evaluate(model) {
    const findings: Finding[] = [];
    for (const service of model.appPlatformServices) {
      const dockerfile = dockerfileForAppPlatform(service, model.dockerfiles);
      if (
        !dockerfile ||
        dockerfile.exposePorts.length === 0 ||
        dockerfile.exposePorts.includes(service.httpPort)
      ) {
        continue;
      }
      findings.push(
        finding(
          appPlatformPortRule,
          `App Platform service ${service.name} sends traffic to ${service.httpPort}, while ${dockerfile.source.file} exposes ${dockerfile.exposePorts.join(", ")}.`,
          "Set http_port to the application's listening port, or update the container configuration.",
          [service.source, dockerfile.source],
        ),
      );
    }
    return findings;
  },
};

const nginxUpstreamRule: RuleDefinition = {
  id: "NGINX001",
  title: "Nginx upstream port disagrees with its service",
  description:
    "Resolves Nginx proxy_pass targets against Compose and Kubernetes service ports.",
  defaultSeverity: "error",
  evaluate(model) {
    const findings: Finding[] = [];
    for (const target of model.nginxTargets) {
      if (!target.port) continue;
      const compose = model.composeServices.find((service) => service.name === target.host);
      if (compose) {
        const ports = [...compose.ports.map((port) => port.target), ...compose.exposePorts];
        if (ports.length > 0 && !ports.includes(target.port)) {
          findings.push(
            finding(
              nginxUpstreamRule,
              `Nginx proxies to ${target.host}:${target.port}, but Compose service ${compose.name} exposes ${ports.join(", ")}.`,
              "Use the Compose service's container-side port in proxy_pass.",
              [target.source, compose.source],
            ),
          );
        }
        continue;
      }

      const services = model.kubernetesServices.filter((service) => service.name === target.host);
      if (services.length === 0) continue;
      const ports = services.flatMap((service) => service.ports.map((port) => port.port));
      if (!ports.includes(target.port)) {
        findings.push(
          finding(
            nginxUpstreamRule,
            `Nginx proxies to ${target.host}:${target.port}, but the Kubernetes Service exposes ${ports.join(", ")}.`,
            "Point proxy_pass at the Kubernetes Service port, not the pod's container port.",
            [target.source, ...services.map((service) => service.source)],
          ),
        );
      }
    }
    return findings;
  },
};

interface CommandSource {
  command: string;
  location: SourceLocation;
  label: string;
}

function loopbackEnvironment(environment: EnvironmentValue[]): EnvironmentValue[] {
  return environment.filter(
    (entry) =>
      /^(?:HOST|BIND_ADDR|LISTEN_ADDR|SERVER_HOST)$/i.test(entry.name) &&
      /^(?:127\.0\.0\.1|localhost)$/i.test(entry.value ?? ""),
  );
}

const loopbackBindRule: RuleDefinition = {
  id: "BIND001",
  title: "Application appears to bind only to loopback",
  description:
    "Detects common run-command and environment settings that make a container unreachable from a proxy or platform router.",
  defaultSeverity: "error",
  evaluate(model) {
    const commands: CommandSource[] = [
      ...model.dockerfiles.flatMap((dockerfile) =>
        dockerfile.commands.map((command) => ({
          command,
          location: dockerfile.source,
          label: dockerfile.source.file,
        })),
      ),
      ...model.composeServices.map((service) => ({
        command: service.command,
        location: service.source,
        label: `Compose service ${service.name}`,
      })),
      ...model.appPlatformServices.map((service) => ({
        command: service.command,
        location: service.source,
        label: `App Platform service ${service.name}`,
      })),
      ...model.workloads.flatMap((workload) =>
        workload.containers.map((container) => ({
          command: container.command,
          location: workload.source,
          label: `${workload.kind} ${workload.name}/${container.name}`,
        })),
      ),
    ];
    const bindPattern = /(?:--host(?:=|\s+)|--bind(?:=|\s+)|(?:HOST|BIND_ADDR|LISTEN_ADDR)=)(?:127\.0\.0\.1|localhost)\b/i;
    const findings = commands
      .filter((source) => bindPattern.test(source.command))
      .map((source) =>
        finding(
          loopbackBindRule,
          `${source.label} binds to a loopback address, so traffic from a container network or platform router cannot reach it.`,
          "Bind the HTTP server to 0.0.0.0 and restrict exposure at the proxy, firewall, or Service layer.",
          [source.location],
        ),
      );

    const environmentSources: Array<{
      entries: EnvironmentValue[];
      location: SourceLocation;
      label: string;
    }> = [
      ...model.dockerfiles.map((item) => ({
        entries: item.environment,
        location: item.source,
        label: item.source.file,
      })),
      ...model.composeServices.map((item) => ({
        entries: item.environment,
        location: item.source,
        label: `Compose service ${item.name}`,
      })),
      ...model.appPlatformServices.map((item) => ({
        entries: item.environment,
        location: item.source,
        label: `App Platform service ${item.name}`,
      })),
      ...model.workloads.flatMap((workload) =>
        workload.containers.map((container) => ({
          entries: container.env,
          location: workload.source,
          label: `${workload.kind} ${workload.name}/${container.name}`,
        })),
      ),
    ];
    for (const source of environmentSources) {
      for (const entry of loopbackEnvironment(source.entries)) {
        findings.push(
          finding(
            loopbackBindRule,
            `${source.label} sets ${entry.name}=${entry.value}, which can make the container unreachable.`,
            "Bind the HTTP server to 0.0.0.0 and restrict exposure outside the application process.",
            [source.location],
          ),
        );
      }
    }
    return findings;
  },
};

const undeclaredEnvironmentRule: RuleDefinition = {
  id: "ENV001",
  title: "Referenced environment variable is not documented",
  description:
    "Finds environment variables referenced by application code but absent from deployment files and .env.example.",
  defaultSeverity: "warning",
  evaluate(model) {
    const references = new Map<string, SourceLocation[]>();
    for (const reference of model.environmentReferences) {
      if (model.declaredEnvironment.has(reference.name)) continue;
      const locations = references.get(reference.name) ?? [];
      locations.push(reference.source);
      references.set(reference.name, locations);
    }
    return [...references.entries()].map(([name, locations]) =>
      finding(
        undeclaredEnvironmentRule,
        `${name} is referenced by application code but is not declared in a scanned deployment file or .env.example.`,
        `Document ${name} in .env.example and supply it explicitly in each deployment target that needs it.`,
        locations,
      ),
    );
  },
};

export const rules: RuleDefinition[] = [
  serviceSelectorRule,
  serviceTargetPortRule,
  probePortRule,
  composePortRule,
  appPlatformPortRule,
  nginxUpstreamRule,
  loopbackBindRule,
  undeclaredEnvironmentRule,
];
