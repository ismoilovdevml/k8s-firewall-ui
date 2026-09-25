package api

import (
	"bytes"
	"errors"
	"io"
	"net"
	"net/http"

	"github.com/go-chi/chi/v5"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/yaml"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/audit"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/auth"
)

const maxBodySize = 1 << 20 // 1 MiB — a NetworkPolicy is tiny; reject anything bigger

// decodePolicyBytes parses a YAML or JSON NetworkPolicy. sigs.k8s.io/yaml
// accepts JSON too (YAML superset); UnmarshalStrict rejects unknown fields,
// catching typos like "ingres:".
func decodePolicyBytes(body []byte) (*networkingv1.NetworkPolicy, error) {
	if len(bytes.TrimSpace(body)) == 0 {
		return nil, errors.New("request body is empty — send a NetworkPolicy as YAML or JSON")
	}
	var pol networkingv1.NetworkPolicy
	if err := yaml.UnmarshalStrict(body, &pol); err != nil {
		return nil, err
	}
	if pol.Kind != "" && pol.Kind != "NetworkPolicy" {
		return nil, errors.New("expected kind NetworkPolicy, got " + pol.Kind)
	}
	return &pol, nil
}

// decodePolicy reads a YAML or JSON NetworkPolicy from the request body.
func decodePolicy(r *http.Request) (*networkingv1.NetworkPolicy, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		return nil, err
	}
	return decodePolicyBytes(body)
}

func isDryRun(r *http.Request) bool { return r.URL.Query().Get("dryRun") == "true" }

func dryRunOptions(r *http.Request) []string {
	if isDryRun(r) {
		return []string{metav1.DryRunAll}
	}
	return nil
}

// writeK8sError maps a Kubernetes API error onto the API error shape,
// preserving the status code (401, 403, 404, 409, 422, ...).
func writeK8sError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	code := "K8S_ERROR"
	var statusErr *apierrors.StatusError
	if errors.As(err, &statusErr) {
		if s := int(statusErr.ErrStatus.Code); s > 0 {
			status = s
		}
		if reason := string(statusErr.ErrStatus.Reason); reason != "" {
			code = reason
		}
	}
	writeError(w, status, code, err.Error())
}

// userClient returns the Kubernetes client acting as the request's user.
func (s *Server) userClient(w http.ResponseWriter, r *http.Request) (kubernetes.Interface, bool) {
	cs, err := s.auth.ClientFor(r.Context())
	if err != nil {
		writeK8sError(w, err)
		return nil, false
	}
	return cs, true
}

// cachedPolicy returns the informer-cache copy of a policy, or nil.
func (s *Server) cachedPolicy(ns, name string) *networkingv1.NetworkPolicy {
	snap, err := s.store.Snapshot()
	if err != nil {
		return nil
	}
	for _, pol := range snap.Policies {
		if pol.Namespace == ns && pol.Name == name {
			return pol
		}
	}
	return nil
}

// recordAudit logs a non-dry-run mutation to the audit log and metrics.
func (s *Server) recordAudit(r *http.Request, action, ns, name string, before, after *networkingv1.NetworkPolicy, err error) {
	e := audit.Entry{
		Action: action, Namespace: ns, Name: name, Result: audit.ResultSuccess,
		Before: policyYAML(before), After: policyYAML(after),
	}
	if u := auth.UserFrom(r.Context()); u != nil {
		e.User, e.Groups = u.Name, u.Groups
	}
	if host, _, splitErr := net.SplitHostPort(r.RemoteAddr); splitErr == nil {
		e.SourceIP = host
	}
	if err != nil {
		e.Result, e.Error, e.After = audit.ResultFailure, err.Error(), ""
	}
	s.audit.Record(e)
	s.metrics.observeMutation(action, e.Result)
}

func policyYAML(pol *networkingv1.NetworkPolicy) string {
	if pol == nil {
		return ""
	}
	out, err := yaml.Marshal(exportable(pol))
	if err != nil {
		return ""
	}
	return string(out)
}

func (s *Server) handlePolicyCreate(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	pol, err := decodePolicy(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_POLICY", err.Error())
		return
	}
	if pol.Namespace != "" && pol.Namespace != ns {
		writeError(w, http.StatusBadRequest, "NAMESPACE_MISMATCH",
			"policy namespace "+pol.Namespace+" does not match URL namespace "+ns)
		return
	}
	pol.Namespace = ns
	cs, ok := s.userClient(w, r)
	if !ok {
		return
	}

	created, err := cs.NetworkingV1().NetworkPolicies(ns).Create(r.Context(), pol,
		metav1.CreateOptions{DryRun: dryRunOptions(r), FieldManager: fieldManager})
	if !isDryRun(r) {
		s.recordAudit(r, "create", ns, pol.Name, nil, created, err)
	}
	if err != nil {
		writeK8sError(w, err)
		return
	}
	created.ManagedFields = nil
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handlePolicyUpdate(w http.ResponseWriter, r *http.Request) {
	ns, name := chi.URLParam(r, "ns"), chi.URLParam(r, "name")
	pol, err := decodePolicy(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_POLICY", err.Error())
		return
	}
	if (pol.Name != "" && pol.Name != name) || (pol.Namespace != "" && pol.Namespace != ns) {
		writeError(w, http.StatusBadRequest, "IDENTITY_MISMATCH",
			"policy metadata does not match URL "+ns+"/"+name)
		return
	}
	pol.Namespace, pol.Name = ns, name

	// Without a resourceVersion Kubernetes performs an unconditional
	// overwrite; require it so concurrent edits surface as 409s instead of
	// silently clobbering each other.
	if pol.ResourceVersion == "" {
		writeError(w, http.StatusBadRequest, "RESOURCE_VERSION_REQUIRED",
			"metadata.resourceVersion is required for updates (reload the policy and try again)")
		return
	}
	cs, ok := s.userClient(w, r)
	if !ok {
		return
	}
	before := s.cachedPolicy(ns, name)
	updated, err := cs.NetworkingV1().NetworkPolicies(ns).Update(r.Context(), pol,
		metav1.UpdateOptions{DryRun: dryRunOptions(r), FieldManager: fieldManager})
	if !isDryRun(r) {
		s.recordAudit(r, "update", ns, name, before, updated, err)
	}
	if err != nil {
		writeK8sError(w, err)
		return
	}
	updated.ManagedFields = nil
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handlePolicyDelete(w http.ResponseWriter, r *http.Request) {
	ns, name := chi.URLParam(r, "ns"), chi.URLParam(r, "name")
	cs, ok := s.userClient(w, r)
	if !ok {
		return
	}
	before := s.cachedPolicy(ns, name)
	err := cs.NetworkingV1().NetworkPolicies(ns).Delete(r.Context(), name, metav1.DeleteOptions{DryRun: dryRunOptions(r)})
	if !isDryRun(r) {
		s.recordAudit(r, "delete", ns, name, before, nil, err)
	}
	if err != nil {
		writeK8sError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// fieldManager attributes UI writes in managedFields.
const fieldManager = "k8s-firewall-ui"
