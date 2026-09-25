# Architecture

```
Browser (React SPA) ── REST /api/v1 + SSE /api/v1/events ──▶ Go binary (:8080)
  ├── web/embed.go          //go:embed all:dist — SPA assets
  ├── internal/kube         client-go, SharedInformerFactory (pods/ns/svc/netpol), Snapshot()
  ├── internal/api          chi router, REST handlers, SSE hub, dry-run apply, metrics, middleware
  ├── internal/auth         none/token/proxy auth, encrypted sessions, per-user clients for writes
  ├── internal/audit        mutation audit (structured log + in-memory ring)
  ├── internal/simulator    pure evaluation engine over ClusterSnapshot (no client-go):
  │                         Evaluate, EvaluateEdge, Impact (what-if), Analyze (posture)
  └── internal/cni          heuristic CNI detection
        ▼
  Kubernetes API (kubeconfig locally, in-cluster ServiceAccount otherwise)
```

Principles:
- The **simulator is a pure function** over an in-memory snapshot — table-testable, single source of truth for policy semantics. The frontend never re-implements semantics.
- All Kubernetes watching stays server-side in SharedInformers. The browser receives coarse SSE invalidation events (`{"resource": "networkpolicies"}`) and refetches via TanStack Query.
- Server-side dry-run (`DryRun: ["All"]`) validates every create/update before real apply.
- Reads are served from the shared informer cache; **writes always use the requesting user's identity** (bearer token or impersonation) outside `--auth-mode=none`, so Kubernetes RBAC is the single source of authorization.

## API surface (v0.1)

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz`, `/readyz` | liveness / informer-cache-sync readiness |
| GET | `/api/v1/cluster-info` | k8s version, CNI detection, ANP CRD presence, warnings |
| GET | `/api/v1/namespaces` | names, labels, pod/policy counts |
| GET | `/api/v1/namespaces/{ns}/pods` | pod list with labels, IP, ports, hostNetwork, owner |
| GET | `/api/v1/pods?labelSelector=&namespace=` | cross-namespace pod query |
| GET | `/api/v1/networkpolicies?namespace=` | policy list + computed summary |
| GET | `/api/v1/namespaces/{ns}/networkpolicies/{name}` | detail: JSON + YAML + affected pods |
| POST | `/api/v1/namespaces/{ns}/networkpolicies?dryRun=` | create |
| PUT | `/api/v1/namespaces/{ns}/networkpolicies/{name}?dryRun=` | update (resourceVersion conflict → 409) |
| DELETE | `/api/v1/namespaces/{ns}/networkpolicies/{name}` | delete |
| POST | `/api/v1/simulate` | connection simulator |
| GET | `/api/v1/topology?namespaces=a,b` | graph model (nodes: namespaces/workloads, edges: verdicts) |
| GET | `/api/v1/events` | SSE stream |

The full, current endpoint list (auth, posture, impact, audit, import/export) lives in [api.md](api.md).
