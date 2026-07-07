package simulator

import (
	"testing"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// M1 sanity suite for the any-port edge engine. The full 30+ case matrix
// with port/warning coverage lands in M3 (TDD phase).

func pod(ns, name string, lbls map[string]string) kube.PodInfo {
	return kube.PodInfo{Name: name, Namespace: ns, Labels: lbls, IP: "10.0.0.1", Phase: "Running"}
}

func policy(ns, name string, spec networkingv1.NetworkPolicySpec) *networkingv1.NetworkPolicy {
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name},
		Spec:       spec,
	}
}

func snapshotWith(pols ...*networkingv1.NetworkPolicy) *Snapshot {
	return &Snapshot{
		Pods: []kube.PodInfo{
			pod("a", "web-1", map[string]string{"app": "web"}),
			pod("b", "db-1", map[string]string{"app": "db"}),
		},
		Namespaces: []kube.NamespaceInfo{
			{Name: "a", Labels: map[string]string{"team": "alpha", "kubernetes.io/metadata.name": "a"}},
			{Name: "b", Labels: map[string]string{"team": "beta", "kubernetes.io/metadata.name": "b"}},
		},
		Policies: pols,
	}
}

func TestEvaluateEdge(t *testing.T) {
	web := pod("a", "web-1", map[string]string{"app": "web"})
	db := pod("b", "db-1", map[string]string{"app": "db"})

	denyAllIngressB := policy("b", "deny-all-ingress", networkingv1.NetworkPolicySpec{
		PodSelector: metav1.LabelSelector{},
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
	})
	allowWebToDB := policy("b", "allow-web", networkingv1.NetworkPolicySpec{
		PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{"app": "db"}},
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
		Ingress: []networkingv1.NetworkPolicyIngressRule{{
			From: []networkingv1.NetworkPolicyPeer{{
				NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "alpha"}},
				PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
			}},
		}},
	})
	// Bare podSelector peer: only matches pods in the POLICY's namespace.
	allowLocalOnly := policy("b", "allow-local", networkingv1.NetworkPolicySpec{
		PodSelector: metav1.LabelSelector{},
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
		Ingress: []networkingv1.NetworkPolicyIngressRule{{
			From: []networkingv1.NetworkPolicyPeer{{
				PodSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
			}},
		}},
	})
	denyAllEgressA := policy("a", "deny-all-egress", networkingv1.NetworkPolicySpec{
		PodSelector: metav1.LabelSelector{},
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
	})
	allowAllIngressB := policy("b", "allow-all-ingress", networkingv1.NetworkPolicySpec{
		PodSelector: metav1.LabelSelector{},
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
		Ingress:     []networkingv1.NetworkPolicyIngressRule{{}}, // one empty rule = allow all
	})

	cases := []struct {
		name     string
		policies []*networkingv1.NetworkPolicy
		want     EdgeVerdict
	}{
		{"no policies at all", nil, EdgeUnconstrained},
		{"default-deny ingress on destination", []*networkingv1.NetworkPolicy{denyAllIngressB}, EdgeBlocked},
		{"deny plus cross-ns AND allow", []*networkingv1.NetworkPolicy{denyAllIngressB, allowWebToDB}, EdgeAllowed},
		{"bare podSelector does not cross namespaces", []*networkingv1.NetworkPolicy{allowLocalOnly}, EdgeBlocked},
		{"default-deny egress on source", []*networkingv1.NetworkPolicy{denyAllEgressA}, EdgeBlocked},
		{"empty ingress rule allows all", []*networkingv1.NetworkPolicy{allowAllIngressB}, EdgeAllowed},
		{"union across policies", []*networkingv1.NetworkPolicy{denyAllIngressB, allowLocalOnly, allowWebToDB}, EdgeAllowed},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			snap := snapshotWith(tc.policies...)
			got, _ := EvaluateEdge(snap, web, db)
			if got != tc.want {
				t.Fatalf("EvaluateEdge() = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestPolicyTypesRespected(t *testing.T) {
	web := pod("a", "web-1", map[string]string{"app": "web"})
	db := pod("b", "db-1", map[string]string{"app": "db"})

	// Egress-only policy on the DESTINATION must not isolate its ingress.
	egressOnlyB := policy("b", "egress-only", networkingv1.NetworkPolicySpec{
		PodSelector: metav1.LabelSelector{},
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
	})
	snap := snapshotWith(egressOnlyB)
	if got, _ := EvaluateEdge(snap, web, db); got != EdgeUnconstrained {
		t.Fatalf("egress-only policy on destination should leave web→db unconstrained, got %s", got)
	}
}

func TestHostNetworkPeerNeverMatchesSelectors(t *testing.T) {
	web := pod("a", "web-1", map[string]string{"app": "web"})
	web.HostNetwork = true
	db := pod("b", "db-1", map[string]string{"app": "db"})

	allowWeb := policy("b", "allow-web", networkingv1.NetworkPolicySpec{
		PodSelector: metav1.LabelSelector{},
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
		Ingress: []networkingv1.NetworkPolicyIngressRule{{
			From: []networkingv1.NetworkPolicyPeer{{
				NamespaceSelector: &metav1.LabelSelector{},
				PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
			}},
		}},
	})
	snap := snapshotWith(allowWeb)
	if got, _ := EvaluateEdge(snap, web, db); got != EdgeBlocked {
		t.Fatalf("hostNetwork source should not match pod selectors, got %s", got)
	}
}
