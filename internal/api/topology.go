package api

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

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
	// Observed is set when node agents saw this connection (flows enabled).
	Observed *observedEdge `json:"observed,omitempty"`
}

type observedEdge struct {
	Ports    []simulator.PortSpec `json:"ports"`
	LastSeen time.Time            `json:"lastSeen"`
}

// observedEdges groups stored flows by workload pair ("src->dst" IDs).
func (s *Server) observedEdges(v *view) map[string]*observedEdge {
	out := map[string]*observedEdge{}
	if s.flows == nil {
		return out
	}
	pods := podsByIP(v.full)
	for _, rec := range s.flows.All() {
		src, ok1 := pods[rec.Src]
		dst, ok2 := pods[rec.Dst]
		if !ok1 || !ok2 || sameWorkload(src, dst) {
			continue
		}
		id := src.Namespace + "/" + src.Owner + "->" + dst.Namespace + "/" + dst.Owner
		e := out[id]
		if e == nil {
			e = &observedEdge{}
			out[id] = e
		}
		port := simulator.PortSpec{Protocol: rec.Protocol, Port: int32(rec.DstPort)}
		if !containsPort(e.Ports, port) {
			e.Ports = append(e.Ports, port)
		}
		if rec.LastSeen.After(e.LastSeen) {
			e.LastSeen = rec.LastSeen
		}
	}
	for _, e := range out {
		sort.Slice(e.Ports, func(i, j int) bool { return e.Ports[i].Port < e.Ports[j].Port })
	}
	return out
}

func containsPort(ps []simulator.PortSpec, p simulator.PortSpec) bool {
	for _, q := range ps {
		if q == p {
			return true
		}
	}
	return false
}

func (s *Server) handleTopology(w http.ResponseWriter, r *http.Request) {
	namespaces := splitCSV(r.URL.Query().Get("namespaces"))
	v, ok := s.view(w, r)
	if !ok {
		return
	}
	if r.URL.Query().Get("level") == "namespace" {
		s.handleNamespaceTopology(w, v, namespaces)
		return
	}
	if len(namespaces) == 0 {
		writeError(w, http.StatusBadRequest, "NAMESPACES_REQUIRED", "pass ?namespaces=a,b — topology is computed per namespace selection")
		return
	}
	snap := v.full

	wanted := map[string]bool{}
	for _, ns := range namespaces {
		if v.visible(ns) {
			wanted[ns] = true
		}
	}
	if len(wanted) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"nodes": []topologyNode{}, "edges": []topologyEdge{}})
		return
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
	observed := s.observedEdges(v)
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
				Observed: observed[src.ID+"->"+dst.ID],
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"nodes": nodes, "edges": edges, "flowsEnabled": s.flows != nil})
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
func (s *Server) handleNamespaceTopology(w http.ResponseWriter, v *view, namespaces []string) {
	snap := v.full
	wanted := map[string]bool{}
	for _, ns := range namespaces {
		if v.visible(ns) {
			wanted[ns] = true
		}
	}
	if len(namespaces) == 0 {
		for _, ns := range snap.Namespaces {
			if !simulator.IsSystemNamespace(ns.Name) && v.visible(ns.Name) {
				wanted[ns.Name] = true
			}
		}
	}
	if len(wanted) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"level": "namespace", "nodes": []simulator.NamespaceNode{}, "edges": []simulator.NamespaceEdge{}})
		return
	}
	if n := len(simulator.Workloads(snap, wanted)); n > maxNamespaceGraphWorkloads {
		writeError(w, http.StatusUnprocessableEntity, "TOO_MANY_WORKLOADS",
			fmt.Sprintf("%d workloads in selection (max %d for the namespace graph) — select fewer namespaces", n, maxNamespaceGraphWorkloads))
		return
	}
	keys := make([]string, 0, len(wanted))
	for ns := range wanted {
		keys = append(keys, ns)
	}
	sort.Strings(keys)
	type graph struct {
		nodes []simulator.NamespaceNode
		edges []simulator.NamespaceEdge
	}
	g := s.cache.get(v.gen, "nsgraph:"+strings.Join(keys, ","), func() any {
		nodes, edges := simulator.NamespaceGraph(snap, wanted)
		return graph{nodes, edges}
	}).(graph)
	writeJSON(w, http.StatusOK, map[string]any{"level": "namespace", "nodes": g.nodes, "edges": g.edges})
}
