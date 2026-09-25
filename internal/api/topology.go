package api

import (
	"fmt"
	"net/http"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

// maxTopologyWorkloads bounds the workload graph: beyond this the browser
// cannot render the O(n²) edges usefully; use the namespace level instead.
const maxTopologyWorkloads = 60

// maxNamespaceGraphWorkloads bounds the O(n²) evaluation behind the
// namespace-level graph (~0.2 s per 400 workloads with the index).
const maxNamespaceGraphWorkloads = 1500

type topologyNode struct {
	ID        string `json:"id"` // "<namespace>/<owner>"
	Namespace string `json:"namespace"`
	Workload  string `json:"workload"` // e.g. "deployment/web"
	PodCount  int    `json:"podCount"`
	// HostNetwork is true when any pod of the workload runs on the host
	// network (policy selectors do not apply to it).
	HostNetwork bool `json:"hostNetwork"`
}

type topologyEdge struct {
	ID       string                `json:"id"`
	Source   string                `json:"source"`
	Target   string                `json:"target"`
	Verdict  simulator.EdgeVerdict `json:"verdict"`
	Policies []simulator.PolicyRef `json:"policies,omitempty"`
}

func (s *Server) handleTopology(w http.ResponseWriter, r *http.Request) {
	namespaces := splitCSV(r.URL.Query().Get("namespaces"))
	if r.URL.Query().Get("level") == "namespace" {
		s.handleNamespaceTopology(w, namespaces)
		return
	}
	if len(namespaces) == 0 {
		writeError(w, http.StatusBadRequest, "NAMESPACES_REQUIRED", "pass ?namespaces=a,b — topology is computed per namespace selection")
		return
	}
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}

	wanted := map[string]bool{}
	for _, ns := range namespaces {
		wanted[ns] = true
	}

	workloads := simulator.Workloads(snap, wanted)
	if len(workloads) > maxTopologyWorkloads {
		writeError(w, http.StatusUnprocessableEntity, "TOO_MANY_WORKLOADS",
			fmt.Sprintf("%d workloads in selection (max %d) — narrow the namespace filter", len(workloads), maxTopologyWorkloads))
		return
	}

	nodes := make([]topologyNode, 0, len(workloads))
	for _, wl := range workloads {
		nodes = append(nodes, topologyNode{ID: wl.ID, Namespace: wl.Namespace, Workload: wl.Owner, PodCount: wl.PodCount, HostNetwork: wl.HostNetwork})
	}

	idx := simulator.NewIndex(snap)
	edges := []topologyEdge{}
	for _, src := range workloads {
		for _, dst := range workloads {
			if src.ID == dst.ID {
				continue
			}
			verdict, policies := idx.EvaluateEdge(src.Rep, dst.Rep)
			edges = append(edges, topologyEdge{
				ID:       src.ID + "->" + dst.ID,
				Source:   src.ID,
				Target:   dst.ID,
				Verdict:  verdict,
				Policies: dedupeRefs(policies),
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"nodes": nodes, "edges": edges})
}

func dedupeRefs(refs []simulator.PolicyRef) []simulator.PolicyRef {
	seen := map[simulator.PolicyRef]bool{}
	out := refs[:0]
	for _, ref := range refs {
		if !seen[ref] {
			seen[ref] = true
			out = append(out, ref)
		}
	}
	return out
}

// handleNamespaceTopology serves the namespace-level graph. Without a
// namespace filter it covers every non-system namespace with pods.
func (s *Server) handleNamespaceTopology(w http.ResponseWriter, namespaces []string) {
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	wanted := map[string]bool{}
	for _, ns := range namespaces {
		wanted[ns] = true
	}
	if len(wanted) == 0 {
		for _, ns := range snap.Namespaces {
			if !simulator.IsSystemNamespace(ns.Name) {
				wanted[ns.Name] = true
			}
		}
	}
	if n := len(simulator.Workloads(snap, wanted)); n > maxNamespaceGraphWorkloads {
		writeError(w, http.StatusUnprocessableEntity, "TOO_MANY_WORKLOADS",
			fmt.Sprintf("%d workloads in selection (max %d for the namespace graph) — select fewer namespaces", n, maxNamespaceGraphWorkloads))
		return
	}
	nodes, edges := simulator.NamespaceGraph(snap, wanted)
	writeJSON(w, http.StatusOK, map[string]any{"level": "namespace", "nodes": nodes, "edges": edges})
}
