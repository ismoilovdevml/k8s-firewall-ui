package flows

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
