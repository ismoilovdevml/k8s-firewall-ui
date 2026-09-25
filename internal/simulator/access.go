package simulator

import (
	"fmt"
	"net"
	"sort"

	networkingv1 "k8s.io/api/networking/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// Access explorer: for one subject (a workload or a whole namespace) list
// every peer it can or cannot talk to, in both directions, with per-port
// detail and the rules that decide. This is the read side of the firewall
// console; plan.go is the write side.

// Peer kinds.
const (
	PeerWorkload  = "workload"
	PeerNamespace = "namespace"
	PeerExternal  = "external"
)

// Subject is what the access view is about: a workload (Namespace + Workload
// such as "deployment/web") or, with Workload empty, a whole namespace.
type Subject struct {
	Namespace string `json:"namespace"`
	Workload  string `json:"workload,omitempty"`
}

// ID renders the subject like workload IDs ("<ns>/<owner>" or "<ns>").
func (s Subject) ID() string {
	if s.Workload == "" {
		return s.Namespace
	}
	return s.Namespace + "/" + s.Workload
}

// Peer is the other end of a flow.
type Peer struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Workload  string `json:"workload,omitempty"` // PeerWorkload only
	CIDR      string `json:"cidr,omitempty"`     // PeerExternal only
	// Label is a human hint, e.g. "DNS" for kube-dns or "internet".
	Label string `json:"label,omitempty"`
}

// ID renders the peer compactly (also the key used by plan requests).
func (p Peer) ID() string {
	switch p.Kind {
	case PeerWorkload:
		return p.Namespace + "/" + p.Workload
	case PeerNamespace:
		return p.Namespace
	default:
		return p.CIDR
	}
}

// PortStatus is the verdict for one destination port.
type PortStatus struct {
	Name     string `json:"name,omitempty"`
	Protocol string `json:"protocol"`
	Port     int32  `json:"port"`
	Allowed  bool   `json:"allowed"`
}

// SideStatus is one side's check for a row (any port).
type SideStatus struct {
	Applicable bool        `json:"applicable"`
	Isolated   bool        `json:"isolated"`
	Allowed    bool        `json:"allowed"`
	Rules      []RuleMatch `json:"rules,omitempty"`
}

// AccessRow is one peer in one direction.
type AccessRow struct {
	Peer Peer `json:"peer"`
	// Verdict: allowed | blocked | unconstrained (workload/external rows),
	// or allowed | partial | blocked | unconstrained for namespace rows.
	Verdict string `json:"verdict"`
	// Egress is the source side, Ingress the destination side.
	Egress  SideStatus     `json:"egress"`
	Ingress SideStatus     `json:"ingress"`
	Ports   []PortStatus   `json:"ports,omitempty"`
	Counts  *VerdictCounts `json:"counts,omitempty"` // namespace rows
}

// AccessReport is the full firewall view of a subject.
type AccessReport struct {
	Subject         Subject              `json:"subject"`
	Pods            []string             `json:"pods"`
	Ports           []kube.ContainerPort `json:"ports,omitempty"`
	HostNetwork     bool                 `json:"hostNetwork"`
	IngressIsolated bool                 `json:"ingressIsolated"`
	EgressIsolated  bool                 `json:"egressIsolated"`
	IngressPolicies []PolicyRef          `json:"ingressPolicies"`
	EgressPolicies  []PolicyRef          `json:"egressPolicies"`
	Inbound         []AccessRow          `json:"inbound"`
	Outbound        []AccessRow          `json:"outbound"`
	Workloads       []string             `json:"workloads,omitempty"` // namespace subjects
}

// internetProbe represents "anywhere on the internet" when no policy names
// a specific CIDR (TEST-NET-3, never a real peer).
const internetProbe = "203.0.113.10"

// Access builds the report for subj.
func Access(snap *Snapshot, subj Subject) (AccessReport, error) {
	if subj.Workload == "" {
		return namespaceAccess(snap, subj)
	}
	var self *Workload
	all := Workloads(snap, nil)
	for i := range all {
		if all[i].Namespace == subj.Namespace && all[i].Owner == subj.Workload {
			self = &all[i]
		}
	}
	if self == nil {
		return AccessReport{}, fmt.Errorf("workload %s not found", subj.ID())
	}
	idx := NewIndex(snap)
	rep := self.Rep
	report := AccessReport{
		Subject: subj, Pods: podsOf(snap, *self), Ports: rep.Ports, HostNetwork: self.HostNetwork,
		Inbound: []AccessRow{}, Outbound: []AccessRow{},
	}
	report.IngressPolicies, report.EgressPolicies = IsolationOf(snap, rep)
	report.IngressIsolated = len(report.IngressPolicies) > 0
	report.EgressIsolated = len(report.EgressPolicies) > 0
	if report.IngressPolicies == nil {
		report.IngressPolicies = []PolicyRef{}
	}
	if report.EgressPolicies == nil {
		report.EgressPolicies = []PolicyRef{}
	}

	for _, other := range all {
		if other.ID == self.ID {
			continue
		}
		peer := Peer{Kind: PeerWorkload, Namespace: other.Namespace, Workload: other.Owner, Label: peerLabel(other.Rep)}
		report.Outbound = append(report.Outbound, workloadRow(snap, idx, peer, rep, other.Rep))
		report.Inbound = append(report.Inbound, workloadRow(snap, idx, peer, other.Rep, rep))
	}

	// External peers: the internet plus every CIDR the subject's policies
	// mention for that direction.
	for _, cidr := range externalCIDRs(idx.selecting(rep, dirEgress), dirEgress) {
		report.Outbound = append(report.Outbound, externalRow(snap, idx, rep, cidr, dirEgress))
	}
	for _, cidr := range externalCIDRs(idx.selecting(rep, dirIngress), dirIngress) {
		report.Inbound = append(report.Inbound, externalRow(snap, idx, rep, cidr, dirIngress))
	}
	return report, nil
}

func podsOf(snap *Snapshot, wl Workload) []string {
	out := []string{}
	for _, p := range snap.Pods {
		if p.Namespace == wl.Namespace && p.Owner == wl.Owner {
			out = append(out, p.Name)
		}
	}
	return out
}

func peerLabel(p kube.PodInfo) string {
	if p.Labels["k8s-app"] == "kube-dns" {
		return "DNS"
	}
	return ""
}

// workloadRow evaluates src → dst for any port and per declared dst port.
func workloadRow(snap *Snapshot, idx *Index, peer Peer, src, dst kube.PodInfo) AccessRow {
	eg := evalSideWith(snap, src, idx.selecting(src, dirEgress), dirEgress, podTarget(dst), nil)
	in := evalSideWith(snap, dst, idx.selecting(dst, dirIngress), dirIngress, podTarget(src), nil)
	verdict, _ := edgeVerdict(eg, in)
	row := AccessRow{Peer: peer, Verdict: string(verdict), Egress: sideStatus(eg), Ingress: sideStatus(in)}
	for _, cp := range dst.Ports {
		q := &PortQuery{Protocol: string(cp.Protocol), Port: cp.Port}
		e := evalSideWith(snap, src, idx.selecting(src, dirEgress), dirEgress, podTarget(dst), q)
		i := evalSideWith(snap, dst, idx.selecting(dst, dirIngress), dirIngress, podTarget(src), q)
		row.Ports = append(row.Ports, PortStatus{Name: cp.Name, Protocol: string(cp.Protocol), Port: cp.Port, Allowed: e.Allowed && i.Allowed})
	}
	return row
}

// externalRow evaluates the subject's own side against an external CIDR.
func externalRow(snap *Snapshot, idx *Index, subject kube.PodInfo, cidr string, dir direction) AccessRow {
	probe := probeIP(cidr)
	side := evalSideWith(snap, subject, idx.selecting(subject, dir), dir, ipTarget(probe), nil)
	label := ""
	if cidr == "0.0.0.0/0" {
		label = "internet"
	}
	row := AccessRow{Peer: Peer{Kind: PeerExternal, CIDR: cidr, Label: label}}
	verdict := EdgeAllowed
	switch {
	case !side.Isolated:
		verdict = EdgeUnconstrained
	case !side.Allowed:
		verdict = EdgeBlocked
	}
	row.Verdict = string(verdict)
	if dir == dirEgress {
		row.Egress, row.Ingress = sideStatus(side), SideStatus{}
	} else {
		row.Ingress, row.Egress = sideStatus(side), SideStatus{}
	}
	return row
}

func sideStatus(s SideResult) SideStatus {
	return SideStatus{Applicable: s.Applicable, Isolated: s.Isolated, Allowed: s.Allowed, Rules: s.MatchedRules}
}

// externalCIDRs lists "0.0.0.0/0" plus every ipBlock CIDR in the given
// policies' rules for dir, sorted and de-duplicated.
func externalCIDRs(pols []*networkingv1.NetworkPolicy, dir direction) []string {
	seen := map[string]bool{"0.0.0.0/0": true}
	for _, pol := range pols {
		for _, r := range rulesOf(pol, dir) {
			for _, p := range r.peers {
				if p.IPBlock != nil {
					seen[p.IPBlock.CIDR] = true
				}
			}
		}
	}
	out := make([]string, 0, len(seen))
	for c := range seen {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i] == "0.0.0.0/0" {
			return true
		}
		if out[j] == "0.0.0.0/0" {
			return false
		}
		return out[i] < out[j]
	})
	return out
}

// probeIP picks a representative address inside cidr (the internet probe
// for 0.0.0.0/0, otherwise the first host address).
func probeIP(cidr string) string {
	if cidr == "0.0.0.0/0" {
		return internetProbe
	}
	ip, n, err := net.ParseCIDR(cidr)
	if err != nil {
		return ""
	}
	ip = ip.Mask(n.Mask)
	if v4 := ip.To4(); v4 != nil {
		ones, bits := n.Mask.Size()
		if bits-ones >= 2 {
			v4[3]++
		}
		return v4.String()
	}
	return ip.String()
}

// namespaceAccess aggregates workload pairs between the subject namespace
// and every other namespace, in both directions.
func namespaceAccess(snap *Snapshot, subj Subject) (AccessReport, error) {
	all := Workloads(snap, nil)
	var mine, others []Workload
	for _, wl := range all {
		if wl.Namespace == subj.Namespace {
			mine = append(mine, wl)
		} else {
			others = append(others, wl)
		}
	}
	found := false
	for _, ns := range snap.Namespaces {
		if ns.Name == subj.Namespace {
			found = true
		}
	}
	if !found {
		return AccessReport{}, fmt.Errorf("namespace %s not found", subj.Namespace)
	}
	idx := NewIndex(snap)
	report := AccessReport{Subject: subj, Pods: []string{}, Inbound: []AccessRow{}, Outbound: []AccessRow{},
		IngressPolicies: []PolicyRef{}, EgressPolicies: []PolicyRef{}, Workloads: []string{}}
	isoIn, isoEg := true, true
	for _, wl := range mine {
		report.Workloads = append(report.Workloads, wl.Owner)
		report.Pods = append(report.Pods, podsOf(snap, wl)...)
		in, eg := IsolationOf(snap, wl.Rep)
		isoIn = isoIn && len(in) > 0
		isoEg = isoEg && len(eg) > 0
	}
	report.IngressIsolated = len(mine) > 0 && isoIn
	report.EgressIsolated = len(mine) > 0 && isoEg
	for _, pol := range snap.Policies {
		if pol.Namespace != subj.Namespace {
			continue
		}
		ref := PolicyRef{Namespace: pol.Namespace, Name: pol.Name}
		if hasPolicyType(pol, dirIngress) {
			report.IngressPolicies = append(report.IngressPolicies, ref)
		}
		if hasPolicyType(pol, dirEgress) {
			report.EgressPolicies = append(report.EgressPolicies, ref)
		}
	}

	byNS := map[string][]Workload{}
	var names []string
	for _, wl := range others {
		if _, ok := byNS[wl.Namespace]; !ok {
			names = append(names, wl.Namespace)
		}
		byNS[wl.Namespace] = append(byNS[wl.Namespace], wl)
	}
	sort.Strings(names)
	for _, ns := range names {
		var out, in VerdictCounts
		for _, a := range mine {
			for _, b := range byNS[ns] {
				v, _ := idx.EvaluateEdge(a.Rep, b.Rep)
				out.add(v)
				v, _ = idx.EvaluateEdge(b.Rep, a.Rep)
				in.add(v)
			}
		}
		peer := Peer{Kind: PeerNamespace, Namespace: ns}
		o, i := out, in
		report.Outbound = append(report.Outbound, AccessRow{Peer: peer, Verdict: reach(o), Counts: &o})
		report.Inbound = append(report.Inbound, AccessRow{Peer: peer, Verdict: reach(i), Counts: &i})
	}
	return report, nil
}

// reach classifies aggregated counts (mirrors the UI's namespace graph).
func reach(c VerdictCounts) string {
	open := c.Allowed + c.Unconstrained
	switch {
	case open == 0 && c.Blocked == 0:
		return string(EdgeUnconstrained)
	case open == 0:
		return string(EdgeBlocked)
	case c.Blocked > 0:
		return "partial"
	case c.Allowed > 0:
		return string(EdgeAllowed)
	default:
		return string(EdgeUnconstrained)
	}
}
