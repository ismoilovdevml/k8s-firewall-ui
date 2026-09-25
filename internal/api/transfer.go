package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/equality"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	utilyaml "k8s.io/apimachinery/pkg/util/yaml"
	"sigs.k8s.io/yaml"
)

const (
	maxImportBytes    = 5 << 20
	maxImportPolicies = 500
	lastAppliedAnno   = "kubectl.kubernetes.io/last-applied-configuration"
)

// exportable strips server-populated metadata so the object can be
// re-applied to any cluster (GitOps-ready).
func exportable(pol *networkingv1.NetworkPolicy) *networkingv1.NetworkPolicy {
	out := &networkingv1.NetworkPolicy{
		TypeMeta: metav1.TypeMeta{APIVersion: "networking.k8s.io/v1", Kind: "NetworkPolicy"},
		ObjectMeta: metav1.ObjectMeta{
			Name: pol.Name, Namespace: pol.Namespace, Labels: pol.Labels,
		},
		Spec: *pol.Spec.DeepCopy(),
	}
	for k, v := range pol.Annotations {
		if k == lastAppliedAnno {
			continue
		}
		if out.Annotations == nil {
			out.Annotations = map[string]string{}
		}
		out.Annotations[k] = v
	}
	return out
}

// handleExport streams all (or one namespace's) policies as a multi-document
// YAML file.
func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	snap, ok := s.snapshot(w)
	if !ok {
		return
	}
	ns := r.URL.Query().Get("namespace")
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "# NetworkPolicies exported by k8s-firewall-ui at %s\n", time.Now().UTC().Format(time.RFC3339))
	n := 0
	for _, pol := range snap.Policies {
		if ns != "" && pol.Namespace != ns {
			continue
		}
		out, err := yaml.Marshal(exportable(pol))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "YAML_MARSHAL_FAILED", err.Error())
			return
		}
		buf.WriteString("---\n")
		buf.Write(out)
		n++
	}
	filename := "networkpolicies.yaml"
	if ns != "" {
		filename = "networkpolicies-" + ns + ".yaml"
	}
	w.Header().Set("Content-Type", "application/yaml")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("X-Policy-Count", fmt.Sprint(n))
	_, _ = w.Write(buf.Bytes())
}

// ImportResult is the outcome for one document of an import.
type ImportResult struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Action    string `json:"action"` // created | updated | unchanged | error
	Error     string `json:"error,omitempty"`
}

// splitPolicies parses a multi-document YAML/JSON stream of NetworkPolicy
// objects (a List or NetworkPolicyList is flattened).
func splitPolicies(body []byte) ([]*networkingv1.NetworkPolicy, error) {
	dec := utilyaml.NewYAMLOrJSONDecoder(bytes.NewReader(body), 4096)
	var out []*networkingv1.NetworkPolicy
	for i := 1; ; i++ {
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, fmt.Errorf("document %d: %w", i, err)
		}
		if len(bytes.TrimSpace(raw)) == 0 || string(raw) == "null" {
			continue
		}
		var probe struct {
			Kind  string            `json:"kind"`
			Items []json.RawMessage `json:"items"`
		}
		if err := json.Unmarshal(raw, &probe); err != nil {
			return nil, fmt.Errorf("document %d: %w", i, err)
		}
		docs := []json.RawMessage{raw}
		if strings.HasSuffix(probe.Kind, "List") {
			docs = probe.Items
		}
		for _, doc := range docs {
			pol, err := decodePolicyBytes(doc)
			if err != nil {
				return nil, fmt.Errorf("document %d: %w", i, err)
			}
			if pol.Name == "" {
				return nil, fmt.Errorf("document %d: metadata.name is required", i)
			}
			out = append(out, pol)
		}
		if len(out) > maxImportPolicies {
			return nil, fmt.Errorf("too many policies (max %d per import)", maxImportPolicies)
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no NetworkPolicy documents found")
	}
	return out, nil
}

// handleImport creates or updates every policy in a multi-document YAML
// body. ?namespace= fills in documents without one; ?dryRun=true validates
// everything server-side without persisting.
func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxImportBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", err.Error())
		return
	}
	if len(body) > maxImportBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "TOO_LARGE", "import body exceeds 5 MiB")
		return
	}
	pols, err := splitPolicies(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_POLICY", err.Error())
		return
	}
	defaultNS := r.URL.Query().Get("namespace")
	for _, pol := range pols {
		if pol.Namespace == "" {
			if defaultNS == "" {
				writeError(w, http.StatusBadRequest, "NAMESPACE_REQUIRED",
					"policy "+pol.Name+" has no metadata.namespace — set one or pass ?namespace=")
				return
			}
			pol.Namespace = defaultNS
		}
	}
	cs, ok := s.userClient(w, r)
	if !ok {
		return
	}

	dry := dryRunOptions(r)
	results := make([]ImportResult, 0, len(pols))
	summary := map[string]int{}
	for _, pol := range pols {
		res := ImportResult{Namespace: pol.Namespace, Name: pol.Name}
		client := cs.NetworkingV1().NetworkPolicies(pol.Namespace)
		pol.ResourceVersion, pol.UID = "", ""
		existing, err := client.Get(r.Context(), pol.Name, metav1.GetOptions{})
		switch {
		case apierrors.IsNotFound(err):
			var created *networkingv1.NetworkPolicy
			created, err = client.Create(r.Context(), pol, metav1.CreateOptions{DryRun: dry, FieldManager: fieldManager})
			res.Action = "created"
			if dry == nil {
				s.recordAudit(r, "create", pol.Namespace, pol.Name, nil, created, err)
			}
		case err != nil:
		case equality.Semantic.DeepEqual(existing.Spec, pol.Spec) &&
			equality.Semantic.DeepEqual(existing.Labels, pol.Labels) &&
			annotationsEqual(existing.Annotations, pol.Annotations):
			res.Action = "unchanged"
		default:
			pol.ResourceVersion = existing.ResourceVersion
			var updated *networkingv1.NetworkPolicy
			updated, err = client.Update(r.Context(), pol, metav1.UpdateOptions{DryRun: dry, FieldManager: fieldManager})
			res.Action = "updated"
			if dry == nil {
				s.recordAudit(r, "update", pol.Namespace, pol.Name, existing, updated, err)
			}
		}
		if err != nil {
			res.Action, res.Error = "error", err.Error()
		}
		summary[res.Action]++
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"dryRun": dry != nil, "summary": summary, "results": results})
}

func annotationsEqual(a, b map[string]string) bool {
	strip := func(m map[string]string) map[string]string {
		out := map[string]string{}
		for k, v := range m {
			if k != lastAppliedAnno {
				out[k] = v
			}
		}
		return out
	}
	return equality.Semantic.DeepEqual(strip(a), strip(b))
}
