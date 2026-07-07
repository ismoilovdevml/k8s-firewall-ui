# k8s-firewall-ui

Open-source Kubernetes NetworkPolicy management dashboard: live topology viewer, policy CRUD, connection simulator, drag-and-drop visual builder. Go backend (single binary) + React SPA. Apache-2.0. All code, docs, UI text, and commit messages in **English**.

## Commands

```bash
make build      # full production build (frontend → web/dist, then Go binary with embedded UI)
make backend    # Go binary only (embeds whatever is in web/dist)
make run        # build + run against current kubeconfig, serves on :8080
make dev        # backend only via go run; run frontend separately:
cd web && npm run dev   # Vite on :5173, /api proxied to :8080
make test       # go test ./... -race -cover
make test-web   # cd web && npm test -- --run  (vitest)
make lint       # golangci-lint run
make lint-web   # cd web && npm run lint
```

## Architecture

```
Browser (React SPA) ── REST /api/v1 + SSE /api/v1/events ──▶ Go binary (:8080)
```

| Package | Responsibility |
|---|---|
| `cmd/k8s-firewall-ui` | flags, wiring, HTTP server |
| `web/embed.go` | `//go:embed all:dist` — SPA assets (dist/.gitkeep committed so `go build` works without npm) |
| `internal/kube` | client-go setup, SharedInformerFactory (pods/namespaces/services/networkpolicies), `Snapshot()` |
| `internal/api` | chi router, REST handlers, SSE hub (debounced invalidate events), dry-run apply |
| `internal/simulator` | **pure** policy evaluation engine over `ClusterSnapshot` — MUST NOT import client-go or make API calls |
| `internal/cni` | heuristic CNI detection (kube-system DaemonSets + CRD discovery), `--cni-override` escape hatch |

Frontend (`web/src/`): `api/` (fetch client, query keys, sse), `pages/` (Topology, Policies, PolicyDetail, Simulator, Builder), `components/`, `hooks/useSSEInvalidation.ts`. State: TanStack Query + SSE invalidation; zustand only for the builder canvas.

## Conventions

- API routes under `/api/v1`; errors as `{"error": {"code": "...", "message": "..."}}`.
- Kubernetes types come from `k8s.io/api/networking/v1` etc. — never hand-rolled structs for k8s objects.
- YAML via `sigs.k8s.io/yaml` (no comment preservation — documented limitation).
- Kubeconfig resolution order: `--kubeconfig` flag → `KUBECONFIG` env → in-cluster → `~/.kube/config`.
- **Simulator changes require table-driven tests** (`internal/simulator/engine_test.go`, fixtures in `testdata/`). The simulator is the correctness core of this project.
- Browser gets coarse SSE invalidation events only; all Kubernetes watching stays server-side in informers.
- No new frontend state-management libraries.

## NetworkPolicy semantics cheat-sheet

Full reference: `docs/research/network-policy-semantics.md`. The rules below are the top sources of bugs — do not re-derive them from memory:

1. **Additive/union, allow-only.** Policies never deny or conflict; no priority. "Deny" = isolate (default-deny) + allow narrowly.
2. **Isolation is per-direction, opt-in.** A pod is wide-open until some policy selects it for that direction (per `policyTypes`); then that direction is default-deny.
3. **Connection allowed ⟺ source egress check AND destination ingress check** both pass. Report which side denies.
4. **Peer AND/OR:** `podSelector` + `namespaceSelector` in the *same* `from`/`to` element = AND; *separate* elements = OR. Bare `podSelector` = policy's own namespace only; `namespaceSelector: {}` = all namespaces.
5. **`from: []` matches no peers (deny); omitted `from` matches all peers.** Similarly `ingress: [{}]` = allow-all vs `ingress: []` = deny-all. Never conflate absent and empty.
6. `policyTypes` defaults are surprising — always set explicitly when generating policies.
7. Warnings the simulator must emit: hostNetwork pods (selectors don't match them; behavior undefined), node-local traffic always allowed, DNS egress trap (egress isolation without a :53 allow breaks DNS).
8. flannel (alone) does NOT enforce NetworkPolicy — API accepts objects silently. Surface CNI warnings app-wide.
9. ANP/BANP/ClusterNetworkPolicy (`policy.networking.k8s.io`) are alpha: detect + banner only, never evaluated in v0.1.
