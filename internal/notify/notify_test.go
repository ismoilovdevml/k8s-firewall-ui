package notify

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/audit"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestWebhookDeliveryFormatsAndRetries(t *testing.T) {
	var (
		mu     sync.Mutex
		bodies []map[string]any
		calls  int
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		if calls == 1 { // first attempt fails transiently
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		bodies = append(bodies, body)
	}))
	defer srv.Close()

	for _, tc := range []struct {
		format Format
		key    string
	}{{FormatSlack, "text"}, {FormatJSON, "entry"}} {
		mu.Lock()
		calls, bodies = 0, nil
		mu.Unlock()
		wh := NewWebhook(srv.URL, tc.format, quiet())
		wh.backoff = time.Millisecond
		wh.Send(audit.Entry{ID: 1, User: "alice", Action: "create", Namespace: "shop", Name: "deny", Result: audit.ResultSuccess})
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		wh.Close(ctx)
		cancel()
		mu.Lock()
		if calls != 2 || len(bodies) != 1 || bodies[0][tc.key] == nil {
			t.Errorf("%s: calls=%d bodies=%v", tc.format, calls, bodies)
		}
		mu.Unlock()
	}
}

func TestNoRetryOnClientError(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	wh := NewWebhook(srv.URL, FormatJSON, quiet())
	wh.backoff = time.Millisecond
	wh.Send(audit.Entry{ID: 1})
	wh.Close(context.Background())
	if calls != 1 {
		t.Fatalf("calls = %d, want no retry on 400", calls)
	}
}

func TestSlackText(t *testing.T) {
	cases := []struct {
		e    audit.Entry
		want string
	}{
		{audit.Entry{User: "bob", Action: "delete", Namespace: "a", Name: "p", Result: audit.ResultSuccess},
			":shield: *bob* deleted NetworkPolicy `a/p`"},
		{audit.Entry{User: "bob", Action: "update", Namespace: "a", Name: "p", Result: audit.ResultFailure, Error: "forbidden"},
			":warning: *bob* failed to update NetworkPolicy `a/p`: forbidden"},
	}
	for _, tc := range cases {
		if got := SlackText(tc.e); got != tc.want {
			t.Errorf("SlackText = %q, want %q", got, tc.want)
		}
	}
}
