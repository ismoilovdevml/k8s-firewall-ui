package api

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// CSRFHeader must accompany every state-changing API request. Browsers
// cannot attach custom headers to cross-site requests without a CORS
// preflight (which this server never grants), so its presence proves the
// request came from the UI's own origin.
const CSRFHeader = "X-Requested-With"

func requireCSRFHeader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if r.Header.Get(CSRFHeader) == "" {
				writeError(w, http.StatusForbidden, "CSRF_HEADER_MISSING",
					"state-changing requests must send the "+CSRFHeader+" header")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// contentSecurityPolicy allows only same-origin resources. Inline styles
// are required by React Flow and CodeMirror.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; " +
	"frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

// SecurityHeaders sets defensive response headers on every response.
func SecurityHeaders(hsts bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("Content-Security-Policy", contentSecurityPolicy)
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			if hsts {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			if strings.HasPrefix(r.URL.Path, "/api/") {
				h.Set("Cache-Control", "no-store")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequestLogger logs one line per request and feeds the HTTP metrics.
// Probes and the metrics endpoint are counted but not logged.
func RequestLogger(logger *slog.Logger, m *Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)

			route := "spa"
			if rc := chi.RouteContext(r.Context()); rc != nil && rc.RoutePattern() != "" && rc.RoutePattern() != "/*" {
				route = rc.RoutePattern()
			}
			status := ww.Status()
			if status == 0 {
				status = http.StatusOK
			}
			elapsed := time.Since(start)
			if m != nil {
				m.observeRequest(r.Method, route, strconv.Itoa(status), elapsed)
			}
			switch r.URL.Path {
			case "/healthz", "/readyz", "/metrics":
				return
			}
			level := slog.LevelInfo
			if status >= 500 {
				level = slog.LevelError
			}
			logger.LogAttrs(r.Context(), level, "http request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.String("route", route),
				slog.Int("status", status),
				slog.Int("bytes", ww.BytesWritten()),
				slog.Duration("duration", elapsed),
				slog.String("remote", r.RemoteAddr),
				slog.String("requestID", middleware.GetReqID(r.Context())),
			)
		})
	}
}
