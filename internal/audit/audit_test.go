package audit

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"
)

func TestRingAndFilter(t *testing.T) {
	var buf bytes.Buffer
	l := New(3, slog.New(slog.NewJSONHandler(&buf, nil)))
	for i, ns := range []string{"a", "b", "a", "c"} {
		l.Record(Entry{User: "u", Action: "create", Namespace: ns, Name: string(rune('p' + i)), Result: ResultSuccess})
	}

	all := l.List(Filter{})
	if len(all) != 3 {
		t.Fatalf("len = %d, want ring size 3", len(all))
	}
	if all[0].ID != 4 || all[2].ID != 2 {
		t.Fatalf("order = %d..%d, want newest first 4..2", all[0].ID, all[2].ID)
	}

	cases := []struct {
		name string
		f    Filter
		want int
	}{
		{"namespace", Filter{Namespace: "a"}, 1},
		{"action miss", Filter{Action: "delete"}, 0},
		{"query", Filter{Query: "c/"}, 1},
		{"limit", Filter{Limit: 2}, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := len(l.List(tc.f)); got != tc.want {
				t.Fatalf("len = %d, want %d", got, tc.want)
			}
		})
	}

	// Every record is also a structured log line.
	lines := bytes.Split(bytes.TrimSpace(buf.Bytes()), []byte("\n"))
	if len(lines) != 4 {
		t.Fatalf("log lines = %d", len(lines))
	}
	var rec map[string]any
	if err := json.Unmarshal(lines[0], &rec); err != nil || rec["audit"] != true || rec["namespace"] != "a" {
		t.Fatalf("log line = %s (%v)", lines[0], err)
	}
}

func TestRecordTruncatesLargeYAML(t *testing.T) {
	l := New(2, slog.New(slog.NewTextHandler(io.Discard, nil)))
	big := strings.Repeat("x", 1<<20)
	e := l.Record(Entry{Action: "update", Before: big, After: "small"})
	if len(e.Before) > maxYAMLBytes+200 || !strings.Contains(e.Before, "truncated") {
		t.Fatalf("Before not truncated: %d bytes", len(e.Before))
	}
	if e.After != "small" {
		t.Fatalf("small YAML must be kept verbatim")
	}
}
