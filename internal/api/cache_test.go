package api

import "testing"

func TestResultCache(t *testing.T) {
	c := newResultCache(2)
	calls := 0
	compute := func() any { calls++; return calls }

	first := c.get(1, "a", compute)
	second := c.get(1, "a", compute)
	if first != 1 || second != 1 || calls != 1 {
		t.Fatalf("same generation must hit: %v %v after %d computes", first, second, calls)
	}
	if c.get(2, "a", compute) != 2 {
		t.Fatal("a new generation must recompute")
	}
	if c.get(1, "a", compute) != 3 || c.get(2, "a", compute) != 2 {
		t.Fatal("a stale generation must neither hit nor evict the current one")
	}
	c.get(2, "b", compute)
	c.get(2, "c", compute) // exceeds max: resets the map
	if len(c.entries) > 2 {
		t.Fatalf("entries = %d, want bounded by max", len(c.entries))
	}
}
