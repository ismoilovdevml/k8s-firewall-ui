package simulator

import (
	"fmt"
	"net"
	"sort"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObservedPeer is a peer the subject actually exchanged traffic with, and
// the destination ports used.
type ObservedPeer struct {
	Peer  Peer       `json:"peer"`
	Ports []PortSpec `json:"ports"`
}

// LearnRequest asks for a least-privilege policy built from observed traffic.
type LearnRequest struct {
	Subject   Subject        `json:"subject"`
	Direction string         `json:"direction"` // inbound | outbound
	Observed  []ObservedPeer `json:"-"`         // filled server-side from the flow store
}

// PlanLearn writes the subject's managed policy for one direction so that it
// allows exactly the observed peers on the observed ports (plus DNS for
// egress) and nothing else. Hand-written policies that also select the
// subject keep allowing what they allow; they are listed in the notes.
func PlanLearn(snap *Snapshot, req LearnRequest) (Plan, error) {
	plan := Plan{Changes: []PlannedChange{}, Blockers: []Blocker{}, Notes: []string{}}
	dir := dirEgress
	switch req.Direction {
	case directionInbound:
		dir = dirIngress
	case directionOutbound:
	default:
		return plan, fmt.Errorf("direction must be inbound or outbound")
	}
	if len(req.Observed) == 0 {
		return plan, fmt.Errorf("no traffic observed for %s %s yet — let the flow agent run longer", req.Subject.ID(), req.Direction)
	}
	self, err := resolveEndpoint(snap, subjectPeer(req.Subject))
	if err != nil {
		return plan, err
	}
	if len(self.reps) == 0 {
		return plan, fmt.Errorf("%s has no running pods", req.Subject.ID())
	}

	b := &builder{snap: snap, work: map[string]*networkingv1.NetworkPolicy{}}
	pol := b.managed(self, dir)
	if dir == dirIngress {
		pol.Spec.Ingress = nil
	} else {
		pol.Spec.Egress = nil
	}

	type resolved struct {
		ep    endpoint
		ports []PortSpec
	}
	var peers []resolved
	for _, o := range req.Observed {
		p := o.Peer
		if p.Kind == PeerExternal {
			p.CIDR = hostCIDR(p.CIDR)
		}
		ep, err := resolveEndpoint(snap, p)
		if err != nil {
			plan.Notes = append(plan.Notes, fmt.Sprintf("Skipped %s: %v", o.Peer.ID(), err))
			continue
		}
		upsertRule(pol, dir, ep.term(), o.Ports)
		peers = append(peers, resolved{ep, o.Ports})
	}
	if dir == dirEgress {
		dns := networkingv1.NetworkPolicyPeer{
			NamespaceSelector: nsSelector("kube-system"),
			PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"k8s-app": "kube-dns"}},
		}
		upsertRule(pol, dir, dns, []PortSpec{{Protocol: "UDP", Port: 53}, {Protocol: "TCP", Port: 53}})
	}
	b.touch(pol, fmt.Sprintf("allow only the %d peer(s) observed %s", len(peers), dirWord(dir)))

	// Other policies selecting the subject keep allowing what they allow.
	others := map[string]bool{}
	for _, rep := range self.reps {
		for _, p := range policiesSelecting(snap, rep, dir) {
			if !isManaged(p) {
				others[p.Namespace+"/"+p.Name] = true
			}
		}
	}
	if len(others) > 0 {
		names := make([]string, 0, len(others))
		for n := range others {
			names = append(names, n)
		}
		sort.Strings(names)
		plan.Notes = append(plan.Notes, fmt.Sprintf("Hand-written policies also select this subject and may allow more: %v.", names))
	}
	plan.Notes = append(plan.Notes, fmt.Sprintf("Built from %d observed peer(s). Traffic that was not observed (rare jobs, failover paths) will be blocked — review before applying.", len(peers)))

	plan.Changes = b.changes()
	after := ApplyChanges(snap, toPolicyChanges(plan.Changes))
	plan.Verified = true
	for _, p := range peers {
		if !sideAdmitsAll(after, self, dir, p.ep, p.ports) {
			plan.Verified = false
			plan.Notes = append(plan.Notes, "Observed traffic with "+p.ep.peer.ID()+" would not be allowed.")
		}
	}
	plan.AlreadyDone = len(plan.Changes) == 0
	plan.Impact = ImpactMany(snap, toPolicyChanges(plan.Changes))
	return plan, nil
}

// hostCIDR turns a bare IP into a host CIDR (/32 or /128).
func hostCIDR(s string) string {
	if _, _, err := net.ParseCIDR(s); err == nil {
		return s
	}
	ip := net.ParseIP(s)
	if ip == nil {
		return s
	}
	if ip.To4() != nil {
		return ip.String() + "/32"
	}
	return ip.String() + "/128"
}
