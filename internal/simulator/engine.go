package simulator

import (
	"fmt"

	networkingv1 "k8s.io/api/networking/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// target is the "other side" of a directional check: a pod or an external IP.
type target struct {
	pod *kube.PodInfo // nil when the peer is a raw IP
	ip  string
}

func podTarget(p kube.PodInfo) target { return target{pod: &p, ip: p.IP} }
func ipTarget(ip string) target       { return target{ip: ip} }

// policiesSelecting returns the policies in pod's namespace whose podSelector
// matches the pod and whose policyTypes include the given direction.
func policiesSelecting(snap *Snapshot, pod kube.PodInfo, dir direction) []*networkingv1.NetworkPolicy {
	var out []*networkingv1.NetworkPolicy
	for _, pol := range snap.Policies {
		if pol.Namespace != pod.Namespace {
			continue
		}
		if !hasPolicyType(pol, dir) {
			continue
		}
		// spec.podSelector: {} selects all pods in the namespace.
		sel := pol.Spec.PodSelector
		if len(sel.MatchLabels) == 0 && len(sel.MatchExpressions) == 0 {
			out = append(out, pol)
			continue
		}
		if selectorMatches(&sel, pod.Labels) {
			out = append(out, pol)
		}
	}
	return out
}

func hasPolicyType(pol *networkingv1.NetworkPolicy, dir direction) bool {
	for _, t := range pol.Spec.PolicyTypes {
		if string(t) == string(dir) {
			return true
		}
	}
	return false
}

// PodsSelectedBy returns the pods in the policy's namespace matched by its
// spec.podSelector (empty selector = all pods in the namespace).
func PodsSelectedBy(snap *Snapshot, pol *networkingv1.NetworkPolicy) []kube.PodInfo {
	var out []kube.PodInfo
	sel := pol.Spec.PodSelector
	empty := len(sel.MatchLabels) == 0 && len(sel.MatchExpressions) == 0
	for _, p := range snap.Pods {
		if p.Namespace != pol.Namespace {
			continue
		}
		if empty || selectorMatches(&sel, p.Labels) {
			out = append(out, p)
		}
	}
	return out
}

// evalSide runs one direction's check: does `subject`'s policy set (for dir)
// admit traffic with `other`? Non-isolated subjects allow everything.
func evalSide(snap *Snapshot, subject kube.PodInfo, dir direction, other target, query *PortQuery) SideResult {
	pols := policiesSelecting(snap, subject, dir)
	res := SideResult{
		Applicable: true,
		Isolated:   len(pols) > 0,
		Allowed:    len(pols) == 0,
	}
	// Named ports always resolve against the DESTINATION pod of the
	// connection: the subject itself for ingress, the peer for egress.
	portPod := &subject
	if dir == dirEgress {
		portPod = other.pod
	}
	for _, pol := range pols {
		ref := PolicyRef{Namespace: pol.Namespace, Name: pol.Name}
		res.EvaluatedPolicies = append(res.EvaluatedPolicies, ref)
		for i, rule := range rulesOf(pol, dir) {
			if ruleAdmits(snap, pol.Namespace, rule.peers, rule.ports, other, portPod, query) {
				res.Allowed = true
				res.MatchedRules = append(res.MatchedRules, RuleMatch{
					Policy:      ref,
					RuleIndex:   i,
					Explanation: explainRule(ref, dir, i, rule, query),
				})
			}
		}
	}
	return res
}

// normalizedRule flattens ingress/egress rules into one shape.
type normalizedRule struct {
	peers []networkingv1.NetworkPolicyPeer
	ports []networkingv1.NetworkPolicyPort
}

func rulesOf(pol *networkingv1.NetworkPolicy, dir direction) []normalizedRule {
	var out []normalizedRule
	if dir == dirIngress {
		for _, r := range pol.Spec.Ingress {
			out = append(out, normalizedRule{peers: r.From, ports: r.Ports})
		}
		return out
	}
	for _, r := range pol.Spec.Egress {
		out = append(out, normalizedRule{peers: r.To, ports: r.Ports})
	}
	return out
}

// ruleAdmits reports whether a single rule matches the peer and queried port.
//
// Peer-list semantics: per the NetworkPolicy API reference, an empty or
// missing from/to list matches ALL peers ("traffic not restricted by
// source/destination"). Risk #1 in the plan tracks pinning this against real
// API-server canonicalization.
func ruleAdmits(snap *Snapshot, policyNamespace string, peers []networkingv1.NetworkPolicyPeer, rulePorts []networkingv1.NetworkPolicyPort, other target, portPod *kube.PodInfo, query *PortQuery) bool {
	if !portsMatch(rulePorts, query, portPod) {
		return false
	}
	if len(peers) == 0 {
		return true
	}
	for _, peer := range peers {
		if peerMatchesTarget(snap, policyNamespace, peer, other) {
			return true
		}
	}
	return false
}

func explainRule(ref PolicyRef, dir direction, index int, rule normalizedRule, query *PortQuery) string {
	peerDesc := "any peer"
	if len(rule.peers) > 0 {
		peerDesc = describePeers(rule.peers)
	}
	portDesc := "all ports"
	if query != nil {
		portDesc = fmt.Sprintf("%d/%s", query.Port, query.Protocol)
	}
	word := "from"
	if dir == dirEgress {
		word = "to"
	}
	return fmt.Sprintf("NetworkPolicy %s/%s %s rule #%d allows traffic %s %s on %s",
		ref.Namespace, ref.Name, lower(dir), index+1, word, peerDesc, portDesc)
}

func lower(dir direction) string {
	if dir == dirIngress {
		return "ingress"
	}
	return "egress"
}

// EvaluateEdge computes the topology verdict for src → dst in any-port mode.
// It returns the verdict and the policies involved on either side.
func EvaluateEdge(snap *Snapshot, src, dst kube.PodInfo) (EdgeVerdict, []PolicyRef) {
	egress := evalSide(snap, src, dirEgress, podTarget(dst), nil)
	ingress := evalSide(snap, dst, dirIngress, podTarget(src), nil)

	refs := append(egress.EvaluatedPolicies, ingress.EvaluatedPolicies...)
	switch {
	case !egress.Isolated && !ingress.Isolated:
		return EdgeUnconstrained, refs
	case egress.Allowed && ingress.Allowed:
		return EdgeAllowed, refs
	default:
		return EdgeBlocked, refs
	}
}
