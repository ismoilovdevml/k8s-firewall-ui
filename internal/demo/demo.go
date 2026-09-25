// Package demo provides an in-memory sample cluster so the UI can be
// evaluated (and screenshotted) without a real Kubernetes cluster:
// `k8s-firewall-ui --demo`. Writes go to the in-memory store only.
package demo

import (
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// Clientset returns a fake clientset seeded with a small multi-team cluster:
// a protected shop namespace, a half-protected payments namespace, an open
// analytics namespace, and a policy with a label typo.
func Clientset() *fake.Clientset {
	objs := []runtime.Object{}
	ns := func(name string, labels map[string]string) {
		l := map[string]string{"kubernetes.io/metadata.name": name}
		for k, v := range labels {
			l[k] = v
		}
		objs = append(objs, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name, Labels: l}})
	}
	ns("kube-system", nil)
	ns("ingress-nginx", nil)
	ns("monitoring", nil)
	ns("shop", map[string]string{"team": "storefront"})
	ns("payments", map[string]string{"team": "payments", "pci": "true"})
	ns("analytics", map[string]string{"team": "data"})

	ip := 10
	deploy := func(namespace, owner string, replicas int, labels map[string]string, ports ...corev1.ContainerPort) {
		for i := range replicas {
			ip++
			objs = append(objs, &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Namespace: namespace, Name: fmt.Sprintf("%s-7d9f8c-%c%d", owner, 'a'+i, i), Labels: labels,
					OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: owner + "-7d9f8c", APIVersion: "apps/v1"}},
				},
				Spec: corev1.PodSpec{
					NodeName:   fmt.Sprintf("node-%d", 1+ip%3),
					Containers: []corev1.Container{{Name: "main", Image: "example/" + owner, Ports: ports}},
				},
				Status: corev1.PodStatus{Phase: corev1.PodRunning, PodIP: fmt.Sprintf("10.244.%d.%d", ip%3, ip)},
			})
		}
	}
	port := func(name string, p int32) corev1.ContainerPort {
		return corev1.ContainerPort{Name: name, ContainerPort: p, Protocol: corev1.ProtocolTCP}
	}
	deploy("kube-system", "coredns", 2, map[string]string{"k8s-app": "kube-dns"}, corev1.ContainerPort{Name: "dns", ContainerPort: 53, Protocol: corev1.ProtocolUDP})
	deploy("ingress-nginx", "ingress-nginx-controller", 1, map[string]string{"app.kubernetes.io/name": "ingress-nginx"}, port("http", 80))
	deploy("monitoring", "prometheus", 1, map[string]string{"app.kubernetes.io/name": "prometheus"}, port("web", 9090))
	deploy("shop", "frontend", 3, map[string]string{"app": "frontend", "tier": "web"}, port("http", 8080), port("metrics", 9100))
	deploy("shop", "cart", 2, map[string]string{"app": "cart", "tier": "api"}, port("http", 8080))
	deploy("shop", "catalog", 2, map[string]string{"app": "catalog", "tier": "api"}, port("http", 8080))
	deploy("shop", "redis", 1, map[string]string{"app": "redis", "tier": "cache"}, port("redis", 6379))
	deploy("payments", "payments-api", 2, map[string]string{"app": "payments-api"}, port("http", 8443))
	deploy("payments", "ledger-db", 1, map[string]string{"app": "ledger-db"}, port("postgres", 5432))
	deploy("analytics", "collector", 2, map[string]string{"app": "collector"}, port("http", 8080))
	deploy("analytics", "dashboard", 1, map[string]string{"app": "dashboard"}, port("http", 3000))

	objs = append(objs, &appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: "calico-node"}})

	tcp, udp := corev1.ProtocolTCP, corev1.ProtocolUDP
	p := func(n int32) *intstr.IntOrString { v := intstr.FromInt32(n); return &v }
	named := func(s string) *intstr.IntOrString { v := intstr.FromString(s); return &v }
	sel := func(kv ...string) *metav1.LabelSelector {
		m := map[string]string{}
		for i := 0; i+1 < len(kv); i += 2 {
			m[kv[i]] = kv[i+1]
		}
		return &metav1.LabelSelector{MatchLabels: m}
	}
	pol := func(namespace, name string, spec networkingv1.NetworkPolicySpec) {
		objs = append(objs, &networkingv1.NetworkPolicy{
			ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: name, ResourceVersion: "1",
				CreationTimestamp: metav1.Now(), Labels: map[string]string{"managed-by": "platform-team"}},
			Spec: spec,
		})
	}
	ingress := []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}
	both := []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress}
	dns := networkingv1.NetworkPolicyEgressRule{
		To:    []networkingv1.NetworkPolicyPeer{{NamespaceSelector: sel("kubernetes.io/metadata.name", "kube-system"), PodSelector: sel("k8s-app", "kube-dns")}},
		Ports: []networkingv1.NetworkPolicyPort{{Protocol: &udp, Port: p(53)}, {Protocol: &tcp, Port: p(53)}},
	}

	// shop: zero-trust baseline plus narrow allows.
	pol("shop", "default-deny-all", networkingv1.NetworkPolicySpec{PolicyTypes: both, Egress: []networkingv1.NetworkPolicyEgressRule{dns}})
	pol("shop", "allow-ingress-to-frontend", networkingv1.NetworkPolicySpec{
		PodSelector: *sel("app", "frontend"), PolicyTypes: ingress,
		Ingress: []networkingv1.NetworkPolicyIngressRule{{
			From:  []networkingv1.NetworkPolicyPeer{{NamespaceSelector: sel("kubernetes.io/metadata.name", "ingress-nginx")}},
			Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: named("http")}},
		}},
	})
	pol("shop", "frontend-to-apis", networkingv1.NetworkPolicySpec{
		PodSelector: *sel("tier", "api"), PolicyTypes: ingress,
		Ingress: []networkingv1.NetworkPolicyIngressRule{{From: []networkingv1.NetworkPolicyPeer{{PodSelector: sel("app", "frontend")}}}},
	})
	pol("shop", "frontend-egress", networkingv1.NetworkPolicySpec{
		PodSelector: *sel("app", "frontend"), PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
		Egress: []networkingv1.NetworkPolicyEgressRule{{To: []networkingv1.NetworkPolicyPeer{{PodSelector: sel("tier", "api")}}}},
	})
	pol("shop", "cart-to-redis", networkingv1.NetworkPolicySpec{
		PodSelector: *sel("app", "redis"), PolicyTypes: ingress,
		Ingress: []networkingv1.NetworkPolicyIngressRule{{
			From:  []networkingv1.NetworkPolicyPeer{{PodSelector: sel("app", "cart")}},
			Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: p(6379)}},
		}},
	})
	pol("shop", "allow-prometheus-scrape", networkingv1.NetworkPolicySpec{
		PolicyTypes: ingress,
		Ingress: []networkingv1.NetworkPolicyIngressRule{{
			From:  []networkingv1.NetworkPolicyPeer{{NamespaceSelector: sel("kubernetes.io/metadata.name", "monitoring"), PodSelector: sel("app.kubernetes.io/name", "prometheus")}},
			Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: named("metrics")}},
		}},
	})

	// payments: the database is locked down, but the peer label has a typo
	// and egress isolation forgot DNS.
	pol("payments", "ledger-db-ingress", networkingv1.NetworkPolicySpec{
		PodSelector: *sel("app", "ledger-db"), PolicyTypes: ingress,
		Ingress: []networkingv1.NetworkPolicyIngressRule{{
			From:  []networkingv1.NetworkPolicyPeer{{PodSelector: sel("app", "payment-api")}},
			Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: p(5432)}},
		}},
	})
	pol("payments", "payments-api-egress", networkingv1.NetworkPolicySpec{
		PodSelector: *sel("app", "payments-api"), PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
		Egress: []networkingv1.NetworkPolicyEgressRule{{
			To:    []networkingv1.NetworkPolicyPeer{{PodSelector: sel("app", "ledger-db")}},
			Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: p(5432)}},
		}},
	})
	pol("payments", "legacy-open-webhook", networkingv1.NetworkPolicySpec{
		PodSelector: *sel("app", "payments-api"), PolicyTypes: ingress,
		Ingress: []networkingv1.NetworkPolicyIngressRule{{
			From: []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{CIDR: "0.0.0.0/0"}}},
		}},
	})

	cs := fake.NewClientset(objs...)
	// The fake tracker ignores dry-run; honor it so "Validate" never writes.
	for _, verb := range []string{"create", "update", "delete"} {
		cs.PrependReactor(verb, "networkpolicies", DryRunReactor)
	}
	return cs
}

// DryRunReactor makes a fake clientset honour DryRun options (the tracker
// otherwise persists dry-run writes).
func DryRunReactor(action k8stesting.Action) (bool, runtime.Object, error) {
	switch a := action.(type) {
	case k8stesting.CreateActionImpl:
		if len(a.CreateOptions.DryRun) > 0 {
			return true, a.Object, nil
		}
	case k8stesting.UpdateActionImpl:
		if len(a.UpdateOptions.DryRun) > 0 {
			return true, a.Object, nil
		}
	case k8stesting.DeleteActionImpl:
		if len(a.DeleteOptions.DryRun) > 0 {
			return true, nil, nil
		}
	}
	return false, nil, nil
}
