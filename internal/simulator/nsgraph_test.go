package simulator

import (
	"testing"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// The index is an optimization only: it must agree with EvaluateEdge on
// every pair, for small hand-written fixtures and a large generated one.
func TestIndexMatchesEvaluateEdge(t *testing.T) {
	allowAlpha := ingressPolicy("b", "allow-alpha", map[string]string{"app": "db"},
		networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "alpha"}},
		}}})
	denyEgressA := policy("a", "deny-egress", networkingv1.NetworkPolicySpec{
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
	})
	snaps := map[string]*Snapshot{
		"no policies":    snap(),
		"mixed policies": snap(allowAlpha, denyEgressA),
		"large":          largeSnap(8, 10),
	}
	for name, s := range snaps {
		t.Run(name, func(t *testing.T) {
			idx := NewIndex(s)
			for _, a := range s.Pods {
				for _, b := range s.Pods {
					want, wantRefs := EvaluateEdge(s, a, b)
					got, gotRefs := idx.EvaluateEdge(a, b)
					if got != want || len(gotRefs) != len(wantRefs) {
						t.Fatalf("%s/%s -> %s/%s: index %s %v, engine %s %v", a.Namespace, a.Name, b.Namespace, b.Name, got, gotRefs, want, wantRefs)
					}
				}
			}
		})
	}
}

func TestNamespaceGraph(t *testing.T) {
	denyB := policy("b", "deny", networkingv1.NetworkPolicySpec{
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
	})
	allowAlpha := ingressPolicy("b", "allow-alpha", map[string]string{"app": "db"},
		networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "alpha"}},
		}}})

	cases := []struct {
		name string
		pols []*networkingv1.NetworkPolicy
		want map[string]VerdictCounts // "src->dst"
	}{
		{
			name: "no policies: everything unconstrained",
			want: map[string]VerdictCounts{"a->b": {Unconstrained: 1}, "kube-system->b": {Unconstrained: 1}},
		},
		{
			name: "default deny in b blocks every inbound namespace",
			pols: []*networkingv1.NetworkPolicy{denyB},
			want: map[string]VerdictCounts{"a->b": {Blocked: 1}, "kube-system->b": {Blocked: 1}, "b->a": {Unconstrained: 1}},
		},
		{
			name: "allow from team=alpha reopens only namespace a",
			pols: []*networkingv1.NetworkPolicy{denyB, allowAlpha},
			want: map[string]VerdictCounts{"a->b": {Allowed: 1}, "kube-system->b": {Blocked: 1}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := snap(tc.pols...)
			for i := range s.Pods {
				s.Pods[i].Owner = "deployment/" + s.Pods[i].Name
			}
			nodes, edges := NamespaceGraph(s, nil)
			if len(nodes) != 3 || nodes[0].Namespace != "a" || nodes[0].Workloads != 1 {
				t.Fatalf("nodes = %+v", nodes)
			}
			got := map[string]VerdictCounts{}
			for _, e := range edges {
				got[e.Source+"->"+e.Target] = e.Counts
			}
			for k, want := range tc.want {
				if got[k] != want {
					t.Errorf("%s = %+v, want %+v", k, got[k], want)
				}
			}
			if len(edges) != 6 {
				t.Errorf("edges = %d, want 6 ordered namespace pairs", len(edges))
			}
		})
	}
}

// selectorMatches' matchLabels fast path must agree with the apimachinery
// conversion it short-circuits.
func TestSelectorFastPathMatchesAPIMachinery(t *testing.T) {
	lbls := map[string]string{"app": "web", "tier": "front"}
	cases := []map[string]string{nil, {}, {"app": "web"}, {"app": "web", "tier": "front"}, {"app": "db"}, {"missing": ""}, {"app": ""}}
	for _, ml := range cases {
		sel := &metav1.LabelSelector{MatchLabels: ml}
		conv, err := metav1.LabelSelectorAsSelector(sel)
		if err != nil {
			t.Fatal(err)
		}
		if got, want := selectorMatches(sel, lbls), conv.Matches(labelsSet(lbls)); got != want {
			t.Errorf("matchLabels %v: fast path %v, apimachinery %v", ml, got, want)
		}
	}
}

func labelsSet(m map[string]string) labels.Set { return labels.Set(m) }
