package simulator

import (
	"net"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
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

// peerMatchesPod reports whether a NetworkPolicyPeer matches the target pod.
// policyNamespace is the namespace the policy lives in (bare podSelector is
// scoped to it). Semantics per docs/research/network-policy-semantics.md §1.1:
// podSelector+namespaceSelector in one peer = AND; ipBlock is exclusive.
func peerMatchesPod(snap *Snapshot, policyNamespace string, peer networkingv1.NetworkPolicyPeer, target kube.PodInfo) bool {
	if peer.IPBlock != nil {
		return ipBlockMatches(peer.IPBlock, target.IP)
	}

	// hostNetwork pods share the node IP; pod/namespace selectors do not
	// match them (behavior officially undefined — surfaced as a warning at
	// the API layer, treated as no-match here).
	if target.HostNetwork {
		return false
	}

	switch {
	case peer.NamespaceSelector != nil && peer.PodSelector != nil:
		return selectorMatches(peer.NamespaceSelector, snap.NamespaceLabels(target.Namespace)) &&
			selectorMatches(peer.PodSelector, target.Labels)
	case peer.NamespaceSelector != nil:
		return selectorMatches(peer.NamespaceSelector, snap.NamespaceLabels(target.Namespace))
	case peer.PodSelector != nil:
		// Bare podSelector is scoped to the policy's own namespace.
		return target.Namespace == policyNamespace && selectorMatches(peer.PodSelector, target.Labels)
	default:
		// A peer with no fields set matches nothing (invalid per API validation).
		return false
	}
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
