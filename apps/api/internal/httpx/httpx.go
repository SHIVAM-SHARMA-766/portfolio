// Package httpx has small HTTP helpers shared by the handlers.
package httpx

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func Error(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, map[string]string{"error": msg})
}

// Decode reads a JSON body of at most max bytes.
func Decode(r *http.Request, v any, max int64) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, max))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// ClientIP trusts X-Forwarded-For only from the local reverse proxy (Caddy).
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	return host
}

// Origins is the set of origins allowed to call the API with credentials.
type Origins map[string]bool

func NewOrigins(urls ...string) Origins {
	o := Origins{}
	for _, u := range urls {
		if p, err := url.Parse(u); err == nil && p.Host != "" {
			o[p.Scheme+"://"+p.Host] = true
		}
	}
	return o
}

func (o Origins) Hosts() []string {
	var hs []string
	for k := range o {
		if p, err := url.Parse(k); err == nil {
			hs = append(hs, p.Host)
		}
	}
	return hs
}

// CORS lets the learn subdomain call the API with cookies, and rejects
// state-changing requests from any other origin (CSRF protection on top of
// SameSite cookies).
func (o Origins) CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && o[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin == "" || !o[origin] {
				Error(w, http.StatusForbidden, "origin not allowed")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// Limiter is a fixed-window counter per key.
type Limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string]*bucket
}

type bucket struct {
	n     int
	reset time.Time
}

func NewLimiter(max int, window time.Duration) *Limiter {
	l := &Limiter{max: max, window: window, hits: map[string]*bucket{}}
	go func() {
		for range time.Tick(window) {
			l.mu.Lock()
			for k, b := range l.hits {
				if time.Now().After(b.reset) {
					delete(l.hits, k)
				}
			}
			l.mu.Unlock()
		}
	}()
	return l
}

// Blocked reports whether the key has used up its allowance, without counting.
func (l *Limiter) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.hits[key]
	return b != nil && time.Now().Before(b.reset) && b.n >= l.max
}

// Allow records a hit and reports whether the key is still under the limit.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.hits[key]
	if b == nil || time.Now().After(b.reset) {
		b = &bucket{reset: time.Now().Add(l.window)}
		l.hits[key] = b
	}
	b.n++
	return b.n <= l.max
}
