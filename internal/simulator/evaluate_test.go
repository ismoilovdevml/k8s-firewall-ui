package simulator

import (
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// Full-engine test matrix (M3). Covers the semantics pinned in
// docs/research/network-policy-semantics.md §5.

func tcp(port int32) *PortQuery { return &PortQuery{Protocol: "TCP", Port: port} }
func udp(port int32) *PortQuery { return &PortQuery{Protocol: "UDP", Port: port} }

func intOrStringPtr(i int32) *intstr.IntOrString { v := intstr.FromInt32(i); return &v }
func namedPortPtr(s string) *intstr.IntOrString  { v := intstr.FromString(s); return &v }
func int32Ptr(i int32) *int32                    { return &i }

func protoPtr(p corev1.Protocol) *corev1.Protocol { return &p }

func basePods() []kube.PodInfo {
	return []kube.PodInfo{
		{Name: "web-1", Namespace: "a", Labels: map[string]string{"app": "web"}, IP: "10.1.0.10", NodeName: "n1", Phase: "Running",
			Ports: []kube.ContainerPort{{Name: "http", Port: 8080, Protocol: corev1.ProtocolTCP}}},
		{Name: "db-1", Namespace: "b", Labels: map[string]string{"app": "db"}, IP: "10.2.0.20", NodeName: "n2", Phase: "Running",
			Ports: []kube.ContainerPort{{Name: "pg", Port: 5432, Protocol: corev1.ProtocolTCP}}},
		{Name: "dns-1", Namespace: "kube-system", Labels: map[string]string{"k8s-app": "kube-dns"}, IP: "10.0.0.5", NodeName: "n1", Phase: "Running"},
	}
}

func baseNamespaces() []kube.NamespaceInfo {
	return []kube.NamespaceInfo{
		{Name: "a", Labels: map[string]string{"team": "alpha", "kubernetes.io/metadata.name": "a"}},
		{Name: "b", Labels: map[string]string{"team": "beta", "kubernetes.io/metadata.name": "b"}},
		{Name: "kube-system", Labels: map[string]string{"kubernetes.io/metadata.name": "kube-system"}},
	}
}

func snap(pols ...*networkingv1.NetworkPolicy) *Snapshot {
	return &Snapshot{Pods: basePods(), Namespaces: baseNamespaces(), Policies: pols}
}

func podEP(ns, name string) Endpoint { return Endpoint{Kind: "pod", Namespace: ns, Name: name} }
func ipEP(ip string) Endpoint        { return Endpoint{Kind: "ip", IP: ip} }

func mustEval(t *testing.T, s *Snapshot, in Input) Result {
	t.Helper()
	res, err := Evaluate(s, in)
	if err != nil {
		t.Fatalf("Evaluate() error: %v", err)
	}
	return res
}

func hasWarning(res Result, code string) bool {
	for _, w := range res.Warnings {
		if w.Code == code {
			return true
		}
	}
	return false
}

// --- policy fixtures ---

func ingressPolicy(ns, name string, podSel map[string]string, rules ...networkingv1.NetworkPolicyIngressRule) *networkingv1.NetworkPolicy {
	return policy(ns, name, networkingv1.NetworkPolicySpec{
		PodSelector: metav1.LabelSelector{MatchLabels: podSel},
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
		Ingress:     rules,
	})
}

func egressPolicy(ns, name string, podSel map[string]string, rules ...networkingv1.NetworkPolicyEgressRule) *networkingv1.NetworkPolicy {
	return policy(ns, name, networkingv1.NetworkPolicySpec{
		PodSelector: metav1.LabelSelector{MatchLabels: podSel},
		PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
		Egress:      rules,
	})
}

func TestEvaluatePortMatching(t *testing.T) {
	fromWeb := networkingv1.NetworkPolicyPeer{
		NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "alpha"}},
	}
	cases := []struct {
		name  string
		rule  networkingv1.NetworkPolicyIngressRule
		query *PortQuery
		want  bool
	}{
		{"no ports = all ports", networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{fromWeb}}, tcp(5432), true},
		{"numeric port match", networkingv1.NetworkPolicyIngressRule{
			From:  []networkingv1.NetworkPolicyPeer{fromWeb},
			Ports: []networkingv1.NetworkPolicyPort{{Port: intOrStringPtr(5432)}},
		}, tcp(5432), true},
		{"numeric port mismatch", networkingv1.NetworkPolicyIngressRule{
			From:  []networkingv1.NetworkPolicyPeer{fromWeb},
			Ports: []networkingv1.NetworkPolicyPort{{Port: intOrStringPtr(5432)}},
		}, tcp(80), false},
		{"protocol mismatch", networkingv1.NetworkPolicyIngressRule{
			From:  []networkingv1.NetworkPolicyPeer{fromWeb},
			Ports: []networkingv1.NetworkPolicyPort{{Port: intOrStringPtr(5432), Protocol: protoPtr(corev1.ProtocolUDP)}},
		}, tcp(5432), false},
		{"endPort range hit", networkingv1.NetworkPolicyIngressRule{
			From:  []networkingv1.NetworkPolicyPeer{fromWeb},
			Ports: []networkingv1.NetworkPolicyPort{{Port: intOrStringPtr(5000), EndPort: int32Ptr(6000)}},
		}, tcp(5432), true},
		{"endPort range miss", networkingv1.NetworkPolicyIngressRule{
			From:  []networkingv1.NetworkPolicyPeer{fromWeb},
			Ports: []networkingv1.NetworkPolicyPort{{Port: intOrStringPtr(5000), EndPort: int32Ptr(6000)}},
		}, tcp(6001), false},
		{"named port resolves on destination pod", networkingv1.NetworkPolicyIngressRule{
			From:  []networkingv1.NetworkPolicyPeer{fromWeb},
			Ports: []networkingv1.NetworkPolicyPort{{Port: namedPortPtr("pg")}},
		}, tcp(5432), true},
		{"named port no such container port", networkingv1.NetworkPolicyIngressRule{
			From:  []networkingv1.NetworkPolicyPeer{fromWeb},
			Ports: []networkingv1.NetworkPolicyPort{{Port: namedPortPtr("nope")}},
		}, tcp(5432), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := snap(
				ingressPolicy("b", "deny", map[string]string{"app": "db"}),
				ingressPolicy("b", "allow", map[string]string{"app": "db"}, tc.rule),
			)
			res := mustEval(t, s, Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tc.query})
			if res.Allowed != tc.want {
				t.Fatalf("Allowed = %v, want %v", res.Allowed, tc.want)
			}
		})
	}
}

func TestEvaluatePeerSemantics(t *testing.T) {
	cases := []struct {
		name string
		peer networkingv1.NetworkPolicyPeer
		want bool
	}{
		{"AND peer matches", networkingv1.NetworkPolicyPeer{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "alpha"}},
			PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		}, true},
		{"AND peer half-match fails", networkingv1.NetworkPolicyPeer{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "beta"}},
			PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		}, false},
		{"empty namespaceSelector matches any namespace", networkingv1.NetworkPolicyPeer{
			NamespaceSelector: &metav1.LabelSelector{},
		}, true},
		{"bare podSelector never crosses namespaces", networkingv1.NetworkPolicyPeer{
			PodSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		}, false},
		{"ipBlock contains source", networkingv1.NetworkPolicyPeer{
			IPBlock: &networkingv1.IPBlock{CIDR: "10.1.0.0/16"},
		}, true},
		{"ipBlock except carves source out", networkingv1.NetworkPolicyPeer{
			IPBlock: &networkingv1.IPBlock{CIDR: "10.0.0.0/8", Except: []string{"10.1.0.0/16"}},
		}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := snap(
				ingressPolicy("b", "deny", map[string]string{"app": "db"}),
				ingressPolicy("b", "allow", map[string]string{"app": "db"},
					networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{tc.peer}}),
			)
			res := mustEval(t, s, Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
			if res.Allowed != tc.want {
				t.Fatalf("Allowed = %v, want %v", res.Allowed, tc.want)
			}
		})
	}
}

func TestEvaluateIsolationAndRuleLists(t *testing.T) {
	t.Run("non-isolated both sides allows", func(t *testing.T) {
		res := mustEval(t, snap(), Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
		if !res.Allowed || res.Egress.Isolated || res.Ingress.Isolated {
			t.Fatalf("want allowed non-isolated, got %+v", res)
		}
	})
	t.Run("empty rule list denies all", func(t *testing.T) {
		res := mustEval(t, snap(ingressPolicy("b", "deny", nil)),
			Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
		if res.Allowed || !res.Ingress.Isolated {
			t.Fatalf("want ingress-isolated deny, got %+v", res)
		}
	})
	t.Run("single empty rule allows all", func(t *testing.T) {
		res := mustEval(t, snap(ingressPolicy("b", "allow-all", nil, networkingv1.NetworkPolicyIngressRule{})),
			Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
		if !res.Allowed {
			t.Fatalf("want allowed, got %+v", res)
		}
	})
	t.Run("egress side blocks independently", func(t *testing.T) {
		res := mustEval(t, snap(egressPolicy("a", "deny-egress", nil)),
			Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
		if res.Allowed || !res.Egress.Isolated || res.Egress.Allowed {
			t.Fatalf("want egress deny, got %+v", res)
		}
		if res.Ingress.Isolated {
			t.Fatal("ingress side should be untouched")
		}
	})
	t.Run("both sides must allow", func(t *testing.T) {
		s := snap(
			egressPolicy("a", "allow-egress-to-b", map[string]string{"app": "web"},
				networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{{
					NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "beta"}},
				}}}),
			ingressPolicy("b", "deny-ingress", nil),
		)
		res := mustEval(t, s, Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
		if res.Allowed || !res.Egress.Allowed || res.Ingress.Allowed {
			t.Fatalf("want egress ok + ingress deny, got %+v", res)
		}
	})
}

func TestEvaluateExternalIPDestination(t *testing.T) {
	t.Run("egress to external IP via ipBlock", func(t *testing.T) {
		s := snap(
			egressPolicy("a", "deny-egress", nil),
			egressPolicy("a", "allow-ext", map[string]string{"app": "web"},
				networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{{
					IPBlock: &networkingv1.IPBlock{CIDR: "203.0.113.0/24"},
				}}}),
		)
		res := mustEval(t, s, Input{Source: podEP("a", "web-1"), Destination: ipEP("203.0.113.7"), Port: tcp(443)})
		if !res.Allowed {
			t.Fatalf("want allowed, got %+v", res)
		}
		if res.Ingress.Applicable {
			t.Fatal("ingress side must not be evaluated for an external IP")
		}
	})
	t.Run("selector peers do not match external IPs", func(t *testing.T) {
		s := snap(
			egressPolicy("a", "deny-egress", nil),
			egressPolicy("a", "allow-ns", map[string]string{"app": "web"},
				networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{{
					NamespaceSelector: &metav1.LabelSelector{},
				}}}),
		)
		res := mustEval(t, s, Input{Source: podEP("a", "web-1"), Destination: ipEP("203.0.113.7"), Port: tcp(443)})
		if res.Allowed {
			t.Fatalf("selector peer must not admit an external IP, got %+v", res)
		}
	})
}

func TestEvaluateWarnings(t *testing.T) {
	t.Run("DNS trap fires for egress isolation without :53", func(t *testing.T) {
		res := mustEval(t, snap(egressPolicy("a", "deny-egress", nil)),
			Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
		if !hasWarning(res, "DNS_EGRESS_BLOCKED") {
			t.Fatalf("want DNS_EGRESS_BLOCKED, got %+v", res.Warnings)
		}
	})
	t.Run("DNS trap silent when :53 allowed", func(t *testing.T) {
		s := snap(
			egressPolicy("a", "deny-egress", nil),
			egressPolicy("a", "allow-dns", nil, networkingv1.NetworkPolicyEgressRule{
				To: []networkingv1.NetworkPolicyPeer{{
					NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": "kube-system"}},
				}},
				Ports: []networkingv1.NetworkPolicyPort{
					{Protocol: protoPtr(corev1.ProtocolUDP), Port: intOrStringPtr(53)},
				},
			}),
		)
		res := mustEval(t, s, Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
		if hasWarning(res, "DNS_EGRESS_BLOCKED") {
			t.Fatalf("DNS warning must not fire, got %+v", res.Warnings)
		}
	})
	t.Run("hostNetwork warning", func(t *testing.T) {
		s := snap(ingressPolicy("b", "deny", nil))
		s.Pods[0].HostNetwork = true
		res := mustEval(t, s, Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
		if !hasWarning(res, "HOSTNETWORK_UNDEFINED") {
			t.Fatalf("want HOSTNETWORK_UNDEFINED, got %+v", res.Warnings)
		}
	})
	t.Run("same-node bypass warning", func(t *testing.T) {
		s := snap(ingressPolicy("b", "deny", nil))
		s.Pods[1].NodeName = "n1" // same node as web-1
		res := mustEval(t, s, Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
		if !hasWarning(res, "NODE_LOCAL_TRAFFIC") {
			t.Fatalf("want NODE_LOCAL_TRAFFIC, got %+v", res.Warnings)
		}
	})
	t.Run("no warnings on plain allowed flow", func(t *testing.T) {
		res := mustEval(t, snap(), Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
		if len(res.Warnings) != 0 {
			t.Fatalf("want no warnings, got %+v", res.Warnings)
		}
	})
	t.Run("querying DNS itself does not trip the trap", func(t *testing.T) {
		res := mustEval(t, snap(egressPolicy("a", "deny-egress", nil)),
			Input{Source: podEP("a", "web-1"), Destination: podEP("kube-system", "dns-1"), Port: udp(53)})
		// The verdict is deny; the DNS warning would be redundant noise here.
		if res.Allowed {
			t.Fatal("expected deny")
		}
	})
}

func TestEvaluateExplanations(t *testing.T) {
	s := snap(
		ingressPolicy("b", "deny", map[string]string{"app": "db"}),
		ingressPolicy("b", "allow-web", map[string]string{"app": "db"},
			networkingv1.NetworkPolicyIngressRule{
				From: []networkingv1.NetworkPolicyPeer{{
					NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"team": "alpha"}},
					PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
				}},
				Ports: []networkingv1.NetworkPolicyPort{{Port: intOrStringPtr(5432)}},
			}),
	)
	res := mustEval(t, s, Input{Source: podEP("a", "web-1"), Destination: podEP("b", "db-1"), Port: tcp(5432)})
	if !res.Allowed {
		t.Fatalf("want allowed, got %+v", res)
	}
	if len(res.Ingress.MatchedRules) != 1 {
		t.Fatalf("want 1 matched rule, got %+v", res.Ingress.MatchedRules)
	}
	m := res.Ingress.MatchedRules[0]
	if m.Policy.Name != "allow-web" || m.RuleIndex != 0 {
		t.Fatalf("wrong match: %+v", m)
	}
	if !strings.Contains(m.Explanation, "allow-web") {
		t.Fatalf("explanation should name the policy: %q", m.Explanation)
	}
	// Both evaluated policies must be reported.
	if len(res.Ingress.EvaluatedPolicies) != 2 {
		t.Fatalf("want 2 evaluated policies, got %+v", res.Ingress.EvaluatedPolicies)
	}
}

func TestEvaluateErrors(t *testing.T) {
	if _, err := Evaluate(snap(), Input{Source: podEP("a", "missing"), Destination: podEP("b", "db-1")}); err == nil {
		t.Fatal("want error for unknown source pod")
	}
	if _, err := Evaluate(snap(), Input{Source: ipEP("1.2.3.4"), Destination: podEP("b", "db-1")}); err == nil {
		t.Fatal("want error: source must be a pod in v0.1")
	}
}
