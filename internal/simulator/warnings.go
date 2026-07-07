package simulator

import (
	corev1 "k8s.io/api/core/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// collectWarnings surfaces the well-known NetworkPolicy footguns relevant to
// this connection. dst is nil for external-IP destinations.
func collectWarnings(snap *Snapshot, src kube.PodInfo, dst *kube.PodInfo, in Input) []Warning {
	var out []Warning

	if src.HostNetwork {
		out = append(out, Warning{
			Code: "HOSTNETWORK_UNDEFINED", Severity: "warning",
			Message: "Source pod runs on the host network: it is seen as node traffic, pod/namespace selectors do not match it, and NetworkPolicy behavior for it is officially undefined.",
		})
	}
	if dst != nil && dst.HostNetwork {
		out = append(out, Warning{
			Code: "HOSTNETWORK_UNDEFINED", Severity: "warning",
			Message: "Destination pod runs on the host network: NetworkPolicy behavior for it is officially undefined.",
		})
	}

	if dst != nil && src.NodeName != "" && src.NodeName == dst.NodeName {
		out = append(out, Warning{
			Code: "NODE_LOCAL_TRAFFIC", Severity: "info",
			Message: "Both pods run on node " + src.NodeName + ". Traffic from a pod's own node is always allowed, so some CNIs may not enforce this verdict for node-local paths (e.g. kubelet probes).",
		})
	}

	if w, fires := dnsTrapWarning(snap, src, in); fires {
		out = append(out, w)
	}
	return out
}

// dnsTrapWarning fires when the source is egress-isolated and none of its
// egress rules allow port 53 — the classic "default-deny egress broke DNS"
// failure. Skipped when the query itself is a :53 lookup (the verdict already
// answers that directly).
func dnsTrapWarning(snap *Snapshot, src kube.PodInfo, in Input) (Warning, bool) {
	if in.Port != nil && in.Port.Port == 53 {
		return Warning{}, false
	}
	pols := policiesSelecting(snap, src, dirEgress)
	if len(pols) == 0 {
		return Warning{}, false // not egress-isolated
	}

	// Does ANY egress rule admit UDP or TCP :53 to any DNS-plausible target?
	// Probe with a synthetic kube-dns pod plus the source itself as targets.
	dnsProbe := target{pod: &kube.PodInfo{
		Namespace: "kube-system",
		Labels:    map[string]string{"k8s-app": "kube-dns"},
		IP:        "10.96.0.10",
	}}
	// Give the synthetic namespace its real labels if kube-system exists.
	for _, proto := range []corev1.Protocol{corev1.ProtocolUDP, corev1.ProtocolTCP} {
		q := &PortQuery{Protocol: string(proto), Port: 53}
		for _, pol := range pols {
			for _, rule := range rulesOf(pol, dirEgress) {
				if ruleAdmits(snap, pol.Namespace, rule.peers, rule.ports, dnsProbe, dnsProbe.pod, q) {
					return Warning{}, false
				}
			}
		}
	}
	return Warning{
		Code: "DNS_EGRESS_BLOCKED", Severity: "warning",
		Message: "The source pod is egress-isolated and no egress rule allows port 53: DNS resolution will fail for it. Add an egress rule allowing UDP/TCP 53 to kube-dns.",
	}, true
}
