package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

const heartbeatInterval = 25 * time.Second

// sseHub fans informer change events out to connected browsers.
type sseHub struct {
	mu      sync.Mutex
	clients map[chan kube.Event]struct{}
	done    chan struct{}
	once    sync.Once
	metrics *Metrics
}

func newSSEHub(m *Metrics) *sseHub {
	return &sseHub{clients: map[chan kube.Event]struct{}{}, done: make(chan struct{}), metrics: m}
}

// close ends every open stream (graceful shutdown).
func (h *sseHub) close() { h.once.Do(func() { close(h.done) }) }

// run consumes the store's event stream for the lifetime of the process.
func (h *sseHub) run(events <-chan kube.Event) {
	for ev := range events {
		h.mu.Lock()
		for ch := range h.clients {
			select {
			case ch <- ev:
			default: // slow client: drop the event, it refetches on the next one
			}
		}
		h.mu.Unlock()
	}
}

func (h *sseHub) subscribe() (chan kube.Event, func()) {
	ch := make(chan kube.Event, 8)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	if h.metrics != nil {
		h.metrics.sse.Inc()
	}
	return ch, func() {
		h.mu.Lock()
		delete(h.clients, ch)
		h.mu.Unlock()
		if h.metrics != nil {
			h.metrics.sse.Dec()
		}
	}
}

func (h *sseHub) serveHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "SSE_UNSUPPORTED", "response writer does not support streaming")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx ingress buffering
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ch, cancel := h.subscribe()
	defer cancel()

	heartbeat := time.NewTicker(heartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-h.done:
			return
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		case ev := <-ch:
			payload, _ := json.Marshal(ev)
			_, _ = fmt.Fprintf(w, "event: invalidate\ndata: %s\n\n", payload)
			flusher.Flush()
		}
	}
}
