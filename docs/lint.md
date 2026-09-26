# Linting policies in CI and GitOps

`k8s-firewall-ui lint` checks NetworkPolicy manifests before they reach a
cluster. It reads files, directories (recursively: `*.yaml`, `*.yml`,
`*.json`) or `-` for stdin. Other kinds (Deployments, Services, …) are
skipped, so you can point it at a whole manifests directory.

```bash
k8s-firewall-ui lint deploy/                    # offline, static checks
k8s-firewall-ui lint --cluster deploy/          # + overlay on the live cluster
k8s-firewall-ui lint --format github deploy/    # annotations on the PR diff
kustomize build overlays/prod | k8s-firewall-ui lint -
```

## Offline checks

| Code | Severity | Why |
|---|---|---|
| `EMPTY_PEER` | critical | a `from`/`to` element with no selector or ipBlock; the API server rejects it |
| `IPBLOCK_WITH_SELECTOR` | critical | ipBlock mixed with selectors in one peer; rejected |
| `INVALID_CIDR`, `INVALID_EXCEPT` | critical | unparsable CIDR, or an `except` outside its CIDR |
| `DUPLICATE_POLICY` | critical | the same namespace/name twice; the later document silently wins |
| `MISSING_NAME` | critical | no `metadata.name` |
| `MISSING_POLICY_TYPES` | warning | implicit `policyTypes` defaults are a classic source of mistakes |
| `IGNORED_EGRESS_RULES` | warning | egress rules without `Egress` in `policyTypes` do nothing |
| `ALLOW_ALL_INGRESS` / `ALLOW_ALL_EGRESS` | warning / info | a rule with no peers and no ports opens everything |
| `IPBLOCK_ANY` | warning (ingress) / info | `0.0.0.0/0` without exceptions |
| `DNS_EGRESS_BLOCKED` | warning | the namespace's manifests isolate egress but none allows port 53 |
| `MISSING_NAMESPACE` | warning | the target namespace depends on the applying tool's context |

## Cluster mode

With `--cluster`, the manifests are overlaid on the live state from the
current kubeconfig, which needs read access to pods, namespaces and
NetworkPolicies. The report then shows only the findings the change
**introduces**, such as a selector that matches no running pod
(`PEER_MATCHES_NOTHING`, usually a label typo), a namespace left
unprotected, or DNS broken by the change. It also lists every workload
connection that becomes blocked or allowed. Existing problems are not
repeated. Manifests without a namespace go to `--namespace` (default
`default`).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | no finding at or above `--fail-on` (default `warning`; `none` never fails) |
| 1 | findings at or above the threshold |
| 2 | usage error, unreadable input, or a document that does not parse (unknown fields are errors, e.g. `ingres:`) |

## GitHub Actions

```yaml
- name: Lint NetworkPolicies
  run: |
    docker run --rm -v "$PWD:/src" -w /src \
      ghcr.io/ismoilovdevml/k8s-firewall-ui:latest lint --format github deploy/
```

With `--format github`, findings appear as annotations on the changed
lines of the pull request. Add `--cluster` (with a read-only kubeconfig
for a staging cluster) to see the connection impact of the PR in the job
log.
