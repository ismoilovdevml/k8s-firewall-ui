// Package simulator evaluates Kubernetes NetworkPolicy semantics over a
// ClusterSnapshot. It is pure: it must never import client-go or perform I/O.
//
// Normative reference: docs/research/network-policy-semantics.md.
package simulator

import (
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// PolicyRef identifies a NetworkPolicy.
type PolicyRef struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// EdgeVerdict classifies traffic between two workloads for the topology view.
type EdgeVerdict string

const (
	// EdgeAllowed: at least one side is isolated and both sides permit the traffic.
	EdgeAllowed EdgeVerdict = "allowed"
	// EdgeBlocked: an isolated side does not permit the traffic.
	EdgeBlocked EdgeVerdict = "blocked"
	// EdgeUnconstrained: neither side is selected by any policy for the
	// relevant direction — traffic flows because nothing restricts it.
	EdgeUnconstrained EdgeVerdict = "unconstrained"
)

// direction of a policy check.
type direction string

const (
	dirIngress direction = "Ingress"
	dirEgress  direction = "Egress"
)

// Snapshot aliases the kube snapshot to keep call sites short.
type Snapshot = kube.ClusterSnapshot

// PortQuery is the optional port/protocol of a simulated connection.
// A nil PortQuery means "any port" (used for topology edges).
type PortQuery struct {
	Protocol string `json:"protocol"` // TCP | UDP | SCTP
	Port     int32  `json:"port"`
}
