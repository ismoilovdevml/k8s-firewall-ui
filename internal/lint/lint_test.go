package lint

import (
	"bytes"
	"strings"
	"testing"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

func codes(fs []Finding) map[string]string {
	out := map[string]string{}
	for _, f := range fs {
		out[f.Code] = f.Severity
	}
	return out
}

func parse(t *testing.T, y string) []Doc {
	t.Helper()
	docs, _, errs := parseStream("test.yaml", strings.NewReader(y))
	if len(errs) > 0 {
		t.Fatalf("parse errors: %v", errs)
	}
	return docs
}

const head = "apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\n"

func TestStatic(t *testing.T) {
	cases := []struct {
		name    string
		yaml    string
		want    map[string]string
		wantNot []string
	}{
		{
			name:    "clean default deny",
			yaml:    head + "metadata: {name: deny, namespace: a}\nspec: {podSelector: {}, policyTypes: [Ingress]}\n",
			wantNot: []string{"MISSING_POLICY_TYPES", "MISSING_NAMESPACE", "ALLOW_ALL_INGRESS"},
		},
		{
			name: "implicit policyTypes and no namespace",
			yaml: head + "metadata: {name: x}\nspec: {podSelector: {}}\n",
			want: map[string]string{"MISSING_POLICY_TYPES": "warning", "MISSING_NAMESPACE": "warning"},
		},
		{
			name: "allow-all ingress rule",
			yaml: head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}, policyTypes: [Ingress], ingress: [{}]}\n",
			want: map[string]string{"ALLOW_ALL_INGRESS": "warning"},
		},
		{
			name: "empty peer is rejected by the API server",
			yaml: head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}, policyTypes: [Ingress], ingress: [{from: [{}]}]}\n",
			want: map[string]string{"EMPTY_PEER": "critical"},
		},
		{
			name: "bad CIDR and bad except",
			yaml: head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}, policyTypes: [Egress], egress: [{to: [{ipBlock: {cidr: 10.0.0.0/33}}, {ipBlock: {cidr: 10.0.0.0/8, except: [192.168.0.0/16]}}]}]}\n",
			want: map[string]string{"INVALID_CIDR": "critical", "INVALID_EXCEPT": "critical"},
		},
		{
			name: "ingress from anywhere",
			yaml: head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}, policyTypes: [Ingress], ingress: [{from: [{ipBlock: {cidr: 0.0.0.0/0}}]}]}\n",
			want: map[string]string{"IPBLOCK_ANY": "warning"},
		},
		{
			name: "egress rules ignored without the Egress type",
			yaml: head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}, policyTypes: [Ingress], egress: [{ports: [{port: 443}]}]}\n",
			want: map[string]string{"IGNORED_EGRESS_RULES": "warning"},
		},
		{
			name: "egress isolation without DNS",
			yaml: head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}, policyTypes: [Egress], egress: [{ports: [{port: 443}]}]}\n",
			want: map[string]string{"DNS_EGRESS_BLOCKED": "warning"},
		},
		{
			name:    "DNS allowed elsewhere in the same namespace",
			yaml:    head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}, policyTypes: [Egress]}\n---\n" + head + "metadata: {name: dns, namespace: a}\nspec: {podSelector: {}, policyTypes: [Egress], egress: [{ports: [{port: 53, protocol: UDP}]}]}\n",
			wantNot: []string{"DNS_EGRESS_BLOCKED"},
		},
		{
			name: "duplicate name",
			yaml: head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}, policyTypes: [Ingress]}\n---\n" + head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}, policyTypes: [Ingress]}\n",
			want: map[string]string{"DUPLICATE_POLICY": "critical"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := codes(Static(parse(t, tc.yaml)))
			for code, sev := range tc.want {
				if got[code] != sev {
					t.Errorf("%s = %q, want %q (all %v)", code, got[code], sev, got)
				}
			}
			for _, code := range tc.wantNot {
				if _, ok := got[code]; ok {
					t.Errorf("unexpected %s (all %v)", code, got)
				}
			}
		})
	}
}

func TestParseStreamLinesAndSkips(t *testing.T) {
	y := "# comment\napiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\n---\n\n" +
		head + "metadata: {name: p, namespace: a}\nspec: {podSelector: {}}\n---\napiVersion: v1\nkind: List\nitems:\n- " +
		"{apiVersion: networking.k8s.io/v1, kind: NetworkPolicy, metadata: {name: q, namespace: a}, spec: {podSelector: {}}}\n"
	docs, skipped, errs := parseStream("f.yaml", strings.NewReader(y))
	if len(errs) != 0 || skipped != 1 || len(docs) != 2 {
		t.Fatalf("docs=%d skipped=%d errs=%v", len(docs), skipped, errs)
	}
	if docs[0].Source.Line != 7 || docs[0].Policy.Name != "p" {
		t.Errorf("first policy at line %d, want 7", docs[0].Source.Line)
	}
	if _, _, errs := parseStream("bad.yaml", strings.NewReader(head+"metadata: {name: x}\nspec: {podSelectr: {}}\n")); len(errs) != 1 {
		t.Errorf("unknown field must be a parse error, got %v", errs)
	}
}

func TestOverlayReportsOnlyNewFindingsAndImpact(t *testing.T) {
	snap := &simulator.Snapshot{
		Pods: []kube.PodInfo{
			{Name: "web-1", Namespace: "a", Owner: "deployment/web", Labels: map[string]string{"app": "web"}, IP: "10.0.0.1"},
			{Name: "db-1", Namespace: "b", Owner: "deployment/db", Labels: map[string]string{"app": "db"}, IP: "10.0.0.2"},
		},
		Namespaces: []kube.NamespaceInfo{
			{Name: "a", Labels: map[string]string{"kubernetes.io/metadata.name": "a"}},
			{Name: "b", Labels: map[string]string{"kubernetes.io/metadata.name": "b"}},
		},
		Policies: []*networkingv1.NetworkPolicy{{
			// Pre-existing problem: must NOT be reported as new.
			ObjectMeta: metav1.ObjectMeta{Namespace: "a", Name: "stale"},
			Spec: networkingv1.NetworkPolicySpec{PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{"app": "gone"}},
				PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}},
		}},
	}
	docs := parse(t, head+"metadata: {name: db-in, namespace: b}\nspec:\n  podSelector: {matchLabels: {app: db}}\n  policyTypes: [Ingress]\n  ingress: [{from: [{podSelector: {matchLabels: {app: wbe}}}]}]\n")
	found, impact := Overlay(snap, docs, "default")
	got := codes(found)
	if got["PEER_MATCHES_NOTHING"] == "" {
		t.Errorf("the label typo (app: wbe) must be caught: %v", got)
	}
	for _, f := range found {
		if f.Policy == "a/stale" {
			t.Errorf("pre-existing finding reported as new: %+v", f)
		}
		if f.Code == "PEER_MATCHES_NOTHING" && (f.Source == nil || f.Source.Line != 1) {
			t.Errorf("finding not mapped back to its manifest: %+v", f)
		}
	}
	if len(impact.NewlyBlocked) != 1 || impact.NewlyBlocked[0].Source != "a/deployment/web" {
		t.Errorf("impact = %+v, want web -> db newly blocked", impact.NewlyBlocked)
	}
}

func TestMainExitCodesAndFormats(t *testing.T) {
	bad := head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}, policyTypes: [Ingress], ingress: [{from: [{}]}]}\n"
	warnOnly := head + "metadata: {name: x, namespace: a}\nspec: {podSelector: {}}\n"
	run := func(input string, args ...string) (int, string) {
		var out, errb bytes.Buffer
		code := Main(append(args, "-"), strings.NewReader(input), &out, &errb, nil)
		return code, out.String() + errb.String()
	}
	if code, _ := run(bad); code != 1 {
		t.Errorf("critical finding: exit %d, want 1", code)
	}
	if code, _ := run(warnOnly, "--fail-on", "critical"); code != 0 {
		t.Errorf("warning below threshold: exit %d, want 0", code)
	}
	var out bytes.Buffer
	if code := Main([]string{"-", "--fail-on", "critical"}, strings.NewReader(warnOnly), &out, &out, nil); code != 0 {
		t.Errorf("warning below threshold: exit %d, want 0", code)
	}
	if code, out := run(bad, "--format", "github"); code != 1 || !strings.Contains(out, "::error file=<stdin>,line=1,title=EMPTY_PEER a/x::") {
		t.Errorf("github format: %d\n%s", code, out)
	}
	if code, out := run(warnOnly, "--format", "json", "--fail-on", "none"); code != 0 || !strings.Contains(out, `"code": "MISSING_POLICY_TYPES"`) {
		t.Errorf("json format: %d\n%s", code, out)
	}
	if code, _ := run(head + "metadata: {name: x}\nspec: {podSelectr: {}}\n"); code != 2 {
		t.Errorf("parse error: exit %d, want 2", code)
	}
	if code := Main(nil, nil, &bytes.Buffer{}, &bytes.Buffer{}, nil); code != 2 {
		t.Errorf("no paths: exit %d, want 2", code)
	}
}
