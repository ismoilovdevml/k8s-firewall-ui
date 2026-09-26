// Package flows records connections actually observed on the nodes.
//
// A small agent (`k8s-firewall-ui agent`, one per node) reads the kernel's
// conntrack table over netlink and reports aggregated flows to the server.
// This works with any iptables/nftables-based data path (kube-router, Calico
// in iptables mode, flannel, AWS VPC CNI, …) and needs no CNI integration.
// Only connections that were established show up: packets a policy drops
// never create a confirmed conntrack entry.
package flows

import (
	"sort"
	"sync"
	"time"
)

// Flow is one observed connection shape: who talked to whom on which port.
// Dst is the real destination after DNAT (a Service's ClusterIP resolves to
// the backend pod); ServiceIP keeps the original destination when it differs.
type Flow struct {
	Protocol    string `json:"protocol"` // TCP | UDP | SCTP
	Src         string `json:"src"`
	Dst         string `json:"dst"`
	DstPort     uint16 `json:"dstPort"`
	ServiceIP   string `json:"serviceIP,omitempty"`
	ServicePort uint16 `json:"servicePort,omitempty"`
}

// Key identifies a flow independently of the ephemeral source port.
type Key struct {
	Protocol string
	Src, Dst string
	DstPort  uint16
}

func (f Flow) key() Key { return Key{f.Protocol, f.Src, f.Dst, f.DstPort} }

// Record is a flow with its observation history.
type Record struct {
	Flow
	FirstSeen time.Time `json:"firstSeen"`
	LastSeen  time.Time `json:"lastSeen"`
	// Samples counts collection rounds that saw the flow (a rough activity
	// measure, not a packet or byte count).
	Samples int      `json:"samples"`
	Nodes   []string `json:"nodes"`
}

// Report is one agent upload.
type Report struct {
	Node  string `json:"node"`
	Flows []Flow `json:"flows"`
}

// Store keeps recent flows in memory, bounded by size and age.
type Store struct {
	mu      sync.Mutex
	records map[Key]*Record
	max     int
	ttl     time.Duration
	now     func() time.Time
	agents  map[string]time.Time
}

// NewStore keeps at most max flows seen within ttl.
func NewStore(max int, ttl time.Duration) *Store {
	if max <= 0 {
		max = 50000
	}
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	return &Store{records: map[Key]*Record{}, max: max, ttl: ttl, now: time.Now, agents: map[string]time.Time{}}
}

// Ingest merges an agent report.
func (s *Store) Ingest(r Report) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agents[r.Node] = now
	for _, f := range r.Flows {
		k := f.key()
		rec, ok := s.records[k]
		if !ok {
			if len(s.records) >= s.max {
				s.evictOldestLocked()
			}
			rec = &Record{Flow: f, FirstSeen: now}
			s.records[k] = rec
		}
		rec.LastSeen = now
		rec.Samples++
		if f.ServiceIP != "" {
			rec.ServiceIP, rec.ServicePort = f.ServiceIP, f.ServicePort
		}
		if !contains(rec.Nodes, r.Node) {
			rec.Nodes = append(rec.Nodes, r.Node)
		}
	}
	s.pruneLocked(now)
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}

func (s *Store) evictOldestLocked() {
	var oldest Key
	var at time.Time
	first := true
	for k, r := range s.records {
		if first || r.LastSeen.Before(at) {
			oldest, at, first = k, r.LastSeen, false
		}
	}
	delete(s.records, oldest)
}

func (s *Store) pruneLocked(now time.Time) {
	for k, r := range s.records {
		if now.Sub(r.LastSeen) > s.ttl {
			delete(s.records, k)
		}
	}
	for n, t := range s.agents {
		if now.Sub(t) > s.ttl {
			delete(s.agents, n)
		}
	}
}

// All returns every stored flow, most recent first.
func (s *Store) All() []Record {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(s.now())
	out := make([]Record, 0, len(s.records))
	for _, r := range s.records {
		cp := *r
		cp.Nodes = append([]string(nil), r.Nodes...)
		out = append(out, cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastSeen.After(out[j].LastSeen) })
	return out
}

// Agents reports each node's last upload time.
func (s *Store) Agents() map[string]time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]time.Time, len(s.agents))
	for n, t := range s.agents {
		out[n] = t
	}
	return out
}
