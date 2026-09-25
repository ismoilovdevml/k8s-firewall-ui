package simulator

import (
	"testing"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func impactSnap(pols ...*networkingv1.NetworkPolicy) *Snapshot {
	pods := basePods()
	pods[0].Owner = "deployment/web"
	pods[1].Owner = "statefulset/db"
	pods[2].Owner = "deployment/coredns"
	// A second replica collapses into the same workload.
	web2 := pods[0]
	web2.Name, web2.IP = "web-2", "10.1.0.11"
	pods = append(pods, web2)
	return &Snapshot{Pods: pods, Namespaces: baseNamespaces(), Policies: pols}
}

func edgeSet(edges []ImpactEdge) map[string]bool {
	out := map[string]bool{}
	for _, e := range edges {
		out[e.Source+"->"+e.Target] = true
	}
	return out
}

func TestImpact(t *testing.T) {
	denyAllB := policy("b", "deny-all", networkingv1.NetworkPolicySpec{
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
	})
	allowWebToDB := ingressPolicy("b", "allow-web", map[string]string{"app": "db"},
		networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "alpha"}},
		}}})
	denyEgressA := policy("a", "deny-egress", networkingv1.NetworkPolicySpec{
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
	})

	cases := []struct {
		name         string
		existing     []*networkingv1.NetworkPolicy
		ns, polName  string
		proposed     *networkingv1.NetworkPolicy // nil = delete
		wantSelected []string
		wantBlocked  []string
		wantAllowed  []string
	}{
		{
			name: "new default-deny blocks all ingress into namespace",
			ns:   "b", polName: "deny-all", proposed: denyAllB,
			wantSelected: []string{"b/statefulset/db"},
			wantBlocked:  []string{"a/deployment/web->b/statefulset/db", "kube-system/deployment/coredns->b/statefulset/db"},
		},
		{
			name:     "allow rule on top of default-deny re-opens only its peers",
			existing: []*networkingv1.NetworkPolicy{denyAllB},
			ns:       "b", polName: "allow-web", proposed: allowWebToDB,
			wantSelected: []string{"b/statefulset/db"},
			wantAllowed:  []string{"a/deployment/web->b/statefulset/db"},
		},
		{
			name:     "deleting the only isolating policy re-opens everything",
			existing: []*networkingv1.NetworkPolicy{denyAllB},
			ns:       "b", polName: "deny-all",
			wantSelected: []string{"b/statefulset/db"},
			wantAllowed:  []string{"a/deployment/web->b/statefulset/db", "kube-system/deployment/coredns->b/statefulset/db"},
		},
		{
			name:     "deleting an allow rule while default-deny remains blocks its peers",
			existing: []*networkingv1.NetworkPolicy{denyAllB, allowWebToDB},
			ns:       "b", polName: "allow-web",
			wantSelected: []string{"b/statefulset/db"},
			wantBlocked:  []string{"a/deployment/web->b/statefulset/db"},
		},
		{
			name: "egress default-deny blocks outbound edges of the selected workload",
			ns:   "a", polName: "deny-egress", proposed: denyEgressA,
			wantSelected: []string{"a/deployment/web"},
			wantBlocked:  []string{"a/deployment/web->b/statefulset/db", "a/deployment/web->kube-system/deployment/coredns"},
		},
		{
			name:     "re-applying an identical policy changes nothing",
			existing: []*networkingv1.NetworkPolicy{denyAllB},
			ns:       "b", polName: "deny-all", proposed: denyAllB,
			wantSelected: []string{"b/statefulset/db"},
		},
		{
			name: "policy selecting no pods has no impact",
			ns:   "b", polName: "nothing",
			proposed:     ingressPolicy("b", "nothing", map[string]string{"app": "ghost"}),
			wantSelected: []string{},
		},
		{
			name: "proposed policy without policyTypes defaults to Ingress",
			ns:   "b", polName: "implicit",
			proposed:     policy("b", "implicit", networkingv1.NetworkPolicySpec{}),
			wantSelected: []string{"b/statefulset/db"},
			wantBlocked:  []string{"a/deployment/web->b/statefulset/db", "kube-system/deployment/coredns->b/statefulset/db"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := Impact(impactSnap(tc.existing...), tc.ns, tc.polName, tc.proposed)
			if got, want := res.SelectedWorkloads, tc.wantSelected; !equalStrings(got, want) {
				t.Errorf("SelectedWorkloads = %v, want %v", got, want)
			}
			assertEdges(t, "NewlyBlocked", res.NewlyBlocked, tc.wantBlocked)
			assertEdges(t, "NewlyAllowed", res.NewlyAllowed, tc.wantAllowed)
			if res.Truncated {
				t.Errorf("unexpected truncation")
			}
		})
	}
}

func assertEdges(t *testing.T, label string, got []ImpactEdge, want []string) {
	t.Helper()
	set := edgeSet(got)
	if len(set) != len(want) {
		t.Errorf("%s = %v, want %v", label, got, want)
		return
	}
	for _, w := range want {
		if !set[w] {
			t.Errorf("%s missing %s (got %v)", label, w, got)
		}
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestWorkloadsCollapseReplicas(t *testing.T) {
	wls := Workloads(impactSnap(), map[string]bool{"a": true})
	if len(wls) != 1 || wls[0].ID != "a/deployment/web" || wls[0].PodCount != 2 {
		t.Fatalf("Workloads = %+v", wls)
	}
}

func TestNormalizePolicyKeepsExplicitTypes(t *testing.T) {
	pol := egressPolicy("a", "e", nil)
	got := NormalizePolicy(pol)
	if len(got.Spec.PolicyTypes) != 1 || got.Spec.PolicyTypes[0] != networkingv1.PolicyTypeEgress {
		t.Fatalf("PolicyTypes = %v", got.Spec.PolicyTypes)
	}
	withEgress := policy("a", "x", networkingv1.NetworkPolicySpec{Egress: []networkingv1.NetworkPolicyEgressRule{{}}})
	if got := NormalizePolicy(withEgress).Spec.PolicyTypes; len(got) != 2 {
		t.Fatalf("defaulted PolicyTypes = %v, want [Ingress Egress]", got)
	}
	if len(withEgress.Spec.PolicyTypes) != 0 {
		t.Fatal("NormalizePolicy mutated its input")
	}
}

func TestImpactManyCombinesChanges(t *testing.T) {
	denyAllB := policy("b", "deny-all", networkingv1.NetworkPolicySpec{
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
	})
	allowWeb := ingressPolicy("b", "allow-web", map[string]string{"app": "db"},
		networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "alpha"}},
		}}})
	// Adding default-deny and the allow together only blocks kube-system.
	res := ImpactMany(impactSnap(), []PolicyChange{
		{Namespace: "b", Name: "deny-all", Proposed: denyAllB},
		{Namespace: "b", Name: "allow-web", Proposed: allowWeb},
	})
	assertEdges(t, "NewlyBlocked", res.NewlyBlocked, []string{"kube-system/deployment/coredns->b/statefulset/db"})
	assertEdges(t, "NewlyAllowed", res.NewlyAllowed, nil)
}
