# Production deployment guide

This guide covers running k8s-firewall-ui for a team or an organization:
authentication, authorization, TLS, high availability, monitoring, and audit.

## 1. Pick an authentication mode

| Mode | Who makes the change in Kubernetes | Use it when |
|---|---|---|
| `none` (default) | the app's ServiceAccount | a single operator using `kubectl port-forward`, or a read-only (`readOnly: true`) install |
| `token` | the **signed-in user**, with their own bearer token | you want per-user RBAC without extra infrastructure |
| `proxy` | the **signed-in user**, via impersonation | you already run SSO (oauth2-proxy, Pomerium, an identity-aware proxy) |

In `token` and `proxy` modes the ServiceAccount has **no write permissions**:
every create/update/delete runs as the end user, so Kubernetes RBAC decides
what each person may change, and the Kubernetes API audit log shows the real
author. The UI checks permissions per namespace (SelfSubjectAccessReview)
and disables actions the user cannot perform.

Reads (topology, posture, the simulator) come from the app's own informer
cache. By default every signed-in user can see policies, pods and
namespaces across the cluster. On multi-tenant clusters set
`auth.restrictReads=true` (`--restrict-reads`): each user then sees only
namespaces where their RBAC allows `list networkpolicies`. That covers
namespace lists, pods, policies, export, posture findings, topology, impact
previews, simulator endpoints and the audit log; hidden namespaces answer
404 so their existence is not disclosed. Verdicts are still computed over
the whole cluster, so they stay correct. Visibility is checked with
SelfSubjectAccessReviews and cached per user for 60 seconds.

### Token mode

```bash
helm install firewall-ui deploy/helm/k8s-firewall-ui \
  -n k8s-firewall-ui --create-namespace \
  --set auth.mode=token \
  --set auth.secureCookies=true
```

Users paste a token on the sign-in page, for example a short-lived
ServiceAccount token (`kubectl create token <sa> --duration=8h`) or an OIDC
`id_token` when the API server trusts your identity provider. The token is
validated with a `SelfSubjectReview`, then kept in an AES-256-GCM encrypted,
`HttpOnly`, `SameSite=Strict` cookie. It never reaches browser JavaScript.

The chart generates a session secret and keeps it across upgrades. Use
`auth.existingSecret` to bring your own (required for GitOps tools that
cannot run `lookup`). All replicas must share the same secret.

### Proxy mode (SSO)

Example with [oauth2-proxy](https://github.com/oauth2-proxy/oauth2-proxy)
as a sidecar-free reverse proxy in front of the service:

```yaml
# values.yaml
auth:
  mode: proxy
  proxy:
    userHeader: X-Forwarded-Email    # or X-Forwarded-User
    groupsHeader: X-Forwarded-Groups
networkPolicy:
  enabled: true
  ingressFrom:                       # ONLY the proxy may reach the UI
    - podSelector:
        matchLabels:
          app.kubernetes.io/name: oauth2-proxy
```

oauth2-proxy needs `--pass-user-headers=true` (or `--set-xauthrequest` with
ingress-nginx auth annotations) and `--upstream=http://firewall-ui-k8s-firewall-ui.k8s-firewall-ui:8080`.

> **Security:** in proxy mode the app trusts the identity headers. Anything
> that can reach the pod directly can claim to be any user. Always enable the
> chart's `networkPolicy` (or an equivalent mesh policy) so that only the
> proxy can connect.

The chart grants the ServiceAccount `impersonate` on `users` and `groups`.
Narrow it with `resourceNames` in a custom ClusterRole if your policy
requires it.

## 2. Grant users permissions

The chart ships a `<release>-k8s-firewall-ui-editor` ClusterRole with full
NetworkPolicy rights. Bind it per team and namespace:

```bash
kubectl -n team-a create rolebinding team-a-netpol \
  --clusterrole=firewall-ui-k8s-firewall-ui-editor --group=team-a
```

Users without a binding can still browse, simulate and preview impact.
They cannot apply changes.

## 3. TLS

Either terminate TLS at your ingress and set `auth.secureCookies=true`, or
serve HTTPS from the pod:

```yaml
tls:
  enabled: true
  secretName: firewall-ui-tls   # kubernetes.io/tls, e.g. from cert-manager
```

HTTPS from the pod also enables HSTS.

For ingress-nginx, disable buffering so live updates (Server-Sent Events) flow:

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
```

## 4. High availability

The server is stateless apart from the in-memory audit buffer. Each replica
runs its own informers.

```yaml
replicaCount: 2
podDisruptionBudget:
  enabled: true
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: k8s-firewall-ui
```

With several replicas in `token` mode, set `auth.existingSecret` or keep the
generated secret so that all replicas decrypt the same cookies.

## 5. Monitoring

`/metrics` exposes Prometheus metrics (`metrics.serviceMonitor.enabled=true`
creates a ServiceMonitor):

| Metric | Meaning |
|---|---|
| `fwui_posture_score` | cluster posture score (0–100) |
| `fwui_pods_isolated{direction}` / `fwui_pods` | isolation coverage of application pods |
| `fwui_posture_findings{severity}` | open findings (critical / warning / info) |
| `fwui_networkpolicies` | policy count |
| `fwui_policy_mutations_total{action,result}` | changes made through the UI |
| `fwui_http_requests_total`, `fwui_http_request_duration_seconds` | HTTP traffic |
| `fwui_informers_synced` | 1 when caches are ready |

Example alert:

```yaml
- alert: NetworkPolicyCriticalFindings
  expr: fwui_posture_findings{severity="critical"} > 0
  for: 15m
  annotations:
    summary: "NetworkPolicy posture has critical findings (e.g. egress isolation that breaks DNS)"
```

## 6. Audit

Every change made through the UI is recorded:

- as a structured log line (`audit=true`, user, groups, source IP, action,
  namespace, name, result, error). Set `logging.format=json` (the chart
  default) and ship pod logs to your log platform. This is the durable
  record.
- in an in-memory ring buffer (`audit.bufferSize`) that powers the UI's
  *Audit log* page, with before/after YAML diffs. It resets on restart and
  is per replica.
- in token/proxy modes, the Kubernetes API audit log also records the end
  user as the author of the request.
- optionally, as a webhook notification (see above).

A downloadable **posture report** (Markdown, CSV of findings, or JSON) is
available from the Overview page or `GET /api/v1/posture/report?format=md|csv|json`,
for compliance evidence.

Dry-runs are not audited.

### Notifications

Send every change to Slack (or Teams/Mattermost via their Slack-compatible
webhooks), or the full audit entry as JSON to any HTTP endpoint (e.g. a
SIEM collector):

```bash
kubectl -n k8s-firewall-ui create secret generic firewall-ui-webhook \
  --from-literal=webhook-url=https://hooks.slack.com/services/…
helm upgrade firewall-ui deploy/helm/k8s-firewall-ui --reuse-values \
  --set notifications.enabled=true --set notifications.existingSecret=firewall-ui-webhook
```

Delivery is asynchronous and retried three times, with backoff on network
errors, 429 and 5xx responses. It never delays or fails the change itself.
With `networkPolicy.enabled`, allow egress to the webhook via
`networkPolicy.extraEgress`.

## 7. Observed traffic (learning mode)

```yaml
flows:
  enabled: true
```

This deploys a DaemonSet agent (`k8s-firewall-ui agent`) on every node. Every
`flows.agent.interval` it dumps the node's conntrack table over netlink and
posts the connections to the server with a shared token (a generated Secret,
or `flows.existingSecret`). The Firewall page then shows, per namespace or
workload, who it actually talks to (pods, external IPs, ports) and whether the
current policies allow it, and can build a least-privilege policy from it.

- Needs `hostNetwork` and `CAP_NET_ADMIN` (read-only use of conntrack). It
  serves no port and mounts no service account token.
- Works on iptables/nftables data paths (kube-router, k3s, Calico iptables,
  flannel, Cilium with kube-proxy, AWS VPC CNI). eBPF-only data paths that
  bypass conntrack report nothing.
- Only established connections are recorded: packets a policy drops never
  show up, so observe *before* locking a workload down.
- Flows live in the server's memory (`flows.retention`). With several
  replicas, each agent posts to one of them through the Service, so each
  replica sees part of the traffic; run one replica while learning.
- With `tls.enabled`, agents trust `tls.secretName`'s `flows.agent.caKey`.
  With `networkPolicy.ingressFrom` set, add the node CIDRs to
  `networkPolicy.agentCIDRs`.

## 8. Hardening checklist

- [ ] `auth.mode` is `token` or `proxy` for anything beyond a single operator
- [ ] HTTPS end to end (`tls.enabled`, or ingress TLS + `auth.secureCookies`)
- [ ] `networkPolicy.enabled=true`, with `ingressFrom` restricted to the proxy/ingress
- [ ] `networkPolicy.apiServerCIDRs` narrowed to your API server endpoints
- [ ] Editor role bound per team/namespace, not cluster-wide
- [ ] Logs shipped and retained (`logging.format=json`)
- [ ] ServiceMonitor + alert on critical findings
- [ ] `readOnly: true` for view-only instances (for example an auditor-facing deployment)

Built-in protections: strict Content-Security-Policy and other security
headers, CSRF protection (custom header required on every write), per-IP
sign-in rate limiting, request size limits, a non-root read-only container
with all capabilities dropped, and graceful shutdown.

## Configuration reference

Every flag can also be set as an environment variable `FWUI_<FLAG>` (dashes become underscores), e.g. `FWUI_AUTH_MODE=token`.

| Flag | Default | Description |
|---|---|---|
| `--listen` | `:8080` | listen address |
| `--kubeconfig` | | kubeconfig path (default: `$KUBECONFIG`, in-cluster, `~/.kube/config`) |
| `--read-only` | `false` | disable all writes |
| `--auth-mode` | `none` | `none` \| `token` \| `proxy` |
| `--session-secret`, `--session-secret-file` | random | cookie encryption secret (token mode) |
| `--session-ttl` | `8h` | session lifetime |
| `--restrict-reads` | `false` | token/proxy mode: show only namespaces the user may list NetworkPolicies in |
| `--auth-proxy-user-header` | `X-Forwarded-User` | proxy mode user header |
| `--auth-proxy-groups-header` | `X-Forwarded-Groups` | proxy mode groups header (comma-separated) |
| `--tls-cert-file`, `--tls-key-file` | | serve HTTPS |
| `--secure-cookies` | `false` | force `Secure` cookies (automatic with TLS) |
| `--metrics` | `true` | expose `/metrics` |
| `--audit-buffer` | `1000` | audit entries kept in memory |
| `--notify-webhook-url` | | POST every change to this URL (use `FWUI_NOTIFY_WEBHOOK_URL`) |
| `--notify-format` | `json` | `json` (audit entry) \| `slack` (text) |
| `--agent-token`, `--agent-token-file` | | enable flow ingestion from node agents (use `FWUI_AGENT_TOKEN`) |
| `--flow-retention` | `24h` | how long observed flows are kept |
| `--log-format` | `text` | `text` \| `json` |
| `--log-level` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `--shutdown-timeout` | `15s` | graceful shutdown timeout |
| `--cni-override` | | skip CNI detection, trust this provider |
| `--demo` | `false` | run against a built-in sample cluster |
