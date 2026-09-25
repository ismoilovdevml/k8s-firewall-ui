// Package auth resolves the acting user of a request and builds
// user-scoped Kubernetes clients, so that Kubernetes RBAC — not this
// binary — decides what each person may change.
//
// Modes:
//   - none:  no login; every request acts as the server's own identity
//     (ServiceAccount or kubeconfig). Suitable for local use.
//   - token: users sign in with a Kubernetes bearer token (ServiceAccount
//     token or OIDC id_token). The token is kept in an encrypted, HttpOnly
//     session cookie and used for every write.
//   - proxy: an authenticating reverse proxy (oauth2-proxy, Pomerium, …)
//     injects the user and groups as headers; writes impersonate that user.
package auth

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
	authenticationv1 "k8s.io/api/authentication/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// Mode selects how users are identified.
type Mode string

// Supported modes.
const (
	ModeNone  Mode = "none"
	ModeToken Mode = "token"
	ModeProxy Mode = "proxy"
)

// ParseMode validates a --auth-mode value.
func ParseMode(s string) (Mode, error) {
	switch m := Mode(s); m {
	case ModeNone, ModeToken, ModeProxy:
		return m, nil
	}
	return "", fmt.Errorf("unknown auth mode %q (want none, token or proxy)", s)
}

// User is the authenticated caller.
type User struct {
	Name   string   `json:"name"`
	Groups []string `json:"groups"`
	token  string
}

// Config configures an Authenticator.
type Config struct {
	Mode Mode
	// Base is the server's own REST config. User clients copy its endpoint
	// and TLS settings but never its credentials.
	Base *rest.Config
	// Clientset is the server's own client (mode none).
	Clientset kubernetes.Interface
	// SessionSecret derives the cookie encryption key. Empty = random per
	// process (sessions do not survive restarts or span replicas).
	SessionSecret string
	SessionTTL    time.Duration
	SecureCookie  bool
	// Proxy mode header names.
	UserHeader   string
	GroupsHeader string
	// RestrictReads limits what each user can see (namespaces, pods,
	// policies, findings, topology, audit) to namespaces where their RBAC
	// allows listing NetworkPolicies. Ignored in mode none.
	RestrictReads bool
	// NewClient builds a clientset from a REST config; overridable in tests.
	NewClient func(*rest.Config) (kubernetes.Interface, error)
}

// Authenticator resolves users and builds per-user clients.
type Authenticator struct {
	cfg      Config
	sessions *sessionCodec

	limMu    sync.Mutex
	limiters map[string]*limiterEntry

	vis visibilityCache
}

type limiterEntry struct {
	lim  *rate.Limiter
	seen time.Time
}

// New validates cfg and constructs an Authenticator.
func New(cfg Config) (*Authenticator, error) {
	if cfg.SessionTTL <= 0 {
		cfg.SessionTTL = 8 * time.Hour
	}
	if cfg.UserHeader == "" {
		cfg.UserHeader = "X-Forwarded-User"
	}
	if cfg.GroupsHeader == "" {
		cfg.GroupsHeader = "X-Forwarded-Groups"
	}
	if cfg.NewClient == nil {
		cfg.NewClient = func(c *rest.Config) (kubernetes.Interface, error) { return kubernetes.NewForConfig(c) }
	}
	if cfg.Mode != ModeNone && cfg.Base == nil {
		return nil, errors.New("auth: base REST config is required for token and proxy modes")
	}
	codec, err := newSessionCodec(cfg.SessionSecret)
	if err != nil {
		return nil, err
	}
	return &Authenticator{cfg: cfg, sessions: codec, limiters: map[string]*limiterEntry{},
		vis: visibilityCache{entries: map[string]visibilityEntry{}}}, nil
}

// Mode reports the configured mode.
func (a *Authenticator) Mode() Mode { return a.cfg.Mode }

// RestrictsReads reports whether per-user read filtering is active.
func (a *Authenticator) RestrictsReads() bool { return a.cfg.RestrictReads && a.cfg.Mode != ModeNone }

type ctxKey struct{}

// UserFrom returns the request's user, or nil when unauthenticated.
func UserFrom(ctx context.Context) *User {
	u, _ := ctx.Value(ctxKey{}).(*User)
	return u
}

// WithUser attaches u to ctx (used by the middleware and tests).
func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

// Identify resolves the user of r without enforcing authentication.
func (a *Authenticator) Identify(r *http.Request) *User {
	switch a.cfg.Mode {
	case ModeNone:
		return &User{Name: "anonymous", Groups: []string{}}
	case ModeProxy:
		name := strings.TrimSpace(r.Header.Get(a.cfg.UserHeader))
		if name == "" {
			return nil
		}
		groups := []string{}
		for _, g := range strings.Split(r.Header.Get(a.cfg.GroupsHeader), ",") {
			if g = strings.TrimSpace(g); g != "" {
				groups = append(groups, g)
			}
		}
		return &User{Name: name, Groups: groups}
	case ModeToken:
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			return nil
		}
		s, err := a.sessions.decode(c.Value, time.Now())
		if err != nil {
			return nil
		}
		return &User{Name: s.User, Groups: s.Groups, token: s.Token}
	}
	return nil
}

// Require is middleware that rejects unauthenticated requests with 401 and
// stores the user in the request context.
func (a *Authenticator) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := a.Identify(r)
		if u == nil {
			writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "sign in to continue")
			return
		}
		next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), u)))
	})
}

// ClientFor returns a Kubernetes client acting as the request's user.
func (a *Authenticator) ClientFor(ctx context.Context) (kubernetes.Interface, error) {
	switch a.cfg.Mode {
	case ModeNone:
		return a.cfg.Clientset, nil
	case ModeToken:
		u := UserFrom(ctx)
		if u == nil || u.token == "" {
			return nil, errUnauthenticated
		}
		return a.cfg.NewClient(tokenConfig(a.cfg.Base, u.token))
	case ModeProxy:
		u := UserFrom(ctx)
		if u == nil {
			return nil, errUnauthenticated
		}
		cfg := rest.CopyConfig(a.cfg.Base)
		cfg.Impersonate = rest.ImpersonationConfig{UserName: u.Name, Groups: u.Groups}
		return a.cfg.NewClient(cfg)
	}
	return nil, fmt.Errorf("auth: unsupported mode %q", a.cfg.Mode)
}

var errUnauthenticated = apierrors.NewUnauthorized("not signed in")

func tokenConfig(base *rest.Config, token string) *rest.Config {
	cfg := rest.AnonymousClientConfig(base)
	cfg.BearerToken = token
	return cfg
}

// --- HTTP handlers ---

type loginRequest struct {
	Token string `json:"token"`
}

// HandleLogin validates a bearer token against the API server and sets the
// session cookie.
func (a *Authenticator) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if a.cfg.Mode != ModeToken {
		writeError(w, http.StatusBadRequest, "LOGIN_NOT_SUPPORTED", "this instance does not use token login (auth mode "+string(a.cfg.Mode)+")")
		return
	}
	if !a.allowLogin(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many sign-in attempts; wait a minute and try again")
		return
	}
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", err.Error())
		return
	}
	token := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(req.Token), "Bearer "))
	if token == "" {
		writeError(w, http.StatusBadRequest, "TOKEN_REQUIRED", "paste a Kubernetes bearer token")
		return
	}
	user, err := a.reviewToken(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "INVALID_TOKEN", "the API server rejected this token: "+err.Error())
		return
	}
	expires := time.Now().Add(a.cfg.SessionTTL)
	value, err := a.sessions.encode(session{User: user.Name, Groups: user.Groups, Token: token, Expires: expires.Unix()})
	if err != nil {
		writeError(w, http.StatusBadRequest, "SESSION_FAILED", err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: value, Path: "/", Expires: expires,
		HttpOnly: true, Secure: a.cfg.SecureCookie, SameSite: http.SameSiteStrictMode,
	})
	writeJSON(w, http.StatusOK, a.meResponse(user))
}

// HandleLogout clears the session cookie.
func (a *Authenticator) HandleLogout(w http.ResponseWriter, _ *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: a.cfg.SecureCookie, SameSite: http.SameSiteStrictMode,
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed out"})
}

// HandleMe reports the auth mode and the current user (null when signed out).
func (a *Authenticator) HandleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.meResponse(a.Identify(r)))
}

func (a *Authenticator) meResponse(u *User) map[string]any {
	return map[string]any{"mode": a.cfg.Mode, "user": u, "restrictReads": a.RestrictsReads()}
}

// reviewToken asks the API server who the token belongs to. It uses
// SelfSubjectReview (GA in 1.28), which needs no extra RBAC; older clusters
// fall back to a SelfSubjectAccessReview that only proves validity.
func (a *Authenticator) reviewToken(ctx context.Context, token string) (*User, error) {
	cs, err := a.cfg.NewClient(tokenConfig(a.cfg.Base, token))
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	review, err := cs.AuthenticationV1().SelfSubjectReviews().Create(ctx, &authenticationv1.SelfSubjectReview{}, metav1.CreateOptions{})
	if err == nil {
		groups := review.Status.UserInfo.Groups
		if groups == nil {
			groups = []string{}
		}
		return &User{Name: review.Status.UserInfo.Username, Groups: groups, token: token}, nil
	}
	if !apierrors.IsNotFound(err) {
		return nil, err
	}
	_, err = cs.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{ResourceAttributes: &authorizationv1.ResourceAttributes{
			Group: "networking.k8s.io", Resource: "networkpolicies", Verb: "list",
		}},
	}, metav1.CreateOptions{})
	if err != nil {
		return nil, err
	}
	return &User{Name: "token-user", Groups: []string{}, token: token}, nil
}

// CanI runs SelfSubjectAccessReviews for the given verbs on NetworkPolicies
// in namespace, as the request's user.
func (a *Authenticator) CanI(ctx context.Context, namespace string, verbs []string) (map[string]bool, error) {
	cs, err := a.ClientFor(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]bool{}
	for _, verb := range verbs {
		res, err := cs.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, &authorizationv1.SelfSubjectAccessReview{
			Spec: authorizationv1.SelfSubjectAccessReviewSpec{ResourceAttributes: &authorizationv1.ResourceAttributes{
				Namespace: namespace, Group: "networking.k8s.io", Resource: "networkpolicies", Verb: verb,
			}},
		}, metav1.CreateOptions{})
		if err != nil {
			return nil, err
		}
		out[verb] = res.Status.Allowed
	}
	return out, nil
}

// allowLogin applies a per-IP token bucket (5/min, burst 10) to sign-ins.
func (a *Authenticator) allowLogin(ip string) bool {
	a.limMu.Lock()
	defer a.limMu.Unlock()
	now := time.Now()
	for k, e := range a.limiters {
		if now.Sub(e.seen) > 10*time.Minute {
			delete(a.limiters, k)
		}
	}
	e, ok := a.limiters[ip]
	if !ok {
		e = &limiterEntry{lim: rate.NewLimiter(rate.Every(12*time.Second), 10)}
		a.limiters[ip] = e
	}
	e.seen = now
	return e.lim.Allow()
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
