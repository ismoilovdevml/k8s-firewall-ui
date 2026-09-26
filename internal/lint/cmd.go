package lint

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

// SnapshotLoader fetches the live cluster state for --cluster.
type SnapshotLoader func(ctx context.Context, kubeconfig string) (*simulator.Snapshot, error)

// Main runs `k8s-firewall-ui lint`; it returns the process exit code
// (0 clean, 1 findings at or above --fail-on, 2 usage or input errors).
func Main(args []string, stdin io.Reader, stdout, stderr io.Writer, load SnapshotLoader) int {
	fs := flag.NewFlagSet("lint", flag.ContinueOnError)
	fs.SetOutput(stderr)
	format := fs.String("format", "text", "output: text | json | github (pull request annotations)")
	failOn := fs.String("fail-on", "warning", "exit 1 when a finding reaches this severity: critical | warning | info | none")
	cluster := fs.Bool("cluster", false, "also overlay the manifests on the live cluster (current kubeconfig) and report new findings and connection impact")
	kubeconfig := fs.String("kubeconfig", "", "kubeconfig for --cluster")
	namespace := fs.String("namespace", "default", "namespace for manifests without metadata.namespace (--cluster)")
	fs.Usage = func() {
		_, _ = fmt.Fprintln(stderr, "Usage: k8s-firewall-ui lint [flags] PATH... (files, directories, or - for stdin)")
		fs.PrintDefaults()
	}
	// Accept flags before and after paths (`lint dir/ --format github`).
	var paths []string
	for rest := args; ; {
		if err := fs.Parse(rest); err != nil {
			return 2
		}
		if fs.NArg() == 0 {
			break
		}
		paths = append(paths, fs.Arg(0))
		rest = fs.Args()[1:]
	}
	if len(paths) == 0 {
		fs.Usage()
		return 2
	}
	switch *failOn {
	case "critical", "warning", "info", "none":
	default:
		_, _ = fmt.Fprintf(stderr, "invalid --fail-on %q\n", *failOn)
		return 2
	}

	docs, skipped, parseErrs, err := Load(paths, stdin)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "error:", err)
		return 2
	}
	report := Report{Policies: len(docs), Skipped: skipped, Parse: parseErrs, Findings: Static(docs)}
	if *cluster {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		snap, err := load(ctx, *kubeconfig)
		if err != nil {
			_, _ = fmt.Fprintln(stderr, "error: loading cluster state:", err)
			return 2
		}
		found, impact := Overlay(snap, docs, *namespace)
		report.Findings = append(report.Findings, found...)
		report.Impact = &impact
		report.Cluster = true
	}
	if report.Findings == nil {
		report.Findings = []Finding{}
	}
	Sort(report.Findings)

	switch *format {
	case "json":
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(report)
	case "github":
		WriteGitHub(stdout, report)
	default:
		WriteText(stdout, report)
	}
	if len(parseErrs) > 0 {
		return 2
	}
	if Fails(report.Findings, *failOn) {
		return 1
	}
	return 0
}
