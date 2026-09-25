package simulator

import (
	"fmt"
	"math"
	"sort"
	"strings"

	networkingv1 "k8s.io/api/networking/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// Finding severities, most severe first.
const (
	SeverityCritical = "critical"
	SeverityWarning  = "warning"
	SeverityInfo     = "info"
)

// Finding is one posture problem detected across the policy set.
type Finding struct {
	Code      string     `json:"code"`
	Severity  string     `json:"severity"`
	Namespace string     `json:"namespace,omitempty"`
	Policy    *PolicyRef `json:"policy,omitempty"`
	Message   string     `json:"message"`
}

// NamespacePosture summarizes isolation coverage for one namespace.
type NamespacePosture struct {
	Namespace string `json:"namespace"`
	System    bool   `json:"system"`
	Pods      int    `json:"pods"`
	// HostNetworkPods are excluded from isolation counts: selectors do not
	// apply to them.
	HostNetworkPods     int  `json:"hostNetworkPods"`
	Policies            int  `json:"policies"`
	IngressIsolatedPods int  `json:"ingressIsolatedPods"`
	EgressIsolatedPods  int  `json:"egressIsolatedPods"`
	DefaultDenyIngress  bool `json:"defaultDenyIngress"`
	DefaultDenyEgress   bool `json:"defaultDenyEgress"`
}

// PostureSummary aggregates coverage over application (non-system,
// non-hostNetwork) pods.
type PostureSummary struct {
	Namespaces          int `json:"namespaces"`
	Policies            int `json:"policies"`
	Pods                int `json:"pods"`
	IngressIsolatedPods int `json:"ingressIsolatedPods"`
	EgressIsolatedPods  int `json:"egressIsolatedPods"`
	// Score is 0–100: 60% ingress coverage + 40% egress coverage, minus 10
	// per critical and 3 per warning finding.
	Score    int `json:"score"`
	Critical int `json:"critical"`
	Warnings int `json:"warnings"`
	Info     int `json:"info"`
}

// PostureReport is the cluster-wide policy posture analysis.
type PostureReport struct {
	Summary    PostureSummary     `json:"summary"`
	Namespaces []NamespacePosture `json:"namespaces"`
	Findings   []Finding          `json:"findings"`
}

// IsSystemNamespace reports whether ns is a Kubernetes system namespace;
// findings there are downgraded because they are usually managed elsewhere.
func IsSystemNamespace(ns string) bool {
	return strings.HasPrefix(ns, "kube-")
}

// Analyze inspects the snapshot for isolation coverage and common policy
// mistakes. It is pure and deterministic (findings are sorted).
func Analyze(snap *Snapshot) PostureReport {
	report := PostureReport{Namespaces: []NamespacePosture{}, Findings: []Finding{}}
	byNS := map[string]*NamespacePosture{}
	for _, ns := range snap.Namespaces {
		byNS[ns.Name] = &NamespacePosture{Namespace: ns.Name, System: IsSystemNamespace(ns.Name)}
	}
	get := func(ns string) *NamespacePosture {
		if p, ok := byNS[ns]; ok {
			return p
		}
		p := &NamespacePosture{Namespace: ns, System: IsSystemNamespace(ns)}
		byNS[ns] = p
		return p
	}

	for _, pol := range snap.Policies {
		np := get(pol.Namespace)
		np.Policies++
		// A default-deny baseline isolates every pod in the namespace
		// (empty podSelector) without an allow-all rule; narrow allows such
		// as DNS alongside it still count.
		empty := len(pol.Spec.PodSelector.MatchLabels) == 0 && len(pol.Spec.PodSelector.MatchExpressions) == 0
		if empty && hasPolicyType(pol, dirIngress) && !hasAllowAll(rulesOf(pol, dirIngress)) {
			np.DefaultDenyIngress = true
		}
		if empty && hasPolicyType(pol, dirEgress) && !hasAllowAll(rulesOf(pol, dirEgress)) {
			np.DefaultDenyEgress = true
		}
		report.Findings = append(report.Findings, policyFindings(snap, pol)...)
	}

	// Per-pod isolation and the DNS trap, aggregated per namespace.
	dnsBlocked := map[string][]string{}
	for _, pod := range snap.Pods {
		np := get(pod.Namespace)
		np.Pods++
		if pod.HostNetwork {
			np.HostNetworkPods++
			continue
		}
		if len(policiesSelecting(snap, pod, dirIngress)) > 0 {
			np.IngressIsolatedPods++
		}
		if len(policiesSelecting(snap, pod, dirEgress)) > 0 {
			np.EgressIsolatedPods++
			if _, fires := dnsTrapWarning(snap, pod, Input{}); fires {
				dnsBlocked[pod.Namespace] = append(dnsBlocked[pod.Namespace], pod.Name)
			}
		}
	}
	for ns, pods := range dnsBlocked {
		report.Findings = append(report.Findings, Finding{
			Code: "DNS_EGRESS_BLOCKED", Severity: downgrade(SeverityCritical, ns), Namespace: ns,
			Message: fmt.Sprintf("%d egress-isolated pod(s) have no egress rule allowing port 53 — DNS resolution fails for them (e.g. %s). Add an egress rule allowing UDP/TCP 53 to kube-dns.",
				len(pods), strings.Join(firstN(pods, 3), ", ")),
		})
	}

	for _, np := range byNS {
		report.Namespaces = append(report.Namespaces, *np)
		eligible := np.Pods - np.HostNetworkPods
		if eligible == 0 {
			continue
		}
		switch {
		case np.IngressIsolatedPods == 0:
			report.Findings = append(report.Findings, Finding{
				Code: "NAMESPACE_UNPROTECTED", Severity: downgrade(SeverityWarning, np.Namespace), Namespace: np.Namespace,
				Message: fmt.Sprintf("No pod in this namespace is ingress-isolated: all %d pod(s) accept traffic from anywhere. Start with a default-deny ingress policy.", eligible),
			})
		case np.IngressIsolatedPods < eligible:
			report.Findings = append(report.Findings, Finding{
				Code: "PODS_NOT_ISOLATED", Severity: SeverityInfo, Namespace: np.Namespace,
				Message: fmt.Sprintf("%d of %d pod(s) are not selected by any ingress policy and accept all traffic.", eligible-np.IngressIsolatedPods, eligible),
			})
		}
	}

	sort.Slice(report.Namespaces, func(i, j int) bool { return report.Namespaces[i].Namespace < report.Namespaces[j].Namespace })
	sort.SliceStable(report.Findings, func(i, j int) bool {
		a, b := report.Findings[i], report.Findings[j]
		if severityRank(a.Severity) != severityRank(b.Severity) {
			return severityRank(a.Severity) < severityRank(b.Severity)
		}
		if a.Namespace != b.Namespace {
			return a.Namespace < b.Namespace
		}
		if a.Code != b.Code {
			return a.Code < b.Code
		}
		return policyName(a.Policy) < policyName(b.Policy)
	})

	summarize(&report)
	return report
}

// summarize (re)computes the summary from the report's namespaces and
// findings, so filtered reports stay self-consistent.
func summarize(report *PostureReport) {
	s := &report.Summary
	*s = PostureSummary{Namespaces: len(report.Namespaces)}
	for _, np := range report.Namespaces {
		s.Policies += np.Policies
		if !np.System {
			s.Pods += np.Pods - np.HostNetworkPods
			s.IngressIsolatedPods += np.IngressIsolatedPods
			s.EgressIsolatedPods += np.EgressIsolatedPods
		}
	}
	for _, f := range report.Findings {
		switch f.Severity {
		case SeverityCritical:
			s.Critical++
		case SeverityWarning:
			s.Warnings++
		default:
			s.Info++
		}
	}
	s.Score = score(*s)
}

// FilterPosture restricts a report to the namespaces visible() accepts
// and recomputes the summary. Cluster-wide findings (no namespace) are
// kept. Analysis always runs on the full cluster first, so cross-namespace
// facts (e.g. a peer selector that matches pods elsewhere) stay correct.
func FilterPosture(report PostureReport, visible func(string) bool) PostureReport {
	out := PostureReport{Namespaces: []NamespacePosture{}, Findings: []Finding{}}
	for _, np := range report.Namespaces {
		if visible(np.Namespace) {
			out.Namespaces = append(out.Namespaces, np)
		}
	}
	for _, f := range report.Findings {
		if f.Namespace == "" || visible(f.Namespace) {
			out.Findings = append(out.Findings, f)
		}
	}
	summarize(&out)
	return out
}

func hasAllowAll(rules []normalizedRule) bool {
	for _, r := range rules {
		if len(r.peers) == 0 && len(r.ports) == 0 {
			return true
		}
	}
	return false
}

func score(s PostureSummary) int {
	if s.Pods == 0 {
		return 100 - min(100, 10*s.Critical+3*s.Warnings)
	}
	coverage := 60*float64(s.IngressIsolatedPods)/float64(s.Pods) + 40*float64(s.EgressIsolatedPods)/float64(s.Pods)
	v := int(math.Round(coverage)) - 10*s.Critical - 3*s.Warnings
	return max(0, min(100, v))
}

// policyFindings reports mistakes visible in a single policy.
func policyFindings(snap *Snapshot, pol *networkingv1.NetworkPolicy) []Finding {
	var out []Finding
	ref := &PolicyRef{Namespace: pol.Namespace, Name: pol.Name}
	add := func(code, severity, msg string) {
		out = append(out, Finding{Code: code, Severity: downgrade(severity, pol.Namespace), Namespace: pol.Namespace, Policy: ref, Message: msg})
	}

	selected := PodsSelectedBy(snap, pol)
	if len(selected) == 0 {
		add("POLICY_SELECTS_NOTHING", SeverityWarning,
			"The podSelector matches no running pod, so this policy has no effect. Check the labels for typos.")
	}
	hostNet := 0
	for _, p := range selected {
		if p.HostNetwork {
			hostNet++
		}
	}
	if hostNet > 0 {
		add("HOSTNETWORK_SELECTED", SeverityInfo,
			fmt.Sprintf("Selects %d hostNetwork pod(s); NetworkPolicy behavior for host-network pods is undefined and usually not enforced.", hostNet))
	}

	if hasPolicyType(pol, dirIngress) {
		for i, r := range pol.Spec.Ingress {
			if len(r.From) == 0 && len(r.Ports) == 0 {
				add("ALLOW_ALL_INGRESS", SeverityWarning,
					fmt.Sprintf("Ingress rule #%d has no peers and no ports: it allows all inbound traffic and cancels isolation for the selected pods.", i+1))
			}
			out = append(out, peerFindings(snap, pol, ref, "ingress", i, r.From)...)
		}
	}
	if hasPolicyType(pol, dirEgress) {
		for i, r := range pol.Spec.Egress {
			if len(r.To) == 0 && len(r.Ports) == 0 {
				add("ALLOW_ALL_EGRESS", SeverityInfo,
					fmt.Sprintf("Egress rule #%d has no peers and no ports: it allows all outbound traffic for the selected pods.", i+1))
			}
			out = append(out, peerFindings(snap, pol, ref, "egress", i, r.To)...)
		}
	}
	return out
}

func peerFindings(snap *Snapshot, pol *networkingv1.NetworkPolicy, ref *PolicyRef, dir string, ruleIndex int, peers []networkingv1.NetworkPolicyPeer) []Finding {
	var out []Finding
	for j, peer := range peers {
		where := fmt.Sprintf("%s rule #%d, peer #%d", strings.ToUpper(dir[:1])+dir[1:], ruleIndex+1, j+1)
		if peer.IPBlock != nil {
			if isAnyCIDR(peer.IPBlock.CIDR) && len(peer.IPBlock.Except) == 0 {
				sev := SeverityInfo
				if dir == "ingress" {
					sev = SeverityWarning
				}
				out = append(out, Finding{
					Code: "IPBLOCK_ANY", Severity: downgrade(sev, pol.Namespace), Namespace: pol.Namespace, Policy: ref,
					Message: fmt.Sprintf("%s allows ipBlock %s without exceptions — every external address.", where, peer.IPBlock.CIDR),
				})
			}
			continue
		}
		if peer.PodSelector == nil && peer.NamespaceSelector == nil {
			continue
		}
		if !peerMatchesAnyPod(snap, pol.Namespace, peer) {
			out = append(out, Finding{
				Code: "PEER_MATCHES_NOTHING", Severity: downgrade(SeverityWarning, pol.Namespace), Namespace: pol.Namespace, Policy: ref,
				Message: fmt.Sprintf("%s (%s) currently matches no pod — likely a label typo, or the peer is not deployed yet.", where, describePeers([]networkingv1.NetworkPolicyPeer{peer})),
			})
		}
	}
	return out
}

func peerMatchesAnyPod(snap *Snapshot, policyNamespace string, peer networkingv1.NetworkPolicyPeer) bool {
	for i := range snap.Pods {
		if peerMatchesTarget(snap, policyNamespace, peer, podTarget(snap.Pods[i])) {
			return true
		}
	}
	return false
}

func isAnyCIDR(cidr string) bool {
	return cidr == "0.0.0.0/0" || cidr == "::/0"
}

// downgrade lowers severity by one step for system namespaces.
func downgrade(severity, namespace string) string {
	if !IsSystemNamespace(namespace) {
		return severity
	}
	switch severity {
	case SeverityCritical:
		return SeverityWarning
	default:
		return SeverityInfo
	}
}

func severityRank(s string) int {
	switch s {
	case SeverityCritical:
		return 0
	case SeverityWarning:
		return 1
	default:
		return 2
	}
}

func policyName(ref *PolicyRef) string {
	if ref == nil {
		return ""
	}
	return ref.Namespace + "/" + ref.Name
}

func firstN(s []string, n int) []string {
	sort.Strings(s)
	if len(s) > n {
		return append(s[:n:n], "…")
	}
	return s
}

// PodIsolation is a pod's per-direction isolation with the selecting policies.
type PodIsolation struct {
	kube.PodInfo
	IngressPolicies []PolicyRef `json:"ingressPolicies"`
	EgressPolicies  []PolicyRef `json:"egressPolicies"`
}

// NamespaceIsolation lists every pod in ns with the policies isolating it.
func NamespaceIsolation(snap *Snapshot, ns string) []PodIsolation {
	out := []PodIsolation{}
	for _, pod := range snap.Pods {
		if pod.Namespace != ns {
			continue
		}
		in, eg := IsolationOf(snap, pod)
		if in == nil {
			in = []PolicyRef{}
		}
		if eg == nil {
			eg = []PolicyRef{}
		}
		out = append(out, PodIsolation{PodInfo: pod, IngressPolicies: in, EgressPolicies: eg})
	}
	return out
}
