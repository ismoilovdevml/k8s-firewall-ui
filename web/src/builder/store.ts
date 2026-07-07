import { create } from 'zustand'
import type { LabelMap, PeerDraft, PortDraft } from '../policy/model'

// The builder canvas models a policy as: one target (spec.podSelector) plus
// peer cards. Each card is one rule with exactly ONE peer — separate cards
// are OR (independent rules), an AND lives inside a single card
// (podsInNamespaces). Splitting a multi-peer rule into one card per peer
// preserves semantics because rules are unioned.

export interface BuilderPeer {
  id: string
  direction: 'ingress' | 'egress'
  peer: PeerDraft
  ports: PortDraft[]
}

export interface BuilderState {
  name: string
  namespace: string
  podSelector: LabelMap
  ingressEnabled: boolean
  egressEnabled: boolean
  peers: BuilderPeer[]
  selectedId: string | null

  set: (patch: Partial<Pick<BuilderState, 'name' | 'namespace' | 'podSelector' | 'ingressEnabled' | 'egressEnabled'>>) => void
  addPeer: (direction: 'ingress' | 'egress') => void
  updatePeer: (id: string, patch: Partial<Pick<BuilderPeer, 'peer' | 'ports'>>) => void
  removePeer: (id: string) => void
  select: (id: string | null) => void
  load: (state: Pick<BuilderState, 'name' | 'namespace' | 'podSelector' | 'ingressEnabled' | 'egressEnabled' | 'peers'>) => void
  reset: (namespace: string) => void
}

let counter = 0
const nextId = () => `peer-${++counter}`

const initial = {
  name: '',
  namespace: '',
  podSelector: {} as LabelMap,
  ingressEnabled: true,
  egressEnabled: false,
  peers: [] as BuilderPeer[],
  selectedId: null as string | null,
}

export const useBuilderStore = create<BuilderState>((set) => ({
  ...initial,

  set: (patch) => set(patch),

  addPeer: (direction) =>
    set((s) => {
      const id = nextId()
      const enable =
        direction === 'ingress' ? { ingressEnabled: true } : { egressEnabled: true }
      return {
        ...enable,
        peers: [
          ...s.peers,
          { id, direction, peer: { kind: 'pods', podSelector: {} }, ports: [] },
        ],
        selectedId: id,
      }
    }),

  updatePeer: (id, patch) =>
    set((s) => ({
      peers: s.peers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),

  removePeer: (id) =>
    set((s) => ({
      peers: s.peers.filter((p) => p.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  select: (id) => set({ selectedId: id }),

  load: (state) => set({ ...state, selectedId: null }),

  reset: (namespace) => set({ ...initial, namespace }),
}))
