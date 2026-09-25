# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/ismoilovdevml/k8s-firewall-ui/security/advisories/new).
Do not open a public issue. We aim to acknowledge reports within 3 working days.

## Security model

k8s-firewall-ui can change NetworkPolicies, so it is security-sensitive by design.

- **Identity.** In `token` and `proxy` auth modes every write runs with the
  end user's own Kubernetes identity (bearer token or impersonation), and the
  ServiceAccount holds no write permissions. Kubernetes RBAC is the only
  authorization layer, and there is no separate permission system to keep in sync.
- **Sessions.** Tokens are kept in AES-256-GCM encrypted, `HttpOnly`,
  `SameSite=Strict` cookies (`Secure` with TLS or `--secure-cookies`).
- **CSRF.** Every state-changing request must carry a custom header that
  cross-site requests cannot set.
- **Browser hardening.** Strict Content-Security-Policy, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy: no-referrer`, HSTS when serving TLS.
- **Proxy mode trusts identity headers.** Only the authenticating proxy may
  reach the pod; enforce this with the chart's `networkPolicy` values.
- **Read visibility.** All authenticated users can view cluster-wide policy
  and pod metadata from the server's cache. Writes are always per-user.
- **Mode `none`.** Anyone who can reach the service acts as the
  ServiceAccount. Use it only via `kubectl port-forward` or with `readOnly`.

See [docs/deployment.md](docs/deployment.md) for the hardening checklist.
