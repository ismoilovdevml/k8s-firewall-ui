# Changelog

## v0.2.0 — enterprise release

### Added
- **Firewall console**: per namespace, workload or pod, every inbound and outbound peer (workloads, namespaces, DNS, external CIDRs, the internet) with per-port status, the denying side and the deciding rule; one-click **Allow / Block** through a planner that writes managed least-privilege policies, keeps other current connections when it has to isolate a side, reports hand-written rules it cannot change, verifies the result with the simulator, and applies after a diff + impact review (server re-plans and refuses stale plans). Verified end-to-end against real traffic.
- **`lint` command** for CI/GitOps: offline checks of NetworkPolicy manifests (invalid peers/CIDRs, duplicates, implicit policyTypes, allow-all rules, `0.0.0.0/0`, DNS trap), `--cluster` overlay reporting only newly introduced findings plus connection impact, `text`/`json`/`github` output and `--fail-on` exit codes.
- **Security overview**: posture score, ingress/egress isolation coverage per namespace with pod drill-down, and prioritized findings: DNS broken by egress isolation, selectors with label typos that match nothing, policies selecting no pods, allow-all rules, `0.0.0.0/0` ingress, unprotected namespaces, hostNetwork pods. One-click "Harden" creates a default-deny baseline.
- **Impact preview**: before creating, editing, deleting or drawing a policy, see which workload connections become blocked or allowed.
- **Review diff**: the Edit and YAML tabs show a unified diff of the pending change before you apply it.
- **Templates**: default-deny ingress, default-deny all / egress (DNS kept open), allow DNS, same-namespace, ingress controller, Prometheus scraping, HTTPS egress.
- **Import / export**: clean multi-document YAML export, and a dry-run-first bulk import that reports created / updated / unchanged per policy.
- **Authentication**: `--auth-mode=token` (sign in with a Kubernetes token) and `--auth-mode=proxy` (SSO via oauth2-proxy, Pomerium, …). Writes run as the signed-in user (own token or impersonation), so Kubernetes RBAC decides who may change what; the UI disables actions you cannot perform.
- **Multi-tenant read scoping** (`--restrict-reads`, Helm `auth.restrictReads`): each user sees only namespaces where their RBAC allows listing NetworkPolicies, across lists, findings, topology, impact, the simulator and the audit log. Hidden namespaces answer 404; verdicts are still computed over the whole cluster.
- **Compliance report**: download the posture report as Markdown, CSV (findings) or JSON.
- **Change notifications**: `--notify-webhook-url` posts every policy change to Slack-compatible webhooks (`--notify-format=slack`) or as JSON to any endpoint, asynchronously with retries.
- **Audit log**: every change with user, groups, source IP, result and a before/after YAML diff, both as structured logs and on an in-app page.
- **Namespace topology**: a map of reachability between every pair of namespaces (open / partial / blocked / unrestricted) that drills down into the workload graph; the workload graph filters by verdict.
- **Operations**: Prometheus `/metrics` (posture score, findings, coverage, HTTP, mutations), JSON logs, graceful shutdown, optional TLS, strict security headers and CSP, CSRF protection, sign-in rate limiting, `FWUI_*` environment variables for every flag.
- **`--demo`**: a built-in sample cluster for evaluating the UI without Kubernetes.
- **Helm chart 0.2.0**: least-privilege RBAC per auth mode, an editor ClusterRole for per-team bindings, a persisted session secret, TLS, ServiceMonitor, PodDisruptionBudget, a NetworkPolicy for the UI itself, startup probes, topology spread.
- **Real-cluster end-to-end suite**: the simulator is cross-checked against actual enforcement for every workload pair and port (`0 mismatches` on k3s), and the UI is driven by Playwright in token-auth mode. Both run in CI on k3s.

### Changed
- Topology opens on the namespace view; the workload graph limit rises from 40 to 60 workloads, and the namespace view handles up to 1500 workloads.
- Bulk policy evaluation is about 3× faster, thanks to a per-snapshot index and a fast path for `matchLabels` selectors.
- Graphs use a circle layout with straight edges, replacing the layered layout that collapsed dense graphs into a line.

### Fixed
- k3s (embedded kube-router policy controller) is detected as enforcing instead of "NOT enforced".
- An unidentified CNI is reported as *unverified* rather than as ignoring policies.

## v0.1.0

Initial release: topology viewer, policy CRUD with dry-run, connection simulator, visual builder, CNI detection, Docker image, Helm chart.
