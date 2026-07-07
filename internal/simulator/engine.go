package simulator

import (
	networkingv1 "k8s.io/api/networking/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

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

// sideCheck holds the outcome of one direction's evaluation.
type sideCheck struct {
	Isolated bool
	Allowed  bool
	Policies []PolicyRef // policies that select the pod for this direction
}

// checkEgress evaluates whether src's egress rules admit traffic to dst on
// the queried port. Non-isolated pods allow everything (default-allow).
func checkEgress(snap *Snapshot, src, dst kube.PodInfo, query *PortQuery) sideCheck {
	pols := policiesSelecting(snap, src, dirEgress)
	check := sideCheck{Isolated: len(pols) > 0, Allowed: len(pols) == 0}
	for _, pol := range pols {
		check.Policies = append(check.Policies, PolicyRef{Namespace: pol.Namespace, Name: pol.Name})
		for _, rule := range pol.Spec.Egress {
			if ruleAdmits(snap, pol.Namespace, rule.To, rule.Ports, dst, query) {
				check.Allowed = true
			}
		}
	}
	return check
}

// checkIngress evaluates whether dst's ingress rules admit traffic from src.
func checkIngress(snap *Snapshot, src, dst kube.PodInfo, query *PortQuery) sideCheck {
	pols := policiesSelecting(snap, dst, dirIngress)
	check := sideCheck{Isolated: len(pols) > 0, Allowed: len(pols) == 0}
	for _, pol := range pols {
		check.Policies = append(check.Policies, PolicyRef{Namespace: pol.Namespace, Name: pol.Name})
		for _, rule := range pol.Spec.Ingress {
			if ruleAdmits(snap, pol.Namespace, rule.From, rule.Ports, src, query) {
				check.Allowed = true
			}
		}
	}
	return check
}

// ruleAdmits reports whether a single ingress/egress rule matches the peer
// pod and the queried port.
//
// Peer-list semantics: per the NetworkPolicy API reference, an empty or
// missing from/to list matches ALL peers ("traffic not restricted by
// source/destination"). Risk #1 in the plan tracks pinning this against real
// API-server canonicalization with a test in M3.
func ruleAdmits(snap *Snapshot, policyNamespace string, peers []networkingv1.NetworkPolicyPeer, rulePorts []networkingv1.NetworkPolicyPort, other kube.PodInfo, query *PortQuery) bool {
	if !portsMatch(rulePorts, query, other) {
		return false
	}
	if len(peers) == 0 {
		return true
	}
	for _, peer := range peers {
		if peerMatchesPod(snap, policyNamespace, peer, other) {
			return true
		}
	}
	return false
}

// EvaluateEdge computes the topology verdict for src → dst in any-port mode.
// It returns the verdict and the policies involved on either side.
func EvaluateEdge(snap *Snapshot, src, dst kube.PodInfo) (EdgeVerdict, []PolicyRef) {
	egress := checkEgress(snap, src, dst, nil)
	ingress := checkIngress(snap, src, dst, nil)

	refs := append(egress.Policies, ingress.Policies...)
	switch {
	case !egress.Isolated && !ingress.Isolated:
		return EdgeUnconstrained, refs
	case egress.Allowed && ingress.Allowed:
		return EdgeAllowed, refs
	default:
		return EdgeBlocked, refs
	}
}
