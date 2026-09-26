package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	authorizationv1 "k8s.io/api/authorization/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	k8stesting "k8s.io/client-go/testing"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/audit"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/auth"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/cni"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/demo"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/flows"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

type fakeStore struct {
	snap *kube.ClusterSnapshot
	gen  uint64
}

func (f *fakeStore) Snapshot() (*kube.ClusterSnapshot, error) { return f.snap, nil }
func (f *fakeStore) Synced() bool                             { return true }
func (f *fakeStore) Events() <-chan kube.Event                { return make(chan kube.Event) }
func (f *fakeStore) Generation() uint64                       { return f.gen }

func denyAll(ns string) *networkingv1.NetworkPolicy {
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: "deny-all", ResourceVersion: "1",
			Annotations: map[string]string{lastAppliedAnno: "{}", "owner": "platform"}},
		Spec: networkingv1.NetworkPolicySpec{PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}},
	}
}

type harness struct {
	snap   *kube.ClusterSnapshot
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
		// The API server labels every namespace with its name (1.21+).
		Namespaces: []kube.NamespaceInfo{
			{Name: "a", Labels: map[string]string{"kubernetes.io/metadata.name": "a"}},
			{Name: "b", Labels: map[string]string{"kubernetes.io/metadata.name": "b"}},
		},
		Policies: pols,
	}
	cs := fake.NewClientset()
	for _, verb := range []string{"create", "update", "delete"} {
		cs.PrependReactor(verb, "networkpolicies", demo.DryRunReactor)
	}
	for _, p := range pols {
		_ = cs.Tracker().Add(p)
	}
	log := audit.New(10, slog.New(slog.NewTextHandler(io.Discard, nil)))
	srv := NewServer(Options{
		Store: &fakeStore{snap: snap}, Clientset: cs, CNI: cni.Result{Provider: "calico", EnforcesPolicies: true},
		ReadOnly: readOnly, Auth: authn, Audit: log, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	t.Cleanup(srv.Close)
	r := chi.NewRouter()
	r.Use(SecurityHeaders(false))
	srv.Routes(r)
	return &harness{snap: snap, t: t, router: r, cs: cs, audit: log}
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

func TestRestrictReadsHidesOtherTenants(t *testing.T) {
	// tenant-a may list NetworkPolicies only in namespace "a".
	newClient := func(c *rest.Config) (kubernetes.Interface, error) {
		cs := fake.NewClientset()
		cs.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
			review := action.(k8stesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
			review.Status.Allowed = c.Impersonate.UserName == "tenant-a" && review.Spec.ResourceAttributes.Namespace == "a"
			return true, review, nil
		})
		return cs, nil
	}
	authn, err := auth.New(auth.Config{Mode: auth.ModeProxy, Base: &rest.Config{Host: "https://k8s"}, RestrictReads: true, NewClient: newClient})
	if err != nil {
		t.Fatal(err)
	}
	h := newHarness(t, false, authn, denyAll("a"), denyAll("b"))
	h.audit.Record(audit.Entry{User: "x", Action: "create", Namespace: "b", Name: "secret-b", Result: audit.ResultSuccess})
	as := []string{"X-Forwarded-User", "tenant-a"}

	cases := []struct {
		path       string
		wantStatus int
		mustHave   string
		mustNot    string
	}{
		{"/api/v1/namespaces", 200, `"name":"a"`, `"name":"b"`},
		{"/api/v1/networkpolicies", 200, `"namespace":"a"`, `"namespace":"b"`},
		{"/api/v1/pods", 200, `"web-1"`, `"db-1"`},
		{"/api/v1/namespaces/b/networkpolicies/deny-all", 404, "", ""},
		{"/api/v1/namespaces/b/pods", 404, "", ""},
		{"/api/v1/namespaces/b/isolation", 404, "", ""},
		{"/api/v1/networkpolicies/export", 200, "namespace: a", "namespace: b"},
		{"/api/v1/posture", 200, `"namespace":"a"`, `"namespace":"b"`},
		{"/api/v1/topology?level=namespace", 200, `"namespace":"a"`, `"namespace":"b"`},
		{"/api/v1/topology?namespaces=a,b", 200, `a/deployment/web`, `statefulset/db`},
		{"/api/v1/audit", 200, "[]", "secret-b"},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			w := h.do(http.MethodGet, tc.path, "", as...)
			body := w.Body.String()
			if w.Code != tc.wantStatus {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.wantStatus, body)
			}
			if tc.mustHave != "" && !strings.Contains(body, tc.mustHave) {
				t.Errorf("missing %q in %s", tc.mustHave, body)
			}
			if tc.mustNot != "" && strings.Contains(body, tc.mustNot) {
				t.Errorf("leaked %q in %s", tc.mustNot, body)
			}
		})
	}

	sim := `{"source":{"kind":"pod","namespace":"a","name":"web-1"},"destination":{"kind":"pod","namespace":"b","name":"db-1"}}`
	if w := h.do(http.MethodPost, "/api/v1/simulate", sim, as...); w.Code != http.StatusNotFound {
		t.Errorf("simulating into a hidden namespace: status %d", w.Code)
	}
	if w := h.do(http.MethodPost, "/api/v1/impact", `{"operation":"delete","namespace":"b","name":"deny-all"}`, as...); w.Code != http.StatusNotFound {
		t.Errorf("impact in a hidden namespace: status %d", w.Code)
	}
	w := h.do(http.MethodGet, "/api/v1/auth/me", "", as...)
	if !strings.Contains(w.Body.String(), `"restrictReads":true`) {
		t.Errorf("me = %s", w.Body)
	}
}

func TestPostureReportDownloads(t *testing.T) {
	h := newHarness(t, false, nil, denyAll("b"))
	cases := []struct {
		format, contentType, mustHave string
	}{
		{"", "text/markdown", "# NetworkPolicy posture report"},
		{"md", "text/markdown", "| b | 1 | 1 | 100% |"},
		{"csv", "text/csv", "severity,code,namespace,policy,message"},
		{"json", "application/json", `"generatedAt"`},
	}
	for _, tc := range cases {
		t.Run("format="+tc.format, func(t *testing.T) {
			w := h.do(http.MethodGet, "/api/v1/posture/report?format="+tc.format, "")
			if w.Code != http.StatusOK || !strings.HasPrefix(w.Header().Get("Content-Type"), tc.contentType) {
				t.Fatalf("status %d type %q", w.Code, w.Header().Get("Content-Type"))
			}
			if !strings.Contains(w.Header().Get("Content-Disposition"), "attachment") {
				t.Errorf("not a download: %q", w.Header().Get("Content-Disposition"))
			}
			if !strings.Contains(w.Body.String(), tc.mustHave) {
				t.Errorf("missing %q in:\n%s", tc.mustHave, w.Body)
			}
		})
	}
	if w := h.do(http.MethodGet, "/api/v1/posture/report?format=pdf", ""); w.Code != http.StatusBadRequest {
		t.Errorf("unknown format status %d", w.Code)
	}
}

func TestAccessPlanAndApply(t *testing.T) {
	// b/db is default-deny ingress; allow a/web -> b/db through the planner.
	h := newHarness(t, false, nil, denyAll("b"))

	w := h.do(http.MethodGet, "/api/v1/access?namespace=a&pod=web-1", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"workload":"deployment/web"`) {
		t.Fatalf("access = %d %s", w.Code, w.Body)
	}

	req := `{"subject":{"namespace":"a","workload":"deployment/web"},"direction":"outbound",
	         "peer":{"kind":"workload","namespace":"b","workload":"statefulset/db"},"action":"allow"}`
	w = h.do(http.MethodPost, "/api/v1/access/plan", req)
	var plan struct {
		Signature string `json:"signature"`
		Verified  bool   `json:"verified"`
		Changes   []struct {
			Operation, Namespace, Name, After string
		} `json:"changes"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &plan); err != nil || w.Code != http.StatusOK {
		t.Fatalf("plan = %d %s", w.Code, w.Body)
	}
	if !plan.Verified || len(plan.Changes) != 1 || plan.Changes[0].Name != "fwui-db-ingress" ||
		!strings.Contains(plan.Changes[0].After, "app.kubernetes.io/managed-by: k8s-firewall-ui") {
		t.Fatalf("plan = %+v", plan)
	}

	// Applying with a stale signature is refused.
	stale := strings.Replace(req, `"action":"allow"}`, `"action":"allow","signature":"stale"}`, 1)
	if w := h.do(http.MethodPost, "/api/v1/access/apply", stale); w.Code != http.StatusConflict {
		t.Fatalf("stale apply status %d", w.Code)
	}
	signed := strings.Replace(req, `"action":"allow"}`, `"action":"allow","signature":"`+plan.Signature+`"}`, 1)
	w = h.do(http.MethodPost, "/api/v1/access/apply", signed)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"operation":"create"`) {
		t.Fatalf("apply = %d %s", w.Code, w.Body)
	}
	if _, err := h.cs.NetworkingV1().NetworkPolicies("b").Get(t.Context(), "fwui-db-ingress", metav1.GetOptions{}); err != nil {
		t.Fatalf("policy not created: %v", err)
	}
	if e := h.audit.List(audit.Filter{}); len(e) != 1 || e[0].Name != "fwui-db-ingress" {
		t.Fatalf("apply not audited: %+v", e)
	}

	// Writes go through the write guard (read-only instances refuse).
	ro := newHarness(t, true, nil, denyAll("b"))
	if w := ro.do(http.MethodPost, "/api/v1/access/apply", signed); w.Code != http.StatusForbidden {
		t.Fatalf("read-only apply status %d", w.Code)
	}
}

func TestObservedFlowsAndLearning(t *testing.T) {
	h := newHarness(t, false, nil)
	// Rebuild the server with flow collection enabled.
	store := flows.NewStore(0, time.Hour)
	srv := NewServer(Options{
		Store: &fakeStore{snap: h.snap}, Clientset: h.cs, CNI: cni.Result{Provider: "calico", EnforcesPolicies: true},
		Audit: h.audit, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Flows: store, AgentToken: "s3cret",
	})
	t.Cleanup(srv.Close)
	r := chi.NewRouter()
	srv.Routes(r)
	h.router = r

	report := `{"node":"n1","flows":[
	  {"protocol":"TCP","src":"10.0.0.1","dst":"10.0.0.2","dstPort":5432},
	  {"protocol":"TCP","src":"10.0.0.1","dst":"93.184.216.34","dstPort":443},
	  {"protocol":"TCP","src":"192.168.9.9","dst":"192.168.9.10","dstPort":22}]}`
	if w := h.do(http.MethodPost, "/api/v1/flows/ingest", report, "Authorization", "Bearer wrong"); w.Code != http.StatusUnauthorized {
		t.Fatalf("bad token status %d", w.Code)
	}
	w := h.do(http.MethodPost, "/api/v1/flows/ingest", report, "Authorization", "Bearer s3cret")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"accepted":2`) {
		t.Fatalf("ingest = %d %s (host-only flow must be dropped)", w.Code, w.Body)
	}

	w = h.do(http.MethodGet, "/api/v1/flows?namespace=a&workload=deployment/web", "")
	var view struct {
		Outbound []struct {
			Peer       struct{ Kind, Namespace, Workload, CIDR string }
			AllowedNow bool
			Ports      []struct{ Port int }
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil || len(view.Outbound) != 2 {
		t.Fatalf("flows = %d %s", w.Code, w.Body)
	}
	for _, row := range view.Outbound {
		if !row.AllowedNow {
			t.Errorf("nothing is isolated, so %+v must be allowed now", row.Peer)
		}
	}

	w = h.do(http.MethodPost, "/api/v1/flows/learn/plan", `{"subject":{"namespace":"a","workload":"deployment/web"},"direction":"outbound"}`)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "fwui-web-egress") ||
		!strings.Contains(w.Body.String(), "93.184.216.34/32") || !strings.Contains(w.Body.String(), `"verified":true`) {
		t.Fatalf("learn plan = %d %s", w.Code, w.Body)
	}
}
