// Package version holds build-time version information injected via ldflags.
package version

// Version is set at build time:
//
//	-ldflags "-X github.com/ismoilovdevml/k8s-firewall-ui/internal/version.Version=v0.1.0"
var Version = "dev"
