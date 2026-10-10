export type Severity = "error" | "warning" | "info";

export interface SourceLocation {
  file: string;
  line?: number;
  detail?: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  message: string;
  remediation: string;
  locations: SourceLocation[];
}

export interface ContainerPort {
  name?: string;
  port: number;
}

export interface Probe {
  kind: "liveness" | "readiness" | "startup";
  port?: string | number;
  path?: string;
}

export interface EnvironmentValue {
  name: string;
  value?: string;
}

export interface Container {
  name: string;
  ports: ContainerPort[];
  env: EnvironmentValue[];
  command: string;
  probes: Probe[];
}

export interface Workload {
  source: SourceLocation;
  kind: string;
  name: string;
  namespace: string;
  replicas: number;
  labels: Record<string, string>;
  containers: Container[];
}

export interface ServicePort {
  name?: string;
  port: number;
  targetPort: string | number;
}

export interface KubernetesService {
  source: SourceLocation;
  name: string;
  namespace: string;
  selector: Record<string, string>;
  ports: ServicePort[];
}

export interface DockerfileModel {
  source: SourceLocation;
  context: string;
  exposePorts: number[];
  environment: EnvironmentValue[];
  commands: string[];
}

export interface ComposePort {
  published?: number;
  target: number;
}

export interface ComposeService {
  source: SourceLocation;
  name: string;
  buildContext?: string;
  dockerfile?: string;
  image?: string;
  ports: ComposePort[];
  exposePorts: number[];
  environment: EnvironmentValue[];
  command: string;
}

export interface AppPlatformService {
  source: SourceLocation;
  name: string;
  httpPort: number;
  dockerfilePath?: string;
  sourceDir?: string;
  environment: EnvironmentValue[];
  command: string;
}

export interface NginxTarget {
  source: SourceLocation;
  location?: string;
  host: string;
  port?: number;
  raw: string;
}

export interface EnvironmentReference {
  source: SourceLocation;
  name: string;
}

export interface ProjectModel {
  root: string;
  files: string[];
  dockerfiles: DockerfileModel[];
  composeServices: ComposeService[];
  workloads: Workload[];
  kubernetesServices: KubernetesService[];
  appPlatformServices: AppPlatformService[];
  nginxTargets: NginxTarget[];
  environmentReferences: EnvironmentReference[];
  declaredEnvironment: Set<string>;
  warnings: string[];
}

export interface ScanResult {
  root: string;
  scannedFiles: number;
  findings: Finding[];
  parserWarnings: string[];
  durationMs: number;
}

export interface RuleDefinition {
  id: string;
  title: string;
  description: string;
  defaultSeverity: Severity;
  evaluate(model: ProjectModel): Finding[];
}
