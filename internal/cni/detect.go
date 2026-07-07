// Package cni heuristically detects the cluster's CNI / policy engine so the
// UI can warn when NetworkPolicies are silently unenforced (e.g. plain
// flannel). Detection is best-effort: evidence strings are surfaced in the
// UI and --cni-override bypasses it entirely.
package cni

import (
	"context"
	"fmt"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// Result is the detection outcome, served via /api/v1/cluster-info.
type Result struct {
	Provider         string   `json:"provider"` // e.g. "calico", "cilium", "flannel", "unknown"
	EnforcesPolicies bool     `json:"enforcesPolicies"`
	Evidence         []string `json:"evidence,omitempty"`
	Warnings         []string `json:"warnings,omitempty"`
	ANPPresent       bool     `json:"anpPresent"` // policy.networking.k8s.io CRDs found
}

// daemonSetSignatures maps kube-system DaemonSet name fragments to providers,
// checked in order (policy-capable CNIs first so e.g. Canal — flannel +
// calico-node — detects as Calico).
var daemonSetSignatures = []struct {
	fragment string
	provider string
	enforces bool
}{
	{"calico-node", "calico", true},
	{"cilium", "cilium", true},
	{"antrea-agent", "antrea", true},
	{"weave-net", "weave", true},
	{"kube-router", "kube-router", true},
	{"ovnkube", "ovn-kubernetes", true},
	{"kube-ovn", "kube-ovn", true},
	{"aws-node", "aws-vpc-cni", false}, // enforces only with the policy agent
	{"kube-flannel", "flannel", false},
	{"flannel", "flannel", false},
}

// crdGroupSignatures maps API group presence to extra evidence.
var crdGroupSignatures = map[string]string{
	"crd.projectcalico.org":     "calico",
	"cilium.io":                 "cilium",
	"crd.antrea.io":             "antrea",
	"policy.networking.k8s.io":  "anp",
	"kubeovn.io":                "kube-ovn",
}

// Detect inspects kube-system DaemonSets and API groups. override, when
// non-empty, is trusted as the provider name (assumed policy-enforcing).
func Detect(ctx context.Context, cs kubernetes.Interface, override string) Result {
	if override != "" {
		return Result{
			Provider:         override,
			EnforcesPolicies: true,
			Evidence:         []string{"--cni-override=" + override},
		}
	}

	res := Result{Provider: "unknown"}

	dsList, err := cs.AppsV1().DaemonSets("kube-system").List(ctx, metav1.ListOptions{})
	if err != nil {
		res.Warnings = append(res.Warnings, fmt.Sprintf("could not list kube-system DaemonSets for CNI detection: %v", err))
	} else {
		names := make([]string, 0, len(dsList.Items))
		for _, ds := range dsList.Items {
			names = append(names, ds.Name)
		}
		for _, sig := range daemonSetSignatures {
			for _, name := range names {
				if strings.Contains(name, sig.fragment) {
					res.Provider = sig.provider
					res.EnforcesPolicies = sig.enforces
					res.Evidence = append(res.Evidence, fmt.Sprintf("kube-system DaemonSet %q matches %s", name, sig.provider))
					break
				}
			}
			if res.Provider != "unknown" {
				break
			}
		}
		// AWS VPC CNI enforces NetworkPolicy only when the policy agent runs.
		if res.Provider == "aws-vpc-cni" {
			for _, name := range names {
				if strings.Contains(name, "aws-network-policy-agent") {
					res.EnforcesPolicies = true
					res.Evidence = append(res.Evidence, "aws-network-policy-agent DaemonSet present")
				}
			}
		}
	}

	groups, err := cs.Discovery().ServerGroups()
	if err != nil {
		res.Warnings = append(res.Warnings, fmt.Sprintf("API group discovery failed: %v", err))
	} else {
		for _, g := range groups.Groups {
			tag, known := crdGroupSignatures[g.Name]
			if !known {
				continue
			}
			if tag == "anp" {
				res.ANPPresent = true
				res.Evidence = append(res.Evidence, "policy.networking.k8s.io API group present (AdminNetworkPolicy)")
				continue
			}
			res.Evidence = append(res.Evidence, fmt.Sprintf("API group %s present", g.Name))
			// CRDs from a policy-capable CNI trump a non-enforcing DaemonSet
			// match (e.g. Canal: flannel DaemonSet + Calico CRDs).
			if res.Provider == "unknown" || !res.EnforcesPolicies {
				res.Provider = tag
				res.EnforcesPolicies = true
			}
		}
	}

	switch {
	case res.Provider == "flannel":
		res.Warnings = append(res.Warnings,
			"flannel does not enforce NetworkPolicies: policies will be accepted by the API server but silently ignored. Install a policy engine (e.g. Calico via Canal, or Cilium in chaining mode).")
	case res.Provider == "aws-vpc-cni" && !res.EnforcesPolicies:
		res.Warnings = append(res.Warnings,
			"AWS VPC CNI without the network policy agent does not enforce NetworkPolicies. Enable the agent or install Calico.")
	case res.Provider == "unknown":
		res.Warnings = append(res.Warnings,
			"Could not identify the CNI. NetworkPolicies may not be enforced — verify your CNI supports them, or set --cni-override.")
	}
	if res.ANPPresent {
		res.Warnings = append(res.Warnings,
			"AdminNetworkPolicy resources detected: this tool does not evaluate them yet, so simulation results may be incomplete.")
	}
	return res
}
