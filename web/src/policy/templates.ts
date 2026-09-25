import type { PeerDraft, PolicyDraft, PortDraft } from './model'

// Starting points for the most common NetworkPolicy patterns. Each one
// produces an ordinary draft that stays fully editable in the form, and
// always sets policyTypes explicitly (via draftToPolicy).

export interface PolicyTemplate {
  id: string
  title: string
  description: string
  /** Shown as a caution on the template card. */
  caution?: string
  build: (namespace: string) => PolicyDraft
}

const DNS_PEER: PeerDraft = {
  kind: 'podsInNamespaces',
  namespaceSelector: { 'kubernetes.io/metadata.name': 'kube-system' },
  podSelector: { 'k8s-app': 'kube-dns' },
}

const DNS_PORTS: PortDraft[] = [
  { protocol: 'UDP', port: '53' },
  { protocol: 'TCP', port: '53' },
]

const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']

function base(namespace: string, name: string): PolicyDraft {
  return {
    name,
    namespace,
    podSelector: {},
    ingressEnabled: false,
    egressEnabled: false,
    ingress: [],
    egress: [],
  }
}

export const TEMPLATES: PolicyTemplate[] = [
  {
    id: 'default-deny-ingress',
    title: 'Default deny ingress',
    description: 'Isolates every pod in the namespace for inbound traffic. Add allow policies next to it.',
    caution: 'All inbound traffic to the namespace stops until you allow it explicitly.',
    build: (ns) => ({ ...base(ns, 'default-deny-ingress'), ingressEnabled: true }),
  },
  {
    id: 'default-deny-all',
    title: 'Default deny all (keeps DNS)',
    description:
      'Zero-trust baseline: isolates all pods in both directions and allows only DNS lookups to kube-dns.',
    caution: 'All traffic except DNS stops until you allow it explicitly.',
    build: (ns) => ({
      ...base(ns, 'default-deny-all'),
      ingressEnabled: true,
      egressEnabled: true,
      egress: [{ peers: [DNS_PEER], ports: DNS_PORTS }],
    }),
  },
  {
    id: 'default-deny-egress',
    title: 'Default deny egress (keeps DNS)',
    description: 'Blocks outbound traffic from every pod except DNS — avoids the classic "egress deny broke DNS" trap.',
    build: (ns) => ({
      ...base(ns, 'default-deny-egress'),
      egressEnabled: true,
      egress: [{ peers: [DNS_PEER], ports: DNS_PORTS }],
    }),
  },
  {
    id: 'allow-dns',
    title: 'Allow DNS egress',
    description: 'Lets every pod in the namespace resolve names through kube-dns (UDP/TCP 53).',
    build: (ns) => ({
      ...base(ns, 'allow-dns-egress'),
      egressEnabled: true,
      egress: [{ peers: [DNS_PEER], ports: DNS_PORTS }],
    }),
  },
  {
    id: 'allow-same-namespace',
    title: 'Allow traffic within the namespace',
    description: 'Pods in the namespace may talk to each other; everything from outside stays blocked.',
    build: (ns) => ({
      ...base(ns, 'allow-same-namespace'),
      ingressEnabled: true,
      ingress: [{ peers: [{ kind: 'pods', podSelector: {} }], ports: [] }],
    }),
  },
  {
    id: 'allow-ingress-controller',
    title: 'Allow from ingress controller',
    description: 'Admits HTTP(S) traffic from the ingress-nginx controller to pods labeled app=web. Adjust labels to your setup.',
    build: (ns) => ({
      ...base(ns, 'allow-from-ingress-controller'),
      podSelector: { app: 'web' },
      ingressEnabled: true,
      ingress: [
        {
          peers: [
            {
              kind: 'podsInNamespaces',
              namespaceSelector: { 'kubernetes.io/metadata.name': 'ingress-nginx' },
              podSelector: { 'app.kubernetes.io/name': 'ingress-nginx' },
            },
          ],
          ports: [{ protocol: 'TCP', port: '8080' }],
        },
      ],
    }),
  },
  {
    id: 'allow-monitoring',
    title: 'Allow Prometheus scraping',
    description: 'Admits scrapes from Prometheus in the monitoring namespace on the "metrics" named port.',
    build: (ns) => ({
      ...base(ns, 'allow-prometheus-scrape'),
      ingressEnabled: true,
      ingress: [
        {
          peers: [
            {
              kind: 'podsInNamespaces',
              namespaceSelector: { 'kubernetes.io/metadata.name': 'monitoring' },
              podSelector: { 'app.kubernetes.io/name': 'prometheus' },
            },
          ],
          ports: [{ protocol: 'TCP', port: 'metrics' }],
        },
      ],
    }),
  },
  {
    id: 'allow-internet-https',
    title: 'Allow HTTPS to the internet',
    description: 'Lets pods labeled app=web call external HTTPS endpoints while private networks stay blocked.',
    build: (ns) => ({
      ...base(ns, 'allow-internet-https'),
      podSelector: { app: 'web' },
      egressEnabled: true,
      egress: [
        {
          peers: [{ kind: 'ipBlock', cidr: '0.0.0.0/0', except: PRIVATE_RANGES }],
          ports: [{ protocol: 'TCP', port: '443' }],
        },
      ],
    }),
  },
]

export function findTemplate(id: string | null): PolicyTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
