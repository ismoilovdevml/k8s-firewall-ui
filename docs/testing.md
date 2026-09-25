# Testing

| Layer | What it proves | Command |
|---|---|---|
| Simulator unit tests | NetworkPolicy semantics, posture findings, impact analysis (table-driven) | `make test` |
| API tests | handlers, CSRF, auth modes, audit, import/export (fake clientset) | `make test` |
| Frontend unit tests | policy draft model, templates, YAML diff | `make test-web` |
| **Enforcement cross-check** | simulator verdicts match what a real CNI does, connection by connection | `hack/e2e/run.sh` |
| **UI end-to-end** | the real app, in token auth mode, driven by Playwright | `hack/e2e/run.sh` |
| Demo smoke test | the binary boots and serves the API and UI | CI `smoke` job |

## Real-cluster end-to-end suite

`hack/e2e/run.sh` runs against the cluster in your current `KUBECONFIG`,
which must enforce NetworkPolicy (k3s, kind, or anything running Calico,
Cilium, …):

```bash
# k3s is the quickest (its embedded kube-router enforces policies):
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable=traefik" sh -
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

cd web && npx playwright install chromium && cd ..
hack/e2e/run.sh
```

The script:

1. Applies `hack/e2e/workloads.yaml` (a small multi-team app: every pod is
   busybox serving HTTP on its declared ports), `hack/e2e/policies.yaml` (a
   policy set with deliberate mistakes), and `hack/e2e/rbac.yaml` (an
   *editor* and a *viewer* identity).
2. Runs `go test -tags e2e ./test/e2e/`. For **every pair of workloads and
   every declared port** it asks the simulator for a verdict and then
   really connects (`wget` via `kubectl exec`), failing on any mismatch.
   It also checks the DNS-trap prediction with real `nslookup`s. A typical run:
   `99 connections probed (25 allowed, 74 blocked), 0 mismatches`.
3. Starts the server with `--auth-mode=token` and runs the Playwright suite
   (`web/e2e/*.e2e.ts`): token sign-in, overview findings, the label-typo
   finding, topology filtering, simulator verdicts, template → impact
   preview → create → audit diff → delete, export, dry-run-first import,
   and RBAC-disabled actions for the viewer.

Videos, screenshots and traces of every test land in `web/e2e-results/`;
the HTML report in `web/e2e-report/`.

### Recording the walkthrough video

```bash
WALKTHROUGH=1 hack/e2e/run.sh walkthrough
ffmpeg -i web/e2e-results/*walkthrough*/video.webm -c:v libx264 -crf 26 \
  -pix_fmt yuv420p -movflags +faststart docs/media/walkthrough.mp4
```
