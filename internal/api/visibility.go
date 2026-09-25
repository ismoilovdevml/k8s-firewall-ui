package api

import (
	"net/http"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/auth"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// view is a snapshot plus what the requesting user may see. Evaluation
// (simulator, analysis) always runs on the full snapshot so verdicts stay
// correct; only what is returned is filtered.
type view struct {
	full *kube.ClusterSnapshot
	vis  auth.Visibility
}

func (v *view) visible(ns string) bool { return v.vis.Visible(ns) }

// filtered returns the snapshot restricted to visible namespaces.
func (v *view) filtered() *kube.ClusterSnapshot {
	if v.vis.All {
		return v.full
	}
	out := &kube.ClusterSnapshot{}
	for _, ns := range v.full.Namespaces {
		if v.visible(ns.Name) {
			out.Namespaces = append(out.Namespaces, ns)
		}
	}
	for _, p := range v.full.Pods {
		if v.visible(p.Namespace) {
			out.Pods = append(out.Pods, p)
		}
	}
	for _, pol := range v.full.Policies {
		if v.visible(pol.Namespace) {
			out.Policies = append(out.Policies, pol)
		}
	}
	out.IndexNamespaces()
	return out
}

// view loads the snapshot and the caller's namespace visibility.
func (s *Server) view(w http.ResponseWriter, r *http.Request) (*view, bool) {
	snap, ok := s.snapshot(w)
	if !ok {
		return nil, false
	}
	names := make([]string, 0, len(snap.Namespaces))
	for _, ns := range snap.Namespaces {
		names = append(names, ns.Name)
	}
	vis, err := s.auth.VisibleNamespaces(r.Context(), names)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "PERMISSION_CHECK_FAILED",
			"could not determine which namespaces you may view: "+err.Error())
		return nil, false
	}
	return &view{full: snap, vis: vis}, true
}

// notVisible answers like a missing object so hidden namespaces are not
// disclosed.
func notVisible(w http.ResponseWriter, what string) {
	writeError(w, http.StatusNotFound, "NOT_FOUND", what+" not found")
}
