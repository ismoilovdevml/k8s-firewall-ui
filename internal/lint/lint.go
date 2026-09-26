// Package lint checks NetworkPolicy manifests before they reach a cluster —
// in a pull request, a GitOps repository, or a pre-commit hook:
//
//	k8s-firewall-ui lint policies/            # offline: static checks
//	k8s-firewall-ui lint --cluster policies/  # + what changes on the live cluster
//
// Offline checks look at each policy (and each namespace's set) on its own.
// With a cluster snapshot the manifests are overlaid on the live state and
// the report shows only findings the change introduces, plus the workload
// connections that become blocked or allowed.
package lint

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"

	networkingv1 "k8s.io/api/networking/v1"
	"sigs.k8s.io/yaml"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

// Source locates a policy in the input.
type Source struct {
	File string `json:"file"`
	Line int    `json:"line"`
}

// Doc is one parsed NetworkPolicy with its location.
type Doc struct {
	Policy *networkingv1.NetworkPolicy
	Source Source
}

// Finding is one lint result.
type Finding struct {
	Code     string  `json:"code"`
	Severity string  `json:"severity"` // critical | warning | info
	Policy   string  `json:"policy,omitempty"`
	Message  string  `json:"message"`
	Source   *Source `json:"source,omitempty"`
}

// Report is the lint outcome.
type Report struct {
	Policies int                     `json:"policies"`
	Findings []Finding               `json:"findings"`
	Impact   *simulator.ImpactResult `json:"impact,omitempty"`
	Parse    []string                `json:"parseErrors,omitempty"`
	Skipped  int                     `json:"skippedDocuments"`
	Cluster  bool                    `json:"cluster"`
}

// --- input ---

// Load reads NetworkPolicies from files, directories (recursively, *.yaml,
// *.yml, *.json) or "-" for stdin. Documents of other kinds are skipped.
func Load(paths []string, stdin io.Reader) ([]Doc, int, []string, error) {
	var docs []Doc
	var skipped int
	var errs []string
	for _, p := range paths {
		if p == "-" {
			d, s, e := parseStream("<stdin>", stdin)
			docs, skipped, errs = append(docs, d...), skipped+s, append(errs, e...)
			continue
		}
		info, err := os.Stat(p)
		if err != nil {
			return nil, 0, nil, err
		}
		var files []string
		if info.IsDir() {
			err := filepath.WalkDir(p, func(path string, d os.DirEntry, err error) error {
				if err != nil {
					return err
				}
				switch strings.ToLower(filepath.Ext(path)) {
				case ".yaml", ".yml", ".json":
					if !d.IsDir() {
						files = append(files, path)
					}
				}
				return nil
			})
			if err != nil {
				return nil, 0, nil, err
			}
			sort.Strings(files)
		} else {
			files = []string{p}
		}
		for _, f := range files {
			fh, err := os.Open(f)
			if err != nil {
				return nil, 0, nil, err
			}
			d, s, e := parseStream(f, fh)
			_ = fh.Close()
			docs, skipped, errs = append(docs, d...), skipped+s, append(errs, e...)
		}
	}
	return docs, skipped, errs, nil
}

// parseStream splits a multi-document YAML stream on "---" lines, keeping
// each document's first line number.
func parseStream(name string, r io.Reader) ([]Doc, int, []string) {
	var docs []Doc
	var errs []string
	skipped := 0
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	var buf bytes.Buffer
	start, line := 1, 0
	flush := func() {
		body := bytes.TrimSpace(buf.Bytes())
		buf.Reset()
		if len(body) == 0 {
			return
		}
		d, s, err := decode(body, Source{File: name, Line: start})
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s:%d: %v", name, start, err))
		}
		docs, skipped = append(docs, d...), skipped+s
	}
	for sc.Scan() {
		line++
		text := sc.Text()
		if strings.HasPrefix(text, "---") {
			flush()
			start = line + 1
			continue
		}
		if buf.Len() == 0 && strings.TrimSpace(text) == "" {
			start = line + 1
		}
		buf.WriteString(text)
		buf.WriteByte('\n')
	}
	flush()
	if err := sc.Err(); err != nil {
		errs = append(errs, fmt.Sprintf("%s: %v", name, err))
	}
	return docs, skipped, errs
}

func decode(body []byte, src Source) ([]Doc, int, error) {
	var probe struct {
		Kind  string            `json:"kind"`
		Items []json.RawMessage `json:"items"`
	}
	if err := yaml.Unmarshal(body, &probe); err != nil {
		return nil, 0, err
	}
	switch {
	case strings.HasSuffix(probe.Kind, "List"):
		var docs []Doc
		skipped := 0
		for _, item := range probe.Items {
			d, s, err := decode(item, src)
			if err != nil {
				return docs, skipped, err
			}
			docs, skipped = append(docs, d...), skipped+s
		}
		return docs, skipped, nil
	case probe.Kind == "":
		return nil, 0, nil // comments only, or not a Kubernetes object
	case probe.Kind != "NetworkPolicy":
		return nil, 1, nil
	}
	var pol networkingv1.NetworkPolicy
	if err := yaml.UnmarshalStrict(body, &pol); err != nil {
		return nil, 0, err
	}
	return []Doc{{Policy: &pol, Source: src}}, 0, nil
}

// --- offline checks ---

func ref(p *networkingv1.NetworkPolicy) string {
	ns := p.Namespace
	if ns == "" {
		ns = "<default>"
	}
	return ns + "/" + p.Name
}

// Static runs the checks that need no cluster.
func Static(docs []Doc) []Finding {
	var out []Finding
	add := func(d Doc, code, sev, msg string) {
		src := d.Source
		out = append(out, Finding{Code: code, Severity: sev, Policy: ref(d.Policy), Message: msg, Source: &src})
	}
	seen := map[string]Source{}
	for _, d := range docs {
		p := d.Policy
		if p.Name == "" {
			add(d, "MISSING_NAME", simulator.SeverityCritical, "metadata.name is required.")
		}
		if p.Namespace == "" {
			add(d, "MISSING_NAMESPACE", simulator.SeverityWarning, "metadata.namespace is not set: the policy lands in whatever namespace the applying tool defaults to.")
		}
		if prev, dup := seen[ref(p)]; dup && p.Name != "" {
			add(d, "DUPLICATE_POLICY", simulator.SeverityCritical, fmt.Sprintf("Also defined at %s:%d; the later document silently wins.", prev.File, prev.Line))
		}
		seen[ref(p)] = d.Source
		if len(p.Spec.PolicyTypes) == 0 {
			add(d, "MISSING_POLICY_TYPES", simulator.SeverityWarning,
				"spec.policyTypes is not set: it defaults to Ingress (plus Egress only if egress rules exist), which is rarely what a default-deny intends. Set it explicitly.")
		}
		types := simulator.NormalizePolicy(p).Spec.PolicyTypes
		has := func(t networkingv1.PolicyType) bool {
			for _, x := range types {
				if x == t {
					return true
				}
			}
			return false
		}
		if has(networkingv1.PolicyTypeIngress) {
			for i, r := range p.Spec.Ingress {
				checkRule(d, add, "ingress", i, r.From, len(r.Ports))
			}
		}
		if has(networkingv1.PolicyTypeEgress) {
			for i, r := range p.Spec.Egress {
				checkRule(d, add, "egress", i, r.To, len(r.Ports))
			}
		} else if len(p.Spec.Egress) > 0 {
			add(d, "IGNORED_EGRESS_RULES", simulator.SeverityWarning, "Egress rules are present but policyTypes does not include Egress, so they are ignored.")
		}
	}
	out = append(out, dnsChecks(docs)...)
	return out
}

func checkRule(d Doc, add func(Doc, string, string, string), dir string, i int, peers []networkingv1.NetworkPolicyPeer, ports int) {
	where := fmt.Sprintf("%s rule #%d", dir, i+1)
	if len(peers) == 0 && ports == 0 {
		sev := simulator.SeverityWarning
		if dir == "egress" {
			sev = simulator.SeverityInfo
		}
		add(d, "ALLOW_ALL_"+strings.ToUpper(dir), sev, fmt.Sprintf("%s has no peers and no ports: it allows all %s traffic for the selected pods.", where, dir))
	}
	for j, peer := range peers {
		pw := fmt.Sprintf("%s, peer #%d", where, j+1)
		if peer.IPBlock == nil && peer.PodSelector == nil && peer.NamespaceSelector == nil {
			add(d, "EMPTY_PEER", simulator.SeverityCritical, pw+" sets no selector or ipBlock; the API server rejects it.")
			continue
		}
		if peer.IPBlock == nil {
			continue
		}
		if peer.PodSelector != nil || peer.NamespaceSelector != nil {
			add(d, "IPBLOCK_WITH_SELECTOR", simulator.SeverityCritical, pw+" mixes ipBlock with selectors; the API server rejects it.")
		}
		_, cidr, err := net.ParseCIDR(peer.IPBlock.CIDR)
		if err != nil {
			add(d, "INVALID_CIDR", simulator.SeverityCritical, fmt.Sprintf("%s: %q is not a valid CIDR.", pw, peer.IPBlock.CIDR))
			continue
		}
		for _, ex := range peer.IPBlock.Except {
			exIP, exNet, err := net.ParseCIDR(ex)
			exOnes, _ := func() (int, int) {
				if exNet == nil {
					return 0, 0
				}
				return exNet.Mask.Size()
			}()
			ones, _ := cidr.Mask.Size()
			if err != nil || !cidr.Contains(exIP) || exOnes <= ones {
				add(d, "INVALID_EXCEPT", simulator.SeverityCritical, fmt.Sprintf("%s: except %q must be a strict subset of %s.", pw, ex, peer.IPBlock.CIDR))
			}
		}
		if (peer.IPBlock.CIDR == "0.0.0.0/0" || peer.IPBlock.CIDR == "::/0") && len(peer.IPBlock.Except) == 0 {
			sev := simulator.SeverityInfo
			if dir == "ingress" {
				sev = simulator.SeverityWarning
			}
			add(d, "IPBLOCK_ANY", sev, pw+" allows every address ("+peer.IPBlock.CIDR+"). Many CNIs also match pod IPs with ipBlock, so this can open in-cluster traffic too.")
		}
	}
}

// dnsChecks warns per namespace when the manifests isolate egress but none
// of them allows port 53 (a common way to break DNS).
func dnsChecks(docs []Doc) []Finding {
	type nsState struct {
		isolating []Doc
		dns       bool
	}
	byNS := map[string]*nsState{}
	for _, d := range docs {
		ns := d.Policy.Namespace
		st := byNS[ns]
		if st == nil {
			st = &nsState{}
			byNS[ns] = st
		}
		p := simulator.NormalizePolicy(d.Policy)
		egress := false
		for _, t := range p.Spec.PolicyTypes {
			egress = egress || t == networkingv1.PolicyTypeEgress
		}
		if !egress {
			continue
		}
		st.isolating = append(st.isolating, d)
		for _, r := range p.Spec.Egress {
			if len(r.Ports) == 0 {
				st.dns = true
			}
			for _, port := range r.Ports {
				if port.Port == nil || (port.Port.IntVal == 53) || (port.EndPort != nil && port.Port.IntVal <= 53 && *port.EndPort >= 53) {
					st.dns = true
				}
			}
		}
	}
	var out []Finding
	namespaces := make([]string, 0, len(byNS))
	for ns := range byNS {
		namespaces = append(namespaces, ns)
	}
	sort.Strings(namespaces)
	for _, ns := range namespaces {
		st := byNS[ns]
		if len(st.isolating) == 0 || st.dns {
			continue
		}
		d := st.isolating[0]
		src := d.Source
		out = append(out, Finding{
			Code: "DNS_EGRESS_BLOCKED", Severity: simulator.SeverityWarning, Policy: ref(d.Policy), Source: &src,
			Message: "These manifests isolate egress in this namespace but none allows port 53: DNS breaks unless another policy on the cluster allows it. Add an egress rule for UDP/TCP 53 to kube-dns.",
		})
	}
	return out
}

// --- cluster overlay ---

// Overlay applies the manifests to a live snapshot and reports findings the
// change introduces plus the connection-level impact. defaultNS fills in
// policies without a namespace.
func Overlay(snap *simulator.Snapshot, docs []Doc, defaultNS string) ([]Finding, simulator.ImpactResult) {
	var changes []simulator.PolicyChange
	srcByRef := map[string]Source{}
	for _, d := range docs {
		p := d.Policy.DeepCopy()
		if p.Namespace == "" {
			p.Namespace = defaultNS
		}
		changes = append(changes, simulator.PolicyChange{Namespace: p.Namespace, Name: p.Name, Proposed: p})
		srcByRef[p.Namespace+"/"+p.Name] = d.Source
	}
	before := simulator.Analyze(snap)
	after := simulator.Analyze(simulator.ApplyChanges(snap, changes))
	key := func(f simulator.Finding) string {
		p := ""
		if f.Policy != nil {
			p = f.Policy.Namespace + "/" + f.Policy.Name
		}
		return f.Code + "|" + f.Namespace + "|" + p + "|" + f.Message
	}
	existing := map[string]bool{}
	for _, f := range before.Findings {
		existing[key(f)] = true
	}
	var out []Finding
	for _, f := range after.Findings {
		if existing[key(f)] {
			continue
		}
		lf := Finding{Code: f.Code, Severity: f.Severity, Message: f.Message}
		if f.Policy != nil {
			lf.Policy = f.Policy.Namespace + "/" + f.Policy.Name
			if src, ok := srcByRef[lf.Policy]; ok {
				s := src
				lf.Source = &s
			}
		} else if f.Namespace != "" {
			lf.Policy = f.Namespace + "/*"
		}
		out = append(out, lf)
	}
	return out, simulator.ImpactMany(snap, changes)
}

// --- output ---

var severityRank = map[string]int{simulator.SeverityCritical: 3, simulator.SeverityWarning: 2, simulator.SeverityInfo: 1}

// Fails reports whether any finding reaches the threshold severity
// ("none" never fails).
func Fails(findings []Finding, threshold string) bool {
	limit, ok := severityRank[threshold]
	if !ok {
		return false
	}
	for _, f := range findings {
		if severityRank[f.Severity] >= limit {
			return true
		}
	}
	return false
}

// Sort orders findings by severity, then location.
func Sort(fs []Finding) {
	sort.SliceStable(fs, func(i, j int) bool {
		a, b := fs[i], fs[j]
		if severityRank[a.Severity] != severityRank[b.Severity] {
			return severityRank[a.Severity] > severityRank[b.Severity]
		}
		return a.Policy < b.Policy
	})
}

// WriteText prints a human-readable report.
func WriteText(w io.Writer, r Report) {
	for _, e := range r.Parse {
		_, _ = fmt.Fprintf(w, "error: %s\n", e)
	}
	for _, f := range r.Findings {
		loc := ""
		if f.Source != nil {
			loc = fmt.Sprintf("%s:%d: ", f.Source.File, f.Source.Line)
		}
		_, _ = fmt.Fprintf(w, "%s%-8s %s %s: %s\n", loc, strings.ToUpper(f.Severity), f.Code, f.Policy, f.Message)
	}
	if r.Impact != nil {
		_, _ = fmt.Fprintf(w, "\nImpact on the live cluster: %d connection(s) become blocked, %d become allowed.\n",
			len(r.Impact.NewlyBlocked), len(r.Impact.NewlyAllowed))
		for _, e := range r.Impact.NewlyBlocked {
			_, _ = fmt.Fprintf(w, "  - blocked: %s -> %s\n", e.Source, e.Target)
		}
		for _, e := range r.Impact.NewlyAllowed {
			_, _ = fmt.Fprintf(w, "  + allowed: %s -> %s\n", e.Source, e.Target)
		}
	}
	writeSummary(w, r)
}

func writeSummary(w io.Writer, r Report) {
	counts := map[string]int{}
	for _, f := range r.Findings {
		counts[f.Severity]++
	}
	_, _ = fmt.Fprintf(w, "\n%d NetworkPolic%s checked (%d other document(s) skipped): %d critical, %d warning, %d info.\n",
		r.Policies, map[bool]string{true: "y", false: "ies"}[r.Policies == 1], r.Skipped,
		counts[simulator.SeverityCritical], counts[simulator.SeverityWarning], counts[simulator.SeverityInfo])
}

// WriteGitHub prints GitHub Actions workflow commands so findings appear as
// annotations on the pull request diff.
func WriteGitHub(w io.Writer, r Report) {
	level := map[string]string{simulator.SeverityCritical: "error", simulator.SeverityWarning: "warning", simulator.SeverityInfo: "notice"}
	esc := strings.NewReplacer("%", "%25", "\r", "%0D", "\n", "%0A")
	for _, e := range r.Parse {
		_, _ = fmt.Fprintf(w, "::error title=parse error::%s\n", esc.Replace(e))
	}
	prop := strings.NewReplacer("%", "%25", "\r", "%0D", "\n", "%0A", ":", "%3A", ",", "%2C")
	for _, f := range r.Findings {
		params := []string{}
		if f.Source != nil {
			params = append(params, "file="+prop.Replace(f.Source.File), fmt.Sprintf("line=%d", f.Source.Line))
		}
		params = append(params, "title="+prop.Replace(f.Code+" "+f.Policy))
		_, _ = fmt.Fprintf(w, "::%s %s::%s\n", level[f.Severity], strings.Join(params, ","), esc.Replace(f.Message))
	}
	if r.Impact != nil {
		_, _ = fmt.Fprintf(w, "::notice title=impact::%d connection(s) become blocked, %d become allowed on the live cluster\n",
			len(r.Impact.NewlyBlocked), len(r.Impact.NewlyAllowed))
	}
	writeSummary(w, r)
}
