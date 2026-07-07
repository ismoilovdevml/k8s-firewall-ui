package api

import (
	"fmt"
	"net/http"
	"sort"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

// maxTopologyWorkloads bounds the O(n²) edge computation per request.
const maxTopologyWorkloads = 40

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

	// Collapse pods into workloads, keeping one representative pod per
	// workload: replicas of a workload share labels, so one pod's verdict
	// holds for all of them.
	type workload struct {
		node topologyNode
		rep  kube.PodInfo
	}
	byID := map[string]*workload{}
	for _, p := range snap.Pods {
		if !wanted[p.Namespace] {
			continue
		}
		id := p.Namespace + "/" + p.Owner
		if wl, exists := byID[id]; exists {
			wl.node.PodCount++
			wl.node.HostNetwork = wl.node.HostNetwork || p.HostNetwork
			continue
		}
		byID[id] = &workload{
			node: topologyNode{ID: id, Namespace: p.Namespace, Workload: p.Owner, PodCount: 1, HostNetwork: p.HostNetwork},
			rep:  p,
		}
	}
	if len(byID) > maxTopologyWorkloads {
		writeError(w, http.StatusUnprocessableEntity, "TOO_MANY_WORKLOADS",
			fmt.Sprintf("%d workloads in selection (max %d) — narrow the namespace filter", len(byID), maxTopologyWorkloads))
		return
	}

	ids := make([]string, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	nodes := make([]topologyNode, 0, len(ids))
	for _, id := range ids {
		nodes = append(nodes, byID[id].node)
	}

	edges := []topologyEdge{}
	for _, srcID := range ids {
		for _, dstID := range ids {
			if srcID == dstID {
				continue
			}
			verdict, policies := simulator.EvaluateEdge(snap, byID[srcID].rep, byID[dstID].rep)
			edges = append(edges, topologyEdge{
				ID:       srcID + "->" + dstID,
				Source:   srcID,
				Target:   dstID,
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
