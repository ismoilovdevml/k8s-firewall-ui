package demo

import (
	"context"
	"testing"
	"time"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/flows"
)

func TestDemoFlows(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cs := Clientset()
	fl, err := Flows(ctx, cs)
	if err != nil || len(fl) == 0 {
		t.Fatalf("no demo flows: %v", err)
	}
	var dns bool
	for _, f := range fl {
		if f.Src == "" || f.Dst == "" || f.DstPort == 0 {
			t.Fatalf("incomplete flow %+v", f)
		}
		dns = dns || (f.DstPort == 53 && f.ServiceIP != "")
	}
	if !dns {
		t.Error("DNS flows should carry the Service IP")
	}
	store := flows.NewStore(0, time.Hour)
	if err := FeedFlows(ctx, cs, store, time.Hour); err != nil {
		t.Fatal(err)
	}
	if len(store.Agents()) != 2 || len(store.All()) != len(fl) {
		t.Fatalf("feed: %d agents, %d flows", len(store.Agents()), len(store.All()))
	}
}
