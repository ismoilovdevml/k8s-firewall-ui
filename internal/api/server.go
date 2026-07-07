// Package api exposes the REST + SSE surface consumed by the web UI.
package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"k8s.io/client-go/kubernetes"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/cni"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// Server wires the informer store, kubernetes client, and SSE hub.
type Server struct {
	store      *kube.Store
	clientset  kubernetes.Interface
	cniResult  cni.Result
	k8sVersion string
	hub        *sseHub
}

// NewServer constructs the API server. Call Run on the returned hub context
// via Router; the SSE hub goroutine starts immediately.
func NewServer(store *kube.Store, clientset kubernetes.Interface, cniResult cni.Result, k8sVersion string) *Server {
	s := &Server{
		store:      store,
		clientset:  clientset,
		cniResult:  cniResult,
		k8sVersion: k8sVersion,
		hub:        newSSEHub(),
	}
	go s.hub.run(store.Events())
	return s
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
		r.Get("/cluster-info", s.handleClusterInfo)
		r.Get("/namespaces", s.handleNamespaces)
		r.Get("/namespaces/{ns}/pods", s.handleNamespacePods)
		r.Get("/pods", s.handlePods)
		r.Get("/networkpolicies", s.handlePolicyList)
		r.Get("/namespaces/{ns}/networkpolicies/{name}", s.handlePolicyGet)
		r.Post("/namespaces/{ns}/networkpolicies", s.handlePolicyCreate)
		r.Put("/namespaces/{ns}/networkpolicies/{name}", s.handlePolicyUpdate)
		r.Delete("/namespaces/{ns}/networkpolicies/{name}", s.handlePolicyDelete)
		r.Post("/simulate", s.handleSimulate)
		r.Get("/topology", s.handleTopology)
		r.Get("/events", s.hub.serveHTTP)
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
