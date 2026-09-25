package simulator

import (
	networkingv1 "k8s.io/api/networking/v1"
)

// maxImpactPairs bounds the before/after edge evaluations of one impact
// request; larger requests are truncated and flagged.
const maxImpactPairs = 20000

// ImpactEdge is a workload-to-workload connection whose reachability flips.
type ImpactEdge struct {
	Source string      `json:"source"` // workload ID "<ns>/<owner>"
	Target string      `json:"target"`
	Before EdgeVerdict `json:"before"`
	After  EdgeVerdict `json:"after"`
}

// ImpactResult is the what-if diff of applying or deleting one policy.
type ImpactResult struct {
	// SelectedWorkloads are the workloads selected by the old or the new
	// version of the policy — the only subjects whose checks can change.
	SelectedWorkloads []string     `json:"selectedWorkloads"`
	NewlyBlocked      []ImpactEdge `json:"newlyBlocked"`
	NewlyAllowed      []ImpactEdge `json:"newlyAllowed"`
	EvaluatedPairs    int          `json:"evaluatedPairs"`
	Truncated         bool         `json:"truncated"`
}

// NormalizePolicy returns a deep copy of pol with spec.policyTypes defaulted
// the way the API server does on admission: Ingress always, plus Egress when
// egress rules are present. Proposed (not yet persisted) policies must be
// normalized before evaluation.
func NormalizePolicy(pol *networkingv1.NetworkPolicy) *networkingv1.NetworkPolicy {
	out := pol.DeepCopy()
	if len(out.Spec.PolicyTypes) == 0 {
		out.Spec.PolicyTypes = []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}
		if len(out.Spec.Egress) > 0 {
			out.Spec.PolicyTypes = append(out.Spec.PolicyTypes, networkingv1.PolicyTypeEgress)
		}
	}
	return out
}

// WithPolicy returns a shallow snapshot copy in which the policy namespace/name
// is replaced by proposed, or removed when proposed is nil.
func WithPolicy(snap *Snapshot, namespace, name string, proposed *networkingv1.NetworkPolicy) *Snapshot {
	out := &Snapshot{Pods: snap.Pods, Namespaces: snap.Namespaces}
	for _, pol := range snap.Policies {
		if pol.Namespace == namespace && pol.Name == name {
			continue
		}
		out.Policies = append(out.Policies, pol)
	}
	if proposed != nil {
		out.Policies = append(out.Policies, NormalizePolicy(proposed))
	}
	return out
}

// Impact computes which workload connections change reachability if the
// policy namespace/name is replaced by proposed (nil = deleted). A policy can
// only change checks whose subject it selects, so only edges into and out of
// workloads selected by the old or new version are evaluated.
//
// Reachability is "not blocked": allowed and unconstrained both reach, so a
// flip between those two is not reported.
func Impact(snap *Snapshot, namespace, name string, proposed *networkingv1.NetworkPolicy) ImpactResult {
	after := WithPolicy(snap, namespace, name, proposed)
	var old *networkingv1.NetworkPolicy
	for _, pol := range snap.Policies {
		if pol.Namespace == namespace && pol.Name == name {
			old = pol
		}
	}
	var normalized *networkingv1.NetworkPolicy
	if proposed != nil {
		normalized = NormalizePolicy(proposed)
	}

	workloads := Workloads(snap, nil)
	selected := map[string]bool{}
	res := ImpactResult{SelectedWorkloads: []string{}, NewlyBlocked: []ImpactEdge{}, NewlyAllowed: []ImpactEdge{}}
	for _, wl := range workloads {
		if (old != nil && selects(old, wl)) || (normalized != nil && selects(normalized, wl)) {
			selected[wl.ID] = true
			res.SelectedWorkloads = append(res.SelectedWorkloads, wl.ID)
		}
	}

	eval := func(src, dst Workload) {
		if res.EvaluatedPairs >= maxImpactPairs {
			res.Truncated = true
			return
		}
		res.EvaluatedPairs++
		before, _ := EvaluateEdge(snap, src.Rep, dst.Rep)
		now, _ := EvaluateEdge(after, src.Rep, dst.Rep)
		edge := ImpactEdge{Source: src.ID, Target: dst.ID, Before: before, After: now}
		switch {
		case before != EdgeBlocked && now == EdgeBlocked:
			res.NewlyBlocked = append(res.NewlyBlocked, edge)
		case before == EdgeBlocked && now != EdgeBlocked:
			res.NewlyAllowed = append(res.NewlyAllowed, edge)
		}
	}
	for _, a := range workloads {
		for _, b := range workloads {
			if a.ID == b.ID {
				continue
			}
			// Each ordered pair once: evaluate a→b when either end is selected.
			if selected[a.ID] || selected[b.ID] {
				eval(a, b)
			}
		}
	}
	return res
}

func selects(pol *networkingv1.NetworkPolicy, wl Workload) bool {
	if pol.Namespace != wl.Namespace {
		return false
	}
	sel := pol.Spec.PodSelector
	if len(sel.MatchLabels) == 0 && len(sel.MatchExpressions) == 0 {
		return true
	}
	return selectorMatches(&sel, wl.Rep.Labels)
}
