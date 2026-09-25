package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	networkingv1 "k8s.io/api/networking/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/audit"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

// handlePosture serves the cluster-wide posture report plus cluster-level
// caveats that affect how much the report can be trusted.
func (s *Server) handlePosture(w http.ResponseWriter, _ *http.Request) {
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	report := simulator.Analyze(snap)
	if !s.cniResult.EnforcesPolicies {
		report.Findings = append([]simulator.Finding{{
			Code: "CNI_NOT_ENFORCING", Severity: simulator.SeverityCritical,
			Message: "The detected CNI (" + s.cniResult.Provider + ") does not enforce NetworkPolicies: none of these policies are in effect.",
		}}, report.Findings...)
		report.Summary.Critical++
	}
	writeJSON(w, http.StatusOK, report)
}

func (s *Server) handleNamespaceIsolation(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, simulator.NamespaceIsolation(snap, chi.URLParam(r, "ns")))
}

type impactRequest struct {
	// Operation is "apply" (default) or "delete".
	Operation string          `json:"operation"`
	Namespace string          `json:"namespace"`
	Name      string          `json:"name"`
	Policy    json.RawMessage `json:"policy,omitempty"`
	YAML      string          `json:"yaml,omitempty"`
}

// handleImpact answers "what changes if I apply/delete this policy?".
func (s *Server) handleImpact(w http.ResponseWriter, r *http.Request) {
	var req impactRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBodySize)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", err.Error())
		return
	}
	var proposed *networkingv1.NetworkPolicy
	switch req.Operation {
	case "", "apply":
		body := []byte(req.YAML)
		if len(req.Policy) > 0 {
			body = req.Policy
		}
		pol, err := decodePolicyBytes(body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_POLICY", err.Error())
			return
		}
		if pol.Namespace == "" {
			pol.Namespace = req.Namespace
		}
		if pol.Namespace == "" || pol.Name == "" {
			writeError(w, http.StatusBadRequest, "IDENTITY_REQUIRED", "policy namespace and name are required")
			return
		}
		req.Namespace, req.Name, proposed = pol.Namespace, pol.Name, pol
	case "delete":
		if req.Namespace == "" || req.Name == "" {
			writeError(w, http.StatusBadRequest, "IDENTITY_REQUIRED", "namespace and name are required")
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "operation must be apply or delete")
		return
	}
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, simulator.Impact(snap, req.Namespace, req.Name, proposed))
}

func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	writeJSON(w, http.StatusOK, s.audit.List(audit.Filter{
		Namespace: q.Get("namespace"), User: q.Get("user"), Action: q.Get("action"),
		Query: q.Get("q"), Limit: limit,
	}))
}

// handlePermissions reports whether the current user may change
// NetworkPolicies in ?namespace= (SelfSubjectAccessReview as that user).
func (s *Server) handlePermissions(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	verbs := []string{"create", "update", "delete"}
	out := map[string]any{"namespace": ns, "readOnly": s.readOnly}
	if s.readOnly {
		for _, v := range verbs {
			out[v] = false
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	allowed, err := s.auth.CanI(r.Context(), ns, verbs)
	if err != nil {
		// Unknown: let the UI offer the action; the API server still decides.
		s.log.Debug("permission check failed", "namespace", ns, "error", err)
		for _, v := range verbs {
			out[v] = true
		}
		out["unknown"] = true
		writeJSON(w, http.StatusOK, out)
		return
	}
	for v, ok := range allowed {
		out[v] = ok
	}
	writeJSON(w, http.StatusOK, out)
}
