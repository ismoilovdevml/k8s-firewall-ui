package api

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/simulator"
)

// Metrics holds the Prometheus collectors exposed on /metrics.
type Metrics struct {
	registry  *prometheus.Registry
	requests  *prometheus.CounterVec
	latency   *prometheus.HistogramVec
	mutations *prometheus.CounterVec
	sse       prometheus.Gauge
	// cache is shared with the API server so scrapes and page loads reuse
	// the same posture analysis.
	cache *resultCache
}

// NewMetrics registers process, Go, HTTP, mutation and cluster collectors.
// Cluster gauges are computed from the informer cache at scrape time.
func NewMetrics(store Store) *Metrics {
	reg := prometheus.NewRegistry()
	m := &Metrics{
		registry: reg,
		cache:    newResultCache(32),
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "fwui_http_requests_total", Help: "HTTP requests by method, route and status code.",
		}, []string{"method", "route", "code"}),
		latency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name: "fwui_http_request_duration_seconds", Help: "HTTP request latency by route.",
			Buckets: prometheus.DefBuckets,
		}, []string{"method", "route"}),
		mutations: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "fwui_policy_mutations_total", Help: "NetworkPolicy changes made through the UI (dry-runs excluded).",
		}, []string{"action", "result"}),
		sse: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "fwui_sse_clients", Help: "Connected Server-Sent Events clients.",
		}),
	}
	reg.MustRegister(m.requests, m.latency, m.mutations, m.sse,
		collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	if store != nil {
		reg.MustRegister(&clusterCollector{store: store, cache: m.cache})
	}
	return m
}

// Handler serves the registry in the Prometheus exposition format.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

func (m *Metrics) observeRequest(method, route, code string, d time.Duration) {
	m.requests.WithLabelValues(method, route, code).Inc()
	m.latency.WithLabelValues(method, route).Observe(d.Seconds())
}

func (m *Metrics) observeMutation(action, result string) {
	m.mutations.WithLabelValues(action, result).Inc()
}

var (
	descPolicies = prometheus.NewDesc("fwui_networkpolicies", "NetworkPolicies in the cluster.", nil, nil)
	descPods     = prometheus.NewDesc("fwui_pods", "Application pods (non-system, non-hostNetwork).", nil, nil)
	descIsolated = prometheus.NewDesc("fwui_pods_isolated", "Application pods isolated per direction.", []string{"direction"}, nil)
	descScore    = prometheus.NewDesc("fwui_posture_score", "Policy posture score (0-100).", nil, nil)
	descFindings = prometheus.NewDesc("fwui_posture_findings", "Posture findings by severity.", []string{"severity"}, nil)
	descSynced   = prometheus.NewDesc("fwui_informers_synced", "1 when informer caches have synced.", nil, nil)
)

// clusterCollector derives posture gauges from a fresh snapshot per scrape.
type clusterCollector struct {
	store Store
	cache *resultCache
}

func (c *clusterCollector) Describe(ch chan<- *prometheus.Desc) {
	for _, d := range []*prometheus.Desc{descPolicies, descPods, descIsolated, descScore, descFindings, descSynced} {
		ch <- d
	}
}

func (c *clusterCollector) Collect(ch chan<- prometheus.Metric) {
	synced := 0.0
	if c.store.Synced() {
		synced = 1
	}
	ch <- prometheus.MustNewConstMetric(descSynced, prometheus.GaugeValue, synced)
	if synced == 0 {
		return
	}
	gen := c.store.Generation() // before the snapshot; see view.gen
	snap, err := c.store.Snapshot()
	if err != nil {
		return
	}
	r := c.cache.get(gen, "posture", func() any { return simulator.Analyze(snap) }).(simulator.PostureReport)
	s := r.Summary
	ch <- prometheus.MustNewConstMetric(descPolicies, prometheus.GaugeValue, float64(s.Policies))
	ch <- prometheus.MustNewConstMetric(descPods, prometheus.GaugeValue, float64(s.Pods))
	ch <- prometheus.MustNewConstMetric(descIsolated, prometheus.GaugeValue, float64(s.IngressIsolatedPods), "ingress")
	ch <- prometheus.MustNewConstMetric(descIsolated, prometheus.GaugeValue, float64(s.EgressIsolatedPods), "egress")
	ch <- prometheus.MustNewConstMetric(descScore, prometheus.GaugeValue, float64(s.Score))
	ch <- prometheus.MustNewConstMetric(descFindings, prometheus.GaugeValue, float64(s.Critical), simulator.SeverityCritical)
	ch <- prometheus.MustNewConstMetric(descFindings, prometheus.GaugeValue, float64(s.Warnings), simulator.SeverityWarning)
	ch <- prometheus.MustNewConstMetric(descFindings, prometheus.GaugeValue, float64(s.Info), simulator.SeverityInfo)
}
