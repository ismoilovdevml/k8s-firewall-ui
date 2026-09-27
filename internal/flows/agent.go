package flows

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"time"
)

// AgentConfig configures the per-node collector loop.
type AgentConfig struct {
	Server   string        // base URL of the k8s-firewall-ui server
	Token    string        // shared ingest token
	Node     string        // node name (from the downward API)
	Interval time.Duration // collection period
	Client   *http.Client
	Logger   *slog.Logger
	// Collect is the flow source; defaults to the conntrack collector.
	Collect func() ([]Flow, error)
	// Fanout resolves the server host every round and uploads to each of
	// its addresses (a headless Service), so every server replica sees
	// all flows. The client's TLS ServerName should then be set.
	Fanout bool
	// Resolve looks up the server host's addresses; defaults to DNS.
	Resolve func(ctx context.Context, host string) ([]string, error)
}

// IngestPath is the server endpoint agents post to.
const IngestPath = "/api/v1/flows/ingest"

// RunAgent collects and uploads flows every Interval until ctx ends.
func RunAgent(ctx context.Context, cfg AgentConfig) error {
	if cfg.Interval <= 0 {
		cfg.Interval = 10 * time.Second
	}
	if cfg.Client == nil {
		cfg.Client = &http.Client{Timeout: 10 * time.Second}
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Collect == nil {
		cfg.Collect = Collect
	}
	if cfg.Resolve == nil {
		cfg.Resolve = net.DefaultResolver.LookupHost
	}
	tick := time.NewTicker(cfg.Interval)
	defer tick.Stop()
	for {
		if err := uploadOnce(ctx, cfg); err != nil {
			cfg.Logger.Warn("flow upload failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
	}
}

func uploadOnce(ctx context.Context, cfg AgentConfig) error {
	flows, err := cfg.Collect()
	if err != nil {
		return fmt.Errorf("collecting conntrack: %w", err)
	}
	body, err := json.Marshal(Report{Node: cfg.Node, Flows: flows})
	if err != nil {
		return err
	}
	targets, err := targets(ctx, cfg)
	if err != nil {
		return err
	}
	var errs []error
	for _, target := range targets {
		if err := post(ctx, cfg, target, body); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", target, err))
		}
	}
	if err := errors.Join(errs...); err != nil {
		return err
	}
	cfg.Logger.Debug("uploaded flows", "count", len(flows), "servers", len(targets))
	return nil
}

// targets returns the server base URLs to upload to: the configured one, or
// with Fanout one per resolved address of its host.
func targets(ctx context.Context, cfg AgentConfig) ([]string, error) {
	if !cfg.Fanout {
		return []string{cfg.Server}, nil
	}
	u, err := url.Parse(cfg.Server)
	if err != nil {
		return nil, err
	}
	addrs, err := cfg.Resolve(ctx, u.Hostname())
	if err != nil {
		return nil, fmt.Errorf("resolving %s: %w", u.Hostname(), err)
	}
	out := make([]string, 0, len(addrs))
	for _, a := range addrs {
		t := *u
		t.Host = net.JoinHostPort(a, u.Port())
		if u.Port() == "" {
			t.Host = a
			if net.ParseIP(a).To4() == nil {
				t.Host = "[" + a + "]"
			}
		}
		out = append(out, t.String())
	}
	return out, nil
}

func post(ctx context.Context, cfg AgentConfig, server string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server+IngestPath, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("X-Requested-With", "k8s-firewall-ui-agent")
	res, err := cfg.Client.Do(req)
	if err != nil {
		return err
	}
	_ = res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("server answered HTTP %d", res.StatusCode)
	}
	return nil
}
