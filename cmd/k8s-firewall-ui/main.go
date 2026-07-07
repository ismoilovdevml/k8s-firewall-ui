// k8s-firewall-ui is a visual firewall dashboard for Kubernetes NetworkPolicies.
package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/ismoilovdevml/k8s-firewall-ui/internal/api"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/cni"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/kube"
	"github.com/ismoilovdevml/k8s-firewall-ui/internal/version"
	"github.com/ismoilovdevml/k8s-firewall-ui/web"
)

func main() {
	var (
		listen      = flag.String("listen", ":8080", "address to listen on")
		kubeconfig  = flag.String("kubeconfig", "", "path to kubeconfig (default: $KUBECONFIG, in-cluster, then ~/.kube/config)")
		cniOverride = flag.String("cni-override", "", "skip CNI auto-detection and trust this provider name")
		showVersion = flag.Bool("version", false, "print version and exit")
	)
	flag.Parse()

	if *showVersion {
		fmt.Println(version.Version)
		os.Exit(0)
	}

	if err := run(*listen, *kubeconfig, *cniOverride); err != nil {
		log.Fatal(err)
	}
}

func run(listen, kubeconfig, cniOverride string) error {
	ctx := context.Background()

	clientset, _, err := kube.NewClientset(kubeconfig)
	if err != nil {
		return err
	}

	serverVersion := "unknown"
	if v, err := clientset.Discovery().ServerVersion(); err == nil {
		serverVersion = v.GitVersion
	} else {
		log.Printf("warning: could not read server version: %v", err)
	}

	store, err := kube.NewStore(clientset)
	if err != nil {
		return err
	}
	log.Print("starting informers, waiting for cache sync...")
	if err := store.Start(ctx); err != nil {
		return err
	}
	log.Print("informer caches synced")

	detectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	cniResult := cni.Detect(detectCtx, clientset, cniOverride)
	cancel()
	log.Printf("CNI detection: provider=%s enforcesPolicies=%v", cniResult.Provider, cniResult.EnforcesPolicies)
	for _, warning := range cniResult.Warnings {
		log.Printf("warning: %s", warning)
	}

	srv := api.NewServer(store, clientset, cniResult, serverVersion)

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	srv.Routes(r)
	r.NotFound(spaHandler())

	log.Printf("k8s-firewall-ui %s listening on %s (cluster %s)", version.Version, listen, serverVersion)
	return http.ListenAndServe(listen, r)
}

// spaHandler serves the embedded frontend. Unknown paths fall back to
// index.html (client-side routing). If the frontend has not been built,
// it serves a placeholder page.
func spaHandler() http.HandlerFunc {
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		log.Fatalf("embedded assets: %v", err)
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
				fileServer.ServeHTTP(w, r)
				return
			}
		}
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
