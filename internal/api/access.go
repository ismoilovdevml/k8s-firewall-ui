package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

// handleAccess serves the firewall view of a workload, pod or namespace:
// GET /api/v1/access?namespace=ns[&workload=deployment/web | &pod=name].
func (s *Server) handleAccess(w http.ResponseWriter, r *http.Request) {
	v, ok := s.view(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	subj := simulator.Subject{Namespace: q.Get("namespace"), Workload: q.Get("workload")}
	if subj.Namespace == "" {
		writeError(w, http.StatusBadRequest, "NAMESPACE_REQUIRED", "pass ?namespace= (and optionally workload= or pod=)")
		return
	}
	if !v.visible(subj.Namespace) {
		notVisible(w, "namespace "+subj.Namespace)
		return
	}
	if pod := q.Get("pod"); pod != "" {
		// Policies select pods by labels, so a pod's firewall is its workload's.
		found := false
		for _, p := range v.full.Pods {
			if p.Namespace == subj.Namespace && p.Name == pod {
				subj.Workload, found = p.Owner, true
			}
		}
		if !found {
			notVisible(w, "pod "+subj.Namespace+"/"+pod)
			return
		}
	}
	report, err := simulator.Access(v.full, subj)
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}
	if !v.vis.All {
		report.Inbound = visibleRows(report.Inbound, v.visible)
		report.Outbound = visibleRows(report.Outbound, v.visible)
	}
	writeJSON(w, http.StatusOK, report)
}

func visibleRows(rows []simulator.AccessRow, visible func(string) bool) []simulator.AccessRow {
	out := rows[:0]
	for _, row := range rows {
		if row.Peer.Kind == simulator.PeerExternal || visible(row.Peer.Namespace) {
			out = append(out, row)
		}
	}
	return out
}

// plannedChangeView is a PlannedChange with ready-to-review YAML.
type plannedChangeView struct {
	simulator.PlannedChange
	Before string `json:"before"`
	After  string `json:"after"`
}

type planView struct {
	simulator.Plan
	Changes []plannedChangeView `json:"changes"`
	// Signature identifies the change set the user reviewed; apply refuses
	// to proceed if the recomputed plan differs.
	Signature string `json:"signature"`
}

func toPlanView(p simulator.Plan) planView {
	out := planView{Plan: p, Changes: []plannedChangeView{}}
	for _, c := range p.Changes {
		out.Changes = append(out.Changes, plannedChangeView{
			PlannedChange: c, Before: policyYAML(c.Previous), After: policyYAML(c.Policy),
		})
	}
	out.Signature = planSignature(p)
	return out
}

// planSignature is a stable description of the change set: operation,
// target and resulting YAML of every change.
func planSignature(p simulator.Plan) string {
	parts := make([]string, 0, len(p.Changes))
	for _, c := range p.Changes {
		parts = append(parts, c.Operation+" "+c.Namespace+"/"+c.Name+"\n"+policyYAML(c.Policy))
	}
	sort.Strings(parts)
	return hashString(strings.Join(parts, "\n---\n"))
}

// decodePlanRequest reads a plan request (and, for apply, the signature of
// the reviewed plan) and checks both namespaces are visible.
func (s *Server) decodePlanRequest(w http.ResponseWriter, r *http.Request) (simulator.PlanRequest, string, *view, bool) {
	var req struct {
		simulator.PlanRequest
		Signature string `json:"signature"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBodySize)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", err.Error())
		return simulator.PlanRequest{}, "", nil, false
	}
	v, ok := s.view(w, r)
	if !ok {
		return simulator.PlanRequest{}, "", nil, false
	}
	for _, ns := range []string{req.Subject.Namespace, req.Peer.Namespace} {
		if ns != "" && !v.visible(ns) {
			notVisible(w, "namespace "+ns)
			return simulator.PlanRequest{}, "", nil, false
		}
	}
	return req.PlanRequest, req.Signature, v, true
}

// handleAccessPlan computes, but does not apply, the changes for a flow.
func (s *Server) handleAccessPlan(w http.ResponseWriter, r *http.Request) {
	req, _, v, ok := s.decodePlanRequest(w, r)
	if !ok {
		return
	}
	plan, err := simulator.PlanAccess(v.full, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, "PLAN_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toPlanView(plan))
}

type applyResult struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Operation string `json:"operation"`
	Error     string `json:"error,omitempty"`
}

// handleAccessApply recomputes the plan server-side (never trusting
// client-sent policies), checks it matches what the user reviewed,
// dry-runs every change, then applies them as the user.
func (s *Server) handleAccessApply(w http.ResponseWriter, r *http.Request) {
	req, signature, v, ok := s.decodePlanRequest(w, r)
	if !ok {
		return
	}
	plan, err := simulator.PlanAccess(v.full, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, "PLAN_FAILED", err.Error())
		return
	}
	s.applyPlan(w, r, plan, signature)
}

// applyPlan checks the reviewed signature, dry-runs every change, then
// applies them in order as the user, auditing each write.
func (s *Server) applyPlan(w http.ResponseWriter, r *http.Request, plan simulator.Plan, signature string) {
	if signature != planSignature(plan) {
		writeError(w, http.StatusConflict, "PLAN_CHANGED",
			"the cluster changed since you reviewed this plan — review the new plan and apply again")
		return
	}
	if len(plan.Changes) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"plan": toPlanView(plan), "results": []applyResult{}})
		return
	}
	cs, ok := s.userClient(w, r)
	if !ok {
		return
	}

	write := func(c simulator.PlannedChange, dryRun []string) (*networkingv1.NetworkPolicy, error) {
		pol := c.Policy.DeepCopy()
		client := cs.NetworkingV1().NetworkPolicies(c.Namespace)
		if c.Operation == "create" {
			return client.Create(r.Context(), pol, metav1.CreateOptions{DryRun: dryRun, FieldManager: fieldManager})
		}
		pol.ResourceVersion = c.Previous.ResourceVersion
		return client.Update(r.Context(), pol, metav1.UpdateOptions{DryRun: dryRun, FieldManager: fieldManager})
	}

	// Phase 1: validate everything; nothing is written if any change fails.
	for _, c := range plan.Changes {
		if _, err := write(c, []string{metav1.DryRunAll}); err != nil {
			writeK8sError(w, err)
			return
		}
	}
	if isDryRun(r) {
		writeJSON(w, http.StatusOK, map[string]any{"plan": toPlanView(plan), "results": []applyResult{}, "dryRun": true})
		return
	}
	// Phase 2: apply in order, stopping at the first failure.
	results := []applyResult{}
	status := http.StatusOK
	for _, c := range plan.Changes {
		res := applyResult{Namespace: c.Namespace, Name: c.Name, Operation: c.Operation}
		after, err := write(c, nil)
		s.recordAudit(r, c.Operation, c.Namespace, c.Name, c.Previous, after, err)
		if err != nil {
			res.Error = err.Error()
			results = append(results, res)
			status = http.StatusBadGateway
			break
		}
		results = append(results, res)
	}
	writeJSON(w, status, map[string]any{"plan": toPlanView(plan), "results": results})
}

func hashString(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:16])
}
