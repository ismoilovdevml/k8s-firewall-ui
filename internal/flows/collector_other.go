//go:build !linux

package flows

import "errors"

// Collect is only supported on Linux nodes.
func Collect() ([]Flow, error) { return nil, errors.New("flow collection requires Linux") }
