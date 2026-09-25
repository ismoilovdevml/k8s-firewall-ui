// Package audit records every policy mutation made through the UI.
//
// Entries go to two sinks: a structured log line (the durable record —
// ship it with your cluster's log pipeline) and a bounded in-memory ring
// that powers the UI's audit page. In token and proxy auth modes the
// Kubernetes API audit log additionally records the real end user, because
// writes are made with the user's own credentials.
package audit

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// Result values.
const (
	ResultSuccess = "success"
	ResultFailure = "failure"
)

// Entry is one audited action.
type Entry struct {
	ID        int64     `json:"id"`
	Time      time.Time `json:"time"`
	User      string    `json:"user"`
	Groups    []string  `json:"groups,omitempty"`
	SourceIP  string    `json:"sourceIP,omitempty"`
	Action    string    `json:"action"` // create | update | delete
	Namespace string    `json:"namespace"`
	Name      string    `json:"name"`
	Result    string    `json:"result"`
	Error     string    `json:"error,omitempty"`
	// Before/After are the policy YAML around the change (empty when the
	// object did not exist on that side).
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`
}

// Log is a concurrency-safe audit recorder.
type Log struct {
	mu     sync.RWMutex
	ring   []Entry
	next   int
	full   bool
	seq    int64
	logger *slog.Logger
	sinks  []func(Entry)
}

// AddSink registers fn to receive every recorded entry (e.g. a webhook
// notifier). Sinks must not block. Register before serving traffic.
func (l *Log) AddSink(fn func(Entry)) { l.sinks = append(l.sinks, fn) }

// New creates a Log keeping the last size entries in memory.
func New(size int, logger *slog.Logger) *Log {
	if size <= 0 {
		size = 1000
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Log{ring: make([]Entry, size), logger: logger}
}

// maxYAMLBytes caps Before/After so the in-memory ring stays bounded even
// if someone applies oversized objects (real NetworkPolicies are ~1 KiB).
const maxYAMLBytes = 64 << 10

func truncate(s string) string {
	if len(s) <= maxYAMLBytes {
		return s
	}
	return s[:maxYAMLBytes] + "\n# … truncated by k8s-firewall-ui audit (object larger than 64 KiB)\n"
}

// Record stores e (assigning ID and Time) and emits a log line.
func (l *Log) Record(e Entry) Entry {
	e.Before, e.After = truncate(e.Before), truncate(e.After)
	l.mu.Lock()
	l.seq++
	e.ID = l.seq
	if e.Time.IsZero() {
		e.Time = time.Now().UTC()
	}
	l.ring[l.next] = e
	l.next = (l.next + 1) % len(l.ring)
	if l.next == 0 {
		l.full = true
	}
	l.mu.Unlock()

	level := slog.LevelInfo
	if e.Result == ResultFailure {
		level = slog.LevelWarn
	}
	l.logger.Log(context.Background(), level, "audit",
		"audit", true,
		"id", e.ID, "user", e.User, "groups", e.Groups, "sourceIP", e.SourceIP,
		"action", e.Action, "namespace", e.Namespace, "name", e.Name,
		"result", e.Result, "error", e.Error)
	for _, sink := range l.sinks {
		sink(e)
	}
	return e
}

// Filter narrows List results; zero values match everything.
type Filter struct {
	Namespace string
	User      string
	Action    string
	Query     string // substring of namespace/name
	Limit     int
}

// List returns matching entries, newest first.
func (l *Log) List(f Filter) []Entry {
	l.mu.RLock()
	defer l.mu.RUnlock()
	n := l.next
	if l.full {
		n = len(l.ring)
	}
	limit := f.Limit
	if limit <= 0 || limit > len(l.ring) {
		limit = len(l.ring)
	}
	out := []Entry{}
	for i := 0; i < n && len(out) < limit; i++ {
		idx := (l.next - 1 - i + len(l.ring)) % len(l.ring)
		e := l.ring[idx]
		if f.Namespace != "" && e.Namespace != f.Namespace {
			continue
		}
		if f.User != "" && e.User != f.User {
			continue
		}
		if f.Action != "" && e.Action != f.Action {
			continue
		}
		if f.Query != "" && !strings.Contains(e.Namespace+"/"+e.Name, f.Query) {
			continue
		}
		out = append(out, e)
	}
	return out
}
