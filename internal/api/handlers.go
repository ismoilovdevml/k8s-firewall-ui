package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/labels"
	"sigs.k8s.io/yaml"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/version"
)

func (s *Server) handleClusterInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"appVersion":        version.Version,
		"kubernetesVersion": s.k8sVersion,
		"cni":               s.cniResult,
	})
}

func (s *Server) handleNamespaces(w http.ResponseWriter, _ *http.Request) {
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	podCount := map[string]int{}
	for _, p := range snap.Pods {
		podCount[p.Namespace]++
	}
	policyCount := map[string]int{}
	for _, pol := range snap.Policies {
		policyCount[pol.Namespace]++
	}
	type nsView struct {
		kube.NamespaceInfo
		PodCount    int `json:"podCount"`
		PolicyCount int `json:"policyCount"`
	}
	out := make([]nsView, 0, len(snap.Namespaces))
	for _, ns := range snap.Namespaces {
		out = append(out, nsView{ns, podCount[ns.Name], policyCount[ns.Name]})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleNamespacePods(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	ns := chi.URLParam(r, "ns")
	out := []kube.PodInfo{}
	for _, p := range snap.Pods {
		if p.Namespace == ns {
			out = append(out, p)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handlePods(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	ns := r.URL.Query().Get("namespace")
	var sel labels.Selector
	if raw := r.URL.Query().Get("labelSelector"); raw != "" {
		var err error
		sel, err = labels.Parse(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "BAD_SELECTOR", err.Error())
			return
		}
	}
	out := []kube.PodInfo{}
	for _, p := range snap.Pods {
		if ns != "" && p.Namespace != ns {
			continue
		}
		if sel != nil && !sel.Matches(labels.Set(p.Labels)) {
			continue
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, out)
}

// policySummary is the list-view projection of a NetworkPolicy.
type policySummary struct {
	Namespace   string   `json:"namespace"`
	Name        string   `json:"name"`
	PolicyTypes []string `json:"policyTypes"`
	PodsMatched int      `json:"podsMatched"`
	CreatedAt   string   `json:"createdAt"`
}

func (s *Server) handlePolicyList(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	nsFilter := r.URL.Query().Get("namespace")
	out := []policySummary{}
	for _, pol := range snap.Policies {
		if nsFilter != "" && pol.Namespace != nsFilter {
			continue
		}
		out = append(out, policySummary{
			Namespace:   pol.Namespace,
			Name:        pol.Name,
			PolicyTypes: policyTypeStrings(pol),
			PodsMatched: len(affectedPods(snap, pol)),
			CreatedAt:   pol.CreationTimestamp.UTC().Format("2006-01-02T15:04:05Z"),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handlePolicyGet(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	ns, name := chi.URLParam(r, "ns"), chi.URLParam(r, "name")
	for _, pol := range snap.Policies {
		if pol.Namespace != ns || pol.Name != name {
			continue
		}
		clean := pol.DeepCopy()
		clean.ManagedFields = nil
		yml, err := yaml.Marshal(clean)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "YAML_MARSHAL_FAILED", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"policy":       clean,
			"yaml":         string(yml),
			"affectedPods": affectedPods(snap, pol),
		})
		return
	}
	writeError(w, http.StatusNotFound, "NOT_FOUND", "networkpolicy "+ns+"/"+name+" not found")
}

// affectedPods returns the pods in the policy's namespace that its
// podSelector matches (simulator semantics: empty selector = all pods).
func affectedPods(snap *kube.ClusterSnapshot, pol *networkingv1.NetworkPolicy) []kube.PodInfo {
	out := []kube.PodInfo{}
	out = append(out, simulator.PodsSelectedBy(snap, pol)...)
	return out
}

func policyTypeStrings(pol *networkingv1.NetworkPolicy) []string {
	out := make([]string, 0, 2)
	for _, t := range pol.Spec.PolicyTypes {
		out = append(out, string(t))
	}
	// Mirror the API default so the UI never shows an empty list.
	if len(out) == 0 {
		out = append(out, "Ingress")
		if len(pol.Spec.Egress) > 0 {
			out = append(out, "Egress")
		}
	}
	return out
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := parts[:0]
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
