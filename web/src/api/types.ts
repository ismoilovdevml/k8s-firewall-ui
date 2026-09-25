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
  restrictReads?: boolean
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

export interface VerdictCounts {
  allowed: number
  blocked: number
  unconstrained: number
}

export interface NamespaceGraphNode {
  namespace: string
  workloads: number
  pods: number
  internal: VerdictCounts
}

export interface NamespaceGraphEdge {
  source: string
  target: string
  counts: VerdictCounts
}

export interface NamespaceTopology {
  level: 'namespace'
  nodes: NamespaceGraphNode[]
  edges: NamespaceGraphEdge[]
}

// ---- access explorer / firewall console ----

export type PeerKind = 'workload' | 'namespace' | 'external'

export interface AccessPeer {
  kind: PeerKind
  namespace?: string
  workload?: string
  cidr?: string
  label?: string
}

export interface AccessRuleMatch {
  policy: PolicyRef
  ruleIndex: number
  explanation: string
}

export interface SideStatus {
  applicable: boolean
  isolated: boolean
  allowed: boolean
  rules?: AccessRuleMatch[]
}

export interface PortStatus {
  name?: string
  protocol: string
  port: number
  allowed: boolean
}

export type AccessVerdict = 'allowed' | 'blocked' | 'unconstrained' | 'partial'

export interface AccessRow {
  peer: AccessPeer
  verdict: AccessVerdict
  egress: SideStatus
  ingress: SideStatus
  ports?: PortStatus[]
  counts?: VerdictCounts
}

export interface AccessSubject {
  namespace: string
  workload?: string
}

export interface AccessReport {
  subject: AccessSubject
  pods: string[]
  ports?: ContainerPort[]
  hostNetwork: boolean
  ingressIsolated: boolean
  egressIsolated: boolean
  ingressPolicies: PolicyRef[]
  egressPolicies: PolicyRef[]
  inbound: AccessRow[]
  outbound: AccessRow[]
  workloads?: string[]
}

export type FlowDirection = 'inbound' | 'outbound'

export interface PlanRequest {
  subject: AccessSubject
  direction: FlowDirection
  peer: AccessPeer
  action: 'allow' | 'block'
  ports?: { protocol: string; port: number }[]
  keepExternal: boolean
}

export interface PlannedChange {
  operation: 'create' | 'update'
  namespace: string
  name: string
  reason: string
  before: string
  after: string
}

export interface AccessPlan {
  changes: PlannedChange[]
  blockers: { policy: PolicyRef; ruleIndex: number; explanation: string }[]
  notes: string[]
  alreadyDone: boolean
  verified: boolean
  impact: ImpactResult
  signature: string
}

export interface ApplyResponse {
  plan: AccessPlan
  results: { namespace: string; name: string; operation: string; error?: string }[]
}
