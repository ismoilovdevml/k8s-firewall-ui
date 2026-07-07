package simulator

import (
	"fmt"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
)

// Evaluate answers "can source reach destination on port?" over the snapshot.
// The source must be a pod (v0.1); the destination is a pod or an external IP.
// The connection is allowed iff the source's egress check AND the
// destination's ingress check both pass; a non-applicable side passes.
func Evaluate(snap *Snapshot, in Input) (Result, error) {
	if in.Source.Kind != "pod" {
		return Result{}, fmt.Errorf("source must be a pod (kind %q not supported)", in.Source.Kind)
	}
	src, err := findPod(snap, in.Source)
	if err != nil {
		return Result{}, err
	}

	var res Result
	switch in.Destination.Kind {
	case "pod":
		dst, err := findPod(snap, in.Destination)
		if err != nil {
			return Result{}, err
		}
		res.Egress = evalSide(snap, src, dirEgress, podTarget(dst), in.Port)
		res.Ingress = evalSide(snap, dst, dirIngress, podTarget(src), in.Port)
		res.Warnings = collectWarnings(snap, src, &dst, in)
	case "ip":
		if in.Destination.IP == "" {
			return Result{}, fmt.Errorf("destination ip is required")
		}
		res.Egress = evalSide(snap, src, dirEgress, ipTarget(in.Destination.IP), in.Port)
		res.Ingress = SideResult{Applicable: false}
		res.Warnings = collectWarnings(snap, src, nil, in)
	default:
		return Result{}, fmt.Errorf("destination kind %q not supported", in.Destination.Kind)
	}

	res.Allowed = sidePasses(res.Egress) && sidePasses(res.Ingress)
	return res, nil
}

func sidePasses(s SideResult) bool { return !s.Applicable || s.Allowed }

func findPod(snap *Snapshot, ep Endpoint) (kube.PodInfo, error) {
	for _, p := range snap.Pods {
		if p.Namespace == ep.Namespace && p.Name == ep.Name {
			return p, nil
		}
	}
	return kube.PodInfo{}, fmt.Errorf("pod %s/%s not found", ep.Namespace, ep.Name)
}
