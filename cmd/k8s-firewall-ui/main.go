// k8s-firewall-ui is a visual firewall dashboard for Kubernetes NetworkPolicies.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/api"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/audit"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/auth"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/cni"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/demo"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/notify"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/version"
	"github.com/ismoilovdevml/k8s-firewall-ui/web"
)

type config struct {
	listen            string
	kubeconfig        string
	cniOverride       string
	readOnly          bool
	authMode          string
	sessionSecret     string
	sessionSecretFile string
	sessionTTL        time.Duration
	proxyUserHeader   string
	proxyGroupsHeader string
	tlsCert, tlsKey   string
	secureCookie      bool
	metrics           bool
	auditSize         int
	logFormat         string
	logLevel          string
	shutdownTimeout   time.Duration
	demo              bool
	restrictReads     bool
	notifyURL         string
	notifyFormat      string
}

func main() {
	var c config
	flags := flag.NewFlagSet(os.Args[0], flag.ExitOnError)
	flags.StringVar(&c.listen, "listen", ":8080", "address to listen on")
	flags.StringVar(&c.kubeconfig, "kubeconfig", "", "path to kubeconfig (default: $KUBECONFIG, in-cluster, then ~/.kube/config)")
	flags.StringVar(&c.cniOverride, "cni-override", "", "skip CNI auto-detection and trust this provider name")
	flags.BoolVar(&c.readOnly, "read-only", false, "disable policy create/update/delete")
	flags.StringVar(&c.authMode, "auth-mode", "none", "user authentication: none | token | proxy")
	flags.StringVar(&c.sessionSecret, "session-secret", "", "secret for session cookie encryption (prefer FWUI_SESSION_SECRET or --session-secret-file)")
	flags.StringVar(&c.sessionSecretFile, "session-secret-file", "", "file containing the session secret")
	flags.DurationVar(&c.sessionTTL, "session-ttl", 8*time.Hour, "session lifetime in token auth mode")
	flags.StringVar(&c.proxyUserHeader, "auth-proxy-user-header", "X-Forwarded-User", "header carrying the user name in proxy auth mode")
	flags.StringVar(&c.proxyGroupsHeader, "auth-proxy-groups-header", "X-Forwarded-Groups", "header carrying comma-separated groups in proxy auth mode")
	flags.StringVar(&c.tlsCert, "tls-cert-file", "", "serve HTTPS with this certificate")
	flags.StringVar(&c.tlsKey, "tls-key-file", "", "private key for --tls-cert-file")
	flags.BoolVar(&c.secureCookie, "secure-cookies", false, "mark session cookies Secure (automatic with TLS; set when TLS terminates at an ingress)")
	flags.BoolVar(&c.metrics, "metrics", true, "expose Prometheus metrics on /metrics")
	flags.IntVar(&c.auditSize, "audit-buffer", 1000, "audit entries kept in memory for the UI")
	flags.StringVar(&c.logFormat, "log-format", "text", "log format: text | json")
	flags.StringVar(&c.logLevel, "log-level", "info", "log level: debug | info | warn | error")
	flags.DurationVar(&c.shutdownTimeout, "shutdown-timeout", 15*time.Second, "graceful shutdown timeout")
	flags.StringVar(&c.notifyURL, "notify-webhook-url", "", "POST every policy change to this webhook (prefer FWUI_NOTIFY_WEBHOOK_URL: the URL is a secret)")
	flags.StringVar(&c.notifyFormat, "notify-format", "json", "webhook payload: json (audit entry) | slack (Slack-compatible text)")
	flags.BoolVar(&c.restrictReads, "restrict-reads", false, "token/proxy mode: show each user only namespaces where they may list NetworkPolicies")
	flags.BoolVar(&c.demo, "demo", false, "run against a built-in in-memory sample cluster (no Kubernetes needed)")
	showVersion := flags.Bool("version", false, "print version and exit")
	_ = flags.Parse(os.Args[1:])
	if err := applyEnv(flags); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	if *showVersion {
		fmt.Println(version.Version)
		return
	}

	logger := newLogger(c.logFormat, c.logLevel)
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, c, logger); err != nil {
		logger.Error("fatal", "error", err)
		os.Exit(1)
	}
}

// applyEnv fills every flag not set on the command line from FWUI_<NAME>
// (e.g. --auth-mode ← FWUI_AUTH_MODE), so container deployments can be
// configured entirely through the environment.
func applyEnv(flags *flag.FlagSet) error {
	set := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { set[f.Name] = true })
	var err error
	flags.VisitAll(func(f *flag.Flag) {
		if set[f.Name] || err != nil {
			return
		}
		key := "FWUI_" + strings.ToUpper(strings.ReplaceAll(f.Name, "-", "_"))
		if v, ok := os.LookupEnv(key); ok {
			if e := f.Value.Set(v); e != nil {
				err = fmt.Errorf("invalid %s: %w", key, e)
			}
		}
	})
	return err
}

func newLogger(format, level string) *slog.Logger {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(level)); err != nil {
		lvl = slog.LevelInfo
	}
	opts := &slog.HandlerOptions{Level: lvl}
	if format == "json" {
		return slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, opts))
}

func run(ctx context.Context, c config, logger *slog.Logger) error {
	mode, err := auth.ParseMode(c.authMode)
	if err != nil {
		return err
	}
	if (c.tlsCert == "") != (c.tlsKey == "") {
		return errors.New("--tls-cert-file and --tls-key-file must be set together")
	}
	secret := c.sessionSecret
	if c.sessionSecretFile != "" {
		b, err := os.ReadFile(c.sessionSecretFile)
		if err != nil {
			return fmt.Errorf("reading session secret: %w", err)
		}
		secret = strings.TrimSpace(string(b))
	}
	if mode == auth.ModeToken && secret == "" {
		logger.Warn("no session secret configured: sessions are lost on restart and do not work across replicas")
	}

	var (
		clientset  kubernetes.Interface
		restConfig *rest.Config
	)
	serverVersion := "unknown"
	if c.demo {
		if mode != auth.ModeNone {
			return errors.New("--demo supports only --auth-mode=none")
		}
		logger.Warn("DEMO MODE: serving a built-in sample cluster; changes are kept in memory only")
		clientset, serverVersion = demo.Clientset(), "v1.34.0 (demo)"
	} else {
		clientset, restConfig, err = kube.NewClientset(c.kubeconfig)
		if err != nil {
			return err
		}
		if v, err := clientset.Discovery().ServerVersion(); err == nil {
			serverVersion = v.GitVersion
		} else {
			logger.Warn("could not read server version", "error", err)
		}
	}

	store, err := kube.NewStore(clientset)
	if err != nil {
		return err
	}
	logger.Info("starting informers, waiting for cache sync")
	if err := store.Start(ctx); err != nil {
		return err
	}
	logger.Info("informer caches synced")

	detectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	cniResult := cni.Detect(detectCtx, clientset, c.cniOverride)
	cancel()
	logger.Info("CNI detection", "provider", cniResult.Provider, "enforcesPolicies", cniResult.EnforcesPolicies)
	for _, warning := range cniResult.Warnings {
		logger.Warn(warning)
	}

	authn, err := auth.New(auth.Config{
		Mode: mode, Base: restConfig, Clientset: clientset,
		SessionSecret: secret, SessionTTL: c.sessionTTL,
		SecureCookie: c.secureCookie || c.tlsCert != "",
		UserHeader:   c.proxyUserHeader, GroupsHeader: c.proxyGroupsHeader,
		RestrictReads: c.restrictReads,
	})
	if c.restrictReads && mode == auth.ModeNone {
		logger.Warn("--restrict-reads has no effect with --auth-mode=none")
	}
	if err != nil {
		return err
	}

	auditLog := audit.New(c.auditSize, logger)
	var webhook *notify.Webhook
	if c.notifyURL != "" {
		format, err := notify.ParseFormat(c.notifyFormat)
		if err != nil {
			return err
		}
		webhook = notify.NewWebhook(c.notifyURL, format, logger)
		auditLog.AddSink(webhook.Send)
		logger.Info("policy change notifications enabled", "format", format)
	}

	metrics := api.NewMetrics(store)
	srv := api.NewServer(api.Options{
		Store: store, Clientset: clientset, CNI: cniResult, K8sVersion: serverVersion,
		ReadOnly: c.readOnly, Auth: authn, Audit: auditLog,
		Logger: logger, Metrics: metrics,
	})

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(api.RequestLogger(logger, metrics))
	r.Use(middleware.Recoverer)
	r.Use(api.SecurityHeaders(c.tlsCert != ""))
	r.Use(middleware.Compress(5, "application/json", "application/yaml", "text/html", "text/css",
		"text/javascript", "application/javascript", "image/svg+xml"))
	if c.metrics {
		r.Handle("/metrics", metrics.Handler())
	}
	srv.Routes(r)
	r.NotFound(spaHandler())

	httpServer := &http.Server{
		Addr:              c.listen,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       120 * time.Second,
		// No WriteTimeout: /api/v1/events is a long-lived stream.
		MaxHeaderBytes: 64 << 10,
	}
	httpServer.RegisterOnShutdown(srv.Close)

	errCh := make(chan error, 1)
	go func() {
		logger.Info("listening", "version", version.Version, "addr", c.listen, "cluster", serverVersion,
			"authMode", mode, "readOnly", c.readOnly, "tls", c.tlsCert != "")
		if c.tlsCert != "" {
			errCh <- httpServer.ListenAndServeTLS(c.tlsCert, c.tlsKey)
		} else {
			errCh <- httpServer.ListenAndServe()
		}
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), c.shutdownTimeout)
	defer cancelShutdown()
	err = httpServer.Shutdown(shutdownCtx)
	if webhook != nil {
		webhook.Close(shutdownCtx) // deliver queued notifications
	}
	return err
}

// spaHandler serves the embedded frontend. Unknown paths fall back to
// index.html (client-side routing). If the frontend has not been built,
// it serves a placeholder page.
func spaHandler() http.HandlerFunc {
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		panic(fmt.Sprintf("embedded assets: %v", err))
	}
	fileServer := http.FileServer(http.FS(dist))

	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if _, err := fs.Stat(dist, path); err == nil {
				// Vite emits content-hashed files under assets/.
				if strings.HasPrefix(path, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		index, err := fs.ReadFile(dist, "index.html")
		if err != nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = fmt.Fprintf(w, placeholderHTML, version.Version)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	}
}

const placeholderHTML = `<!doctype html>
<html>
<head><title>k8s-firewall-ui</title></head>
<body style="font-family: sans-serif; max-width: 40rem; margin: 4rem auto;">
<h1>k8s-firewall-ui %s</h1>
<p>The web UI is not embedded in this binary. Build it first:</p>
<pre>make web &amp;&amp; make backend</pre>
</body>
</html>`
