package kube

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

// Event signals that a resource kind changed; consumers refetch, they do not
// receive object payloads.
type Event struct {
	Resource string `json:"resource"` // "pods" | "namespaces" | "networkpolicies"
}

const debounceInterval = 250 * time.Millisecond

// Store owns the shared informers and produces snapshots and coarse-grained
// change events.
type Store struct {
	factory informers.SharedInformerFactory

	mu    sync.Mutex
	dirty map[string]bool
	timer *time.Timer
	out   chan Event

	synced bool
	sMu    sync.RWMutex
}

// NewStore builds informers for pods, namespaces, and networkpolicies.
func NewStore(cs kubernetes.Interface) (*Store, error) {
	s := &Store{
		factory: informers.NewSharedInformerFactory(cs, 0),
		dirty:   map[string]bool{},
		out:     make(chan Event, 16),
	}
	for resource, informer := range map[string]cache.SharedIndexInformer{
		"pods":            s.factory.Core().V1().Pods().Informer(),
		"namespaces":      s.factory.Core().V1().Namespaces().Informer(),
		"networkpolicies": s.factory.Networking().V1().NetworkPolicies().Informer(),
	} {
		if _, err := informer.AddEventHandler(s.markDirtyHandler(resource)); err != nil {
			return nil, fmt.Errorf("adding %s event handler: %w", resource, err)
		}
	}
	return s, nil
}

// Start runs the informers and blocks until caches sync or ctx is done.
func (s *Store) Start(ctx context.Context) error {
	s.factory.Start(ctx.Done())
	for typ, ok := range s.factory.WaitForCacheSync(ctx.Done()) {
		if !ok {
			return fmt.Errorf("cache sync failed for %v", typ)
		}
	}
	s.sMu.Lock()
	s.synced = true
	s.sMu.Unlock()
	return nil
}

// Synced reports whether all informer caches have synced (readiness).
func (s *Store) Synced() bool {
	s.sMu.RLock()
	defer s.sMu.RUnlock()
	return s.synced
}

// Events is the debounced change stream. Single consumer (the SSE hub).
func (s *Store) Events() <-chan Event { return s.out }

func (s *Store) markDirtyHandler(resource string) cache.ResourceEventHandlerFuncs {
	mark := func(any) { s.markDirty(resource) }
	return cache.ResourceEventHandlerFuncs{
		AddFunc:    mark,
		UpdateFunc: func(_, _ any) { s.markDirty(resource) },
		DeleteFunc: mark,
	}
}

func (s *Store) markDirty(resource string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dirty[resource] = true
	if s.timer == nil {
		s.timer = time.AfterFunc(debounceInterval, s.flush)
	}
}

func (s *Store) flush() {
	s.mu.Lock()
	pending := s.dirty
	s.dirty = map[string]bool{}
	s.timer = nil
	s.mu.Unlock()

	for resource := range pending {
		select {
		case s.out <- Event{Resource: resource}:
		default: // consumer stalled; drop rather than block informers
		}
	}
}

// Snapshot copies the informer caches into a ClusterSnapshot.
func (s *Store) Snapshot() (*ClusterSnapshot, error) {
	pods, err := s.factory.Core().V1().Pods().Lister().List(labels.Everything())
	if err != nil {
		return nil, fmt.Errorf("listing pods: %w", err)
	}
	namespaces, err := s.factory.Core().V1().Namespaces().Lister().List(labels.Everything())
	if err != nil {
		return nil, fmt.Errorf("listing namespaces: %w", err)
	}
	policies, err := s.factory.Networking().V1().NetworkPolicies().Lister().List(labels.Everything())
	if err != nil {
		return nil, fmt.Errorf("listing networkpolicies: %w", err)
	}

	snap := &ClusterSnapshot{Policies: policies}
	for _, p := range pods {
		if p.Status.Phase == corev1.PodSucceeded || p.Status.Phase == corev1.PodFailed {
			continue // completed pods have no network presence
		}
		snap.Pods = append(snap.Pods, podInfoFrom(p))
	}
	for _, ns := range namespaces {
		snap.Namespaces = append(snap.Namespaces, NamespaceInfo{Name: ns.Name, Labels: ns.Labels})
	}
	sort.Slice(snap.Pods, func(i, j int) bool {
		a, b := snap.Pods[i], snap.Pods[j]
		return a.Namespace+"/"+a.Name < b.Namespace+"/"+b.Name
	})
	sort.Slice(snap.Namespaces, func(i, j int) bool { return snap.Namespaces[i].Name < snap.Namespaces[j].Name })
	sort.Slice(snap.Policies, func(i, j int) bool {
		a, b := snap.Policies[i], snap.Policies[j]
		return a.Namespace+"/"+a.Name < b.Namespace+"/"+b.Name
	})
	return snap, nil
}
