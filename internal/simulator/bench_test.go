package simulator

import (
	"fmt"
	"testing"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// largeSnap builds nsCount namespaces × wlPerNS workloads with a
// default-deny plus one allow policy per namespace.
func largeSnap(nsCount, wlPerNS int) *Snapshot {
	s := &Snapshot{}
	for n := range nsCount {
		ns := fmt.Sprintf("team-%d", n)
		s.Namespaces = append(s.Namespaces, kube.NamespaceInfo{Name: ns, Labels: map[string]string{"kubernetes.io/metadata.name": ns, "tier": fmt.Sprint(n % 3)}})
		for w := range wlPerNS {
			app := fmt.Sprintf("app-%d", w)
			s.Pods = append(s.Pods, kube.PodInfo{Name: app + "-x", Namespace: ns, Owner: "deployment/" + app,
				Labels: map[string]string{"app": app, "role": fmt.Sprint(w % 4)}, IP: fmt.Sprintf("10.%d.%d.1", n, w)})
		}
		s.Policies = append(s.Policies,
			policy(ns, "deny", networkingv1.NetworkPolicySpec{PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}}),
			ingressPolicy(ns, "allow", map[string]string{"role": "0"}, networkingv1.NetworkPolicyIngressRule{
				From: []networkingv1.NetworkPolicyPeer{{NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"tier": "1"}}}},
			}))
	}
	return s
}

func BenchmarkAllPairs(b *testing.B) {
	s := largeSnap(20, 20) // 400 workloads → 159,600 ordered pairs
	wls := Workloads(s, nil)
	b.ResetTimer()
	for range b.N {
		for _, a := range wls {
			for _, c := range wls {
				if a.ID != c.ID {
					EvaluateEdge(s, a.Rep, c.Rep)
				}
			}
		}
	}
}

func BenchmarkAllPairsIndexed(b *testing.B) {
	s := largeSnap(20, 20)
	s.IndexNamespaces()
	wls := Workloads(s, nil)
	b.ResetTimer()
	for range b.N {
		idx := NewIndex(s)
		for _, a := range wls {
			for _, c := range wls {
				if a.ID != c.ID {
					idx.EvaluateEdge(a.Rep, c.Rep)
				}
			}
		}
	}
}
