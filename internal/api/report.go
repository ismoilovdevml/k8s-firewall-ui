package api

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/version"
)

// handlePostureReport serves the posture report as a downloadable file for
// auditors: ?format=md (default) | csv | json.
func (s *Server) handlePostureReport(w http.ResponseWriter, r *http.Request) {
	v, ok := s.view(w, r)
	if !ok {
		return
	}
	report := s.cache.get(v.gen, "posture", func() any { return simulator.Analyze(v.full) }).(simulator.PostureReport)
	if !v.vis.All {
		report = simulator.FilterPosture(report, v.visible)
	}
	now := time.Now().UTC()
	stamp := now.Format("20060102-1504")

	switch format := r.URL.Query().Get("format"); format {
	case "json":
		w.Header().Set("Content-Disposition", `attachment; filename="networkpolicy-posture-`+stamp+`.json"`)
		writeJSON(w, http.StatusOK, map[string]any{
			"generatedAt": now.Format(time.RFC3339), "cluster": s.k8sVersion, "cni": s.cniResult, "report": report,
		})
	case "csv":
		var buf bytes.Buffer
		cw := csv.NewWriter(&buf)
		_ = cw.Write([]string{"severity", "code", "namespace", "policy", "message"})
		for _, f := range report.Findings {
			_ = cw.Write([]string{f.Severity, f.Code, f.Namespace, policyName(f.Policy), f.Message})
		}
		cw.Flush()
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="networkpolicy-findings-`+stamp+`.csv"`)
		_, _ = w.Write(buf.Bytes())
	case "", "md":
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="networkpolicy-posture-`+stamp+`.md"`)
		_, _ = w.Write([]byte(markdownReport(report, s.k8sVersion, s.cniResult.Provider, s.cniResult.EnforcesPolicies, now)))
	default:
		writeError(w, http.StatusBadRequest, "INVALID_FORMAT", "format must be md, csv or json")
	}
}

func policyName(ref *simulator.PolicyRef) string {
	if ref == nil {
		return ""
	}
	return ref.Namespace + "/" + ref.Name
}

func pct(n, d int) string {
	if d == 0 {
		return "—"
	}
	return fmt.Sprintf("%d%%", (100*n+d/2)/d)
}

func markdownReport(r simulator.PostureReport, cluster, cni string, enforced bool, now time.Time) string {
	var b strings.Builder
	s := r.Summary
	fmt.Fprintf(&b, "# NetworkPolicy posture report\n\n")
	fmt.Fprintf(&b, "Generated %s by k8s-firewall-ui %s · cluster %s · CNI %s (enforced: %v)\n\n",
		now.Format(time.RFC3339), version.Version, cluster, cni, enforced)
	fmt.Fprintf(&b, "## Summary\n\n| Metric | Value |\n|---|---|\n")
	fmt.Fprintf(&b, "| Posture score | **%d / 100** |\n", s.Score)
	fmt.Fprintf(&b, "| Application pods | %d |\n", s.Pods)
	fmt.Fprintf(&b, "| Ingress-isolated pods | %d (%s) |\n", s.IngressIsolatedPods, pct(s.IngressIsolatedPods, s.Pods))
	fmt.Fprintf(&b, "| Egress-isolated pods | %d (%s) |\n", s.EgressIsolatedPods, pct(s.EgressIsolatedPods, s.Pods))
	fmt.Fprintf(&b, "| NetworkPolicies | %d |\n", s.Policies)
	fmt.Fprintf(&b, "| Findings | %d critical · %d warning · %d info |\n\n", s.Critical, s.Warnings, s.Info)

	fmt.Fprintf(&b, "## Namespaces\n\n| Namespace | Pods | Policies | Ingress isolated | Egress isolated | Default-deny in / out |\n|---|---|---|---|---|---|\n")
	for _, np := range r.Namespaces {
		eligible := np.Pods - np.HostNetworkPods
		mark := func(v bool) string {
			if v {
				return "yes"
			}
			return "no"
		}
		name := np.Namespace
		if np.System {
			name += " (system)"
		}
		fmt.Fprintf(&b, "| %s | %d | %d | %s | %s | %s / %s |\n", name, np.Pods, np.Policies,
			pct(np.IngressIsolatedPods, eligible), pct(np.EgressIsolatedPods, eligible),
			mark(np.DefaultDenyIngress), mark(np.DefaultDenyEgress))
	}

	fmt.Fprintf(&b, "\n## Findings\n\n")
	if len(r.Findings) == 0 {
		b.WriteString("No findings.\n")
	}
	for _, f := range r.Findings {
		where := f.Namespace
		if f.Policy != nil {
			where = policyName(f.Policy)
		}
		if where == "" {
			where = "cluster"
		}
		fmt.Fprintf(&b, "- **%s** `%s` — %s: %s\n", strings.ToUpper(f.Severity), f.Code, where, f.Message)
	}
	b.WriteString("\n---\nVerdicts are computed from the NetworkPolicy objects in the cluster. They assume the CNI enforces them as specified.\n")
	return b.String()
}
