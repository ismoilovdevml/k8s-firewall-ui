#!/usr/bin/env bash
# End-to-end suite against a real cluster (current KUBECONFIG) whose CNI
# enforces NetworkPolicy (kind with its default kindnet, k3s, Calico, …):
#   1. deploys the sample app, policies and two test identities
#   2. cross-checks simulator verdicts against real connections (Go)
#   3. runs the UI in token auth mode and drives it with Playwright
# Usage: hack/e2e/run.sh            (from the repository root)
set -euo pipefail
cd "$(dirname "$0")/../.."
KUBECTL=${KUBECTL:-kubectl}
PORT=${PORT:-18080}

echo "--- deploying sample app"
$KUBECTL apply -f hack/e2e/workloads.yaml -f hack/e2e/policies.yaml -f hack/e2e/rbac.yaml >/dev/null
$KUBECTL wait --for=condition=Available deployment --all -A --timeout=300s >/dev/null

echo "--- simulator vs. real enforcement"
go test -tags e2e ./test/e2e/ -count=1 -v

echo "--- UI tests"
make build >/dev/null
export FWUI_TOKEN=$($KUBECTL -n fwui-e2e create token editor --duration=1h)
export FWUI_VIEWER_TOKEN=$($KUBECTL -n fwui-e2e create token viewer --duration=1h)
export FWUI_TENANT_TOKEN=$($KUBECTL -n fwui-e2e create token shop-team --duration=1h)
./bin/k8s-firewall-ui --listen ":$PORT" --auth-mode token --restrict-reads --session-secret e2e-secret > e2e-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "localhost:$PORT/readyz" >/dev/null && break; sleep 1; done
cd web && FWUI_URL="http://localhost:$PORT" npx playwright test "$@"
