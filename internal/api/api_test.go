package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/audit"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/auth"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/cni"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

type fakeStore struct{ snap *kube.ClusterSnapshot }

func (f *fakeStore) Snapshot() (*kube.ClusterSnapshot, error) { return f.snap, nil }
func (f *fakeStore) Synced() bool                             { return true }
func (f *fakeStore) Events() <-chan kube.Event                { return make(chan kube.Event) }

func denyAll(ns string) *networkingv1.NetworkPolicy {
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: "deny-all", ResourceVersion: "1",
			Annotations: map[string]string{lastAppliedAnno: "{}", "owner": "platform"}},
		Spec: networkingv1.NetworkPolicySpec{PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}},
	}
}

type harness struct {
	t      *testing.T
	router http.Handler
	cs     *fake.Clientset
	audit  *audit.Log
}

func newHarness(t *testing.T, readOnly bool, authn *auth.Authenticator, pols ...*networkingv1.NetworkPolicy) *harness {
	t.Helper()
	snap := &kube.ClusterSnapshot{
		Pods: []kube.PodInfo{
			{Name: "web-1", Namespace: "a", Labels: map[string]string{"app": "web"}, IP: "10.0.0.1", Owner: "deployment/web"},
			{Name: "db-1", Namespace: "b", Labels: map[string]string{"app": "db"}, IP: "10.0.0.2", Owner: "statefulset/db"},
		},
		Namespaces: []kube.NamespaceInfo{{Name: "a"}, {Name: "b"}},
		Policies:   pols,
	}
	cs := fake.NewClientset()
	for _, p := range pols {
		_ = cs.Tracker().Add(p)
	}
	log := audit.New(10, slog.New(slog.NewTextHandler(io.Discard, nil)))
	srv := NewServer(Options{
		Store: &fakeStore{snap}, Clientset: cs, CNI: cni.Result{Provider: "calico", EnforcesPolicies: true},
		ReadOnly: readOnly, Auth: authn, Audit: log, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	t.Cleanup(srv.Close)
	r := chi.NewRouter()
	r.Use(SecurityHeaders(false))
	srv.Routes(r)
	return &harness{t: t, router: r, cs: cs, audit: log}
}

func (h *harness) do(method, path, body string, headers ...string) *httptest.ResponseRecorder {
	h.t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(CSRFHeader, "test")
	for i := 0; i+1 < len(headers); i += 2 {
		if headers[i+1] == "" {
			req.Header.Del(headers[i])
		} else {
			req.Header.Set(headers[i], headers[i+1])
		}
	}
	w := httptest.NewRecorder()
	h.router.ServeHTTP(w, req)
	return w
}

func errorCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error apiError `json:"error"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return body.Error.Code
}

const webPolicyYAML = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-web
spec:
  podSelector:
    matchLabels:
      app: db
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector: {}
`

func TestWriteGuards(t *testing.T) {
	cases := []struct {
		name     string
		readOnly bool
		headers  []string
		want     int
		wantCode string
	}{
		{"missing CSRF header", false, []string{CSRFHeader, ""}, http.StatusForbidden, "CSRF_HEADER_MISSING"},
		{"read-only", true, nil, http.StatusForbidden, "READ_ONLY"},
		{"allowed", false, nil, http.StatusCreated, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t, tc.readOnly, nil)
			w := h.do(http.MethodPost, "/api/v1/namespaces/b/networkpolicies", webPolicyYAML, tc.headers...)
			if w.Code != tc.want || errorCode(t, w) != tc.wantCode {
				t.Fatalf("status %d code %q, want %d %q: %s", w.Code, errorCode(t, w), tc.want, tc.wantCode, w.Body)
			}
		})
	}
}

func TestCreateIsAudited(t *testing.T) {
	h := newHarness(t, false, nil)
	if w := h.do(http.MethodPost, "/api/v1/namespaces/b/networkpolicies?dryRun=true", webPolicyYAML); w.Code != http.StatusCreated {
		t.Fatalf("dry-run status %d", w.Code)
	}
	if n := len(h.audit.List(audit.Filter{})); n != 0 {
		t.Fatalf("dry-runs must not be audited, got %d entries", n)
	}
	_ = h.cs.Tracker().Delete(networkingv1.SchemeGroupVersion.WithResource("networkpolicies"), "b", "allow-web")

	if w := h.do(http.MethodPost, "/api/v1/namespaces/b/networkpolicies", webPolicyYAML); w.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	entries := h.audit.List(audit.Filter{})
	if len(entries) != 1 || entries[0].Action != "create" || entries[0].User != "anonymous" ||
		entries[0].Result != audit.ResultSuccess || !strings.Contains(entries[0].After, "allow-web") {
		t.Fatalf("audit = %+v", entries)
	}

	// A conflicting create is audited as a failure.
	if w := h.do(http.MethodPost, "/api/v1/namespaces/b/networkpolicies", webPolicyYAML); w.Code != http.StatusConflict {
		t.Fatalf("duplicate status %d", w.Code)
	}
	if e := h.audit.List(audit.Filter{})[0]; e.Result != audit.ResultFailure || e.Error == "" {
		t.Fatalf("failure entry = %+v", e)
	}

	w := h.do(http.MethodGet, "/api/v1/audit?action=create", "")
	var got []audit.Entry
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || len(got) != 2 {
		t.Fatalf("GET /audit = %s (%v)", w.Body, err)
	}
}

func TestExportStripsServerFields(t *testing.T) {
	h := newHarness(t, false, nil, denyAll("a"), denyAll("b"))
	w := h.do(http.MethodGet, "/api/v1/networkpolicies/export?namespace=a", "")
	body := w.Body.String()
	if w.Code != http.StatusOK || strings.Count(body, "kind: NetworkPolicy") != 1 {
		t.Fatalf("export = %d %s", w.Code, body)
	}
	for _, forbidden := range []string{"resourceVersion", lastAppliedAnno, "namespace: b"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("export contains %q:\n%s", forbidden, body)
		}
	}
	if !strings.Contains(body, "owner: platform") {
		t.Errorf("export dropped user annotations:\n%s", body)
	}
	if !strings.Contains(w.Header().Get("Content-Disposition"), "networkpolicies-a.yaml") {
		t.Errorf("Content-Disposition = %q", w.Header().Get("Content-Disposition"))
	}
}

func TestImport(t *testing.T) {
	existing := denyAll("a")
	h := newHarness(t, false, nil, existing)

	changed := strings.Replace(webPolicyYAML, "name: allow-web", "name: deny-all", 1)
	body := `---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: deny-all, namespace: a, annotations: {owner: platform}}
spec: {podSelector: {}, policyTypes: [Ingress]}
---
` + webPolicyYAML + "---\n" + strings.Replace(changed, "metadata:\n", "metadata:\n  namespace: b\n", 1) +
		`---
apiVersion: v1
kind: List
items:
  - apiVersion: networking.k8s.io/v1
    kind: NetworkPolicy
    metadata: {name: listed, namespace: a}
    spec: {podSelector: {}}
`
	w := h.do(http.MethodPost, "/api/v1/networkpolicies/import?namespace=b", body)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var out struct {
		Summary map[string]int `json:"summary"`
		Results []ImportResult `json:"results"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	want := []string{"a/deny-all:unchanged", "b/allow-web:created", "b/deny-all:created", "a/listed:created"}
	if len(out.Results) != len(want) {
		t.Fatalf("results = %+v", out.Results)
	}
	for i, r := range out.Results {
		if got := r.Namespace + "/" + r.Name + ":" + r.Action; got != want[i] {
			t.Errorf("result %d = %s (%s), want %s", i, got, r.Error, want[i])
		}
	}

	// Re-importing with a changed spec updates in place.
	updated := strings.Replace(webPolicyYAML, "podSelector: {}", "podSelector: {matchLabels: {app: web}}", 1)
	w = h.do(http.MethodPost, "/api/v1/networkpolicies/import?namespace=b", updated)
	if !strings.Contains(w.Body.String(), `"action":"updated"`) {
		t.Fatalf("re-import = %s", w.Body)
	}

	for name, bad := range map[string]string{
		"unknown field": "kind: NetworkPolicy\nmetadata: {name: x, namespace: a}\nspec: {podSelectr: {}}\n",
		"wrong kind":    "kind: ConfigMap\nmetadata: {name: x, namespace: a}\n",
		"no namespace":  "kind: NetworkPolicy\nmetadata: {name: x}\nspec: {podSelector: {}}\n",
		"empty":         "---\n",
	} {
		t.Run(name, func(t *testing.T) {
			if w := h.do(http.MethodPost, "/api/v1/networkpolicies/import", bad); w.Code != http.StatusBadRequest {
				t.Fatalf("status %d: %s", w.Code, w.Body)
			}
		})
	}
}

func TestImpactEndpoint(t *testing.T) {
	h := newHarness(t, false, nil)
	body, _ := json.Marshal(map[string]string{"namespace": "b", "yaml": strings.Replace(webPolicyYAML, "- podSelector: {}", "- podSelector: {matchLabels: {app: none}}", 1)})
	w := h.do(http.MethodPost, "/api/v1/impact", string(body))
	var res struct {
		NewlyBlocked []struct{ Source, Target string } `json:"newlyBlocked"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil || w.Code != http.StatusOK {
		t.Fatalf("impact = %d %s", w.Code, w.Body)
	}
	if len(res.NewlyBlocked) != 1 || res.NewlyBlocked[0].Source != "a/deployment/web" {
		t.Fatalf("newlyBlocked = %+v", res.NewlyBlocked)
	}

	if w := h.do(http.MethodPost, "/api/v1/impact", `{"operation":"delete"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("delete without identity status %d", w.Code)
	}
}

func TestPostureAndSecurityHeaders(t *testing.T) {
	h := newHarness(t, false, nil, denyAll("b"))
	w := h.do(http.MethodGet, "/api/v1/posture", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"NAMESPACE_UNPROTECTED"`) {
		t.Fatalf("posture = %d %s", w.Code, w.Body)
	}
	for _, hdr := range []string{"Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options"} {
		if w.Header().Get(hdr) == "" {
			t.Errorf("missing %s", hdr)
		}
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("API responses must not be cached")
	}
}

func TestProxyAuthRequired(t *testing.T) {
	authn, err := auth.New(auth.Config{Mode: auth.ModeProxy, Base: &rest.Config{Host: "https://k8s"}})
	if err != nil {
		t.Fatal(err)
	}
	h := newHarness(t, false, authn)
	if w := h.do(http.MethodGet, "/api/v1/namespaces", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status %d", w.Code)
	}
	w := h.do(http.MethodGet, "/api/v1/auth/me", "", "X-Forwarded-User", "dana")
	if !strings.Contains(w.Body.String(), `"name":"dana"`) || !strings.Contains(w.Body.String(), `"mode":"proxy"`) {
		t.Fatalf("me = %s", w.Body)
	}
	if w := h.do(http.MethodGet, "/api/v1/namespaces", "", "X-Forwarded-User", "dana"); w.Code != http.StatusOK {
		t.Fatalf("authenticated status %d", w.Code)
	}
}

func TestNamespaceTopology(t *testing.T) {
	h := newHarness(t, false, nil, denyAll("b"))
	w := h.do(http.MethodGet, "/api/v1/topology?level=namespace", "")
	var res struct {
		Level string `json:"level"`
		Nodes []struct {
			Namespace string `json:"namespace"`
		} `json:"nodes"`
		Edges []struct {
			Source, Target string
			Counts         struct{ Allowed, Blocked, Unconstrained int }
		} `json:"edges"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil || w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if res.Level != "namespace" || len(res.Nodes) != 2 || len(res.Edges) != 2 {
		t.Fatalf("graph = %+v", res)
	}
	for _, e := range res.Edges {
		if e.Source == "a" && e.Counts.Blocked != 1 {
			t.Errorf("a -> b should be blocked by b's default deny: %+v", e)
		}
	}
}
