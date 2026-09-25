package auth

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// visibilityTTL bounds how long a user's namespace visibility is cached.
// RBAC changes take effect after at most this long.
const visibilityTTL = 60 * time.Second

// Visibility answers "may this user see namespace X?" for read filtering.
type Visibility struct {
	All     bool
	allowed map[string]bool
}

// Visible reports whether ns may be shown.
func (v Visibility) Visible(ns string) bool { return v.All || v.allowed[ns] }

type visibilityEntry struct {
	vis     Visibility
	expires time.Time
}

type visibilityCache struct {
	mu      sync.Mutex
	entries map[string]visibilityEntry
}

func userCacheKey(u *User) string {
	groups := append([]string(nil), u.Groups...)
	sort.Strings(groups)
	return u.Name + "\x00" + strings.Join(groups, ",")
}

// VisibleNamespaces returns which of namespaces the request's user may
// read, judged by RBAC "list networkpolicies" in each namespace. It is only
// meaningful with RestrictReads; otherwise (and in mode none) everything is
// visible. One cluster-wide check short-circuits the per-namespace ones.
func (a *Authenticator) VisibleNamespaces(ctx context.Context, namespaces []string) (Visibility, error) {
	if !a.cfg.RestrictReads || a.cfg.Mode == ModeNone {
		return Visibility{All: true}, nil
	}
	u := UserFrom(ctx)
	if u == nil {
		return Visibility{}, errUnauthenticated
	}
	key := userCacheKey(u)
	now := time.Now()
	a.vis.mu.Lock()
	if e, ok := a.vis.entries[key]; ok && now.Before(e.expires) && e.vis.covers(namespaces) {
		a.vis.mu.Unlock()
		return e.vis, nil
	}
	a.vis.mu.Unlock()

	cs, err := a.ClientFor(ctx)
	if err != nil {
		return Visibility{}, err
	}
	vis, err := computeVisibility(ctx, cs, namespaces)
	if err != nil {
		return Visibility{}, err
	}
	a.vis.mu.Lock()
	for k, e := range a.vis.entries { // opportunistic cleanup
		if now.After(e.expires) {
			delete(a.vis.entries, k)
		}
	}
	a.vis.entries[key] = visibilityEntry{vis: vis, expires: now.Add(visibilityTTL)}
	a.vis.mu.Unlock()
	return vis, nil
}

// covers reports whether the cached result decided every namespace asked
// about (a namespace created after caching must be checked).
func (v Visibility) covers(namespaces []string) bool {
	if v.All {
		return true
	}
	for _, ns := range namespaces {
		if _, ok := v.allowed[ns]; !ok {
			return false
		}
	}
	return true
}

func computeVisibility(ctx context.Context, cs kubernetes.Interface, namespaces []string) (Visibility, error) {
	can := func(ns string) (bool, error) {
		res, err := cs.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, &authorizationv1.SelfSubjectAccessReview{
			Spec: authorizationv1.SelfSubjectAccessReviewSpec{ResourceAttributes: &authorizationv1.ResourceAttributes{
				Namespace: ns, Group: "networking.k8s.io", Resource: "networkpolicies", Verb: "list",
			}},
		}, metav1.CreateOptions{})
		if err != nil {
			return false, err
		}
		return res.Status.Allowed, nil
	}
	all, err := can("")
	if err != nil {
		return Visibility{}, err
	}
	if all {
		return Visibility{All: true}, nil
	}

	vis := Visibility{allowed: make(map[string]bool, len(namespaces))}
	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		firstErr error
		sem      = make(chan struct{}, 16)
	)
	for _, ns := range namespaces {
		wg.Add(1)
		sem <- struct{}{}
		go func(ns string) {
			defer wg.Done()
			defer func() { <-sem }()
			ok, err := can(ns)
			mu.Lock()
			defer mu.Unlock()
			if err != nil && firstErr == nil {
				firstErr = err
			}
			vis.allowed[ns] = ok
		}(ns)
	}
	wg.Wait()
	if firstErr != nil {
		return Visibility{}, firstErr
	}
	return vis, nil
}
