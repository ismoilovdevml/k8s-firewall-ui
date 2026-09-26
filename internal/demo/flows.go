package demo

import (
	"context"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/flows"
)

// Flows is synthetic observed traffic for the sample cluster, as node agents
// would report it. payments-api → ledger-db was observed before the
// ledger-db policy with the label typo went in, so it shows as blocked now.
func Flows(ctx context.Context, cs kubernetes.Interface) ([]flows.Flow, error) {
	pods, err := cs.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	ips := map[string][]string{} // "ns/owner" -> pod IPs
	for _, p := range pods.Items {
		owner := p.Name[:strings.Index(p.Name, "-7d9f8c")]
		ips[p.Namespace+"/"+owner] = append(ips[p.Namespace+"/"+owner], p.Status.PodIP)
	}
	const dnsService = "10.96.0.10"
	var out []flows.Flow
	link := func(from, to string, port uint16, proto string) {
		for _, s := range ips[from] {
			for _, d := range ips[to] {
				f := flows.Flow{Protocol: proto, Src: s, Dst: d, DstPort: port}
				if to == "kube-system/coredns" {
					f.ServiceIP, f.ServicePort = dnsService, port
				}
				out = append(out, f)
			}
		}
	}
	external := func(from, ip string, port uint16) {
		for _, s := range ips[from] {
			out = append(out, flows.Flow{Protocol: "TCP", Src: s, Dst: ip, DstPort: port})
		}
	}
	link("ingress-nginx/ingress-nginx-controller", "shop/frontend", 8080, "TCP")
	link("shop/frontend", "shop/cart", 8080, "TCP")
	link("shop/frontend", "shop/catalog", 8080, "TCP")
	link("shop/cart", "shop/redis", 6379, "TCP")
	link("monitoring/prometheus", "shop/frontend", 9100, "TCP")
	link("payments/payments-api", "payments/ledger-db", 5432, "TCP")
	link("shop/cart", "payments/payments-api", 8443, "TCP")
	link("analytics/collector", "analytics/dashboard", 3000, "TCP")
	for _, w := range []string{"shop/frontend", "shop/cart", "shop/catalog", "payments/payments-api", "analytics/collector"} {
		link(w, "kube-system/coredns", 53, "UDP")
	}
	external("payments/payments-api", "203.0.113.10", 443) // card processor
	external("analytics/collector", "198.51.100.7", 443)   // SaaS metrics endpoint
	return out, nil
}

// FeedFlows ingests the synthetic traffic now and then every interval until
// ctx ends, so the demo looks like a live cluster with two node agents.
func FeedFlows(ctx context.Context, cs kubernetes.Interface, store *flows.Store, interval time.Duration) error {
	fl, err := Flows(ctx, cs)
	if err != nil {
		return err
	}
	feed := func() {
		store.Ingest(flows.Report{Node: "node-1", Flows: fl[:len(fl)/2]})
		store.Ingest(flows.Report{Node: "node-2", Flows: fl[len(fl)/2:]})
	}
	feed()
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				feed()
			}
		}
	}()
	return nil
}
