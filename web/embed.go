// Package web embeds the built frontend assets (web/dist).
// dist/.gitkeep is committed so `go build` works before the frontend is built;
// in that case the server falls back to a placeholder page.
package web

import "embed"

//go:embed all:dist
var Dist embed.FS
