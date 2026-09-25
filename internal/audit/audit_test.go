package audit

import (
	"bytes"
	"encoding/json"
	"log/slog"
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
