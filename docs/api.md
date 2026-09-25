# API Reference

All endpoints are served by the single binary under `/api/v1`. Errors use the shape `{"error": {"code": "...", "message": "..."}}` with an appropriate HTTP status.

Every non-GET request under `/api/v1` must carry an `X-Requested-With` header (any value). Requests without it get 403 `CSRF_HEADER_MISSING`. In `token`/`proxy` auth modes, all endpoints except `/auth/me`, `/auth/login` and `/auth/logout` return 401 `UNAUTHENTICATED` without a session.

## Health & metrics

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | liveness |
| GET | `/readyz` | 503 until informer caches sync |
| GET | `/metrics` | Prometheus metrics (disable with `--metrics=false`) |

## Authentication

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/auth/me` | `{mode, user}`; `user` is `null` when signed out |
| POST | `/api/v1/auth/login` | token mode: `{"token": "..."}` → validates via SelfSubjectReview, sets the session cookie. 401 `INVALID_TOKEN`, 429 `RATE_LIMITED` |
| POST | `/api/v1/auth/logout` | clears the session cookie |
| GET | `/api/v1/auth/permissions?namespace=` | `{create, update, delete, readOnly}` for NetworkPolicies in the namespace, as the current user |

## Cluster

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/cluster-info` | app version, Kubernetes version, CNI detection result (provider, enforcesPolicies, evidence, warnings, anpPresent) |
| GET | `/api/v1/namespaces` | namespaces with labels, pod count, policy count |
| GET | `/api/v1/namespaces/{ns}/pods` | pods with labels, IP, node, hostNetwork, owner workload, container ports |
| GET | `/api/v1/pods?namespace=&labelSelector=` | cross-namespace pod query |

## NetworkPolicies

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/networkpolicies?namespace=` | summaries (policyTypes, pods matched, created) |
| GET | `/api/v1/namespaces/{ns}/networkpolicies/{name}` | `{policy, yaml, affectedPods}` |
| POST | `/api/v1/namespaces/{ns}/networkpolicies?dryRun=true` | create (YAML or JSON body; strict decoding rejects unknown fields) |
| PUT | `/api/v1/namespaces/{ns}/networkpolicies/{name}?dryRun=true` | update; `metadata.resourceVersion` REQUIRED — stale versions return 409 |
| DELETE | `/api/v1/namespaces/{ns}/networkpolicies/{name}` | delete |

| GET | `/api/v1/networkpolicies/export?namespace=` | multi-document YAML download with server fields stripped (re-appliable) |
| POST | `/api/v1/networkpolicies/import?namespace=&dryRun=true` | body: multi-document YAML/JSON (or a List). Creates or updates each policy; `?namespace=` fills in documents without one. Response: `{dryRun, summary, results: [{namespace, name, action: created\|updated\|unchanged\|error, error}]}`. Max 5 MiB / 500 policies |

Writes are performed with the **current user's** credentials in `token`/`proxy` mode, so Kubernetes RBAC errors come back unchanged (403 `Forbidden`). Every non-dry-run write is audited.

`?dryRun=true` performs a server-side dry-run (`DryRun: All`) — full API-server validation without persisting. Write endpoints return 403 with code `READ_ONLY` when the binary runs with `--read-only`.

## Simulation

`POST /api/v1/simulate`

```json
{
  "source":      {"kind": "pod", "namespace": "a", "name": "web-1"},
  "destination": {"kind": "pod", "namespace": "b", "name": "db-1"},
  "port":        {"protocol": "TCP", "port": 5432}
}
```

`destination` may also be `{"kind": "ip", "ip": "203.0.113.7"}` (egress-only check). Omit `port` for an any-port query.

Response:

```json
{
  "allowed": true,
  "egress":  {"applicable": true, "isolated": false, "allowed": true, "matchedRules": [], "evaluatedPolicies": []},
  "ingress": {"applicable": true, "isolated": true,  "allowed": true,
              "matchedRules": [{"policy": {"namespace": "b", "name": "allow-web"}, "ruleIndex": 0,
                                "explanation": "NetworkPolicy b/allow-web ingress rule #1 allows traffic from …"}],
              "evaluatedPolicies": [{"namespace": "b", "name": "allow-web"}]},
  "warnings": [{"code": "DNS_EGRESS_BLOCKED", "severity": "warning", "message": "…"}]
}
```

Warning codes: `HOSTNETWORK_UNDEFINED`, `NODE_LOCAL_TRAFFIC`, `DNS_EGRESS_BLOCKED`, `CNI_NOT_ENFORCING`, `ANP_NOT_EVALUATED`.

## Impact preview

`POST /api/v1/impact`

```json
{"operation": "apply", "namespace": "shop", "yaml": "kind: NetworkPolicy\n…"}
{"operation": "apply", "namespace": "shop", "policy": { …NetworkPolicy JSON… }}
{"operation": "delete", "namespace": "shop", "name": "default-deny-all"}
```

Response: `{selectedWorkloads, newlyBlocked: [{source, target, before, after}], newlyAllowed, evaluatedPairs, truncated}`. Workload IDs are `<namespace>/<kind>/<name>`. Only reachability flips are reported (`allowed` ↔ `unconstrained` is not a flip).

## Posture

`GET /api/v1/posture` → `{summary, namespaces, findings}`.

- `summary`: pods, isolated pods per direction, policy count, `score` (0–100), finding counts. Covers application pods only (non-`kube-*` namespaces, non-hostNetwork).
- `namespaces[]`: pods, hostNetworkPods, policies, ingress/egress isolated pods, `defaultDenyIngress/Egress`.
- `findings[]`: `{code, severity: critical|warning|info, namespace, policy?, message}`. Codes: `CNI_NOT_ENFORCING`, `CNI_UNVERIFIED`, `DNS_EGRESS_BLOCKED`, `NAMESPACE_UNPROTECTED`, `PODS_NOT_ISOLATED`, `POLICY_SELECTS_NOTHING`, `PEER_MATCHES_NOTHING`, `ALLOW_ALL_INGRESS`, `ALLOW_ALL_EGRESS`, `IPBLOCK_ANY`, `HOSTNETWORK_SELECTED`. Findings in `kube-*` namespaces are downgraded one severity step.

`GET /api/v1/namespaces/{ns}/isolation` → each pod with the `ingressPolicies` and `egressPolicies` isolating it.

## Audit

`GET /api/v1/audit?namespace=&user=&action=&q=&limit=` → newest-first entries `{id, time, user, groups, sourceIP, action, namespace, name, result, error, before, after}` (`before`/`after` are policy YAML).

## Topology

`GET /api/v1/topology?namespaces=a,b` → `{nodes, edges}` where nodes are workloads (pods collapsed by owner) and each directed edge carries a verdict: `allowed` | `blocked` | `unconstrained`, plus the policies involved. Requests spanning more than 60 workloads return 422 `TOO_MANY_WORKLOADS`.

`GET /api/v1/topology?level=namespace[&namespaces=a,b]` → `{level: "namespace", nodes: [{namespace, workloads, pods, internal}], edges: [{source, target, counts}]}`. Each edge tallies every workload pair between two namespaces as `{allowed, blocked, unconstrained}`; `internal` does the same inside a namespace. Without `namespaces` it covers all non-system namespaces (up to 1500 workloads).

## Events

`GET /api/v1/events` — SSE stream. Each informer change emits (debounced 250ms):

```
event: invalidate
data: {"resource":"networkpolicies"}
```

Clients refetch on invalidation; no object payloads are streamed.
