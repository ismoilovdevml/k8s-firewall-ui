// Package kube wraps client-go: client construction, shared informers, and
// point-in-time cluster snapshots consumed by the API and simulator layers.
package kube

import (
	"fmt"
	"os"
	"path/filepath"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// NewRestConfig resolves cluster credentials in order:
// --kubeconfig flag → $KUBECONFIG → in-cluster ServiceAccount → ~/.kube/config.
func NewRestConfig(kubeconfigFlag string) (*rest.Config, error) {
	if kubeconfigFlag != "" {
		return clientcmd.BuildConfigFromFlags("", kubeconfigFlag)
	}
	if env := os.Getenv("KUBECONFIG"); env != "" {
		return clientcmd.BuildConfigFromFlags("", env)
	}
	if cfg, err := rest.InClusterConfig(); err == nil {
		return cfg, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("no kubeconfig found and no home directory: %w", err)
	}
	return clientcmd.BuildConfigFromFlags("", filepath.Join(home, ".kube", "config"))
}

// NewClientset builds a typed clientset from the resolved config.
func NewClientset(kubeconfigFlag string) (kubernetes.Interface, *rest.Config, error) {
	cfg, err := NewRestConfig(kubeconfigFlag)
	if err != nil {
		return nil, nil, fmt.Errorf("resolving kubeconfig: %w", err)
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("building clientset: %w", err)
	}
	return cs, cfg, nil
}
