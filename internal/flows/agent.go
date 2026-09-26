package flows

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
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
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.Server+IngestPath, bytes.NewReader(body))
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
	cfg.Logger.Debug("uploaded flows", "count", len(flows))
	return nil
}
