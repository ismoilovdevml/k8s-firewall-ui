package simulator

import (
	networkingv1 "k8s.io/api/networking/v1"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// Index precomputes, for every pod, the policies selecting it per
// direction. Bulk evaluations (topology, impact, namespace graphs) then
// skip the per-pair scan over all policies. Results are identical to
// EvaluateEdge; see TestIndexMatchesEvaluateEdge.
type Index struct {
	snap    *Snapshot
	ingress map[podID][]*networkingv1.NetworkPolicy
	egress  map[podID][]*networkingv1.NetworkPolicy
}

type podID struct{ namespace, name string }

func podKey(p kube.PodInfo) podID { return podID{p.Namespace, p.Name} }

// NewIndex builds the index over the snapshot's pods.
func NewIndex(snap *Snapshot) *Index {
	idx := &Index{
		snap:    snap,
		ingress: make(map[podID][]*networkingv1.NetworkPolicy, len(snap.Pods)),
		egress:  make(map[podID][]*networkingv1.NetworkPolicy, len(snap.Pods)),
	}
	for _, p := range snap.Pods {
		idx.ingress[podKey(p)] = policiesSelecting(snap, p, dirIngress)
		idx.egress[podKey(p)] = policiesSelecting(snap, p, dirEgress)
	}
	return idx
}

func (idx *Index) selecting(p kube.PodInfo, dir direction) []*networkingv1.NetworkPolicy {
	m := idx.ingress
	if dir == dirEgress {
		m = idx.egress
	}
	if pols, ok := m[podKey(p)]; ok {
		return pols
	}
	return policiesSelecting(idx.snap, p, dir) // pod not in the snapshot
}

// EvaluateEdge is simulator.EvaluateEdge using the precomputed selections.
func (idx *Index) EvaluateEdge(src, dst kube.PodInfo) (EdgeVerdict, []PolicyRef) {
	egress := evalSideWith(idx.snap, src, idx.selecting(src, dirEgress), dirEgress, podTarget(dst), nil)
	ingress := evalSideWith(idx.snap, dst, idx.selecting(dst, dirIngress), dirIngress, podTarget(src), nil)
	return edgeVerdict(egress, ingress)
}
