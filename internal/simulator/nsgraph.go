package simulator

import "sort"

// VerdictCounts tallies workload-pair verdicts.
type VerdictCounts struct {
	Allowed       int `json:"allowed"`
	Blocked       int `json:"blocked"`
	Unconstrained int `json:"unconstrained"`
}

func (c *VerdictCounts) add(v EdgeVerdict) {
	switch v {
	case EdgeAllowed:
		c.Allowed++
	case EdgeBlocked:
		c.Blocked++
	default:
		c.Unconstrained++
	}
}

// NamespaceNode summarizes one namespace in the namespace-level graph.
type NamespaceNode struct {
	Namespace string `json:"namespace"`
	Workloads int    `json:"workloads"`
	Pods      int    `json:"pods"`
	// Internal tallies workload pairs inside the namespace.
	Internal VerdictCounts `json:"internal"`
}

// NamespaceEdge aggregates every workload pair from Source to Target.
type NamespaceEdge struct {
	Source string        `json:"source"`
	Target string        `json:"target"`
	Counts VerdictCounts `json:"counts"`
}

// NamespaceGraph collapses the workload graph to namespaces, so clusters
// with hundreds of workloads can be viewed at a glance. When namespaces is
// non-empty only those namespaces are included. Output is sorted.
func NamespaceGraph(snap *Snapshot, namespaces map[string]bool) ([]NamespaceNode, []NamespaceEdge) {
	idx := NewIndex(snap)
	workloads := Workloads(snap, namespaces)

	nodes := map[string]*NamespaceNode{}
	for _, wl := range workloads {
		n, ok := nodes[wl.Namespace]
		if !ok {
			n = &NamespaceNode{Namespace: wl.Namespace}
			nodes[wl.Namespace] = n
		}
		n.Workloads++
		n.Pods += wl.PodCount
	}

	edges := map[[2]string]*NamespaceEdge{}
	for _, src := range workloads {
		for _, dst := range workloads {
			if src.ID == dst.ID {
				continue
			}
			v, _ := idx.EvaluateEdge(src.Rep, dst.Rep)
			if src.Namespace == dst.Namespace {
				nodes[src.Namespace].Internal.add(v)
				continue
			}
			key := [2]string{src.Namespace, dst.Namespace}
			e, ok := edges[key]
			if !ok {
				e = &NamespaceEdge{Source: src.Namespace, Target: dst.Namespace}
				edges[key] = e
			}
			e.Counts.add(v)
		}
	}

	outNodes := make([]NamespaceNode, 0, len(nodes))
	for _, n := range nodes {
		outNodes = append(outNodes, *n)
	}
	sort.Slice(outNodes, func(i, j int) bool { return outNodes[i].Namespace < outNodes[j].Namespace })
	outEdges := make([]NamespaceEdge, 0, len(edges))
	for _, e := range edges {
		outEdges = append(outEdges, *e)
	}
	sort.Slice(outEdges, func(i, j int) bool {
		if outEdges[i].Source != outEdges[j].Source {
			return outEdges[i].Source < outEdges[j].Source
		}
		return outEdges[i].Target < outEdges[j].Target
	})
	return outNodes, outEdges
}
