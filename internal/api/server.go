// Package api exposes the REST + SSE surface consumed by the web UI.
package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"k8s.io/client-go/kubernetes"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/audit"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/auth"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/cni"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// Store is the read side of the informer cache.
type Store interface {
	Snapshot() (*kube.ClusterSnapshot, error)
	Synced() bool
	Events() <-chan kube.Event
	// Generation changes whenever the cached cluster state changes.
	Generation() uint64
}

// Options configures a Server.
type Options struct {
	Store      Store
	Clientset  kubernetes.Interface
	CNI        cni.Result
	K8sVersion string
	ReadOnly   bool
	Auth       *auth.Authenticator
	Audit      *audit.Log
	Logger     *slog.Logger
	Metrics    *Metrics
}

// Server wires the informer store, kubernetes client, and SSE hub.
type Server struct {
	store      Store
	clientset  kubernetes.Interface
	cniResult  cni.Result
	k8sVersion string
	readOnly   bool
	auth       *auth.Authenticator
	audit      *audit.Log
	log        *slog.Logger
	metrics    *Metrics
	hub        *sseHub
	cache      *resultCache
}

// NewServer constructs the API server; the SSE hub goroutine starts
// immediately and runs until Close.
func NewServer(o Options) *Server {
	if o.Logger == nil {
		o.Logger = slog.Default()
	}
	if o.Audit == nil {
		o.Audit = audit.New(1000, o.Logger)
	}
	if o.Metrics == nil {
		o.Metrics = NewMetrics(o.Store)
	}
	if o.Auth == nil {
		a, err := auth.New(auth.Config{Mode: auth.ModeNone, Clientset: o.Clientset})
		if err != nil {
			panic(err) // mode none cannot fail
		}
		o.Auth = a
	}
	s := &Server{
		store:      o.Store,
		clientset:  o.Clientset,
		cniResult:  o.CNI,
		k8sVersion: o.K8sVersion,
		readOnly:   o.ReadOnly,
		auth:       o.Auth,
		audit:      o.Audit,
		log:        o.Logger,
		metrics:    o.Metrics,
		hub:        newSSEHub(o.Metrics),
		cache:      o.Metrics.cache,
	}
	go s.hub.run(o.Store.Events())
	return s
}

// Close disconnects SSE clients so graceful shutdown does not wait on them.
func (s *Server) Close() { s.hub.close() }

// guardWrites returns 403 for every request when the server runs read-only.
func (s *Server) guardWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.readOnly {
			writeError(w, http.StatusForbidden, "READ_ONLY",
				"this instance runs in read-only mode; policy changes are disabled")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Routes registers all API routes on r.
func (s *Server) Routes(r chi.Router) {
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	r.Get("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		if !s.store.Synced() {
			http.Error(w, "informer caches not synced", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("ok"))
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(requireCSRFHeader)

		// Public: the UI needs these to decide whether to show the login page.
		r.Get("/auth/me", s.auth.HandleMe)
		r.Post("/auth/login", s.auth.HandleLogin)
		r.Post("/auth/logout", s.auth.HandleLogout)

		r.Group(func(r chi.Router) {
			r.Use(s.auth.Require)
			r.Get("/auth/permissions", s.handlePermissions)
			r.Get("/cluster-info", s.handleClusterInfo)
			r.Get("/namespaces", s.handleNamespaces)
			r.Get("/namespaces/{ns}/pods", s.handleNamespacePods)
			r.Get("/namespaces/{ns}/isolation", s.handleNamespaceIsolation)
			r.Get("/pods", s.handlePods)
			r.Get("/networkpolicies", s.handlePolicyList)
			r.Get("/networkpolicies/export", s.handleExport)
			r.Get("/namespaces/{ns}/networkpolicies/{name}", s.handlePolicyGet)
			r.Group(func(r chi.Router) {
				r.Use(s.guardWrites)
				r.Post("/namespaces/{ns}/networkpolicies", s.handlePolicyCreate)
				r.Put("/namespaces/{ns}/networkpolicies/{name}", s.handlePolicyUpdate)
				r.Delete("/namespaces/{ns}/networkpolicies/{name}", s.handlePolicyDelete)
				r.Post("/networkpolicies/import", s.handleImport)
			})
			r.Post("/simulate", s.handleSimulate)
			r.Post("/impact", s.handleImpact)
			r.Get("/posture", s.handlePosture)
			r.Get("/topology", s.handleTopology)
			r.Get("/audit", s.handleAudit)
			r.Get("/events", s.hub.serveHTTP)
		})
	})
}

// --- shared helpers ---

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: message}})
}

func (s *Server) snapshot(w http.ResponseWriter) (*kube.ClusterSnapshot, bool) {
	snap, err := s.store.Snapshot()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "SNAPSHOT_FAILED", err.Error())
		return nil, false
	}
	return snap, true
}
