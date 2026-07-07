package kube

import (
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
)

// ContainerPort is a named container port exposed by a pod.
type ContainerPort struct {
	Name     string          `json:"name,omitempty"`
	Port     int32           `json:"port"`
	Protocol corev1.Protocol `json:"protocol"`
}

// PodInfo is the simulator- and API-facing view of a pod.
type PodInfo struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Labels      map[string]string `json:"labels,omitempty"`
	IP          string            `json:"ip,omitempty"`
	NodeName    string            `json:"nodeName,omitempty"`
	HostNetwork bool              `json:"hostNetwork"`
	Phase       string            `json:"phase"`
	// Owner is the collapsed workload identity, e.g. "deployment/web" or
	// "statefulset/db"; bare pods use "pod/<name>".
	Owner string          `json:"owner"`
	Ports []ContainerPort `json:"ports,omitempty"`
}

// NamespaceInfo is the API-facing view of a namespace.
type NamespaceInfo struct {
	Name   string            `json:"name"`
	Labels map[string]string `json:"labels,omitempty"`
}

// ClusterSnapshot is a point-in-time copy of the informer caches. It is the
// sole input to the simulator and the topology computation.
type ClusterSnapshot struct {
	Pods       []PodInfo
	Namespaces []NamespaceInfo
	Policies   []*networkingv1.NetworkPolicy
}

// NamespaceLabels returns the labels of the named namespace, or nil.
func (s *ClusterSnapshot) NamespaceLabels(name string) map[string]string {
	for _, ns := range s.Namespaces {
		if ns.Name == name {
			return ns.Labels
		}
	}
	return nil
}

func podInfoFrom(p *corev1.Pod) PodInfo {
	info := PodInfo{
		Name:        p.Name,
		Namespace:   p.Namespace,
		Labels:      p.Labels,
		IP:          p.Status.PodIP,
		NodeName:    p.Spec.NodeName,
		HostNetwork: p.Spec.HostNetwork,
		Phase:       string(p.Status.Phase),
		Owner:       ownerOf(p),
	}
	for _, c := range p.Spec.Containers {
		for _, port := range c.Ports {
			proto := port.Protocol
			if proto == "" {
				proto = corev1.ProtocolTCP
			}
			info.Ports = append(info.Ports, ContainerPort{
				Name:     port.Name,
				Port:     port.ContainerPort,
				Protocol: proto,
			})
		}
	}
	return info
}

// ownerOf collapses a pod to its workload identity. ReplicaSet-owned pods are
// attributed to a Deployment by trimming the ReplicaSet hash suffix — a
// heuristic that avoids a second informer and is right for standard names.
func ownerOf(p *corev1.Pod) string {
	for _, ref := range p.OwnerReferences {
		switch ref.Kind {
		case "ReplicaSet":
			if i := lastDash(ref.Name); i > 0 {
				return "deployment/" + ref.Name[:i]
			}
			return "replicaset/" + ref.Name
		case "StatefulSet":
			return "statefulset/" + ref.Name
		case "DaemonSet":
			return "daemonset/" + ref.Name
		case "Job":
			return "job/" + ref.Name
		}
	}
	return "pod/" + p.Name
}

func lastDash(s string) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == '-' {
			return i
		}
	}
	return -1
}
