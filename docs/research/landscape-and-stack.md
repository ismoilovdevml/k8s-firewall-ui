# Competitive Landscape & Tech Stack Decisions

> Research snapshot: July 2026. Records why this project exists and why the stack was chosen.

## 1. The gap this project fills

No open-source tool combines all four of: (1) live-cluster read of existing policies, (2) visual/interactive builder, (3) apply/edit against the API server, (4) simulation/preview. That combination exists only in **commercial Calico Enterprise/Cloud** (Tigera Policy Board: stage + preview policy behavior — proprietary, Calico-specific).

| Tool | Live cluster | NetPol CRUD | Visual builder | Simulation | Notes |
|---|---|---|---|---|---|
| editor.networkpolicy.io (Cilium) | ❌ | ❌ (YAML export) | ✅ | score only | offline authoring; no cluster connection |
| Cilium Hubble UI | ✅ | ❌ read-only | service map | ❌ (observes real verdicts) | requires Cilium; observability, not management |
| Tigera Calico Cloud/Enterprise | ✅ | ✅ commercial | ✅ | ✅ | proprietary; free tier view-only |
| Headlamp (CNCF) | ✅ | generic CRUD | ❌ | ❌ | general-purpose; JS plugin system; no netpol builder ships |
| Otterize network-mapper | ✅ | generates | traffic graph | ❌ | intents → auto-generated policies |
| Kubescape | ✅ | generates | ❌ | ❌ | eBPF capture → GeneratedNetworkPolicy CRD |
| Skooner / K8s Dashboard | ✅ | generic | ❌ | ❌ | no netpol specialization |
| infnada/k8s-network-policy-visualizer, glothriel/npviz, artturik/network-policy-viewer | partial | ❌ | viz only | ❌ | small read-only visualizers |

**Positioning:** CNI-agnostic, live-cluster, visual builder + simulator, fully OSS. Lead with simulation/preview and live CRUD.

Watch item: Headlamp's 2025 work reportedly improved its NetworkPolicy UI — re-check before major releases.

## 2. Stack decisions

### Backend: Go + client-go (single binary)
- The de facto standard for k8s dashboards: Headlamp, ArgoCD, k9s, Radar are all Go.
- client-go is the reference client: informers, listers, typed `networking.k8s.io/v1` objects, `SelfSubjectAccessReview`, dynamic client for CRD discovery.
- `embed.FS` embeds the built Vite frontend → one static binary, one image.
- **SharedInformers server-side; SSE to the browser** for coarse invalidation events (Radar pattern). WebSocket reserved for future genuinely-bidirectional needs.

### Frontend: React + TypeScript + Vite; React Flow for graphs
- **React Flow (xyflow, MIT)** — chosen because the app is *authoring-heavy* (drag/edit nodes); custom React nodes, viewport-only rendering.
- Cytoscape.js reserved as a future option for a very large read-only topology view; D3 rejected (too low-level).
- TanStack Query + SSE invalidation for server state; zustand only for builder canvas; CodeMirror 6 for YAML (bundle size vs Monaco); Tailwind CSS v4; dagre for auto-layout.

### Auth (Headlamp model)
- In-cluster: ServiceAccount + minimal ClusterRole; token auto-mounted.
- Local mode: kubeconfig (`--kubeconfig` → `KUBECONFIG` → in-cluster → `~/.kube/config`).
- Later: bearer-token login acting with the user's RBAC + `SelfSubjectAccessReview` UI gating; optional OIDC (pass the user's id_token through — a static SA token defeats per-user RBAC, see Headlamp #3441).
- `--read-only` flag + Helm `readOnly` value for safe evaluation deployments.

### Distribution & license
- Multi-arch Docker image (distroless), Helm chart, `kubectl port-forward` quickstart, plain binaries via GoReleaser later.
- **Apache-2.0** — CNCF norm (explicit patent grant); React Flow's MIT is compatible.

## 3. Reference URLs

- https://editor.networkpolicy.io/ · https://cilium.io/blog/2021/02/10/network-policy-editor/
- https://docs.cilium.io/en/stable/observability/hubble/hubble-ui/
- https://www.tigera.io/tigera-products/calico-commercial-editions/
- https://headlamp.dev/docs/latest/development/plugins/ · https://github.com/kubernetes-sigs/headlamp/issues/3441
- https://github.com/otterize/network-mapper · https://kubescape.io/docs/operator/network-policy-generation/
- https://reactflow.dev · https://github.com/xyflow/xyflow
- https://www.cncf.io/blog/2017/02/01/cncf-recommends-aslv2/
