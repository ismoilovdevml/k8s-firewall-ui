package simulator

import (
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// portsMatch reports whether a rule's port list admits the queried port.
// Empty/absent ports = all ports. A nil query means "any port": the rule's
// port list cannot block it (some port is always admitted). dst may be nil
// (external IP destination) — named ports then never resolve.
func portsMatch(rulePorts []networkingv1.NetworkPolicyPort, query *PortQuery, dst *kube.PodInfo) bool {
	if len(rulePorts) == 0 || query == nil {
		return true
	}
	for _, rp := range rulePorts {
		if portEntryMatches(rp, query, dst) {
			return true
		}
	}
	return false
}

func portEntryMatches(rp networkingv1.NetworkPolicyPort, query *PortQuery, dst *kube.PodInfo) bool {
	proto := "TCP"
	if rp.Protocol != nil {
		proto = string(*rp.Protocol)
	}
	if proto != query.Protocol {
		return false
	}
	if rp.Port == nil {
		return true // protocol-only entry: all ports of that protocol
	}
	switch rp.Port.Type {
	case intstr.Int:
		start := rp.Port.IntVal
		if rp.EndPort != nil {
			return query.Port >= start && query.Port <= *rp.EndPort
		}
		return query.Port == start
	case intstr.String:
		// Named ports resolve against the destination pod's container ports.
		if dst == nil {
			return false
		}
		for _, cp := range dst.Ports {
			if cp.Name == rp.Port.StrVal && string(cp.Protocol) == query.Protocol && cp.Port == query.Port {
				return true
			}
		}
		return false
	}
	return false
}
