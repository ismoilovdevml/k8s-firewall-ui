package simulator

import (
	"sort"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// Workload is a set of pods collapsed by owner. Replicas of a workload share
// labels, so one representative pod's verdict holds for all of them.
type Workload struct {
	ID        string // "<namespace>/<owner>"
	Namespace string
	Owner     string // e.g. "deployment/web"
	PodCount  int
	// HostNetwork is true when any pod of the workload runs on the host
	// network (policy selectors do not apply to it).
	HostNetwork bool
	Rep         kube.PodInfo
}

// Workloads groups the snapshot's pods by owner, sorted by ID. When
// namespaces is non-empty only pods in those namespaces are included.
func Workloads(snap *Snapshot, namespaces map[string]bool) []Workload {
	byID := map[string]*Workload{}
	for _, p := range snap.Pods {
		if len(namespaces) > 0 && !namespaces[p.Namespace] {
			continue
		}
		id := p.Namespace + "/" + p.Owner
		if wl, exists := byID[id]; exists {
			wl.PodCount++
			wl.HostNetwork = wl.HostNetwork || p.HostNetwork
			continue
		}
		byID[id] = &Workload{
			ID: id, Namespace: p.Namespace, Owner: p.Owner,
			PodCount: 1, HostNetwork: p.HostNetwork, Rep: p,
		}
	}
	out := make([]Workload, 0, len(byID))
	for _, wl := range byID {
		out = append(out, *wl)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// IsolationOf reports which directions isolate the pod and the policies
// that select it for each direction.
func IsolationOf(snap *Snapshot, pod kube.PodInfo) (ingress, egress []PolicyRef) {
	for _, pol := range policiesSelecting(snap, pod, dirIngress) {
		ingress = append(ingress, PolicyRef{Namespace: pol.Namespace, Name: pol.Name})
	}
	for _, pol := range policiesSelecting(snap, pod, dirEgress) {
		egress = append(egress, PolicyRef{Namespace: pol.Namespace, Name: pol.Name})
	}
	return ingress, egress
}
