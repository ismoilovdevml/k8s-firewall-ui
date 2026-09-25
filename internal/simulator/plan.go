package simulator

import (
	"fmt"
	"net"
	"regexp"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/equality"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// The access planner turns "allow / block this flow" into concrete
// NetworkPolicy changes. NetworkPolicy is allow-only, so:
//
//   - allow adds a rule for the peer on every side that is isolated and does
//     not already admit the flow (source egress and destination ingress);
//   - block acts on the subject's own side. If that side is not isolated it
//     is "locked down": isolated by a managed policy that re-allows every
//     peer that can connect today except the blocked one. If it is isolated,
//     the admitting rules are narrowed — managed rules are edited, rules in
//     other policies are reported as blockers (they must be edited by hand).
//
// Rules the planner writes live in "managed" policies named
// fwui-<workload>-<direction> (or fwui-namespace-<direction>) carrying the
// ManagedByLabel, so they never collide with hand-written policies.
// Every plan is verified by re-evaluating the flow on the changed snapshot.

// ManagedByLabel marks policies owned by the access planner.
const (
	ManagedByLabel      = "app.kubernetes.io/managed-by"
	ManagedByValue      = "k8s-firewall-ui"
	SubjectAnnotation   = "k8s-firewall-ui.io/subject"
	namespaceNameLabel  = "kubernetes.io/metadata.name"
	directionInbound    = "inbound"
	directionOutbound   = "outbound"
	actionAllow         = "allow"
	actionBlock         = "block"
	operationCreate     = "create"
	operationUpdate     = "update"
	maxManagedNameBytes = 63
)

// PrivateRanges are excluded from "internet" rules (RFC 1918 plus the
// RFC 6598 shared range some CNIs use for pods).
var PrivateRanges = []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"}

// coveredBy reports whether cidr lies inside one of ranges.
func coveredBy(cidr string, ranges []string) bool {
	ip, n, err := net.ParseCIDR(cidr)
	if err != nil {
		return false
	}
	ones, _ := n.Mask.Size()
	for _, r := range ranges {
		_, rn, err := net.ParseCIDR(r)
		if err != nil {
			continue
		}
		rOnes, _ := rn.Mask.Size()
		if rn.Contains(ip) && ones >= rOnes {
			return true
		}
	}
	return false
}

// volatileLabels change per pod or per rollout and must never be used to
// select a workload.
var volatileLabels = map[string]bool{
	"pod-template-hash":                  true,
	"controller-revision-hash":           true,
	"pod-template-generation":            true,
	"statefulset.kubernetes.io/pod-name": true,
	"apps.kubernetes.io/pod-index":       true,
	"controller-uid":                     true,
	"batch.kubernetes.io/controller-uid": true,
}

// PortSpec restricts an allow to one port.
type PortSpec struct {
	Protocol string `json:"protocol"`
	Port     int32  `json:"port"`
}

// PlanRequest asks to allow or block the flow between Subject and Peer.
type PlanRequest struct {
	Subject   Subject `json:"subject"`
	Direction string  `json:"direction"` // inbound (peer → subject) | outbound (subject → peer)
	Peer      Peer    `json:"peer"`
	Action    string  `json:"action"` // allow | block
	// Ports restricts an allow; empty = the destination's declared ports
	// (all ports when it declares none, and always for namespace flows).
	Ports []PortSpec `json:"ports,omitempty"`
	// KeepExternal: when a block must isolate a side that is open today,
	// keep traffic to/from external networks (ipBlock 0.0.0.0/0) allowed.
	KeepExternal bool `json:"keepExternal"`
}

// PlannedChange is one policy to create or update.
type PlannedChange struct {
	Operation string                      `json:"operation"` // create | update
	Namespace string                      `json:"namespace"`
	Name      string                      `json:"name"`
	Policy    *networkingv1.NetworkPolicy `json:"policy"`
	Previous  *networkingv1.NetworkPolicy `json:"previous,omitempty"`
	Reason    string                      `json:"reason"`
}

// Blocker is a rule outside the planner's control that keeps a flow open.
type Blocker struct {
	Policy      PolicyRef `json:"policy"`
	RuleIndex   int       `json:"ruleIndex"`
	Explanation string    `json:"explanation"`
}

// Plan is the planner's answer.
type Plan struct {
	Changes  []PlannedChange `json:"changes"`
	Blockers []Blocker       `json:"blockers"`
	Notes    []string        `json:"notes"`
	// AlreadyDone: the flow is already in the requested state.
	AlreadyDone bool `json:"alreadyDone"`
	// Verified: after applying Changes the flow is in the requested state.
	Verified bool         `json:"verified"`
	Impact   ImpactResult `json:"impact"`
}

// endpoint is one end of a flow with its representative pods.
type endpoint struct {
	peer     Peer
	selector map[string]string // workloads only
	reps     []kube.PodInfo    // workload: 1; namespace: one per workload
	ip       string            // external probe
}

func (e endpoint) isExternal() bool { return e.peer.Kind == PeerExternal }

// targets are the concrete things to evaluate against when e is the peer.
func (e endpoint) targets() []target {
	if e.isExternal() {
		return []target{ipTarget(e.ip)}
	}
	if len(e.reps) == 0 { // empty namespace: a synthetic pod still matches namespace terms
		return []target{podTarget(kube.PodInfo{Namespace: e.peer.Namespace, Labels: map[string]string{}})}
	}
	out := make([]target, 0, len(e.reps))
	for _, p := range e.reps {
		out = append(out, podTarget(p))
	}
	return out
}

// term is the NetworkPolicyPeer that designates e from any namespace.
func (e endpoint) term() networkingv1.NetworkPolicyPeer {
	switch e.peer.Kind {
	case PeerExternal:
		return networkingv1.NetworkPolicyPeer{IPBlock: &networkingv1.IPBlock{CIDR: e.peer.CIDR}}
	case PeerNamespace:
		return networkingv1.NetworkPolicyPeer{NamespaceSelector: nsSelector(e.peer.Namespace)}
	default:
		return networkingv1.NetworkPolicyPeer{
			NamespaceSelector: nsSelector(e.peer.Namespace),
			PodSelector:       &metav1.LabelSelector{MatchLabels: copyLabels(e.selector)},
		}
	}
}

func nsSelector(ns string) *metav1.LabelSelector {
	return &metav1.LabelSelector{MatchLabels: map[string]string{namespaceNameLabel: ns}}
}

func copyLabels(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// WorkloadSelector returns the labels shared by every pod of the workload,
// minus per-pod/per-rollout labels. It errors when nothing stable is left.
func WorkloadSelector(snap *Snapshot, namespace, owner string) (map[string]string, error) {
	var common map[string]string
	for _, p := range snap.Pods {
		if p.Namespace != namespace || p.Owner != owner {
			continue
		}
		if common == nil {
			common = map[string]string{}
			for k, v := range p.Labels {
				if !volatileLabels[k] {
					common[k] = v
				}
			}
			continue
		}
		for k, v := range common {
			if p.Labels[k] != v {
				delete(common, k)
			}
		}
	}
	if common == nil {
		return nil, fmt.Errorf("workload %s/%s has no running pods", namespace, owner)
	}
	if len(common) == 0 {
		return nil, fmt.Errorf("workload %s/%s has no stable labels to select it by", namespace, owner)
	}
	return common, nil
}

func resolveEndpoint(snap *Snapshot, p Peer) (endpoint, error) {
	e := endpoint{peer: p}
	switch p.Kind {
	case PeerExternal:
		if _, _, err := net.ParseCIDR(p.CIDR); err != nil {
			return e, fmt.Errorf("invalid CIDR %q", p.CIDR)
		}
		e.ip = probeIP(p.CIDR)
		return e, nil
	case PeerNamespace:
		for _, wl := range Workloads(snap, map[string]bool{p.Namespace: true}) {
			e.reps = append(e.reps, wl.Rep)
		}
		return e, nil
	case PeerWorkload:
		sel, err := WorkloadSelector(snap, p.Namespace, p.Workload)
		if err != nil {
			return e, err
		}
		e.selector = sel
		for _, wl := range Workloads(snap, map[string]bool{p.Namespace: true}) {
			if wl.Owner == p.Workload {
				e.reps = []kube.PodInfo{wl.Rep}
			}
		}
		return e, nil
	}
	return e, fmt.Errorf("unknown peer kind %q", p.Kind)
}

func subjectPeer(s Subject) Peer {
	if s.Workload == "" {
		return Peer{Kind: PeerNamespace, Namespace: s.Namespace}
	}
	return Peer{Kind: PeerWorkload, Namespace: s.Namespace, Workload: s.Workload}
}

// PlanAccess computes the changes for req. The snapshot is not modified.
func PlanAccess(snap *Snapshot, req PlanRequest) (Plan, error) {
	plan := Plan{Changes: []PlannedChange{}, Blockers: []Blocker{}, Notes: []string{}}
	if req.Direction != directionInbound && req.Direction != directionOutbound {
		return plan, fmt.Errorf("direction must be inbound or outbound")
	}
	if req.Action != actionAllow && req.Action != actionBlock {
		return plan, fmt.Errorf("action must be allow or block")
	}
	subject, err := resolveEndpoint(snap, subjectPeer(req.Subject))
	if err != nil {
		return plan, err
	}
	if len(subject.reps) == 0 {
		return plan, fmt.Errorf("%s has no running pods", req.Subject.ID())
	}
	other, err := resolveEndpoint(snap, req.Peer)
	if err != nil {
		return plan, err
	}
	if other.peer.Kind == PeerWorkload && other.peer.ID() == subject.peer.ID() {
		return plan, fmt.Errorf("a workload cannot be its own peer")
	}

	src, dst := subject, other
	if req.Direction == directionInbound {
		src, dst = other, subject
	}
	ports := planPorts(req, dst)

	b := &builder{snap: snap, work: map[string]*networkingv1.NetworkPolicy{}}
	if req.Action == actionAllow {
		if flowAllowed(snap, src, dst, ports) {
			plan.AlreadyDone = true
			plan.Verified = true
			plan.Notes = append(plan.Notes, "This flow is already allowed.")
			return plan, nil
		}
		for _, dir := range []direction{dirEgress, dirIngress} {
			self, peer := src, dst
			if dir == dirIngress {
				self, peer = dst, src
			}
			if self.isExternal() || sideAdmitsAll(snap, self, dir, peer, ports) {
				continue
			}
			pol := b.managed(self, dir)
			upsertRule(pol, dir, peer.term(), ports)
			b.touch(pol, fmt.Sprintf("allow %s %s %s", peerWord(dir), dirWord(dir), peer.peer.ID()))
		}
		if hostNetwork(src) || hostNetwork(dst) {
			plan.Notes = append(plan.Notes, "A hostNetwork pod is involved: NetworkPolicy selectors do not apply to it, so enforcement is undefined.")
		}
	} else {
		self, peer, dir := subject, other, dirEgress
		if req.Direction == directionInbound {
			dir = dirIngress
		}
		if !flowAllowed(snap, src, dst, nil) {
			plan.AlreadyDone = true
			plan.Verified = true
			plan.Notes = append(plan.Notes, "This flow is already blocked.")
			return plan, nil
		}
		if !sideIsolated(snap, self, dir) {
			b.lockdown(self, dir, peer, req.KeepExternal, &plan)
		} else {
			b.narrow(self, dir, peer, &plan)
		}
	}

	plan.Changes = b.changes()
	after := ApplyChanges(snap, toPolicyChanges(plan.Changes))
	if req.Action == actionAllow {
		plan.Verified = flowAllowed(after, src, dst, ports)
	} else {
		plan.Verified = !flowAllowed(after, src, dst, nil)
		if !plan.Verified && len(plan.Blockers) == 0 {
			plan.Notes = append(plan.Notes, "The flow would still be allowed after these changes.")
		}
	}
	plan.Impact = ImpactMany(snap, toPolicyChanges(plan.Changes))
	return plan, nil
}

func toPolicyChanges(changes []PlannedChange) []PolicyChange {
	out := make([]PolicyChange, 0, len(changes))
	for _, c := range changes {
		out = append(out, PolicyChange{Namespace: c.Namespace, Name: c.Name, Proposed: c.Policy})
	}
	return out
}

func hostNetwork(e endpoint) bool {
	for _, r := range e.reps {
		if r.HostNetwork {
			return true
		}
	}
	return false
}

func peerWord(dir direction) string {
	if dir == dirEgress {
		return "egress"
	}
	return "ingress"
}

func dirWord(dir direction) string {
	if dir == dirEgress {
		return "to"
	}
	return "from"
}

// planPorts: explicit ports, else the destination workload's declared ports.
func planPorts(req PlanRequest, dst endpoint) []PortSpec {
	if len(req.Ports) > 0 {
		return req.Ports
	}
	if dst.peer.Kind != PeerWorkload || len(dst.reps) == 0 {
		return nil
	}
	var out []PortSpec
	for _, cp := range dst.reps[0].Ports {
		out = append(out, PortSpec{Protocol: string(cp.Protocol), Port: cp.Port})
	}
	return out
}

func queries(ports []PortSpec) []*PortQuery {
	if len(ports) == 0 {
		return []*PortQuery{nil}
	}
	out := make([]*PortQuery, 0, len(ports))
	for _, p := range ports {
		proto := p.Protocol
		if proto == "" {
			proto = "TCP"
		}
		out = append(out, &PortQuery{Protocol: proto, Port: p.Port})
	}
	return out
}

// sideAdmitsAll: every subject rep's dir-side admits every peer target on
// every queried port.
func sideAdmitsAll(snap *Snapshot, self endpoint, dir direction, peer endpoint, ports []PortSpec) bool {
	for _, rep := range self.reps {
		for _, t := range peer.targets() {
			for _, q := range queries(ports) {
				if !evalSide(snap, rep, dir, t, q).Allowed {
					return false
				}
			}
		}
	}
	return true
}

func sideIsolated(snap *Snapshot, self endpoint, dir direction) bool {
	for _, rep := range self.reps {
		if len(policiesSelecting(snap, rep, dir)) == 0 {
			return false
		}
	}
	return true
}

// flowAllowed: every src→dst pair passes both sides on every port. For
// external endpoints only the in-cluster side applies.
func flowAllowed(snap *Snapshot, src, dst endpoint, ports []PortSpec) bool {
	if !src.isExternal() && !sideAdmitsAll(snap, src, dirEgress, dst, ports) {
		return false
	}
	if !dst.isExternal() && !sideAdmitsAll(snap, dst, dirIngress, src, ports) {
		return false
	}
	return true
}

// --- change builder ---

type builder struct {
	snap  *Snapshot
	work  map[string]*networkingv1.NetworkPolicy
	order []string
	why   map[string][]string
}

func policyKey(ns, name string) string { return ns + "/" + name }

func (b *builder) existing(ns, name string) *networkingv1.NetworkPolicy {
	for _, pol := range b.snap.Policies {
		if pol.Namespace == ns && pol.Name == name {
			return pol
		}
	}
	return nil
}

// working returns a mutable copy of ns/name (from earlier edits or the
// snapshot), or nil when the policy does not exist.
func (b *builder) working(ns, name string) *networkingv1.NetworkPolicy {
	if pol, ok := b.work[policyKey(ns, name)]; ok {
		return pol
	}
	if pol := b.existing(ns, name); pol != nil {
		cp := pol.DeepCopy()
		cp.ManagedFields = nil
		b.work[policyKey(ns, name)] = cp
		b.order = append(b.order, policyKey(ns, name))
		return cp
	}
	return nil
}

var nonDNS = regexp.MustCompile(`[^a-z0-9-]+`)

// ManagedPolicyName is the planner's policy name for a subject + direction.
func ManagedPolicyName(p Peer, ingress bool) string {
	suffix := "-egress"
	if ingress {
		suffix = "-ingress"
	}
	base := "fwui-namespace"
	if p.Kind == PeerWorkload {
		name := p.Workload
		if i := strings.LastIndex(name, "/"); i >= 0 {
			name = name[i+1:]
		}
		base = "fwui-" + strings.Trim(nonDNS.ReplaceAllString(strings.ToLower(name), "-"), "-")
	}
	if len(base)+len(suffix) > maxManagedNameBytes {
		base = strings.TrimRight(base[:maxManagedNameBytes-len(suffix)], "-")
	}
	return base + suffix
}

// managed returns the managed policy for e/dir, creating it if needed.
func (b *builder) managed(e endpoint, dir direction) *networkingv1.NetworkPolicy {
	name := ManagedPolicyName(e.peer, dir == dirIngress)
	if pol := b.working(e.peer.Namespace, name); pol != nil {
		if !hasPolicyType(pol, dir) {
			pol.Spec.PolicyTypes = append(pol.Spec.PolicyTypes, networkingv1.PolicyType(peerTypeName(dir)))
		}
		return pol
	}
	selector := metav1.LabelSelector{}
	subjectID := e.peer.Namespace
	if e.peer.Kind == PeerWorkload {
		selector.MatchLabels = copyLabels(e.selector)
		subjectID = e.peer.ID()
	}
	pol := &networkingv1.NetworkPolicy{
		TypeMeta: metav1.TypeMeta{APIVersion: "networking.k8s.io/v1", Kind: "NetworkPolicy"},
		ObjectMeta: metav1.ObjectMeta{
			Namespace:   e.peer.Namespace,
			Name:        name,
			Labels:      map[string]string{ManagedByLabel: ManagedByValue},
			Annotations: map[string]string{SubjectAnnotation: subjectID},
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: selector,
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyType(peerTypeName(dir))},
		},
	}
	key := policyKey(pol.Namespace, pol.Name)
	b.work[key] = pol
	b.order = append(b.order, key)
	return pol
}

func peerTypeName(dir direction) string { return string(dir) }

func (b *builder) touch(pol *networkingv1.NetworkPolicy, reason string) {
	if b.why == nil {
		b.why = map[string][]string{}
	}
	key := policyKey(pol.Namespace, pol.Name)
	b.why[key] = append(b.why[key], reason)
}

// changes lists every touched policy that actually differs from the cluster.
func (b *builder) changes() []PlannedChange {
	out := []PlannedChange{}
	for _, key := range b.order {
		pol := b.work[key]
		prev := b.existing(pol.Namespace, pol.Name)
		op := operationCreate
		if prev != nil {
			if equality.Semantic.DeepEqual(prev.Spec, pol.Spec) {
				continue
			}
			op = operationUpdate
		}
		out = append(out, PlannedChange{
			Operation: op, Namespace: pol.Namespace, Name: pol.Name,
			Policy: pol, Previous: prev, Reason: strings.Join(b.why[key], "; "),
		})
	}
	return out
}

// isManaged reports whether the planner owns pol.
func isManaged(pol *networkingv1.NetworkPolicy) bool {
	return pol.Labels[ManagedByLabel] == ManagedByValue
}

// --- rule editing ---

func rulePeers(pol *networkingv1.NetworkPolicy, dir direction, i int) []networkingv1.NetworkPolicyPeer {
	if dir == dirIngress {
		return pol.Spec.Ingress[i].From
	}
	return pol.Spec.Egress[i].To
}

func ruleCount(pol *networkingv1.NetworkPolicy, dir direction) int {
	if dir == dirIngress {
		return len(pol.Spec.Ingress)
	}
	return len(pol.Spec.Egress)
}

func setRulePeers(pol *networkingv1.NetworkPolicy, dir direction, i int, peers []networkingv1.NetworkPolicyPeer) {
	if dir == dirIngress {
		pol.Spec.Ingress[i].From = peers
	} else {
		pol.Spec.Egress[i].To = peers
	}
}

func deleteRule(pol *networkingv1.NetworkPolicy, dir direction, i int) {
	if dir == dirIngress {
		pol.Spec.Ingress = append(pol.Spec.Ingress[:i], pol.Spec.Ingress[i+1:]...)
	} else {
		pol.Spec.Egress = append(pol.Spec.Egress[:i], pol.Spec.Egress[i+1:]...)
	}
}

func toPolicyPorts(ports []PortSpec) []networkingv1.NetworkPolicyPort {
	out := make([]networkingv1.NetworkPolicyPort, 0, len(ports))
	for _, p := range ports {
		proto := corev1.Protocol(p.Protocol)
		if proto == "" {
			proto = corev1.ProtocolTCP
		}
		port := intstr.FromInt32(p.Port)
		out = append(out, networkingv1.NetworkPolicyPort{Protocol: &proto, Port: &port})
	}
	return out
}

// upsertRule adds a single-peer rule for term (merging ports into an
// existing rule for the same peer; empty ports means all ports).
func upsertRule(pol *networkingv1.NetworkPolicy, dir direction, term networkingv1.NetworkPolicyPeer, ports []PortSpec) {
	for i := 0; i < ruleCount(pol, dir); i++ {
		peers := rulePeers(pol, dir, i)
		if len(peers) != 1 || !equality.Semantic.DeepEqual(peers[0], term) {
			continue
		}
		existing := ruleports(pol, dir, i)
		if len(existing) == 0 || len(ports) == 0 {
			setRulePorts(pol, dir, i, nil) // all ports
			return
		}
		setRulePorts(pol, dir, i, mergePorts(existing, toPolicyPorts(ports)))
		return
	}
	pp := toPolicyPorts(ports)
	if len(pp) == 0 {
		pp = nil
	}
	if dir == dirIngress {
		pol.Spec.Ingress = append(pol.Spec.Ingress, networkingv1.NetworkPolicyIngressRule{From: []networkingv1.NetworkPolicyPeer{term}, Ports: pp})
	} else {
		pol.Spec.Egress = append(pol.Spec.Egress, networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{term}, Ports: pp})
	}
}

func ruleports(pol *networkingv1.NetworkPolicy, dir direction, i int) []networkingv1.NetworkPolicyPort {
	if dir == dirIngress {
		return pol.Spec.Ingress[i].Ports
	}
	return pol.Spec.Egress[i].Ports
}

func setRulePorts(pol *networkingv1.NetworkPolicy, dir direction, i int, ports []networkingv1.NetworkPolicyPort) {
	if dir == dirIngress {
		pol.Spec.Ingress[i].Ports = ports
	} else {
		pol.Spec.Egress[i].Ports = ports
	}
}

func mergePorts(a, b []networkingv1.NetworkPolicyPort) []networkingv1.NetworkPolicyPort {
	out := append([]networkingv1.NetworkPolicyPort(nil), a...)
	for _, p := range b {
		dup := false
		for _, q := range out {
			if equality.Semantic.DeepEqual(p, q) {
				dup = true
			}
		}
		if !dup {
			out = append(out, p)
		}
	}
	return out
}

// lockdown isolates self/dir, re-allowing every peer that can connect today
// except the blocked one.
func (b *builder) lockdown(self endpoint, dir direction, blocked endpoint, keepExternal bool, plan *Plan) {
	pol := b.managed(self, dir)
	all := Workloads(b.snap, nil)
	selfIDs := map[string]bool{}
	for _, r := range self.reps {
		selfIDs[r.Namespace+"/"+r.Owner] = true
	}
	// Which workloads can connect with self in this direction today?
	openByNS := map[string][]Workload{}
	totalByNS := map[string]int{}
	for _, wl := range all {
		if selfIDs[wl.ID] {
			continue
		}
		totalByNS[wl.Namespace]++
		if isBlockedTarget(blocked, wl) {
			continue
		}
		w := endpoint{peer: Peer{Kind: PeerWorkload, Namespace: wl.Namespace, Workload: wl.Owner}, reps: []kube.PodInfo{wl.Rep}}
		src, dst := self, w
		if dir == dirIngress {
			src, dst = w, self
		}
		if flowAllowed(b.snap, src, dst, nil) {
			openByNS[wl.Namespace] = append(openByNS[wl.Namespace], wl)
		}
	}
	namespaces := make([]string, 0, len(openByNS))
	for ns := range openByNS {
		namespaces = append(namespaces, ns)
	}
	sort.Strings(namespaces)
	kept := 0
	blockedNS := blocked.peer.Kind == PeerWorkload && blocked.peer.Namespace != ""
	for _, ns := range namespaces {
		wls := openByNS[ns]
		// Whole namespace open (and not partially blocked): one namespace term.
		partiallyBlocked := blockedNS && blocked.peer.Namespace == ns
		if len(wls) == totalByNS[ns] && !partiallyBlocked {
			upsertRule(pol, dir, networkingv1.NetworkPolicyPeer{NamespaceSelector: nsSelector(ns)}, nil)
			kept += len(wls)
			continue
		}
		for _, wl := range wls {
			sel, err := WorkloadSelector(b.snap, wl.Namespace, wl.Owner)
			if err != nil {
				plan.Notes = append(plan.Notes, fmt.Sprintf("Cannot keep %s open: %v", wl.ID, err))
				continue
			}
			e := endpoint{peer: Peer{Kind: PeerWorkload, Namespace: wl.Namespace, Workload: wl.Owner}, selector: sel}
			upsertRule(pol, dir, e.term(), nil)
			kept++
		}
	}
	if keepExternal {
		// "The internet": everything except private ranges. Many CNIs apply
		// ipBlock to pod IPs too, so a bare 0.0.0.0/0 would re-open the
		// in-cluster peer being blocked.
		block := &networkingv1.IPBlock{CIDR: "0.0.0.0/0", Except: append([]string(nil), PrivateRanges...)}
		if blocked.isExternal() && blocked.peer.CIDR != "0.0.0.0/0" && !coveredBy(blocked.peer.CIDR, PrivateRanges) {
			block.Except = append(block.Except, blocked.peer.CIDR)
		}
		blocksInternet := blocked.isExternal() && blocked.peer.CIDR == "0.0.0.0/0"
		if !blocksInternet {
			upsertRule(pol, dir, networkingv1.NetworkPolicyPeer{IPBlock: block}, nil)
		}
	} else {
		plan.Notes = append(plan.Notes, fmt.Sprintf("Traffic %s external networks will be blocked too.", dirWord(dir)))
	}
	if keepExternal {
		plan.Notes = append(plan.Notes, fmt.Sprintf("Traffic %s the internet stays allowed (0.0.0.0/0 except private ranges %s).", dirWord(dir), strings.Join(PrivateRanges, ", ")))
	}
	b.touch(pol, fmt.Sprintf("isolate %s and keep %d currently reachable workload(s) open, except %s", peerWord(dir), kept, blocked.peer.ID()))
	plan.Notes = append(plan.Notes, fmt.Sprintf(
		"%s had no %s isolation, so it is isolated now; the %d workload(s) that can connect today stay allowed. Pods deployed later are not included automatically.",
		self.peer.ID(), peerWord(dir), kept))
}

func isBlockedTarget(blocked endpoint, wl Workload) bool {
	switch blocked.peer.Kind {
	case PeerWorkload:
		return blocked.peer.Namespace == wl.Namespace && blocked.peer.Workload == wl.Owner
	case PeerNamespace:
		return blocked.peer.Namespace == wl.Namespace
	}
	return false
}

// narrow removes the blocked peer from every managed rule admitting it and
// reports rules in other policies as blockers.
func (b *builder) narrow(self endpoint, dir direction, blocked endpoint, plan *Plan) {
	type ruleID struct {
		ns, name string
		index    int
	}
	admitting := map[ruleID]RuleMatch{}
	for _, rep := range self.reps {
		for _, t := range blocked.targets() {
			res := evalSide(b.snap, rep, dir, t, nil)
			for _, m := range res.MatchedRules {
				admitting[ruleID{m.Policy.Namespace, m.Policy.Name, m.RuleIndex}] = m
			}
		}
	}
	ids := make([]ruleID, 0, len(admitting))
	for id := range admitting {
		ids = append(ids, id)
	}
	// Edit highest rule index first so deletions keep lower indexes valid.
	sort.Slice(ids, func(i, j int) bool {
		if ids[i].ns+ids[i].name != ids[j].ns+ids[j].name {
			return ids[i].ns+ids[i].name < ids[j].ns+ids[j].name
		}
		return ids[i].index > ids[j].index
	})
	for _, id := range ids {
		orig := b.existing(id.ns, id.name)
		if orig == nil || !isManaged(orig) {
			plan.Blockers = append(plan.Blockers, Blocker(admitting[id]))
			continue
		}
		pol := b.working(id.ns, id.name)
		peers := rulePeers(pol, dir, id.index)
		if len(peers) == 0 {
			m := admitting[id]
			plan.Blockers = append(plan.Blockers, Blocker{Policy: m.Policy, RuleIndex: m.RuleIndex,
				Explanation: m.Explanation + " (allows every peer; edit it to list peers explicitly)"})
			continue
		}
		var kept []networkingv1.NetworkPolicyPeer
		for _, p := range peers {
			kept = append(kept, b.subtract(p, id.ns, blocked, plan)...)
		}
		if len(kept) == 0 {
			// An empty peer list would mean "everyone": drop the rule.
			deleteRule(pol, dir, id.index)
		} else {
			setRulePeers(pol, dir, id.index, kept)
		}
		b.touch(pol, "stop allowing "+blocked.peer.ID())
	}
}

// subtract returns peer term p minus the blocked endpoint.
func (b *builder) subtract(p networkingv1.NetworkPolicyPeer, policyNS string, blocked endpoint, plan *Plan) []networkingv1.NetworkPolicyPeer {
	matches := false
	for _, t := range blocked.targets() {
		if peerMatchesTarget(b.snap, policyNS, p, t) {
			matches = true
		}
	}
	if !matches {
		return []networkingv1.NetworkPolicyPeer{p}
	}
	switch {
	case p.IPBlock != nil:
		if !blocked.isExternal() || blocked.peer.CIDR == p.IPBlock.CIDR {
			return nil
		}
		out := p.DeepCopy()
		out.IPBlock.Except = append(out.IPBlock.Except, blocked.peer.CIDR)
		return []networkingv1.NetworkPolicyPeer{*out}
	case blocked.peer.Kind == PeerWorkload && p.PodSelector == nil &&
		equality.Semantic.DeepEqual(p.NamespaceSelector, nsSelector(blocked.peer.Namespace)):
		// The planner's own single-namespace term covering the blocked
		// workload: expand it into the namespace's other workloads.
		var out []networkingv1.NetworkPolicyPeer
		for _, wl := range Workloads(b.snap, map[string]bool{blocked.peer.Namespace: true}) {
			if wl.Owner == blocked.peer.Workload {
				continue
			}
			sel, err := WorkloadSelector(b.snap, wl.Namespace, wl.Owner)
			if err != nil {
				plan.Notes = append(plan.Notes, fmt.Sprintf("Cannot keep %s open: %v", wl.ID, err))
				continue
			}
			e := endpoint{peer: Peer{Kind: PeerWorkload, Namespace: wl.Namespace, Workload: wl.Owner}, selector: sel}
			out = append(out, e.term())
		}
		return out
	default:
		return nil
	}
}
