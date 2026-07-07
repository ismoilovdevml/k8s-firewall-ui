package api

import (
	"encoding/json"
	"net/http"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

func (s *Server) handleSimulate(w http.ResponseWriter, r *http.Request) {
	var in simulator.Input
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", err.Error())
		return
	}
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	res, err := simulator.Evaluate(snap, in)
	if err != nil {
		writeError(w, http.StatusBadRequest, "SIMULATION_FAILED", err.Error())
		return
	}

	// Cluster-level caveats belong on every simulation result.
	if !s.cniResult.EnforcesPolicies {
		res.Warnings = append(res.Warnings, simulator.Warning{
			Code: "CNI_NOT_ENFORCING", Severity: "warning",
			Message: "The detected CNI (" + s.cniResult.Provider + ") does not enforce NetworkPolicies — this verdict is theoretical.",
		})
	}
	if s.cniResult.ANPPresent {
		res.Warnings = append(res.Warnings, simulator.Warning{
			Code: "ANP_NOT_EVALUATED", Severity: "info",
			Message: "AdminNetworkPolicy resources exist in this cluster and are not evaluated; the real verdict may differ.",
		})
	}
	writeJSON(w, http.StatusOK, res)
}
