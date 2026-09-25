package api

import "sync"

// resultCache memoizes expensive derived results (posture analysis,
// namespace graph) for the current store generation. Any cluster change
// bumps the generation and implicitly invalidates every entry.
type resultCache struct {
	mu      sync.Mutex
	gen     uint64
	max     int
	entries map[string]any
}

func newResultCache(max int) *resultCache {
	return &resultCache{max: max, entries: map[string]any{}}
}

// get returns the cached value for key at generation gen, computing and
// storing it on a miss. compute runs outside the lock.
func (c *resultCache) get(gen uint64, key string, compute func() any) any {
	c.mu.Lock()
	if c.gen == gen {
		if v, ok := c.entries[key]; ok {
			c.mu.Unlock()
			return v
		}
	}
	c.mu.Unlock()

	v := compute()

	c.mu.Lock()
	defer c.mu.Unlock()
	if gen > c.gen || (gen == c.gen && len(c.entries) >= c.max) {
		c.gen = gen
		c.entries = map[string]any{}
	}
	if gen == c.gen {
		c.entries[key] = v
	}
	return v
}
