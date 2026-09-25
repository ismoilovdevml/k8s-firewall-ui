package simulator

import (
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// planSnap: a/web and a/api (team alpha), b/db (team beta), kube-dns.
func planSnap(pols ...*networkingv1.NetworkPolicy) *Snapshot {
	pod := func(ns, name, owner string, labels map[string]string, ip string, ports ...kube.ContainerPort) kube.PodInfo {
		return kube.PodInfo{Name: name, Namespace: ns, Owner: owner, Labels: labels, IP: ip, Phase: "Running", Ports: ports}
	}
	tcp := func(name string, p int32) kube.ContainerPort {
		return kube.ContainerPort{Name: name, Port: p, Protocol: corev1.ProtocolTCP}
	}
	return &Snapshot{
		Pods: []kube.PodInfo{
			pod("a", "web-1", "deployment/web", map[string]string{"app": "web", "pod-template-hash": "111"}, "10.1.0.1", tcp("http", 8080)),
			pod("a", "web-2", "deployment/web", map[string]string{"app": "web", "pod-template-hash": "222"}, "10.1.0.2", tcp("http", 8080)),
			pod("a", "api-1", "deployment/api", map[string]string{"app": "api"}, "10.1.0.3", tcp("http", 9000)),
			pod("b", "db-0", "statefulset/db", map[string]string{"app": "db", "statefulset.kubernetes.io/pod-name": "db-0"}, "10.2.0.1", tcp("pg", 5432)),
			pod("kube-system", "dns-1", "deployment/coredns", map[string]string{"k8s-app": "kube-dns"}, "10.0.0.10"),
		},
		Namespaces: baseNamespaces(),
		Policies:   pols,
	}
}

var (
	webWL = Peer{Kind: PeerWorkload, Namespace: "a", Workload: "deployment/web"}
	apiWL = Peer{Kind: PeerWorkload, Namespace: "a", Workload: "deployment/api"}
	dbWL  = Peer{Kind: PeerWorkload, Namespace: "b", Workload: "statefulset/db"}
	dnsWL = Peer{Kind: PeerWorkload, Namespace: "kube-system", Workload: "deployment/coredns"}
	webS  = Subject{Namespace: "a", Workload: "deployment/web"}
	dbS   = Subject{Namespace: "b", Workload: "statefulset/db"}
)

func denyIngress(ns string) *networkingv1.NetworkPolicy {
	return policy(ns, "deny-in", networkingv1.NetworkPolicySpec{PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}})
}

func denyEgress(ns string) *networkingv1.NetworkPolicy {
	return policy(ns, "deny-out", networkingv1.NetworkPolicySpec{PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress}})
}

func mustPlan(t *testing.T, s *Snapshot, req PlanRequest) Plan {
	t.Helper()
	p, err := PlanAccess(s, req)
	if err != nil {
		t.Fatalf("PlanAccess: %v", err)
	}
	return p
}

func apply(s *Snapshot, p Plan) *Snapshot { return ApplyChanges(s, toPolicyChanges(p.Changes)) }

// reachable evaluates one workload pair (any port, or a TCP port).
func reachable(t *testing.T, s *Snapshot, src, dst Peer, port int32) bool {
	t.Helper()
	var q *PortQuery
	if port > 0 {
		q = tcp(port)
	}
	se, _ := resolveEndpoint(s, src)
	de, _ := resolveEndpoint(s, dst)
	if dst.Kind == PeerExternal {
		return evalSide(s, se.reps[0], dirEgress, ipTarget(de.ip), q).Allowed
	}
	res, err := Evaluate(s, Input{
		Source:      Endpoint{Kind: "pod", Namespace: src.Namespace, Name: se.reps[0].Name},
		Destination: Endpoint{Kind: "pod", Namespace: dst.Namespace, Name: de.reps[0].Name},
		Port:        q,
	})
	if err != nil {
		t.Fatal(err)
	}
	return res.Allowed
}

func TestWorkloadSelectorAndManagedName(t *testing.T) {
	s := planSnap()
	sel, err := WorkloadSelector(s, "a", "deployment/web")
	if err != nil || len(sel) != 1 || sel["app"] != "web" {
		t.Fatalf("selector = %v, %v (pod-template-hash must be dropped)", sel, err)
	}
	if sel, _ := WorkloadSelector(s, "b", "statefulset/db"); sel["statefulset.kubernetes.io/pod-name"] != "" {
		t.Fatalf("per-pod label leaked into selector: %v", sel)
	}
	cases := map[string]string{
		ManagedPolicyName(webWL, true):  "fwui-web-ingress",
		ManagedPolicyName(dbWL, false):  "fwui-db-egress",
		ManagedPolicyName(Peer{Kind: PeerNamespace, Namespace: "a"}, true): "fwui-namespace-ingress",
		ManagedPolicyName(Peer{Kind: PeerWorkload, Workload: "deployment/My_App.v2" + strings.Repeat("x", 80)}, false)[:12]: "fwui-my-app-",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("name %q, want %q", got, want)
		}
	}
	if n := ManagedPolicyName(Peer{Kind: PeerWorkload, Workload: "deployment/" + strings.Repeat("x", 80)}, true); len(n) > 63 {
		t.Errorf("name too long: %d", len(n))
	}
}

func TestPlanAllow(t *testing.T) {
	cases := []struct {
		name        string
		pols        []*networkingv1.NetworkPolicy
		req         PlanRequest
		wantChanges []string // "op ns/name"
		wantDone    bool
		check       func(t *testing.T, after *Snapshot)
	}{
		{
			name:     "already open",
			req:      PlanRequest{Subject: webS, Direction: "outbound", Peer: dbWL, Action: "allow"},
			wantDone: true,
		},
		{
			name:        "destination default-deny: add an ingress rule on the destination only",
			pols:        []*networkingv1.NetworkPolicy{denyIngress("b")},
			req:         PlanRequest{Subject: webS, Direction: "outbound", Peer: dbWL, Action: "allow"},
			wantChanges: []string{"create b/fwui-db-ingress"},
			check: func(t *testing.T, after *Snapshot) {
				if !reachable(t, after, webWL, dbWL, 5432) {
					t.Error("web -> db:5432 still blocked")
				}
				if reachable(t, after, webWL, dbWL, 22) {
					t.Error("allow must be limited to the destination's declared ports")
				}
				if reachable(t, after, apiWL, dbWL, 5432) {
					t.Error("allow must be limited to the requested peer")
				}
			},
		},
		{
			name:        "both sides isolated: rules on both",
			pols:        []*networkingv1.NetworkPolicy{denyIngress("b"), denyEgress("a")},
			req:         PlanRequest{Subject: dbS, Direction: "inbound", Peer: webWL, Action: "allow"},
			wantChanges: []string{"create a/fwui-web-egress", "create b/fwui-db-ingress"},
			check: func(t *testing.T, after *Snapshot) {
				if !reachable(t, after, webWL, dbWL, 5432) {
					t.Error("web -> db still blocked")
				}
			},
		},
		{
			name:        "namespace to namespace",
			pols:        []*networkingv1.NetworkPolicy{denyIngress("b")},
			req:         PlanRequest{Subject: Subject{Namespace: "b"}, Direction: "inbound", Peer: Peer{Kind: PeerNamespace, Namespace: "a"}, Action: "allow"},
			wantChanges: []string{"create b/fwui-namespace-ingress"},
			check: func(t *testing.T, after *Snapshot) {
				if !reachable(t, after, apiWL, dbWL, 0) || !reachable(t, after, webWL, dbWL, 0) {
					t.Error("namespace a should reach b")
				}
				if reachable(t, after, dnsWL, dbWL, 0) {
					t.Error("kube-system must stay blocked")
				}
			},
		},
		{
			name:        "external CIDR on an egress-isolated workload",
			pols:        []*networkingv1.NetworkPolicy{denyEgress("a")},
			req:         PlanRequest{Subject: webS, Direction: "outbound", Peer: Peer{Kind: PeerExternal, CIDR: "198.51.100.0/24"}, Action: "allow", Ports: []PortSpec{{Protocol: "TCP", Port: 443}}},
			wantChanges: []string{"create a/fwui-web-egress"},
			check: func(t *testing.T, after *Snapshot) {
				if !reachable(t, after, webWL, Peer{Kind: PeerExternal, CIDR: "198.51.100.0/24"}, 443) {
					t.Error("egress to the CIDR on 443 not allowed")
				}
				if reachable(t, after, webWL, Peer{Kind: PeerExternal, CIDR: "198.51.100.0/24"}, 80) {
					t.Error("port restriction ignored")
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := planSnap(tc.pols...)
			p := mustPlan(t, s, tc.req)
			assertPlan(t, p, tc.wantChanges, tc.wantDone)
			if tc.check != nil {
				tc.check(t, apply(s, p))
			}
		})
	}
}

func assertPlan(t *testing.T, p Plan, wantChanges []string, wantDone bool) {
	t.Helper()
	var got []string
	for _, c := range p.Changes {
		got = append(got, c.Operation+" "+c.Namespace+"/"+c.Name)
		if c.Policy.Labels[ManagedByLabel] != ManagedByValue {
			t.Errorf("%s/%s lacks the managed-by label", c.Namespace, c.Name)
		}
		if len(c.Policy.Spec.PolicyTypes) == 0 {
			t.Errorf("%s/%s has implicit policyTypes", c.Namespace, c.Name)
		}
	}
	if strings.Join(got, ",") != strings.Join(wantChanges, ",") {
		t.Errorf("changes = %v, want %v (notes %v)", got, wantChanges, p.Notes)
	}
	if p.AlreadyDone != wantDone {
		t.Errorf("AlreadyDone = %v, want %v", p.AlreadyDone, wantDone)
	}
	if !p.Verified {
		t.Errorf("plan not verified (blockers %v, notes %v)", p.Blockers, p.Notes)
	}
}

func TestPlanBlock(t *testing.T) {
	t.Run("open side is locked down, keeping every other current peer", func(t *testing.T) {
		s := planSnap()
		p := mustPlan(t, s, PlanRequest{Subject: webS, Direction: "outbound", Peer: dbWL, Action: "block", KeepExternal: true})
		assertPlan(t, p, []string{"create a/fwui-web-egress"}, false)
		after := apply(s, p)
		if reachable(t, after, webWL, dbWL, 0) {
			t.Fatal("web -> db still allowed")
		}
		for _, keep := range []Peer{apiWL, dnsWL, {Kind: PeerExternal, CIDR: "0.0.0.0/0"}} {
			if !reachable(t, after, webWL, keep, 0) {
				t.Errorf("web -> %s lost", keep.ID())
			}
		}
		if len(p.Impact.NewlyBlocked) != 1 || p.Impact.NewlyBlocked[0].Target != "b/statefulset/db" {
			t.Errorf("impact = %+v, want only web -> db blocked", p.Impact.NewlyBlocked)
		}

		// Then block api too: the planner expands its own namespace term.
		p2 := mustPlan(t, after, PlanRequest{Subject: webS, Direction: "outbound", Peer: apiWL, Action: "block"})
		assertPlan(t, p2, []string{"update a/fwui-web-egress"}, false)
		after2 := apply(after, p2)
		if reachable(t, after2, webWL, apiWL, 0) || !reachable(t, after2, webWL, dnsWL, 0) {
			t.Error("expected web -> api blocked and DNS kept")
		}
	})

	t.Run("allow then block removes the managed rule and keeps isolation", func(t *testing.T) {
		s := planSnap(denyIngress("b"))
		allowed := apply(s, mustPlan(t, s, PlanRequest{Subject: dbS, Direction: "inbound", Peer: webWL, Action: "allow"}))
		p := mustPlan(t, allowed, PlanRequest{Subject: dbS, Direction: "inbound", Peer: webWL, Action: "block"})
		assertPlan(t, p, []string{"update b/fwui-db-ingress"}, false)
		if n := len(p.Changes[0].Policy.Spec.Ingress); n != 0 {
			t.Errorf("ingress rules = %d, want the rule removed (not left with empty peers)", n)
		}
		if reachable(t, apply(allowed, p), webWL, dbWL, 0) {
			t.Error("web -> db still allowed")
		}
	})

	t.Run("a hand-written policy keeps the flow open: reported as a blocker", func(t *testing.T) {
		userAllow := ingressPolicy("b", "team-allow", map[string]string{"app": "db"},
			networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{{NamespaceSelector: nsSelector("a")}}})
		s := planSnap(userAllow)
		p, err := PlanAccess(s, PlanRequest{Subject: dbS, Direction: "inbound", Peer: webWL, Action: "block"})
		if err != nil {
			t.Fatal(err)
		}
		if p.Verified || len(p.Blockers) != 1 || p.Blockers[0].Policy.Name != "team-allow" {
			t.Fatalf("blockers = %+v verified=%v", p.Blockers, p.Verified)
		}
	})

	t.Run("block one external CIDR, keep the rest of the internet", func(t *testing.T) {
		s := planSnap()
		bad := Peer{Kind: PeerExternal, CIDR: "192.0.2.0/24"}
		p := mustPlan(t, s, PlanRequest{Subject: webS, Direction: "outbound", Peer: bad, Action: "block", KeepExternal: true})
		assertPlan(t, p, []string{"create a/fwui-web-egress"}, false)
		after := apply(s, p)
		if reachable(t, after, webWL, bad, 0) || !reachable(t, after, webWL, Peer{Kind: PeerExternal, CIDR: "0.0.0.0/0"}, 0) {
			t.Error("expected 192.0.2.0/24 blocked and the internet kept")
		}
	})

	t.Run("already blocked", func(t *testing.T) {
		s := planSnap(denyIngress("b"))
		p := mustPlan(t, s, PlanRequest{Subject: dbS, Direction: "inbound", Peer: webWL, Action: "block"})
		assertPlan(t, p, nil, true)
	})
}

func TestPlanRejectsBadRequests(t *testing.T) {
	s := planSnap()
	for name, req := range map[string]PlanRequest{
		"bad direction": {Subject: webS, Direction: "sideways", Peer: dbWL, Action: "allow"},
		"bad action":    {Subject: webS, Direction: "inbound", Peer: dbWL, Action: "toggle"},
		"self":          {Subject: webS, Direction: "inbound", Peer: webWL, Action: "allow"},
		"no such peer":  {Subject: webS, Direction: "inbound", Peer: Peer{Kind: PeerWorkload, Namespace: "a", Workload: "deployment/ghost"}, Action: "allow"},
		"bad cidr":      {Subject: webS, Direction: "outbound", Peer: Peer{Kind: PeerExternal, CIDR: "nope"}, Action: "allow"},
	} {
		if _, err := PlanAccess(s, req); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestAccessReport(t *testing.T) {
	s := planSnap(denyIngress("b"))
	r, err := Access(s, webS)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Pods) != 2 || r.IngressIsolated || r.EgressIsolated {
		t.Fatalf("report header = %+v", r)
	}
	row := func(rows []AccessRow, id string) AccessRow {
		for _, x := range rows {
			if x.Peer.ID() == id {
				return x
			}
		}
		t.Fatalf("no row %s", id)
		return AccessRow{}
	}
	out := row(r.Outbound, "b/statefulset/db")
	if out.Verdict != "blocked" || !out.Ingress.Isolated || len(out.Ports) != 1 || out.Ports[0].Allowed {
		t.Errorf("web -> db row = %+v", out)
	}
	if dns := row(r.Outbound, "kube-system/deployment/coredns"); dns.Peer.Label != "DNS" || dns.Verdict != "unconstrained" {
		t.Errorf("dns row = %+v", dns)
	}
	if ext := row(r.Outbound, "0.0.0.0/0"); ext.Peer.Kind != PeerExternal || ext.Verdict != "unconstrained" {
		t.Errorf("internet row = %+v", ext)
	}
	ns, err := Access(s, Subject{Namespace: "b"})
	if err != nil {
		t.Fatal(err)
	}
	if in := row(ns.Inbound, "a"); in.Verdict != "blocked" || in.Counts.Blocked != 2 {
		t.Errorf("namespace inbound a -> b = %+v", in)
	}
	if _, err := Access(s, Subject{Namespace: "zzz"}); err == nil {
		t.Error("unknown namespace must error")
	}
}
