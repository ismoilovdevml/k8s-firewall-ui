package flows

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestStoreMergesAndExpires(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	s := NewStore(2, time.Hour)
	s.now = func() time.Time { return now }

	a := Flow{Protocol: "TCP", Src: "10.0.0.1", Dst: "10.0.0.2", DstPort: 80}
	s.Ingest(Report{Node: "n1", Flows: []Flow{a}})
	now = now.Add(time.Minute)
	s.Ingest(Report{Node: "n2", Flows: []Flow{a}})

	all := s.All()
	if len(all) != 1 || all[0].Samples != 2 || len(all[0].Nodes) != 2 {
		t.Fatalf("merge: got %+v", all)
	}
	if !all[0].FirstSeen.Before(all[0].LastSeen) {
		t.Errorf("first/last seen not tracked: %+v", all[0])
	}

	// Bounded: a third distinct flow evicts the least recently seen one.
	b := Flow{Protocol: "UDP", Src: "10.0.0.1", Dst: "10.0.0.3", DstPort: 53}
	c := Flow{Protocol: "TCP", Src: "10.0.0.4", Dst: "10.0.0.2", DstPort: 80}
	now = now.Add(time.Minute)
	s.Ingest(Report{Node: "n1", Flows: []Flow{b}})
	now = now.Add(time.Minute)
	s.Ingest(Report{Node: "n1", Flows: []Flow{c}})
	if got := s.All(); len(got) != 2 || got[0].key() != c.key() || got[1].key() != b.key() {
		t.Fatalf("eviction: got %+v", got)
	}

	// Expired flows and agents disappear.
	now = now.Add(2 * time.Hour)
	if got := s.All(); len(got) != 0 {
		t.Fatalf("expiry: got %+v", got)
	}
	if got := s.Agents(); len(got) != 0 {
		t.Fatalf("agents not expired: %+v", got)
	}
}

func TestAgentUploads(t *testing.T) {
	got := make(chan Report, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != IngestPath || r.Header.Get("Authorization") != "Bearer secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var rep Report
		_ = json.NewDecoder(r.Body).Decode(&rep)
		select {
		case got <- rep:
		default:
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	flow := Flow{Protocol: "TCP", Src: "10.0.0.1", Dst: "10.0.0.2", DstPort: 443}
	go func() {
		_ = RunAgent(ctx, AgentConfig{Server: srv.URL, Token: "secret", Node: "n1", Interval: time.Hour,
			Collect: func() ([]Flow, error) { return []Flow{flow}, nil }})
	}()
	select {
	case rep := <-got:
		if rep.Node != "n1" || len(rep.Flows) != 1 || rep.Flows[0] != flow {
			t.Fatalf("unexpected report %+v", rep)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("agent never uploaded")
	}
}

func TestAgentFanoutReachesEveryReplica(t *testing.T) {
	hits := make(chan string, 4)
	handler := func(name string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits <- name })
	}
	a, b := httptest.NewServer(handler("a")), httptest.NewServer(handler("b"))
	defer a.Close()
	defer b.Close()
	// Both test servers listen on 127.0.0.1 with different ports, so the
	// fake resolver returns host:port pairs via distinct "hosts".
	cfg := AgentConfig{Server: "http://replicas.example:1", Fanout: true,
		Resolve: func(context.Context, string) ([]string, error) { return []string{"127.0.0.1", "127.0.0.2"}, nil }}
	got, err := targets(context.Background(), cfg)
	if err != nil || len(got) != 2 || got[0] != "http://127.0.0.1:1" || got[1] != "http://127.0.0.2:1" {
		t.Fatalf("targets = %v, %v", got, err)
	}

	cfg.Resolve = func(context.Context, string) ([]string, error) { return []string{"127.0.0.1"}, nil }
	cfg.Collect = func() ([]Flow, error) { return nil, nil }
	cfg.Client, cfg.Logger = http.DefaultClient, slog.Default()
	for _, srv := range []*httptest.Server{a, b} {
		cfg.Server = "http://replicas.example:" + srv.URL[strings.LastIndex(srv.URL, ":")+1:]
		if err := uploadOnce(context.Background(), cfg); err != nil {
			t.Fatal(err)
		}
	}
	if first, second := <-hits, <-hits; first != "a" || second != "b" {
		t.Fatalf("hits = %s, %s", first, second)
	}
}

func TestStoreSurvivesRestart(t *testing.T) {
	path := t.TempDir() + "/flows.json.gz"
	now := time.Now()
	s := NewStore(0, time.Hour)
	s.now = func() time.Time { return now.Add(-2 * time.Hour) }
	s.Ingest(Report{Node: "old", Flows: []Flow{{Protocol: "TCP", Src: "10.0.0.9", Dst: "10.0.0.2", DstPort: 22}}})
	s.now = func() time.Time { return now }
	s.Ingest(Report{Node: "n1", Flows: []Flow{{Protocol: "TCP", Src: "10.0.0.1", Dst: "10.0.0.2", DstPort: 80, ServiceIP: "10.96.0.5", ServicePort: 80}}})
	if err := s.SaveFile(path); err != nil {
		t.Fatal(err)
	}

	restored := NewStore(0, time.Hour)
	n, err := restored.LoadFile(path)
	if err != nil || n != 1 {
		t.Fatalf("restored %d flows, err %v", n, err)
	}
	got := restored.All()[0]
	if got.ServiceIP != "10.96.0.5" || got.Samples != 1 || got.Nodes[0] != "n1" || len(restored.Agents()) != 1 {
		t.Fatalf("restored %+v, agents %v", got, restored.Agents())
	}

	if n, err := NewStore(0, time.Hour).LoadFile(path + ".missing"); n != 0 || err != nil {
		t.Fatalf("missing file: %d, %v", n, err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := restored.Persist(ctx, path+".2", time.Hour, slog.Default())
	cancel()
	<-done
	if n, err := NewStore(0, time.Hour).LoadFile(path + ".2"); n != 1 || err != nil {
		t.Fatalf("final save on shutdown: %d, %v", n, err)
	}
}
