# k8s-firewall-ui

**A visual firewall dashboard for Kubernetes NetworkPolicies** — view, create, edit, simulate, and manage network policies on a live cluster.

> No open-source tool today combines a live-cluster view, a visual policy builder, apply/CRUD, and connection simulation. k8s-firewall-ui fills that gap: it is CNI-agnostic, self-hosted, and Apache-2.0 licensed.

## Features

- 🗺️ **Topology viewer** — live graph of namespaces and workloads with policy-derived edges (allowed / blocked / unconstrained)
- ✏️ **Policy management** — list, inspect, create, edit (YAML + form), and delete NetworkPolicies with server-side dry-run validation
- 🧪 **Connection simulator** — "can pod A reach pod B on port 5432?" answered with a full explanation of which policy and rule allowed or denied each side
- 🧱 **Visual builder** — drag-and-drop policy authoring with a live YAML preview
- 🚨 **CNI awareness** — detects your CNI and warns loudly when NetworkPolicies are not enforced (e.g. plain flannel)
- ⚠️ **Built-in guardrails** — warnings for the DNS egress trap, hostNetwork pods, and other well-known NetworkPolicy footguns

## Status

Early development (v0.1 in progress).

| Milestone | Status |
|---|---|
| M0 Scaffold | 🚧 |
| M1 Topology viewer | ⬜ |
| M2 Policy CRUD | ⬜ |
| M3 Connection simulator | ⬜ |
| M4 Visual builder | ⬜ |
| M5 Docker / Helm / CI | ⬜ |

## Quickstart (local mode)

Runs a single binary on your machine against your current kubeconfig:

```bash
git clone https://github.com/ismoilovdevml/k8s-firewall-ui.git
cd k8s-firewall-ui
make run
# open http://localhost:8080
```

Requirements: Go 1.26+, Node 22+, a kubeconfig pointing at a cluster.

## Development

```bash
make dev              # backend on :8080
cd web && npm run dev # frontend on :5173, /api proxied to :8080
```

See [CLAUDE.md](CLAUDE.md) for architecture and conventions, and [docs/research/](docs/research/) for the NetworkPolicy semantics reference this project is built on.

## License

[Apache-2.0](LICENSE)
