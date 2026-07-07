# Kubernetes Network Policy APIs — Technical Foundation

> Research snapshot: July 2026. This is the normative semantics reference for k8s-firewall-ui.
> The simulator (`internal/simulator`) must implement exactly what is described here.

## 1. Core API: `networking.k8s.io/v1` NetworkPolicy

Stable/GA; the only policy API guaranteed present in every conformant cluster. v0.1 supports this object type only.

### 1.1 Spec structure

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: example
  namespace: default          # NetworkPolicy is ALWAYS namespaced
spec:
  podSelector: {}             # which pods in THIS namespace the policy applies to
  policyTypes: [Ingress, Egress]
  ingress:
  - from:
    - podSelector: {...}
      namespaceSelector: {...}
    - ipBlock:
        cidr: 10.0.0.0/8
        except: [10.1.0.0/16]
    ports:
    - protocol: TCP
      port: 6379
      endPort: 6390
  egress:
  - to: [...]
    ports: [...]
```

Field semantics:

- **`podSelector`** — selects pods *in the policy's own namespace*. `podSelector: {}` selects **all pods in the namespace**. Never crosses namespace boundaries.
- **`policyTypes`** — `["Ingress"]`, `["Egress"]`, or both. If omitted, defaults to `["Ingress"]` plus `Egress` if any egress rule is present. **Always set explicitly when generating policies.**
- **`ingress[].from` / `egress[].to`** — list of *peers*. Each peer combines `podSelector`, `namespaceSelector`, `ipBlock`.
- **Peer combination rule (#1 gotcha):**
  - `podSelector` + `namespaceSelector` **in the same list element** = **AND** (pods matching X *in* namespaces matching Y).
  - Two **separate list elements** = **OR** (union).
- **`namespaceSelector: {}`** = all namespaces. `podSelector` present with `namespaceSelector` absent = only the policy's own namespace.
- **`ipBlock`** — `cidr` + optional `except` (CIDRs carved out). Cannot be combined with pod/namespace selectors in the same peer element. Meant for external IPs; matching pod IPs is fragile/CNI-dependent.

### 1.2 Ports

- Entries: `protocol` (`TCP`|`UDP`|`SCTP`, default `TCP`), `port` (numeric or **named** string port), `endPort` (numeric).
- **`endPort`** — inclusive range `[port, endPort]`; stable since v1.25; not allowed with named ports; `endPort >= port` required.
- **Named ports** resolve against the *target pod's* `containerPort` names — per-pod resolution.
- **SCTP** supported as a value; enforcement depends on CNI.
- **Empty/omitted `ports`** = all ports for that peer.

### 1.3 Semantics gotchas (critical)

1. **Default-allow, opt-in isolation.** A pod is non-isolated until some policy selects it; then it becomes **default-deny for that direction**.
2. **Additive/union — policies never deny.** The allowed set is the union across all applicable policies; evaluation order is irrelevant. No priority, no explicit deny.
3. **Both ends must permit.** A → B:port succeeds iff A's egress allows B AND B's ingress allows A.
4. **`from: []` vs omitted `from`:**
   - `ingress: [{ports: [...]}]`, `from` **omitted** → those ports from **all sources**.
   - `from: []` (empty array) → matches **no sources** → effectively deny.
   - `ingress: [{}]` (one empty rule) = **allow all ingress**; `ingress: []` / omitted with Ingress in policyTypes = **deny all ingress**.
5. **Node-local traffic always allowed** (kubelet probes etc.) regardless of policy.
6. **Self-traffic** cannot be blocked.
7. Canonical templates to ship as presets:

```yaml
# default-deny-all ingress
spec: {podSelector: {}, policyTypes: [Ingress]}
# allow-all ingress
spec: {podSelector: {}, ingress: [{}], policyTypes: [Ingress]}
# default-deny-all egress
spec: {podSelector: {}, policyTypes: [Egress]}
```

Refs: <https://kubernetes.io/docs/concepts/services-networking/network-policies/> · <https://kubernetes.io/docs/reference/kubernetes-api/policy-resources/network-policy-v1/>

## 2. `policy.networking.k8s.io` — ANP / BANP / ClusterNetworkPolicy

Project: kubernetes-sigs/network-policy-api. Adds cluster-scoped, admin-owned, ordered policies with explicit Deny.

- **v1alpha1:** `AdminNetworkPolicy` (priority 0–1000, lower wins; actions Allow/Deny/Pass) + `BaselineAdminNetworkPolicy` (singleton `default`, no priority, no Pass). Still alpha; what's actually deployed (OVN-Kubernetes/OpenShift, Antrea, KubeOVN, Calico partial).
- **v1alpha2 (announced Oct 2025):** ANP+BANP consolidated into a single **`ClusterNetworkPolicy`** with a `tier: Admin|Baseline` field; `Allow` renamed `Accept`; richer `protocols` port matching. Still alpha.
- **Evaluation pipeline:** Admin tier (priority-ordered, Allow/Deny/Pass short-circuit) → standard NetworkPolicy (union) → Baseline tier.
- **v0.1 decision:** detect CRD presence, show a banner ("AdminNetworkPolicies detected — not evaluated by this tool yet"), never evaluate. Revisit at v1beta1.

Refs: <https://network-policy-api.sigs.k8s.io/api-overview/> · <https://network-policy-api.sigs.k8s.io/implementations/>

## 3. CNI-specific policy CRDs (awareness only in v0.1)

| CRD | API group | Scope | Notes |
|---|---|---|---|
| Calico `NetworkPolicy` | `projectcalico.org/v3` (`crd.projectcalico.org/v1` storage) | ns | ordered, explicit Allow/Deny |
| Calico `GlobalNetworkPolicy` | `projectcalico.org/v3` | cluster | cluster defaults |
| Cilium `CiliumNetworkPolicy` | `cilium.io/v2` | ns | adds L7 (HTTP/gRPC/Kafka/DNS-FQDN) |
| Cilium `CiliumClusterwideNetworkPolicy` | `cilium.io/v2` | cluster | |
| Antrea `NetworkPolicy` / `ClusterNetworkPolicy` | `crd.antrea.io/v1beta1` | ns / cluster | tiered, priorities, Allow/Deny/Pass |

Their explicit-deny/priority/L7 models differ fundamentally from core NP — list their presence, do not edit or evaluate.

## 4. CNI enforcement + detection

**Enforce core NetworkPolicy:** Calico, Cilium, Antrea, Weave Net, kube-router, Kube-OVN, OVN-Kubernetes, GKE Dataplane V2, AKS (Azure/Calico/Cilium), EKS VPC-CNI *with the policy agent enabled*.

**Do NOT enforce:** **flannel** alone — NetworkPolicy objects are accepted by the API server but **silently have no effect**. Plain AWS VPC CNI without the policy agent likewise. This is the most dangerous UX trap; the UI must warn prominently. Fix paths: Canal, or Cilium chained over flannel.

**Detection heuristics (no first-class API):**
1. kube-system DaemonSets/pods: `calico-node`/`tigera-operator` → Calico; `cilium` → Cilium; `antrea-agent` → Antrea; `kube-flannel` → flannel (⚠); `weave-net` → Weave; `kube-router`; `ovnkube-node` → OVN-Kubernetes; `aws-node` → AWS VPC CNI (check for policy agent).
2. CRD group discovery: `crd.projectcalico.org`, `cilium.io`, `crd.antrea.io`, `policy.networking.k8s.io`.
3. Node annotations/labels (`projectcalico.org/...`, `io.cilium/...`).

Detection is best-effort → expose evidence strings in the UI and provide a `--cni-override` flag.

## 5. Connection simulator algorithm (A → B on port P)

**Allowed ⟺ egress check on A AND ingress check on B.**

Egress check (A → B:P):
1. Collect policies in A's namespace whose `podSelector` matches A and whose `policyTypes` includes `Egress`.
2. None → A not egress-isolated → **allow**.
3. Else A is egress-isolated (default-deny): allow iff **any** egress rule across those policies has a `to` peer matching B (pod labels / namespace labels / ipBlock on B's IP) AND a port entry matching P (or empty ports). Pure union; order-independent.

Ingress check is symmetric on B with `from` matched against A.

Peer matching details:
- AND within one `from`/`to` element, OR across elements (§1.1).
- Bare `podSelector` → policy's own namespace only. `namespaceSelector: {}` → any namespace. (Most common simulator bug.)
- `ipBlock`: match iff IP ∈ `cidr` AND ∉ every `except`.
- Ports: empty = all; named ports resolve against B's containerPorts; `endPort` = range; protocol defaults TCP.

Edge cases the simulator MUST flag:
1. **Node-local traffic always allowed** — if A and B share a node, note the bypass.
2. **hostNetwork pods** share the node IP; pod/namespace selectors **do not match them**; behavior officially undefined → warning.
3. **DNS egress trap** — egress isolation without an explicit :53 allow breaks DNS. Reliable selector for kube-system: `kubernetes.io/metadata.name` namespace label; DNS pods usually `k8s-app: kube-dns` (verify per cluster). Emit `DNS_EGRESS_BLOCKED` warning.
4. Report **which side denies** — that's the actionable diagnostic.
5. If the detected CNI doesn't enforce NP, the verdict is theoretical → warning.
6. If ANP/BANP CRDs present, results may be incomplete → warning.

Refs: <https://www.cncf.io/blog/2020/02/10/guide-to-kubernetes-egress-network-policies/> · <https://github.com/ahmetb/kubernetes-network-policy-recipes>
