package simulator

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func findingCodes(r PostureReport, ns string) map[string]string {
	out := map[string]string{}
	for _, f := range r.Findings {
		if f.Namespace == ns {
			out[f.Code] = f.Severity
		}
	}
	return out
}

func TestAnalyzeFindings(t *testing.T) {
	denyAllIngressB := policy("b", "deny-all", networkingv1.NetworkPolicySpec{
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
	})
	denyEgressA := policy("a", "deny-egress", networkingv1.NetworkPolicySpec{
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
	})
	dnsAllowA := egressPolicy("a", "allow-dns", nil, networkingv1.NetworkPolicyEgressRule{
		Ports: []networkingv1.NetworkPolicyPort{
			{Port: intOrStringPtr(53), Protocol: protoPtr(corev1.ProtocolUDP)},
			{Port: intOrStringPtr(53), Protocol: protoPtr(corev1.ProtocolTCP)},
		},
	})

	cases := []struct {
		name    string
		pols    []*networkingv1.NetworkPolicy
		ns      string
		want    map[string]string // code -> severity that MUST be present
		wantNot []string          // codes that must be absent
	}{
		{
			name: "no policies: namespace unprotected",
			ns:   "a",
			want: map[string]string{"NAMESPACE_UNPROTECTED": SeverityWarning},
		},
		{
			name: "system namespace findings are downgraded",
			ns:   "kube-system",
			want: map[string]string{"NAMESPACE_UNPROTECTED": SeverityInfo},
		},
		{
			name:    "default-deny ingress protects the namespace",
			pols:    []*networkingv1.NetworkPolicy{denyAllIngressB},
			ns:      "b",
			wantNot: []string{"NAMESPACE_UNPROTECTED", "PODS_NOT_ISOLATED", "POLICY_SELECTS_NOTHING"},
		},
		{
			name: "egress isolation without DNS allow is critical",
			pols: []*networkingv1.NetworkPolicy{denyEgressA},
			ns:   "a",
			want: map[string]string{"DNS_EGRESS_BLOCKED": SeverityCritical},
		},
		{
			name:    "DNS allow rule clears the DNS trap",
			pols:    []*networkingv1.NetworkPolicy{denyEgressA, dnsAllowA},
			ns:      "a",
			wantNot: []string{"DNS_EGRESS_BLOCKED"},
		},
		{
			name: "selector matching no pods",
			pols: []*networkingv1.NetworkPolicy{ingressPolicy("b", "typo", map[string]string{"app": "dbb"})},
			ns:   "b",
			want: map[string]string{"POLICY_SELECTS_NOTHING": SeverityWarning, "NAMESPACE_UNPROTECTED": SeverityWarning},
		},
		{
			name: "allow-all ingress rule cancels isolation",
			pols: []*networkingv1.NetworkPolicy{ingressPolicy("b", "open", nil, networkingv1.NetworkPolicyIngressRule{})},
			ns:   "b",
			want: map[string]string{"ALLOW_ALL_INGRESS": SeverityWarning},
		},
		{
			name: "peer selector with a label typo",
			pols: []*networkingv1.NetworkPolicy{ingressPolicy("b", "peer-typo", map[string]string{"app": "db"},
				networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{{
					NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "alfa"}},
				}}})},
			ns:   "b",
			want: map[string]string{"PEER_MATCHES_NOTHING": SeverityWarning},
		},
		{
			name: "peer selector that matches is not flagged",
			pols: []*networkingv1.NetworkPolicy{ingressPolicy("b", "peer-ok", map[string]string{"app": "db"},
				networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{{
					NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "alpha"}},
					PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
				}}})},
			ns:      "b",
			wantNot: []string{"PEER_MATCHES_NOTHING"},
		},
		{
			name: "ingress from 0.0.0.0/0",
			pols: []*networkingv1.NetworkPolicy{ingressPolicy("b", "world", map[string]string{"app": "db"},
				networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{{
					IPBlock: &networkingv1.IPBlock{CIDR: "0.0.0.0/0"},
				}}})},
			ns:   "b",
			want: map[string]string{"IPBLOCK_ANY": SeverityWarning},
		},
		{
			name: "0.0.0.0/0 with exceptions is not flagged",
			pols: []*networkingv1.NetworkPolicy{ingressPolicy("b", "world-but", map[string]string{"app": "db"},
				networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{{
					IPBlock: &networkingv1.IPBlock{CIDR: "0.0.0.0/0", Except: []string{"10.0.0.0/8"}},
				}}})},
			ns:      "b",
			wantNot: []string{"IPBLOCK_ANY"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := findingCodes(Analyze(snap(tc.pols...)), tc.ns)
			for code, sev := range tc.want {
				if got[code] != sev {
					t.Errorf("finding %s severity = %q, want %q (all: %v)", code, got[code], sev, got)
				}
			}
			for _, code := range tc.wantNot {
				if _, ok := got[code]; ok {
					t.Errorf("unexpected finding %s (all: %v)", code, got)
				}
			}
		})
	}
}

func TestAnalyzeCoverageAndScore(t *testing.T) {
	denyAllA := policy("a", "deny-all", networkingv1.NetworkPolicySpec{
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress},
		Egress: []networkingv1.NetworkPolicyEgressRule{{
			Ports: []networkingv1.NetworkPolicyPort{{Port: intOrStringPtr(53), Protocol: protoPtr(corev1.ProtocolUDP)}},
		}},
	})
	denyAllB := policy("b", "deny-all", networkingv1.NetworkPolicySpec{
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
	})

	cases := []struct {
		name        string
		pols        []*networkingv1.NetworkPolicy
		wantIngress int
		wantEgress  int
		wantScore   int
		wantDenyInA bool
		wantDenyEgA bool
	}{
		// Application pods: web-1 (a), db-1 (b). kube-system is excluded.
		{name: "nothing isolated", wantScore: 0},
		{
			name: "allow-all rule is not a default-deny", pols: []*networkingv1.NetworkPolicy{policy("a", "open", networkingv1.NetworkPolicySpec{
				PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
				Ingress:     []networkingv1.NetworkPolicyIngressRule{{}},
			})},
			wantIngress: 1, wantScore: 30 - 3 - 3, // ALLOW_ALL_INGRESS + b unprotected
		},
		{name: "one of two ingress-isolated", pols: []*networkingv1.NetworkPolicy{denyAllB}, wantIngress: 1, wantScore: 27},
		{
			name: "fully isolated both ways in a", pols: []*networkingv1.NetworkPolicy{denyAllA, denyAllB},
			wantIngress: 2, wantEgress: 1, wantScore: 80, wantDenyInA: true, wantDenyEgA: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := Analyze(snap(tc.pols...))
			if r.Summary.Pods != 2 {
				t.Fatalf("Summary.Pods = %d, want 2 (system namespaces excluded)", r.Summary.Pods)
			}
			if r.Summary.IngressIsolatedPods != tc.wantIngress || r.Summary.EgressIsolatedPods != tc.wantEgress {
				t.Errorf("isolated ingress/egress = %d/%d, want %d/%d",
					r.Summary.IngressIsolatedPods, r.Summary.EgressIsolatedPods, tc.wantIngress, tc.wantEgress)
			}
			if r.Summary.Score != tc.wantScore {
				t.Errorf("Score = %d, want %d (summary %+v, findings %+v)", r.Summary.Score, tc.wantScore, r.Summary, r.Findings)
			}
			var a NamespacePosture
			for _, np := range r.Namespaces {
				if np.Namespace == "a" {
					a = np
				}
			}
			if a.DefaultDenyIngress != tc.wantDenyInA || a.DefaultDenyEgress != tc.wantDenyEgA {
				t.Errorf("namespace a default-deny ingress/egress = %v/%v, want %v/%v",
					a.DefaultDenyIngress, a.DefaultDenyEgress, tc.wantDenyInA, tc.wantDenyEgA)
			}
		})
	}
}

func TestAnalyzeHostNetworkExcluded(t *testing.T) {
	s := snap()
	s.Pods[0].HostNetwork = true
	r := Analyze(s)
	if r.Summary.Pods != 1 {
		t.Fatalf("Summary.Pods = %d, want 1 (hostNetwork pods are not isolatable)", r.Summary.Pods)
	}
	if _, ok := findingCodes(r, "a")["NAMESPACE_UNPROTECTED"]; ok {
		t.Fatal("namespace with only hostNetwork pods must not be flagged unprotected")
	}
}

func TestFilterPosture(t *testing.T) {
	full := Analyze(snap(policy("b", "deny", networkingv1.NetworkPolicySpec{
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
	})))
	full.Findings = append(full.Findings, Finding{Code: "CLUSTER_WIDE", Severity: SeverityInfo, Message: "x"})

	onlyB := FilterPosture(full, func(ns string) bool { return ns == "b" })
	if len(onlyB.Namespaces) != 1 || onlyB.Namespaces[0].Namespace != "b" {
		t.Fatalf("namespaces = %+v", onlyB.Namespaces)
	}
	for _, f := range onlyB.Findings {
		if f.Namespace != "" && f.Namespace != "b" {
			t.Errorf("leaked finding from %s: %+v", f.Namespace, f)
		}
	}
	if s := onlyB.Summary; s.Pods != 1 || s.IngressIsolatedPods != 1 || s.Policies != 1 || s.Score != 60 {
		t.Errorf("summary = %+v, want 1 pod fully ingress-isolated, score 60", s)
	}

	all := FilterPosture(full, func(string) bool { return true })
	if all.Summary.Pods != full.Summary.Pods || len(all.Findings) != len(full.Findings) || len(all.Namespaces) != len(full.Namespaces) {
		t.Errorf("identity filter changed the report: %+v vs %+v", all.Summary, full.Summary)
	}
	if all.Summary.Info != full.Summary.Info+1 {
		t.Errorf("summary not recomputed from findings: info %d, want %d", all.Summary.Info, full.Summary.Info+1)
	}
}
