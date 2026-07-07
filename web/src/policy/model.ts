// PolicyDraft is the headless form model for the policy editor and (later)
// the visual builder. Converters translate between it and the Kubernetes
// NetworkPolicy JSON shape. Drafts cover the common subset: matchLabels
// selectors, numeric/named ports, ipBlock. Anything else (matchExpressions,
// …) is flagged lossy and edited as YAML.

export type LabelMap = Record<string, string>

export interface PortDraft {
  protocol: 'TCP' | 'UDP' | 'SCTP'
  /** Numeric ("5432") or named ("metrics") port. Empty = all ports. */
  port: string
  endPort?: string
}

export type PeerKind = 'pods' | 'namespaces' | 'podsInNamespaces' | 'ipBlock'

export interface PeerDraft {
  kind: PeerKind
  /** pods / podsInNamespaces: matchLabels of the pod selector ({} = all pods). */
  podSelector?: LabelMap
  /** namespaces / podsInNamespaces: matchLabels of the namespace selector ({} = all namespaces). */
  namespaceSelector?: LabelMap
  cidr?: string
  except?: string[]
}

export interface RuleDraft {
  /** Empty peers = rule matches ALL peers (API semantics). */
  peers: PeerDraft[]
  /** Empty ports = all ports. */
  ports: PortDraft[]
}

export interface PolicyDraft {
  name: string
  namespace: string
  /** matchLabels of spec.podSelector; {} selects every pod in the namespace. */
  podSelector: LabelMap
  ingressEnabled: boolean
  egressEnabled: boolean
  ingress: RuleDraft[]
  egress: RuleDraft[]
}

export function emptyDraft(namespace: string): PolicyDraft {
  return {
    name: '',
    namespace,
    podSelector: {},
    ingressEnabled: true,
    egressEnabled: false,
    ingress: [],
    egress: [],
  }
}

// ---- Draft → NetworkPolicy JSON ----

interface K8sLabelSelector {
  matchLabels?: LabelMap
  matchExpressions?: unknown[]
}

interface K8sPeer {
  podSelector?: K8sLabelSelector
  namespaceSelector?: K8sLabelSelector
  ipBlock?: { cidr: string; except?: string[] }
}

interface K8sPort {
  protocol?: string
  port?: number | string
  endPort?: number
}

interface K8sRule {
  from?: K8sPeer[]
  to?: K8sPeer[]
  ports?: K8sPort[]
}

export interface K8sNetworkPolicy {
  apiVersion: 'networking.k8s.io/v1'
  kind: 'NetworkPolicy'
  metadata: { name: string; namespace: string; resourceVersion?: string }
  spec: {
    podSelector: K8sLabelSelector
    policyTypes: string[]
    ingress?: K8sRule[]
    egress?: K8sRule[]
  }
}

function selectorFrom(labels: LabelMap | undefined): K8sLabelSelector {
  if (!labels || Object.keys(labels).length === 0) return {}
  return { matchLabels: { ...labels } }
}

function peerFrom(draft: PeerDraft): K8sPeer {
  switch (draft.kind) {
    case 'pods':
      return { podSelector: selectorFrom(draft.podSelector) }
    case 'namespaces':
      return { namespaceSelector: selectorFrom(draft.namespaceSelector) }
    case 'podsInNamespaces':
      return {
        podSelector: selectorFrom(draft.podSelector),
        namespaceSelector: selectorFrom(draft.namespaceSelector),
      }
    case 'ipBlock':
      return {
        ipBlock: {
          cidr: draft.cidr ?? '',
          ...(draft.except && draft.except.length > 0 ? { except: draft.except } : {}),
        },
      }
  }
}

function portFrom(draft: PortDraft): K8sPort {
  const out: K8sPort = { protocol: draft.protocol }
  if (draft.port !== '') {
    const numeric = /^\d+$/.test(draft.port)
    out.port = numeric ? Number(draft.port) : draft.port
    if (numeric && draft.endPort && /^\d+$/.test(draft.endPort)) {
      out.endPort = Number(draft.endPort)
    }
  }
  return out
}

function ruleFrom(draft: RuleDraft, direction: 'ingress' | 'egress'): K8sRule {
  const rule: K8sRule = {}
  if (draft.peers.length > 0) {
    rule[direction === 'ingress' ? 'from' : 'to'] = draft.peers.map(peerFrom)
  }
  if (draft.ports.length > 0) {
    rule.ports = draft.ports.map(portFrom)
  }
  return rule
}

/** Converts a draft to NetworkPolicy JSON. policyTypes is always explicit. */
export function draftToPolicy(draft: PolicyDraft): K8sNetworkPolicy {
  const policyTypes: string[] = []
  if (draft.ingressEnabled) policyTypes.push('Ingress')
  if (draft.egressEnabled) policyTypes.push('Egress')

  const spec: K8sNetworkPolicy['spec'] = {
    podSelector: selectorFrom(draft.podSelector),
    policyTypes,
  }
  if (draft.ingressEnabled && draft.ingress.length > 0) {
    spec.ingress = draft.ingress.map((r) => ruleFrom(r, 'ingress'))
  }
  if (draft.egressEnabled && draft.egress.length > 0) {
    spec.egress = draft.egress.map((r) => ruleFrom(r, 'egress'))
  }

  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: draft.name, namespace: draft.namespace },
    spec,
  }
}

// ---- NetworkPolicy JSON → Draft ----

export interface DraftConversion {
  draft: PolicyDraft
  /** Human-readable reasons parts of the policy could not be represented. */
  lossy: string[]
}

function labelsFrom(sel: K8sLabelSelector | undefined, lossy: string[], where: string): LabelMap {
  if (!sel) return {}
  if (sel.matchExpressions && sel.matchExpressions.length > 0) {
    lossy.push(`${where} uses matchExpressions`)
  }
  return { ...(sel.matchLabels ?? {}) }
}

function peerTo(peer: K8sPeer, lossy: string[], where: string): PeerDraft {
  if (peer.ipBlock) {
    return { kind: 'ipBlock', cidr: peer.ipBlock.cidr, except: peer.ipBlock.except ?? [] }
  }
  const hasPod = peer.podSelector !== undefined
  const hasNs = peer.namespaceSelector !== undefined
  if (hasPod && hasNs) {
    return {
      kind: 'podsInNamespaces',
      podSelector: labelsFrom(peer.podSelector, lossy, `${where} podSelector`),
      namespaceSelector: labelsFrom(peer.namespaceSelector, lossy, `${where} namespaceSelector`),
    }
  }
  if (hasNs) {
    return {
      kind: 'namespaces',
      namespaceSelector: labelsFrom(peer.namespaceSelector, lossy, `${where} namespaceSelector`),
    }
  }
  return { kind: 'pods', podSelector: labelsFrom(peer.podSelector, lossy, `${where} podSelector`) }
}

function portTo(port: K8sPort): PortDraft {
  return {
    protocol: (port.protocol ?? 'TCP') as PortDraft['protocol'],
    port: port.port === undefined ? '' : String(port.port),
    ...(port.endPort !== undefined ? { endPort: String(port.endPort) } : {}),
  }
}

function ruleTo(rule: K8sRule, direction: 'ingress' | 'egress', index: number, lossy: string[]): RuleDraft {
  const peers = (direction === 'ingress' ? rule.from : rule.to) ?? []
  const where = `${direction} rule #${index + 1}`
  return {
    peers: peers.map((p) => peerTo(p, lossy, where)),
    ports: (rule.ports ?? []).map(portTo),
  }
}

/** Converts NetworkPolicy JSON to a draft, collecting lossy reasons. */
export function policyToDraft(pol: K8sNetworkPolicy): DraftConversion {
  const lossy: string[] = []
  const types = pol.spec.policyTypes ?? ['Ingress']
  const draft: PolicyDraft = {
    name: pol.metadata.name,
    namespace: pol.metadata.namespace,
    podSelector: labelsFrom(pol.spec.podSelector, lossy, 'spec.podSelector'),
    ingressEnabled: types.includes('Ingress'),
    egressEnabled: types.includes('Egress'),
    ingress: (pol.spec.ingress ?? []).map((r, i) => ruleTo(r, 'ingress', i, lossy)),
    egress: (pol.spec.egress ?? []).map((r, i) => ruleTo(r, 'egress', i, lossy)),
  }
  return { draft, lossy }
}
