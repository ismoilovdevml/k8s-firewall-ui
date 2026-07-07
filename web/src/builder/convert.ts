import type { PolicyDraft } from '../policy/model'
import type { BuilderPeer, BuilderState } from './store'

type BuilderSnapshot = Pick<
  BuilderState,
  'name' | 'namespace' | 'podSelector' | 'ingressEnabled' | 'egressEnabled' | 'peers'
>

/** Builder canvas → PolicyDraft. Each peer card becomes one single-peer rule. */
export function builderToDraft(state: BuilderSnapshot): PolicyDraft {
  const ruleOf = (p: BuilderPeer) => ({ peers: [p.peer], ports: p.ports })
  return {
    name: state.name,
    namespace: state.namespace,
    podSelector: state.podSelector,
    ingressEnabled: state.ingressEnabled,
    egressEnabled: state.egressEnabled,
    ingress: state.peers.filter((p) => p.direction === 'ingress').map(ruleOf),
    egress: state.peers.filter((p) => p.direction === 'egress').map(ruleOf),
  }
}

export interface BuilderConversion {
  state: BuilderSnapshot
  /** Reasons the canvas is not a faithful representation (edit YAML instead). */
  lossy: string[]
}

/**
 * PolicyDraft → builder canvas. Multi-peer rules are split into one card per
 * peer — semantically identical (rules are unioned) but structurally
 * different, so no lossy flag. A rule with NO peers (allow-from-anywhere)
 * cannot be drawn as a peer card and is flagged lossy.
 */
export function draftToBuilder(draft: PolicyDraft): BuilderConversion {
  const lossy: string[] = []
  const peers: BuilderPeer[] = []
  let counter = 0

  for (const direction of ['ingress', 'egress'] as const) {
    draft[direction].forEach((rule, i) => {
      if (rule.peers.length === 0) {
        lossy.push(`${direction} rule #${i + 1} allows traffic from/to anywhere (no peers) — not representable on the canvas`)
        return
      }
      for (const peer of rule.peers) {
        peers.push({
          id: `loaded-${++counter}`,
          direction,
          peer,
          ports: rule.ports,
        })
      }
    })
  }

  return {
    state: {
      name: draft.name,
      namespace: draft.namespace,
      podSelector: draft.podSelector,
      ingressEnabled: draft.ingressEnabled,
      egressEnabled: draft.egressEnabled,
      peers,
    },
    lossy,
  }
}
