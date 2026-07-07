import { describe, expect, it } from 'vitest'
import { builderToDraft, draftToBuilder } from './convert'
import { draftToPolicy, policyToDraft } from '../policy/model'
import type { PolicyDraft } from '../policy/model'
import type { BuilderPeer } from './store'

const card = (
  direction: 'ingress' | 'egress',
  peer: BuilderPeer['peer'],
  ports: BuilderPeer['ports'] = [],
  id = 'p1',
): BuilderPeer => ({ id, direction, peer, ports })

describe('builderToDraft', () => {
  it('turns each card into a single-peer rule', () => {
    const draft = builderToDraft({
      name: 'x',
      namespace: 'demo',
      podSelector: { app: 'db' },
      ingressEnabled: true,
      egressEnabled: false,
      peers: [
        card('ingress', { kind: 'pods', podSelector: { app: 'web' } }, [{ protocol: 'TCP', port: '80' }], 'a'),
        card('ingress', { kind: 'namespaces', namespaceSelector: { team: 'x' } }, [], 'b'),
      ],
    })
    expect(draft.ingress).toHaveLength(2)
    expect(draft.ingress[0].peers).toHaveLength(1)
    expect(draft.egress).toHaveLength(0)
  })
})

describe('draftToBuilder', () => {
  it('splits multi-peer rules into one card per peer (union-safe)', () => {
    const draft: PolicyDraft = {
      name: 'x',
      namespace: 'demo',
      podSelector: {},
      ingressEnabled: true,
      egressEnabled: false,
      ingress: [
        {
          peers: [
            { kind: 'pods', podSelector: { a: '1' } },
            { kind: 'ipBlock', cidr: '10.0.0.0/8', except: [] },
          ],
          ports: [{ protocol: 'TCP', port: '80' }],
        },
      ],
      egress: [],
    }
    const { state, lossy } = draftToBuilder(draft)
    expect(lossy).toEqual([])
    expect(state.peers).toHaveLength(2)
    // both cards inherit the rule's ports
    expect(state.peers[0].ports).toEqual(draft.ingress[0].ports)
    expect(state.peers[1].ports).toEqual(draft.ingress[0].ports)
  })

  it('flags peerless rules (allow-anywhere) as lossy', () => {
    const draft: PolicyDraft = {
      name: 'x',
      namespace: 'demo',
      podSelector: {},
      ingressEnabled: true,
      egressEnabled: false,
      ingress: [{ peers: [], ports: [] }],
      egress: [],
    }
    const { lossy } = draftToBuilder(draft)
    expect(lossy).toHaveLength(1)
  })

  it('round-trips builder → draft → builder stably', () => {
    const original = {
      name: 'rt',
      namespace: 'demo',
      podSelector: { app: 'db' },
      ingressEnabled: true,
      egressEnabled: true,
      peers: [
        card('ingress', { kind: 'podsInNamespaces', podSelector: { app: 'web' }, namespaceSelector: { t: 'a' } }, [{ protocol: 'TCP', port: '5432' }], 'a'),
        card('egress', { kind: 'ipBlock', cidr: '0.0.0.0/0', except: ['169.254.0.0/16'] }, [], 'b'),
      ],
    }
    const { state: back, lossy } = draftToBuilder(builderToDraft(original))
    expect(lossy).toEqual([])
    const strip = (peers: BuilderPeer[]) => peers.map(({ direction, peer, ports }) => ({ direction, peer, ports }))
    expect(strip(back.peers)).toEqual(strip(original.peers))
    expect(back.podSelector).toEqual(original.podSelector)
  })

  it('survives the full chain: builder → draft → k8s json → draft → builder', () => {
    const original = {
      name: 'chain',
      namespace: 'demo',
      podSelector: { app: 'db' },
      ingressEnabled: true,
      egressEnabled: false,
      peers: [
        card('ingress', { kind: 'pods', podSelector: { app: 'web' } }, [{ protocol: 'TCP', port: '80' }], 'a'),
      ],
    }
    const json = draftToPolicy(builderToDraft(original))
    const { draft, lossy: l1 } = policyToDraft(json)
    const { state: back, lossy: l2 } = draftToBuilder(draft)
    expect([...l1, ...l2]).toEqual([])
    expect(back.peers[0].peer).toEqual(original.peers[0].peer)
    expect(back.peers[0].ports).toEqual(original.peers[0].ports)
  })
})
