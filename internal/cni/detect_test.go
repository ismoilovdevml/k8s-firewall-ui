package cni

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/version"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"
)

func ds(name string) runtime.Object {
	return &appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: name}}
}

func k3sNode(args string) runtime.Object {
	return &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "n1", Annotations: map[string]string{"k3s.io/node-args": args}}}
}

func TestDetect(t *testing.T) {
	cases := []struct {
		name         string
		gitVersion   string
		objs         []runtime.Object
		override     string
		wantProvider string
		wantEnforces bool
	}{
		{"calico daemonset", "v1.33.0", []runtime.Object{ds("calico-node")}, "", "calico", true},
		{"cilium daemonset", "v1.33.0", []runtime.Object{ds("cilium")}, "", "cilium", true},
		{"plain flannel", "v1.33.0", []runtime.Object{ds("kube-flannel-ds")}, "", "flannel", false},
		{"aws vpc cni without agent", "v1.33.0-eks", []runtime.Object{ds("aws-node")}, "", "aws-vpc-cni", false},
		{"aws vpc cni with agent", "v1.33.0-eks", []runtime.Object{ds("aws-node"), ds("aws-network-policy-agent")}, "", "aws-vpc-cni", true},
		{"nothing recognizable", "v1.33.0", nil, "", "unknown", false},
		{"k3s embedded controller", "v1.33.4+k3s1", []runtime.Object{k3sNode(`["server"]`)}, "", "k3s", true},
		{"k3s with network policy disabled", "v1.33.4+k3s1", []runtime.Object{k3sNode(`["server","--disable-network-policy"]`)}, "", "k3s", false},
		{"k3s with calico installed", "v1.33.4+k3s1", []runtime.Object{ds("calico-node")}, "", "calico", true},
		{"override wins", "v1.33.0", []runtime.Object{ds("kube-flannel-ds")}, "cilium", "cilium", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cs := fake.NewClientset(tc.objs...)
			cs.Discovery().(*fakediscovery.FakeDiscovery).FakedServerVersion = &version.Info{GitVersion: tc.gitVersion}
			res := Detect(context.Background(), cs, tc.override)
			if res.Provider != tc.wantProvider || res.EnforcesPolicies != tc.wantEnforces {
				t.Fatalf("Detect = %s/%v, want %s/%v (evidence %v)", res.Provider, res.EnforcesPolicies, tc.wantProvider, tc.wantEnforces, res.Evidence)
			}
		})
	}
}
