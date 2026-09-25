package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	sessionCookie = "fwui_session"
	// maxCookieBytes keeps the cookie under the common 4 KiB browser limit.
	maxCookieBytes = 3900
)

type session struct {
	User    string   `json:"u"`
	Groups  []string `json:"g"`
	Token   string   `json:"t"`
	Expires int64    `json:"e"`
}

// sessionCodec seals sessions with AES-256-GCM. The cookie is opaque and
// tamper-proof; the bearer token inside never reaches browser JavaScript.
type sessionCodec struct {
	aead cipher.AEAD
}

func newSessionCodec(secret string) (*sessionCodec, error) {
	var key [32]byte
	if secret == "" {
		if _, err := io.ReadFull(rand.Reader, key[:]); err != nil {
			return nil, fmt.Errorf("generating session key: %w", err)
		}
	} else {
		key = sha256.Sum256([]byte(secret))
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &sessionCodec{aead: aead}, nil
}

func (c *sessionCodec) encode(s session) (string, error) {
	plain, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := c.aead.Seal(nonce, nonce, plain, []byte(sessionCookie))
	out := base64.RawURLEncoding.EncodeToString(sealed)
	if len(out) > maxCookieBytes {
		return "", errors.New("token is too large to keep in a session cookie")
	}
	return out, nil
}

func (c *sessionCodec) decode(value string, now time.Time) (session, error) {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return session{}, err
	}
	ns := c.aead.NonceSize()
	if len(raw) < ns {
		return session{}, errors.New("session too short")
	}
	plain, err := c.aead.Open(nil, raw[:ns], raw[ns:], []byte(sessionCookie))
	if err != nil {
		return session{}, errors.New("session invalid")
	}
	var s session
	if err := json.Unmarshal(plain, &s); err != nil {
		return session{}, err
	}
	if now.Unix() >= s.Expires {
		return session{}, errors.New("session expired")
	}
	return s, nil
}

// --- tiny JSON helpers (duplicated from package api to avoid a cycle) ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]map[string]string{"error": {"code": code, "message": message}})
}

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 64<<10))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}
