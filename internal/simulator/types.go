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

// Endpoint is one side of a simulated connection: a pod or a raw IP.
type Endpoint struct {
	Kind      string `json:"kind"` // "pod" | "ip"
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
	IP        string `json:"ip,omitempty"`
}

// Input is a simulation request.
type Input struct {
	Source      Endpoint   `json:"source"`
	Destination Endpoint   `json:"destination"`
	Port        *PortQuery `json:"port,omitempty"`
}

// RuleMatch pinpoints the rule that admitted the traffic.
type RuleMatch struct {
	Policy      PolicyRef `json:"policy"`
	RuleIndex   int       `json:"ruleIndex"`
	Explanation string    `json:"explanation"`
}

// SideResult is one direction's evaluation outcome.
type SideResult struct {
	// Applicable is false when this side was not evaluated (e.g. the
	// destination is an external IP, so no ingress check exists).
	Applicable bool `json:"applicable"`
	// Isolated: at least one policy selects the pod for this direction.
	Isolated bool `json:"isolated"`
	// Allowed: the side permits the traffic (non-isolated, or a rule matched).
	Allowed           bool        `json:"allowed"`
	MatchedRules      []RuleMatch `json:"matchedRules,omitempty"`
	EvaluatedPolicies []PolicyRef `json:"evaluatedPolicies,omitempty"`
}

// Warning surfaces a semantics footgun relevant to the simulated connection.
type Warning struct {
	Code     string `json:"code"`
	Severity string `json:"severity"` // "info" | "warning"
	Message  string `json:"message"`
}

// Result is the full simulation verdict.
type Result struct {
	Allowed  bool       `json:"allowed"`
	Egress   SideResult `json:"egress"`
	Ingress  SideResult `json:"ingress"`
	Warnings []Warning  `json:"warnings,omitempty"`
}
