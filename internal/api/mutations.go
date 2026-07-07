package api

import (
	"bytes"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"
)

const maxBodySize = 1 << 20 // 1 MiB — a NetworkPolicy is tiny; reject anything bigger

// decodePolicy reads a YAML or JSON NetworkPolicy from the request body.
func decodePolicy(r *http.Request) (*networkingv1.NetworkPolicy, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodySize))
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return nil, errors.New("request body is empty — send a NetworkPolicy as YAML or JSON")
	}
	var pol networkingv1.NetworkPolicy
	// sigs.k8s.io/yaml accepts JSON too (YAML superset); UnmarshalStrict
	// rejects unknown fields, catching typos like "ingres:".
	if err := yaml.UnmarshalStrict(body, &pol); err != nil {
		return nil, err
	}
	return &pol, nil
}

func dryRunOptions(r *http.Request) []string {
	if r.URL.Query().Get("dryRun") == "true" {
		return []string{metav1.DryRunAll}
	}
	return nil
}

// writeK8sError maps a Kubernetes API error onto the API error shape,
// preserving the status code (404, 409, 422, ...).
func writeK8sError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	code := "K8S_ERROR"
	if statusErr, ok := err.(*apierrors.StatusError); ok {
		if s := int(statusErr.ErrStatus.Code); s > 0 {
			status = s
		}
		if reason := string(statusErr.ErrStatus.Reason); reason != "" {
			code = reason
		}
	}
	writeError(w, status, code, err.Error())
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

	created, err := s.clientset.NetworkingV1().NetworkPolicies(ns).Create(r.Context(), pol,
		metav1.CreateOptions{DryRun: dryRunOptions(r)})
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
	updated, err := s.clientset.NetworkingV1().NetworkPolicies(ns).Update(r.Context(), pol,
		metav1.UpdateOptions{DryRun: dryRunOptions(r)})
	if err != nil {
		writeK8sError(w, err)
		return
	}
	updated.ManagedFields = nil
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handlePolicyDelete(w http.ResponseWriter, r *http.Request) {
	ns, name := chi.URLParam(r, "ns"), chi.URLParam(r, "name")
	err := s.clientset.NetworkingV1().NetworkPolicies(ns).Delete(r.Context(), name, metav1.DeleteOptions{})
	if err != nil {
		writeK8sError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
