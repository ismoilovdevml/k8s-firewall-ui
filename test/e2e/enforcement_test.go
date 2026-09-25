//go:build e2e

// Package e2e cross-checks the simulator against real NetworkPolicy
// enforcement: for every pair of sample workloads it asks the simulator for a
// verdict, then actually connects from one pod to the other and compares.
//
// Requires a cluster with an enforcing CNI and the sample app applied:
//
//	kubectl apply -f hack/e2e/workloads.yaml -f hack/e2e/policies.yaml
//	KUBECONFIG=... go test -tags e2e ./test/e2e/ -v
package e2e

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

var sampleNamespaces = map[string]bool{
	"shop": true, "payments": true, "analytics": true, "ingress-nginx": true, "monitoring": true,
}

type probe struct {
	src, dst simulator.Workload
	port     kube.ContainerPort
	want     bool
	got      bool
	output   string
}

func TestSimulatorMatchesEnforcement(t *testing.T) {
	cs, cfg, err := kube.NewClientset("")
	if err != nil {
		t.Fatalf("kubeconfig: %v", err)
	}
	store, err := kube.NewStore(cs)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if err := store.Start(ctx); err != nil {
		t.Fatal(err)
	}
	snap, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}

	workloads := simulator.Workloads(snap, sampleNamespaces)
	if len(workloads) < 5 {
		t.Fatalf("found %d sample workloads — apply hack/e2e/workloads.yaml first", len(workloads))
	}

	var probes []*probe
	for _, src := range workloads {
		for _, dst := range workloads {
			if src.ID == dst.ID || len(dst.Rep.Ports) == 0 {
				continue
			}
			for _, port := range dst.Rep.Ports {
				res, err := simulator.Evaluate(snap, simulator.Input{
					Source:      simulator.Endpoint{Kind: "pod", Namespace: src.Rep.Namespace, Name: src.Rep.Name},
					Destination: simulator.Endpoint{Kind: "pod", Namespace: dst.Rep.Namespace, Name: dst.Rep.Name},
					Port:        &simulator.PortQuery{Protocol: "TCP", Port: port.Port},
				})
				if err != nil {
					t.Fatal(err)
				}
				probes = append(probes, &probe{src: src, dst: dst, port: port, want: res.Allowed})
			}
		}
	}

	runParallel(probes, 12, func(p *probe) {
		cmd := []string{"wget", "-qO-", "-T", "3", fmt.Sprintf("http://%s:%d/", p.dst.Rep.IP, p.port.Port)}
		p.output, p.got = exec(ctx, cs, cfg, p.src.Rep, cmd)
	})

	mismatches := 0
	allowed := 0
	for _, p := range probes {
		if p.got {
			allowed++
		}
		if p.got != p.want {
			mismatches++
			t.Errorf("%s -> %s:%d (%s): simulator allowed=%v, cluster allowed=%v (%s)",
				p.src.ID, p.dst.ID, p.port.Port, p.port.Name, p.want, p.got, strings.TrimSpace(p.output))
		}
	}
	t.Logf("%d connections probed (%d allowed, %d blocked), %d mismatches",
		len(probes), allowed, len(probes)-allowed, mismatches)
}

// TestDNSTrapMatchesEnforcement checks the DNS_EGRESS_BLOCKED prediction:
// pods the simulator says cannot reach kube-dns on UDP/53 must fail lookups.
func TestDNSTrapMatchesEnforcement(t *testing.T) {
	cs, cfg, err := kube.NewClientset("")
	if err != nil {
		t.Fatal(err)
	}
	store, _ := kube.NewStore(cs)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if err := store.Start(ctx); err != nil {
		t.Fatal(err)
	}
	snap, _ := store.Snapshot()

	var dns *kube.PodInfo
	for i, p := range snap.Pods {
		if p.Namespace == "kube-system" && p.Labels["k8s-app"] == "kube-dns" {
			dns = &snap.Pods[i]
		}
	}
	if dns == nil {
		t.Skip("no kube-dns pod found")
	}

	var probes []*probe
	for _, wl := range simulator.Workloads(snap, sampleNamespaces) {
		res, err := simulator.Evaluate(snap, simulator.Input{
			Source:      simulator.Endpoint{Kind: "pod", Namespace: wl.Rep.Namespace, Name: wl.Rep.Name},
			Destination: simulator.Endpoint{Kind: "pod", Namespace: dns.Namespace, Name: dns.Name},
			Port:        &simulator.PortQuery{Protocol: "UDP", Port: 53},
		})
		if err != nil {
			t.Fatal(err)
		}
		probes = append(probes, &probe{src: wl, want: res.Allowed})
	}
	runParallel(probes, 12, func(p *probe) {
		p.output, p.got = exec(ctx, cs, cfg, p.src.Rep,
			[]string{"timeout", "6", "nslookup", "kubernetes.default.svc.cluster.local", dns.IP})
	})
	for _, p := range probes {
		if p.got != p.want {
			t.Errorf("%s DNS: simulator allowed=%v, cluster allowed=%v (%s)", p.src.ID, p.want, p.got, strings.TrimSpace(p.output))
		}
	}
	t.Logf("%d DNS lookups probed", len(probes))
}

func runParallel(probes []*probe, n int, fn func(*probe)) {
	sem := make(chan struct{}, n)
	var wg sync.WaitGroup
	for _, p := range probes {
		wg.Add(1)
		sem <- struct{}{}
		go func(p *probe) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(p)
		}(p)
	}
	wg.Wait()
}

// exec runs cmd in the pod's first container; success = exit code 0.
func exec(ctx context.Context, cs kubernetes.Interface, cfg *rest.Config, pod kube.PodInfo, cmd []string) (string, bool) {
	req := cs.CoreV1().RESTClient().Post().Resource("pods").Namespace(pod.Namespace).Name(pod.Name).
		SubResource("exec").VersionedParams(&corev1.PodExecOptions{
		Command: cmd, Stdout: true, Stderr: true,
	}, scheme.ParameterCodec)
	ex, err := remotecommand.NewSPDYExecutor(cfg, "POST", req.URL())
	if err != nil {
		return err.Error(), false
	}
	var out bytes.Buffer
	err = ex.StreamWithContext(ctx, remotecommand.StreamOptions{Stdout: &out, Stderr: &out})
	if err != nil {
		return out.String() + " " + err.Error(), false
	}
	return out.String(), true
}
