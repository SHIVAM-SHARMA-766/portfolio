// Package preview guards the draft-preview site (a build that includes drafts,
// served by Caddy on its own host). The admin asks for a short-lived signed
// link; opening it swaps the link token for a preview cookie on the preview
// host, and Caddy's forward_auth asks /api/preview/check about every request.
// Tokens are stateless: "<purpose>.<expiry>.<hmac>", signed with SESSION_SECRET.
package preview

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	Cookie   = "pf_preview"
	LinkTTL  = 10 * time.Minute // how long an "open preview" link works
	ViewTTL  = 8 * time.Hour    // how long the preview cookie lasts
	purposeL = "link"
	purposeV = "view"
)

type Guard struct {
	secret []byte
	secure bool
}

func New(secret []byte, secure bool) *Guard { return &Guard{secret: secret, secure: secure} }

func (g *Guard) sign(purpose string, exp int64) string {
	m := hmac.New(sha256.New, g.secret)
	fmt.Fprintf(m, "preview|%s|%d", purpose, exp)
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (g *Guard) token(purpose string, ttl time.Duration) string {
	exp := time.Now().Add(ttl).Unix()
	return fmt.Sprintf("%s.%d.%s", purpose, exp, g.sign(purpose, exp))
}

func (g *Guard) valid(tok, purpose string) bool {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 || parts[0] != purpose {
		return false
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	return hmac.Equal([]byte(parts[2]), []byte(g.sign(purpose, exp)))
}

// Link returns a URL that opens path on the preview site.
func (g *Guard) Link(base, path string) string {
	if !safePath(path) {
		path = "/"
	}
	return strings.TrimRight(base, "/") + "/_preview/enter?t=" + g.token(purposeL, LinkTTL) + "&to=" + url.QueryEscape(path)
}

// safePath accepts only same-site absolute paths.
func safePath(p string) bool {
	return strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "//") && !strings.ContainsAny(p, "\\\r\n")
}

func (g *Guard) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/preview/enter", g.enter)
	mux.HandleFunc("GET /api/preview/check", g.check)
}

// enter: GET /api/preview/enter?t=…&to=/path/ (proxied from /_preview/enter on the preview host).
func (g *Guard) enter(w http.ResponseWriter, r *http.Request) {
	if !g.valid(r.URL.Query().Get("t"), purposeL) {
		expired(w)
		return
	}
	to := r.URL.Query().Get("to")
	if !safePath(to) {
		to = "/"
	}
	http.SetCookie(w, &http.Cookie{Name: Cookie, Value: g.token(purposeV, ViewTTL), Path: "/", MaxAge: int(ViewTTL.Seconds()), HttpOnly: true, Secure: g.secure, SameSite: http.SameSiteLaxMode})
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, to, http.StatusFound)
}

// check: Caddy's forward_auth for every preview request. 204 lets it through.
func (g *Guard) check(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(Cookie); err == nil && g.valid(c.Value, purposeV) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	expired(w)
}

func expired(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	w.WriteHeader(http.StatusUnauthorized)
	fmt.Fprint(w, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Draft preview</title>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#18181b">
<h1 style="font-size:1.4rem">This preview link has expired</h1>
<p>Draft previews are private. Open the page again from the admin panel with <b>Preview draft</b>.</p></body>`)
}
