package auth

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	authenticationv1 "k8s.io/api/authentication/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	k8stesting "k8s.io/client-go/testing"
)

func TestSessionCodec(t *testing.T) {
	c, err := newSessionCodec("s3cret")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	value, err := c.encode(session{User: "alice", Groups: []string{"dev"}, Token: "tok", Expires: now.Add(time.Hour).Unix()})
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name    string
		codec   *sessionCodec
		value   string
		now     time.Time
		wantErr bool
	}{
		{"round trip", c, value, now, false},
		{"expired", c, value, now.Add(2 * time.Hour), true},
		{"tampered", c, value[:len(value)-2] + "AA", now, true},
		{"garbage", c, "not-base64!!", now, true},
		{"other key", mustCodec(t, "different"), value, now, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, err := tc.codec.decode(tc.value, tc.now)
			if (err != nil) != tc.wantErr {
				t.Fatalf("decode err = %v, wantErr %v", err, tc.wantErr)
			}
			if !tc.wantErr && (s.User != "alice" || s.Token != "tok") {
				t.Fatalf("decoded %+v", s)
			}
		})
	}
}

func mustCodec(t *testing.T, secret string) *sessionCodec {
	t.Helper()
	c, err := newSessionCodec(secret)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestIdentifyProxy(t *testing.T) {
	a, err := New(Config{Mode: ModeProxy, Base: &rest.Config{Host: "https://k8s"}})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if a.Identify(r) != nil {
		t.Fatal("request without proxy headers must be unauthenticated")
	}
	r.Header.Set("X-Forwarded-User", "bob@example.com")
	r.Header.Set("X-Forwarded-Groups", "platform, sre,")
	u := a.Identify(r)
	if u == nil || u.Name != "bob@example.com" || len(u.Groups) != 2 || u.Groups[1] != "sre" {
		t.Fatalf("Identify = %+v", u)
	}
}

func TestTokenLoginFlow(t *testing.T) {
	var gotToken string
	newClient := func(c *rest.Config) (kubernetes.Interface, error) {
		gotToken = c.BearerToken
		cs := fake.NewClientset()
		cs.PrependReactor("create", "selfsubjectreviews", func(k8stesting.Action) (bool, runtime.Object, error) {
			if c.BearerToken != "good" {
				return true, nil, errors.New("Unauthorized")
			}
			return true, &authenticationv1.SelfSubjectReview{Status: authenticationv1.SelfSubjectReviewStatus{
				UserInfo: authenticationv1.UserInfo{Username: "alice", Groups: []string{"dev"}},
			}}, nil
		})
		return cs, nil
	}
	a, err := New(Config{Mode: ModeToken, Base: &rest.Config{Host: "https://k8s", Username: "admin", Password: "x"}, NewClient: newClient})
	if err != nil {
		t.Fatal(err)
	}

	// Rejected token.
	w := httptest.NewRecorder()
	a.HandleLogin(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"token":"bad"}`)))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("bad token status = %d", w.Code)
	}

	// Accepted token sets a cookie that identifies the user.
	w = httptest.NewRecorder()
	a.HandleLogin(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"token":"Bearer good"}`)))
	if w.Code != http.StatusOK {
		t.Fatalf("good token status = %d body %s", w.Code, w.Body)
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie = %+v", cookies)
	}
	if strings.Contains(cookies[0].Value, "good") {
		t.Fatal("token must not appear in clear text in the cookie")
	}

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.AddCookie(cookies[0])
	u := a.Identify(r)
	if u == nil || u.Name != "alice" {
		t.Fatalf("Identify = %+v", u)
	}

	// User clients carry the user's token and none of the server's credentials.
	if _, err := a.ClientFor(WithUser(r.Context(), u)); err != nil {
		t.Fatal(err)
	}
	if gotToken != "good" {
		t.Fatalf("user client token = %q", gotToken)
	}
	cfg := tokenConfig(a.cfg.Base, "good")
	if cfg.Username != "" || cfg.Password != "" {
		t.Fatal("user client must not inherit server credentials")
	}
}

func TestRequire(t *testing.T) {
	a, _ := New(Config{Mode: ModeProxy, Base: &rest.Config{}})
	h := a.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(UserFrom(r.Context()).Name))
	}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("X-Forwarded-User", "carol")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Body.String() != "carol" {
		t.Fatalf("body = %q", w.Body)
	}
}

func TestLoginRateLimit(t *testing.T) {
	a, _ := New(Config{Mode: ModeNone})
	allowed := 0
	for range 20 {
		if a.allowLogin("1.2.3.4") {
			allowed++
		}
	}
	if allowed != 10 {
		t.Fatalf("allowed = %d, want burst of 10", allowed)
	}
	if !a.allowLogin("5.6.7.8") {
		t.Fatal("limits must be per IP")
	}
}
