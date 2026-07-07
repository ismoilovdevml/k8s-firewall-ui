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
