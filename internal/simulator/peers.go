package simulator

import (
	"net"
	"sort"
	"strings"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// selectorMatches reports whether a LabelSelector matches the given labels.
// A nil selector matches nothing here; callers handle presence explicitly.
func selectorMatches(sel *metav1.LabelSelector, lbls map[string]string) bool {
	if sel == nil {
		return false
	}
	s, err := metav1.LabelSelectorAsSelector(sel)
	if err != nil {
		return false // invalid selector selects nothing
	}
	return s.Matches(labels.Set(lbls))
}

// peerMatchesTarget reports whether a NetworkPolicyPeer matches the other
// side of the connection (a pod, or an external IP where only ipBlock can
// match). policyNamespace scopes bare podSelectors. Semantics per
// docs/research/network-policy-semantics.md §1.1: podSelector+
// namespaceSelector in one peer = AND; ipBlock is exclusive.
func peerMatchesTarget(snap *Snapshot, policyNamespace string, peer networkingv1.NetworkPolicyPeer, tgt target) bool {
	if peer.IPBlock != nil {
		return ipBlockMatches(peer.IPBlock, tgt.ip)
	}
	if tgt.pod == nil {
		// Selector peers never match external IPs.
		return false
	}
	pod := *tgt.pod

	// hostNetwork pods share the node IP; pod/namespace selectors do not
	// match them (behavior officially undefined — surfaced as a warning,
	// treated as no-match here).
	if pod.HostNetwork {
		return false
	}

	switch {
	case peer.NamespaceSelector != nil && peer.PodSelector != nil:
		return selectorMatches(peer.NamespaceSelector, snap.NamespaceLabels(pod.Namespace)) &&
			selectorMatches(peer.PodSelector, pod.Labels)
	case peer.NamespaceSelector != nil:
		return selectorMatches(peer.NamespaceSelector, snap.NamespaceLabels(pod.Namespace))
	case peer.PodSelector != nil:
		// Bare podSelector is scoped to the policy's own namespace.
		return pod.Namespace == policyNamespace && selectorMatches(peer.PodSelector, pod.Labels)
	default:
		// A peer with no fields set matches nothing (invalid per API validation).
		return false
	}
}

// describePeers renders a compact human-readable peer list for explanations.
func describePeers(peers []networkingv1.NetworkPolicyPeer) string {
	parts := make([]string, 0, len(peers))
	for _, p := range peers {
		switch {
		case p.IPBlock != nil:
			s := "ipBlock " + p.IPBlock.CIDR
			if len(p.IPBlock.Except) > 0 {
				s += " except " + strings.Join(p.IPBlock.Except, ",")
			}
			parts = append(parts, s)
		case p.NamespaceSelector != nil && p.PodSelector != nil:
			parts = append(parts, "pods ["+selectorText(p.PodSelector)+"] in namespaces ["+selectorText(p.NamespaceSelector)+"]")
		case p.NamespaceSelector != nil:
			parts = append(parts, "namespaces ["+selectorText(p.NamespaceSelector)+"]")
		case p.PodSelector != nil:
			parts = append(parts, "pods ["+selectorText(p.PodSelector)+"] in the policy's namespace")
		}
	}
	return strings.Join(parts, ", or ")
}

func selectorText(sel *metav1.LabelSelector) string {
	if sel == nil || (len(sel.MatchLabels) == 0 && len(sel.MatchExpressions) == 0) {
		return "all"
	}
	keys := make([]string, 0, len(sel.MatchLabels))
	for k := range sel.MatchLabels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+sel.MatchLabels[k])
	}
	if len(sel.MatchExpressions) > 0 {
		parts = append(parts, "…expressions")
	}
	return strings.Join(parts, ",")
}

// ipBlockMatches reports whether ip is inside cidr and outside every except.
func ipBlockMatches(block *networkingv1.IPBlock, ip string) bool {
	if ip == "" {
		return false
	}
	addr := net.ParseIP(ip)
	if addr == nil {
		return false
	}
	_, cidr, err := net.ParseCIDR(block.CIDR)
	if err != nil || !cidr.Contains(addr) {
		return false
	}
	for _, ex := range block.Except {
		if _, exNet, err := net.ParseCIDR(ex); err == nil && exNet.Contains(addr) {
			return false
		}
	}
	return true
}
