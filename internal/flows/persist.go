package flows

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// state is the on-disk format of a Store.
type state struct {
	Version int                  `json:"version"`
	Records []Record             `json:"records"`
	Agents  map[string]time.Time `json:"agents"`
}

// SaveFile writes the store to path atomically (gzip-compressed JSON).
func (s *Store) SaveFile(path string) error {
	st := state{Version: 1, Records: s.All(), Agents: s.Agents()}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".flows-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }() // no-op after a successful rename
	zw := gzip.NewWriter(tmp)
	if err := json.NewEncoder(zw).Encode(st); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := zw.Close(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// LoadFile restores flows saved by SaveFile, dropping expired ones. A
// missing file is not an error (first start).
func (s *Store) LoadFile(path string) (int, error) {
	f, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	defer func() { _ = f.Close() }()
	zr, err := gzip.NewReader(f)
	if err != nil {
		return 0, fmt.Errorf("reading %s: %w", path, err)
	}
	var st state
	if err := json.NewDecoder(zr).Decode(&st); err != nil {
		return 0, fmt.Errorf("reading %s: %w", path, err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range st.Records {
		if len(s.records) >= s.max {
			break
		}
		r := r
		if cur, ok := s.records[r.key()]; ok && cur.LastSeen.After(r.LastSeen) {
			continue
		}
		s.records[r.key()] = &r
	}
	for n, t := range st.Agents {
		if cur, ok := s.agents[n]; !ok || t.After(cur) {
			s.agents[n] = t
		}
	}
	s.pruneLocked(s.now())
	return len(s.records), nil
}

// Persist saves the store to path every interval and once more when ctx
// ends. The returned channel closes after the final save.
func (s *Store) Persist(ctx context.Context, path string, interval time.Duration, logger *slog.Logger) <-chan struct{} {
	done := make(chan struct{})
	save := func() {
		if err := s.SaveFile(path); err != nil {
			logger.Warn("saving observed flows failed", "path", path, "error", err)
		}
	}
	go func() {
		defer close(done)
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				save()
				return
			case <-t.C:
				save()
			}
		}
	}()
	return done
}
