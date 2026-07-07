// Human-readable rendering of policy rules for the Overview tab.
import type { LabelMap, PeerDraft, PolicyDraft, PortDraft, RuleDraft } from './model'

export function labelsText(labels: LabelMap | undefined, empty: string): string {
  if (!labels || Object.keys(labels).length === 0) return empty
  return Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

export function peerText(peer: PeerDraft): string {
  switch (peer.kind) {
    case 'pods':
      return `pods [${labelsText(peer.podSelector, 'all')}] in this namespace`
    case 'namespaces':
      return `all pods in namespaces [${labelsText(peer.namespaceSelector, 'all')}]`
    case 'podsInNamespaces':
      return `pods [${labelsText(peer.podSelector, 'all')}] in namespaces [${labelsText(peer.namespaceSelector, 'all')}]`
    case 'ipBlock': {
      const except = peer.except?.length ? ` except ${peer.except.join(', ')}` : ''
      return `IP range ${peer.cidr}${except}`
    }
  }
}

export function portText(port: PortDraft): string {
  if (port.port === '') return `any ${port.protocol} port`
  const range = port.endPort ? `–${port.endPort}` : ''
  return `${port.port}${range}/${port.protocol}`
}

export function ruleText(rule: RuleDraft, direction: 'ingress' | 'egress'): string {
  const who =
    rule.peers.length === 0 ? 'anywhere' : rule.peers.map(peerText).join(', or ')
  const ports =
    rule.ports.length === 0 ? 'on all ports' : `on ${rule.ports.map(portText).join(', ')}`
  return direction === 'ingress' ? `Allow from ${who} ${ports}` : `Allow to ${who} ${ports}`
}

export function isolationText(draft: PolicyDraft): string[] {
  const target = `pods [${labelsText(draft.podSelector, 'all')}]`
  const lines: string[] = []
  if (draft.ingressEnabled) {
    lines.push(
      draft.ingress.length === 0
        ? `${target}: all incoming traffic denied`
        : `${target}: incoming traffic denied unless a rule below allows it`,
    )
  }
  if (draft.egressEnabled) {
    lines.push(
      draft.egress.length === 0
        ? `${target}: all outgoing traffic denied`
        : `${target}: outgoing traffic denied unless a rule below allows it`,
    )
  }
  return lines
}
