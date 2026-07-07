# API Reference

All endpoints are served by the single binary under `/api/v1`. Errors use the shape `{"error": {"code": "...", "message": "..."}}` with an appropriate HTTP status.

## Health

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | liveness |
| GET | `/readyz` | 503 until informer caches sync |

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

## Topology

`GET /api/v1/topology?namespaces=a,b` → `{nodes, edges}` where nodes are workloads (pods collapsed by owner) and each directed edge carries a verdict: `allowed` | `blocked` | `unconstrained`, plus the policies involved. Requests spanning more than 40 workloads return 422 `TOO_MANY_WORKLOADS`.

## Events

`GET /api/v1/events` — SSE stream. Each informer change emits (debounced 250ms):

```
event: invalidate
data: {"resource":"networkpolicies"}
```

Clients refetch on invalidation; no object payloads are streamed.
