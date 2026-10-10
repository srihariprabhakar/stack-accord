import { promises as fs } from "node:fs";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import type {
  ComposePort,
  Container,
  EnvironmentReference,
  EnvironmentValue,
  KubernetesService,
  NginxTarget,
  Probe,
  ProjectModel,
  ServicePort,
  Workload,
} from "./types.js";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  lineOf,
  relative,
  stringifyCommand,
  stringRecord,
  uniqueNumbers,
} from "./util.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".vscode",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "target",
]);

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".go",
  ".py",
  ".rs",
  ".rb",
  ".php",
  ".java",
  ".kt",
]);

const SAFE_IMPLICIT_ENV = new Set([
  "CI",
  "HOME",
  "HOSTNAME",
  "NODE_ENV",
  "PATH",
  "PWD",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
]);

async function discoverFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isSymbolicLink()) return;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(fullPath);
          return;
        }
        if (entry.isFile()) files.push(fullPath);
      }),
    );
  }

  await visit(root);
  return files.sort();
}

function parseEnvironment(value: unknown): EnvironmentValue[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item !== "string") return [];
      const separator = item.indexOf("=");
      if (separator === -1) return [{ name: item }];
      return [{ name: item.slice(0, separator), value: item.slice(separator + 1) }];
    });
  }

  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).map(([name, item]) => {
    if (item === null || item === undefined) return { name };
    return { name, value: String(item) };
  });
}

function parseKubernetesEnvironment(value: unknown): EnvironmentValue[] {
  return asArray(value).flatMap((item) => {
    const entry = asRecord(item);
    const name = asString(entry?.name);
    if (!name) return [];
    const literal = asString(entry?.value);
    return literal === undefined ? [{ name }] : [{ name, value: literal }];
  });
}

function parseProbe(kind: Probe["kind"], value: unknown): Probe | undefined {
  const probe = asRecord(value);
  if (!probe) return undefined;
  const httpGet = asRecord(probe.httpGet);
  const tcpSocket = asRecord(probe.tcpSocket);
  const grpc = asRecord(probe.grpc);
  const port = httpGet?.port ?? tcpSocket?.port ?? grpc?.port;
  const parsedPort = asNumber(port) ?? asString(port);
  const parsedPath = asString(httpGet?.path);
  return {
    kind,
    ...(parsedPort !== undefined ? { port: parsedPort } : {}),
    ...(parsedPath !== undefined ? { path: parsedPath } : {}),
  };
}

function parseContainer(value: unknown): Container | undefined {
  const container = asRecord(value);
  const name = asString(container?.name);
  if (!container || !name) return undefined;

  const ports = asArray(container.ports).flatMap((item) => {
    const port = asRecord(item);
    const containerPort = asNumber(port?.containerPort);
    if (!containerPort) return [];
    const portName = asString(port?.name);
    return [{ ...(portName ? { name: portName } : {}), port: containerPort }];
  });

  const probes: Probe[] = [];
  const liveness = parseProbe("liveness", container.livenessProbe);
  const readiness = parseProbe("readiness", container.readinessProbe);
  const startup = parseProbe("startup", container.startupProbe);
  if (liveness) probes.push(liveness);
  if (readiness) probes.push(readiness);
  if (startup) probes.push(startup);

  return {
    name,
    ports,
    env: parseKubernetesEnvironment(container.env),
    command: [stringifyCommand(container.command), stringifyCommand(container.args)]
      .filter(Boolean)
      .join(" "),
    probes,
  };
}

function parseWorkload(
  document: Record<string, unknown>,
  sourceFile: string,
): Workload | undefined {
  const kind = asString(document.kind);
  if (!kind || !["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Pod"].includes(kind)) {
    return undefined;
  }

  const metadata = asRecord(document.metadata);
  const name = asString(metadata?.name);
  if (!name) return undefined;
  const spec = asRecord(document.spec) ?? {};
  const template = kind === "Pod" ? document : asRecord(spec.template);
  const podMetadata = kind === "Pod" ? metadata : asRecord(asRecord(template)?.metadata);
  const podSpec = kind === "Pod" ? spec : asRecord(asRecord(template)?.spec);
  const containers = asArray(podSpec?.containers)
    .map(parseContainer)
    .filter((container): container is Container => container !== undefined);

  return {
    source: { file: sourceFile },
    kind,
    name,
    namespace: asString(metadata?.namespace) ?? "default",
    replicas: kind === "DaemonSet" || kind === "Pod" ? 1 : asNumber(spec.replicas) ?? 1,
    labels: stringRecord(podMetadata?.labels),
    containers,
  };
}

function parseKubernetesService(
  document: Record<string, unknown>,
  sourceFile: string,
): KubernetesService | undefined {
  if (document.kind !== "Service") return undefined;
  const metadata = asRecord(document.metadata);
  const spec = asRecord(document.spec);
  const name = asString(metadata?.name);
  if (!name || !spec) return undefined;

  const ports: ServicePort[] = asArray(spec.ports).flatMap((item) => {
    const port = asRecord(item);
    const servicePort = asNumber(port?.port);
    if (!servicePort) return [];
    const rawTarget = port?.targetPort;
    const targetPort = asNumber(rawTarget) ?? asString(rawTarget) ?? servicePort;
    const portName = asString(port?.name);
    return [{ ...(portName ? { name: portName } : {}), port: servicePort, targetPort }];
  });

  return {
    source: { file: sourceFile },
    name,
    namespace: asString(metadata?.namespace) ?? "default",
    selector: stringRecord(spec.selector),
    ports,
  };
}

function parseKubernetesDocument(
  document: Record<string, unknown>,
  sourceFile: string,
  model: ProjectModel,
): boolean {
  if (!asString(document.apiVersion) || !asString(document.kind)) return false;

  if (document.kind === "List") {
    for (const item of asArray(document.items)) {
      const record = asRecord(item);
      if (record) parseKubernetesDocument(record, sourceFile, model);
    }
    return true;
  }

  const workload = parseWorkload(document, sourceFile);
  if (workload) {
    model.workloads.push(workload);
    for (const container of workload.containers) {
      for (const env of container.env) model.declaredEnvironment.add(env.name);
    }
  }
  const service = parseKubernetesService(document, sourceFile);
  if (service) model.kubernetesServices.push(service);
  return true;
}

function parseComposePort(value: unknown): ComposePort | undefined {
  if (typeof value === "number") return { target: value };
  if (typeof value === "string") {
    const withoutProtocol = value.split("/")[0] ?? value;
    const parts = withoutProtocol.split(":");
    const target = Number(parts.at(-1));
    const published = parts.length >= 2 ? Number(parts.at(-2)) : undefined;
    if (!Number.isFinite(target)) return undefined;
    return {
      target,
      ...(published !== undefined && Number.isFinite(published) ? { published } : {}),
    };
  }
  const record = asRecord(value);
  const target = asNumber(record?.target);
  if (!target) return undefined;
  const published = asNumber(record?.published);
  return { target, ...(published ? { published } : {}) };
}

function parseComposeDocument(
  document: Record<string, unknown>,
  sourceFile: string,
  model: ProjectModel,
): boolean {
  const services = asRecord(document.services);
  if (!services || Array.isArray(document.services)) return false;

  for (const [name, rawService] of Object.entries(services)) {
    const service = asRecord(rawService);
    if (!service) continue;
    const build = asRecord(service.build);
    const buildContext =
      asString(service.build) ?? asString(build?.context) ?? (service.build ? "." : undefined);
    const dockerfile = asString(build?.dockerfile);
    const environment = parseEnvironment(service.environment);
    const image = asString(service.image);
    const ports = asArray(service.ports)
      .map(parseComposePort)
      .filter((port): port is ComposePort => port !== undefined);
    const exposePorts = asArray(service.expose)
      .map(asNumber)
      .filter((port): port is number => port !== undefined);

    model.composeServices.push({
      source: { file: sourceFile },
      name,
      ...(buildContext ? { buildContext } : {}),
      ...(dockerfile ? { dockerfile } : {}),
      ...(image ? { image } : {}),
      ports,
      exposePorts,
      environment,
      command: stringifyCommand(service.command),
    });
    for (const env of environment) model.declaredEnvironment.add(env.name);
  }

  return true;
}

function parseAppPlatformDocument(
  original: Record<string, unknown>,
  sourceFile: string,
  model: ProjectModel,
): boolean {
  const document = asRecord(original.spec) ?? original;
  if (!Array.isArray(document.services)) return false;
  const hasAppPlatformShape = asArray(document.services).some((value) => {
    const service = asRecord(value);
    return Boolean(
      service &&
        ("http_port" in service ||
          "run_command" in service ||
          "github" in service ||
          "git" in service ||
          "dockerfile_path" in service),
    );
  });
  if (!hasAppPlatformShape) return false;

  for (const rawService of asArray(document.services)) {
    const service = asRecord(rawService);
    const name = asString(service?.name);
    if (!service || !name) continue;
    const environment = asArray(service.envs).flatMap((item) => {
      const env = asRecord(item);
      const envName = asString(env?.key);
      if (!envName) return [];
      const value = asString(env?.value);
      return [value === undefined ? { name: envName } : { name: envName, value }];
    });
    const dockerfilePath = asString(service.dockerfile_path);
    const sourceDir = asString(service.source_dir);
    model.appPlatformServices.push({
      source: { file: sourceFile },
      name,
      httpPort: asNumber(service.http_port) ?? 8080,
      ...(dockerfilePath ? { dockerfilePath } : {}),
      ...(sourceDir ? { sourceDir } : {}),
      environment,
      command: asString(service.run_command) ?? "",
    });
    for (const env of environment) model.declaredEnvironment.add(env.name);
  }
  return true;
}

async function parseYamlFile(file: string, model: ProjectModel): Promise<void> {
  const text = await fs.readFile(file, "utf8");
  const sourceFile = relative(model.root, file);
  const documents = parseAllDocuments(text, { prettyErrors: true });

  for (const document of documents) {
    if (document.errors.length > 0) {
      model.warnings.push(`${sourceFile}: ${document.errors[0]?.message ?? "invalid YAML"}`);
      continue;
    }
    const record = asRecord(document.toJS());
    if (!record) continue;
    if (parseKubernetesDocument(record, sourceFile, model)) continue;
    if (parseComposeDocument(record, sourceFile, model)) continue;
    parseAppPlatformDocument(record, sourceFile, model);
  }
}

async function parseDockerfile(file: string, model: ProjectModel): Promise<void> {
  const text = await fs.readFile(file, "utf8");
  const sourceFile = relative(model.root, file);
  const exposePorts: number[] = [];
  const environment: EnvironmentValue[] = [];
  const commands: string[] = [];
  const logicalLines = text.replace(/\\\r?\n\s*/g, " ").split(/\r?\n/);

  for (const rawLine of logicalLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [instruction = "", ...rest] = line.split(/\s+/);
    const value = rest.join(" ");
    switch (instruction.toUpperCase()) {
      case "EXPOSE":
        for (const token of rest) {
          const port = Number(token.split("/")[0]);
          if (Number.isFinite(port)) exposePorts.push(port);
        }
        break;
      case "ENV": {
        const assignments = value.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=(?:"[^"]*"|'[^']*'|\S+)/g);
        for (const match of assignments) environment.push({ name: match[1] ?? "" });
        if (!value.includes("=") && rest.length >= 2 && rest[0]) {
          environment.push({ name: rest[0], value: rest.slice(1).join(" ") });
        }
        break;
      }
      case "CMD":
      case "ENTRYPOINT":
        commands.push(value);
        break;
    }
  }

  for (const env of environment) model.declaredEnvironment.add(env.name);
  model.dockerfiles.push({
    source: { file: sourceFile },
    context: path.dirname(sourceFile),
    exposePorts: uniqueNumbers(exposePorts),
    environment,
    commands,
  });
}

async function parseNginx(file: string, model: ProjectModel): Promise<void> {
  const text = await fs.readFile(file, "utf8");
  if (!/\b(?:proxy_pass|upstream|server)\b/.test(text)) return;
  const sourceFile = relative(model.root, file);
  const upstreams = new Map<string, { host: string; port?: number }>();
  const upstreamPattern = /upstream\s+([\w.-]+)\s*\{([\s\S]*?)\}/g;
  for (const match of text.matchAll(upstreamPattern)) {
    const server = match[2]?.match(/\bserver\s+([\w.-]+)(?::(\d+))?\s*;/);
    if (!match[1] || !server?.[1]) continue;
    const port = server[2] ? Number(server[2]) : undefined;
    upstreams.set(match[1], { host: server[1], ...(port ? { port } : {}) });
  }

  const proxyPattern = /proxy_pass\s+https?:\/\/([\w.-]+)(?::(\d+))?([^;\s]*)\s*;/g;
  for (const match of text.matchAll(proxyPattern)) {
    if (!match[1] || match.index === undefined) continue;
    const upstream = upstreams.get(match[1]);
    const host = upstream?.host ?? match[1];
    const explicitPort = match[2] ? Number(match[2]) : undefined;
    const port = explicitPort ?? upstream?.port;
    const prefix = text.slice(0, match.index);
    const locations = [...prefix.matchAll(/location\s+(?:[=~*^]+\s*)?([^\s{]+)\s*\{/g)];
    const location = locations.at(-1)?.[1];
    const target: NginxTarget = {
      source: { file: sourceFile, line: lineOf(text, match.index) },
      ...(location ? { location } : {}),
      host,
      ...(port ? { port } : {}),
      raw: match[0],
    };
    model.nginxTargets.push(target);
  }
}

async function parseEnvExample(file: string, model: ProjectModel): Promise<void> {
  const text = await fs.readFile(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1]) model.declaredEnvironment.add(match[1]);
  }
}

async function parseEnvironmentReferences(file: string, model: ProjectModel): Promise<void> {
  const extension = path.extname(file);
  if (!SOURCE_EXTENSIONS.has(extension)) return;
  const text = await fs.readFile(file, "utf8");
  const sourceFile = relative(model.root, file);
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
    /(?:os\.(?:Getenv|LookupEnv)|os\.getenv|env::var|ENV\.fetch)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
    /os\.environ\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  ];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1];
      if (!name || seen.has(name) || SAFE_IMPLICIT_ENV.has(name) || match.index === undefined) continue;
      seen.add(name);
      const reference: EnvironmentReference = {
        source: { file: sourceFile, line: lineOf(text, match.index) },
        name,
      };
      model.environmentReferences.push(reference);
    }
  }
}

export async function buildProjectModel(rootPath: string): Promise<ProjectModel> {
  const root = path.resolve(rootPath);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`Scan target is not a directory: ${rootPath}`);
  const files = await discoverFiles(root);
  const model: ProjectModel = {
    root,
    files,
    dockerfiles: [],
    composeServices: [],
    workloads: [],
    kubernetesServices: [],
    appPlatformServices: [],
    nginxTargets: [],
    environmentReferences: [],
    declaredEnvironment: new Set<string>(),
    warnings: [],
  };

  for (const file of files) {
    const basename = path.basename(file);
    const lower = basename.toLowerCase();
    try {
      if (basename === "Dockerfile" || basename.startsWith("Dockerfile.")) {
        await parseDockerfile(file, model);
      } else if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
        await parseYamlFile(file, model);
      } else if (lower.endsWith(".conf") || lower === "nginx.conf") {
        await parseNginx(file, model);
      } else if (lower === ".env.example" || lower.endsWith(".env.example")) {
        await parseEnvExample(file, model);
      }
      await parseEnvironmentReferences(file, model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      model.warnings.push(`${relative(root, file)}: ${message}`);
    }
  }

  return model;
}
