export interface ContainerPort {
  name?: string
  port: number
  protocol: 'TCP' | 'UDP' | 'SCTP'
}

export interface PodInfo {
  name: string
  namespace: string
  labels?: Record<string, string>
  ip?: string
  nodeName?: string
  hostNetwork: boolean
  phase: string
  owner: string
  ports?: ContainerPort[]
}

export interface NamespaceInfo {
  name: string
  labels?: Record<string, string>
  podCount: number
  policyCount: number
}

export interface CniResult {
  provider: string
  enforcesPolicies: boolean
  evidence?: string[]
  warnings?: string[]
  anpPresent: boolean
}

export interface ClusterInfo {
  appVersion: string
  kubernetesVersion: string
  cni: CniResult
  readOnly: boolean
  authMode: AuthMode
}

export interface PolicyRef {
  namespace: string
  name: string
}

export type EdgeVerdict = 'allowed' | 'blocked' | 'unconstrained'

export interface TopologyNode {
  id: string
  namespace: string
  workload: string
  podCount: number
  hostNetwork: boolean
}

export interface TopologyEdge {
  id: string
  source: string
  target: string
  verdict: EdgeVerdict
  policies?: PolicyRef[]
}

export interface Topology {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

export interface PolicySummary {
  namespace: string
  name: string
  policyTypes: string[]
  podsMatched: number
  createdAt: string
}

export type AuthMode = 'none' | 'token' | 'proxy'

export interface AuthUser {
  name: string
  groups: string[]
}

export interface AuthMe {
  mode: AuthMode
  user: AuthUser | null
}

export interface Permissions {
  namespace: string
  readOnly: boolean
  create: boolean
  update: boolean
  delete: boolean
  unknown?: boolean
}

export type Severity = 'critical' | 'warning' | 'info'

export interface Finding {
  code: string
  severity: Severity
  namespace?: string
  policy?: PolicyRef
  message: string
}

export interface NamespacePosture {
  namespace: string
  system: boolean
  pods: number
  hostNetworkPods: number
  policies: number
  ingressIsolatedPods: number
  egressIsolatedPods: number
  defaultDenyIngress: boolean
  defaultDenyEgress: boolean
}

export interface PostureReport {
  summary: {
    namespaces: number
    policies: number
    pods: number
    ingressIsolatedPods: number
    egressIsolatedPods: number
    score: number
    critical: number
    warnings: number
    info: number
  }
  namespaces: NamespacePosture[]
  findings: Finding[]
}

export interface PodIsolation extends PodInfo {
  ingressPolicies: PolicyRef[]
  egressPolicies: PolicyRef[]
}

export interface ImpactEdge {
  source: string
  target: string
  before: EdgeVerdict
  after: EdgeVerdict
}

export interface ImpactResult {
  selectedWorkloads: string[]
  newlyBlocked: ImpactEdge[]
  newlyAllowed: ImpactEdge[]
  evaluatedPairs: number
  truncated: boolean
}

export interface AuditEntry {
  id: number
  time: string
  user: string
  groups?: string[]
  sourceIP?: string
  action: 'create' | 'update' | 'delete'
  namespace: string
  name: string
  result: 'success' | 'failure'
  error?: string
  before?: string
  after?: string
}

export interface ImportResult {
  namespace: string
  name: string
  action: 'created' | 'updated' | 'unchanged' | 'error'
  error?: string
}

export interface ImportResponse {
  dryRun: boolean
  summary: Partial<Record<ImportResult['action'], number>>
  results: ImportResult[]
}
