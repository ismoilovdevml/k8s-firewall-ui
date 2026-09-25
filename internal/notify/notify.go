// Package notify forwards audit entries to a webhook (Slack-compatible
// incoming webhooks, Teams/Mattermost via their Slack-compatible endpoints,
// or any JSON consumer such as a SIEM). Delivery is asynchronous, bounded
// and retried; it never slows down or fails the user's request.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/audit"
)

// Format selects the payload shape.
type Format string

// Supported formats.
const (
	FormatJSON  Format = "json"  // the audit entry as JSON
	FormatSlack Format = "slack" // {"text": "..."} for Slack-compatible webhooks
)

// ParseFormat validates a --notify-format value.
func ParseFormat(s string) (Format, error) {
	switch f := Format(s); f {
	case FormatJSON, FormatSlack:
		return f, nil
	}
	return "", fmt.Errorf("unknown notify format %q (want json or slack)", s)
}

// Webhook delivers entries to one URL.
type Webhook struct {
	url     string
	format  Format
	client  *http.Client
	logger  *slog.Logger
	queue   chan audit.Entry
	retries int
	backoff time.Duration

	wg       sync.WaitGroup
	stopOnce sync.Once
}

// NewWebhook starts a delivery worker. Call Close to drain it on shutdown.
func NewWebhook(url string, format Format, logger *slog.Logger) *Webhook {
	w := &Webhook{
		url: url, format: format, logger: logger,
		client:  &http.Client{Timeout: 5 * time.Second},
		queue:   make(chan audit.Entry, 256),
		retries: 3,
		backoff: time.Second,
	}
	w.wg.Add(1)
	go w.run()
	return w
}

// Send enqueues e; when the queue is full the entry is dropped and logged
// (the structured audit log remains the durable record).
func (w *Webhook) Send(e audit.Entry) {
	select {
	case w.queue <- e:
	default:
		w.logger.Warn("notification queue full; dropping", "id", e.ID)
	}
}

// Close stops accepting entries and waits (bounded by ctx) for the queue
// to drain.
func (w *Webhook) Close(ctx context.Context) {
	w.stopOnce.Do(func() { close(w.queue) })
	done := make(chan struct{})
	go func() { w.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

func (w *Webhook) run() {
	defer w.wg.Done()
	for e := range w.queue {
		body, err := w.payload(e)
		if err != nil {
			w.logger.Error("notification encode failed", "error", err)
			continue
		}
		w.deliver(e.ID, body)
	}
}

func (w *Webhook) deliver(id int64, body []byte) {
	delay := w.backoff
	for attempt := 1; ; attempt++ {
		err := w.post(body)
		if err == nil {
			return
		}
		if attempt >= w.retries || !retryable(err) {
			w.logger.Warn("notification failed", "id", id, "attempts", attempt, "error", err)
			return
		}
		time.Sleep(delay)
		delay *= 2
	}
}

type statusError int

func (s statusError) Error() string { return fmt.Sprintf("webhook answered HTTP %d", int(s)) }

// retryable: network errors, 429 and 5xx are retried; other 4xx are not.
func retryable(err error) bool {
	if code, ok := err.(statusError); ok {
		return code == http.StatusTooManyRequests || code >= 500
	}
	return true
}

func (w *Webhook) post(body []byte) error {
	req, err := http.NewRequest(http.MethodPost, w.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "k8s-firewall-ui")
	res, err := w.client.Do(req)
	if err != nil {
		return err
	}
	_ = res.Body.Close()
	if res.StatusCode >= 300 {
		return statusError(res.StatusCode)
	}
	return nil
}

func (w *Webhook) payload(e audit.Entry) ([]byte, error) {
	if w.format == FormatSlack {
		return json.Marshal(map[string]string{"text": SlackText(e)})
	}
	return json.Marshal(map[string]any{"type": "networkpolicy." + e.Action, "entry": e})
}

var pastTense = map[string]string{"create": "created", "update": "updated", "delete": "deleted"}

// SlackText renders a one-line human summary of an audit entry.
func SlackText(e audit.Entry) string {
	verb := pastTense[e.Action]
	if verb == "" {
		verb = e.Action
	}
	who := e.User
	if who == "" {
		who = "someone"
	}
	if e.Result == audit.ResultFailure {
		return fmt.Sprintf(":warning: *%s* failed to %s NetworkPolicy `%s/%s`: %s", who, e.Action, e.Namespace, e.Name, e.Error)
	}
	return fmt.Sprintf(":shield: *%s* %s NetworkPolicy `%s/%s`", who, verb, e.Namespace, e.Name)
}
