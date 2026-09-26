package simulator

import (
	"strings"
	"testing"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

func TestPlanLearn(t *testing.T) {
	s := planSnap()
	observed := []ObservedPeer{
		{Peer: dbWL, Ports: []PortSpec{{Protocol: "TCP", Port: 5432}}},
		{Peer: Peer{Kind: PeerExternal, CIDR: "203.0.113.7"}, Ports: []PortSpec{{Protocol: "TCP", Port: 443}}},
	}
	p, err := PlanLearn(s, LearnRequest{Subject: webS, Direction: "outbound", Observed: observed})
	if err != nil {
		t.Fatal(err)
	}
	if !p.Verified || len(p.Changes) != 1 || p.Changes[0].Name != "fwui-web-egress" {
		t.Fatalf("plan = %+v", p)
	}
	after := apply(s, p)
	cases := []struct {
		name string
		dst  Peer
		port int32
		want bool
	}{
		{"observed db port", dbWL, 5432, true},
		{"unobserved db port", dbWL, 22, false},
		{"unobserved workload", apiWL, 9000, false},
		{"DNS kept", dnsWL, 0, true},
		{"observed external host", Peer{Kind: PeerExternal, CIDR: "203.0.113.7/32"}, 443, true},
		{"other external host", Peer{Kind: PeerExternal, CIDR: "203.0.113.8/32"}, 443, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got bool
			if tc.name == "DNS kept" {
				got = evalSide(after, planSnapRep(t, after, webWL), dirEgress, podTarget(planSnapRep(t, after, dnsWL)), udp(53)).Allowed
			} else {
				got = reachable(t, after, webWL, tc.dst, tc.port)
			}
			if got != tc.want {
				t.Errorf("reachable = %v, want %v", got, tc.want)
			}
		})
	}
	if len(p.Impact.NewlyBlocked) == 0 {
		t.Error("least privilege should block the unobserved peers")
	}

	if _, err := PlanLearn(s, LearnRequest{Subject: webS, Direction: "outbound"}); err == nil || !strings.Contains(err.Error(), "no traffic observed") {
		t.Errorf("empty observation must error, got %v", err)
	}
}

func planSnapRep(t *testing.T, s *Snapshot, p Peer) kube.PodInfo {
	t.Helper()
	e, err := resolveEndpoint(s, p)
	if err != nil || len(e.reps) == 0 {
		t.Fatalf("resolve %s: %v", p.ID(), err)
	}
	return e.reps[0]
}
