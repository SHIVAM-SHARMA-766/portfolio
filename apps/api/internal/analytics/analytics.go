// Package analytics is the site's own cookie-free page analytics:
// POST /api/collect receives a page view or an event from a small beacon.
//
// Privacy: no cookies, nothing stored in the browser, no IP addresses kept. A
// visitor is a hash of (secret salt, day, IP, user agent); the salt is random,
// lives only in memory and is replaced every day, so hashes cannot be reversed
// or linked across days. Bots and the admin's own visits are not counted.
package analytics

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/httpx"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/store"
)

// RetentionDays is how long hits are kept.
const RetentionDays = 400

// Events the beacon may send besides page views.
var Events = map[string]bool{"cv": true, "email": true, "copy-email": true, "outbound": true, "contact": true, "theme": true}

var bots = regexp.MustCompile(`(?i)bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|curl|wget|python|go-http|java/|okhttp|axios|node-fetch|monitor|uptime`)

var themes = map[string]bool{"studio": true, "terminal": true, "quest": true}

type Collector struct {
	store   *store.Store
	siteHst string
	limit   *httpx.Limiter
	mu      sync.Mutex
	day     string
	salt    []byte
}

func New(st *store.Store, siteURL string) *Collector {
	host := ""
	if u, err := url.Parse(siteURL); err == nil {
		host = u.Hostname()
	}
	c := &Collector{store: st, siteHst: host, limit: httpx.NewLimiter(300, 10*time.Minute)}
	go func() {
		for range time.Tick(24 * time.Hour) {
			st.PruneHits(context.Background(), RetentionDays)
		}
	}()
	return c
}

func (c *Collector) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/collect", c.collect)
}

// visitor returns today's anonymous id for a request.
func (c *Collector) visitor(ip, ua string) string {
	c.mu.Lock()
	day := time.Now().UTC().Format("2006-01-02")
	if day != c.day {
		c.day, c.salt = day, make([]byte, 32)
		rand.Read(c.salt)
	}
	salt := c.salt
	c.mu.Unlock()
	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(day + "|" + ip + "|" + ua))
	return hex.EncodeToString(h.Sum(nil))[:20]
}

type beacon struct {
	Kind     string `json:"k"` // "view" or an event
	Path     string `json:"p"`
	Label    string `json:"l"`
	Referrer string `json:"r"`
	Source   string `json:"s"` // utm_source
	Campaign string `json:"c"` // utm_campaign
	Width    int    `json:"w"`
	Theme    string `json:"t"`
}

func cut(s string, n int) string {
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	if len(s) > n {
		s = s[:n]
	}
	return s
}

// cleanPath drops the query, a theme prefix (/terminal/…) and bounds the length.
func cleanPath(p string) string {
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") {
		return ""
	}
	parts := strings.SplitN(strings.TrimPrefix(p, "/"), "/", 2)
	if themes[parts[0]] {
		p = "/"
		if len(parts) == 2 {
			p += parts[1]
		}
	}
	if p != "/" && !strings.HasSuffix(p, "/") && !strings.Contains(p[strings.LastIndex(p, "/"):], ".") {
		p += "/"
	}
	return cut(p, 200)
}

// Known sources, so google.co.in and google.com read as one.
var named = []struct {
	re   *regexp.Regexp
	name string
}{
	{regexp.MustCompile(`(^|\.)google\.`), "Google"},
	{regexp.MustCompile(`(^|\.)(linkedin\.com|lnkd\.in)$`), "LinkedIn"},
	{regexp.MustCompile(`(^|\.)github\.(com|io)$`), "GitHub"},
	{regexp.MustCompile(`(^|\.)(t\.co|twitter\.com|x\.com)$`), "X / Twitter"},
	{regexp.MustCompile(`(^|\.)bing\.com$`), "Bing"},
	{regexp.MustCompile(`(^|\.)duckduckgo\.com$`), "DuckDuckGo"},
	{regexp.MustCompile(`(^|\.)reddit\.com$`), "Reddit"},
	{regexp.MustCompile(`(^|\.)news\.ycombinator\.com$`), "Hacker News"},
	{regexp.MustCompile(`(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai)$`), "AI assistants"},
	{regexp.MustCompile(`(^|\.)(mail\.google\.com|outlook\.(live|office)\.com)$`), "Email"},
}

func (c *Collector) source(utm, ref string) string {
	if utm = cut(strings.ToLower(utm), 60); utm != "" {
		return utm
	}
	u, err := url.Parse(ref)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	if host == c.siteHst || strings.HasSuffix(host, "."+c.siteHst) || host == "localhost" {
		return ""
	}
	for _, n := range named {
		if n.re.MatchString(host) {
			return n.name
		}
	}
	return cut(host, 80)
}

func device(w int) string {
	switch {
	case w <= 0:
		return ""
	case w < 640:
		return "mobile"
	case w < 1024:
		return "tablet"
	}
	return "desktop"
}

func (c *Collector) collect(w http.ResponseWriter, r *http.Request) {
	// Always 204: the beacon never waits on, or learns from, the answer.
	defer w.WriteHeader(http.StatusNoContent)
	ua := r.UserAgent()
	if ua == "" || bots.MatchString(ua) {
		return
	}
	ip := httpx.ClientIP(r)
	if !c.limit.Allow(ip) {
		return
	}
	var b beacon
	// sendBeacon posts text/plain, so accept any content type.
	if err := httpx.Decode(r, &b, 4<<10); err != nil {
		return
	}
	if b.Kind != "view" && !Events[b.Kind] {
		return
	}
	p := cleanPath(b.Path)
	if p == "" || strings.HasPrefix(p, "/admin") || strings.HasPrefix(p, "/api") {
		return
	}
	h := store.Hit{VID: c.visitor(ip, ua), Kind: b.Kind, Path: p, Label: cut(b.Label, 100), Device: device(b.Width)}
	if themes[b.Theme] {
		h.Theme = b.Theme
	}
	if b.Kind == "view" {
		h.Source = c.source(b.Source, b.Referrer)
		h.Campaign = cut(strings.ToLower(b.Campaign), 60)
	}
	c.store.AddHit(r.Context(), h)
}
