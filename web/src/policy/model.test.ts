import { describe, expect, it } from 'vitest'
import { draftToPolicy, emptyDraft, policyToDraft } from './model'
import type { K8sNetworkPolicy, PolicyDraft } from './model'

describe('draftToPolicy', () => {
  it('always sets policyTypes explicitly', () => {
    const draft = emptyDraft('demo')
    draft.name = 'deny-all'
    const pol = draftToPolicy(draft)
    expect(pol.spec.policyTypes).toEqual(['Ingress'])
    expect(pol.spec.ingress).toBeUndefined()
  })

  it('builds an AND peer (podsInNamespaces) as a single peer element', () => {
    const draft: PolicyDraft = {
      ...emptyDraft('demo'),
      name: 'allow-web',
      podSelector: { app: 'db' },
      ingress: [
        {
          peers: [
            {
              kind: 'podsInNamespaces',
              podSelector: { app: 'web' },
              namespaceSelector: { team: 'alpha' },
            },
          ],
          ports: [{ protocol: 'TCP', port: '5432' }],
        },
      ],
    }
    const pol = draftToPolicy(draft)
    expect(pol.spec.ingress).toHaveLength(1)
    const peer = pol.spec.ingress![0].from![0]
    expect(peer.podSelector).toEqual({ matchLabels: { app: 'web' } })
    expect(peer.namespaceSelector).toEqual({ matchLabels: { team: 'alpha' } })
  })

  it('keeps named ports as strings and numeric ports as numbers', () => {
    const draft = emptyDraft('demo')
    draft.name = 'ports'
    draft.ingress = [
      {
        peers: [],
        ports: [
          { protocol: 'TCP', port: 'metrics' },
          { protocol: 'UDP', port: '53' },
          { protocol: 'TCP', port: '8000', endPort: '8080' },
        ],
      },
    ]
    const ports = draftToPolicy(draft).spec.ingress![0].ports!
    expect(ports[0].port).toBe('metrics')
    expect(ports[1].port).toBe(53)
    expect(ports[2]).toMatchObject({ port: 8000, endPort: 8080 })
  })

  it('empty selectors become {} (all pods / all namespaces)', () => {
    const draft = emptyDraft('demo')
    draft.name = 'x'
    draft.ingress = [{ peers: [{ kind: 'namespaces', namespaceSelector: {} }], ports: [] }]
    const pol = draftToPolicy(draft)
    expect(pol.spec.podSelector).toEqual({})
    expect(pol.spec.ingress![0].from![0].namespaceSelector).toEqual({})
  })
})

describe('policyToDraft', () => {
  it('round-trips a supported policy without loss', () => {
    const draft: PolicyDraft = {
      ...emptyDraft('demo'),
      name: 'rt',
      podSelector: { app: 'db' },
      egressEnabled: true,
      ingress: [
        {
          peers: [
            { kind: 'podsInNamespaces', podSelector: { app: 'web' }, namespaceSelector: { t: 'a' } },
            { kind: 'ipBlock', cidr: '10.0.0.0/8', except: ['10.1.0.0/16'] },
          ],
          ports: [{ protocol: 'TCP', port: '80' }],
        },
      ],
      egress: [{ peers: [{ kind: 'pods', podSelector: { app: 'cache' } }], ports: [] }],
    }
    const { draft: back, lossy } = policyToDraft(draftToPolicy(draft))
    expect(lossy).toEqual([])
    expect(back).toEqual(draft)
  })

  it('flags matchExpressions as lossy', () => {
    const pol: K8sNetworkPolicy = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name: 'x', namespace: 'demo' },
      spec: {
        podSelector: {
          matchExpressions: [{ key: 'app', operator: 'In', values: ['a', 'b'] }],
        },
        policyTypes: ['Ingress'],
      },
    }
    const { lossy } = policyToDraft(pol)
    expect(lossy).toContain('spec.podSelector uses matchExpressions')
  })

  it('defaults missing policyTypes to Ingress (API default mirror)', () => {
    const pol = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name: 'x', namespace: 'demo' },
      spec: { podSelector: {} },
    } as unknown as K8sNetworkPolicy
    const { draft } = policyToDraft(pol)
    expect(draft.ingressEnabled).toBe(true)
    expect(draft.egressEnabled).toBe(false)
  })
})
