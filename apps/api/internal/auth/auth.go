// Package auth handles visitor sign-in with GitHub, Google and LinkedIn (OAuth
// 2.0 / OpenID Connect) and the session cookie shared by both subdomains.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/endpoints"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/config"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/httpx"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/store"
)

const (
	SessionCookie = "pf_session"
	stateCookie   = "pf_oauth"
	SessionTTL    = 180 * 24 * time.Hour
)

type provider struct {
	cfg   *oauth2.Config
	fetch func(ctx context.Context, c *http.Client) (store.Identity, error)
}

type Auth struct {
	store        *store.Store
	secret       []byte
	providers    map[string]*provider
	siteURL      string
	cookieDomain string
	secure       bool
	origins      httpx.Origins
}

func New(cfg *config.Config, st *store.Store, siteURL, cookieDomain string, origins httpx.Origins) *Auth {
	a := &Auth{store: st, secret: cfg.SessionSecret, providers: map[string]*provider{}, siteURL: strings.TrimRight(siteURL, "/"),
		cookieDomain: cookieDomain, secure: !cfg.Dev, origins: origins}
	cb := func(p string) string { return a.siteURL + "/api/auth/" + p + "/callback" }
	if app, ok := cfg.OAuth["github"]; ok {
		a.providers["github"] = &provider{
			cfg:   &oauth2.Config{ClientID: app.ID, ClientSecret: app.Secret, Endpoint: endpoints.GitHub, RedirectURL: cb("github"), Scopes: []string{"read:user", "user:email"}},
			fetch: fetchGitHub,
		}
	}
	if app, ok := cfg.OAuth["google"]; ok {
		a.providers["google"] = &provider{
			cfg:   &oauth2.Config{ClientID: app.ID, ClientSecret: app.Secret, Endpoint: endpoints.Google, RedirectURL: cb("google"), Scopes: []string{"openid", "email", "profile"}},
			fetch: fetchOIDC("google", "https://openidconnect.googleapis.com/v1/userinfo"),
		}
	}
	if app, ok := cfg.OAuth["linkedin"]; ok {
		a.providers["linkedin"] = &provider{
			cfg: &oauth2.Config{ClientID: app.ID, ClientSecret: app.Secret, RedirectURL: cb("linkedin"), Scopes: []string{"openid", "profile", "email"},
				Endpoint: oauth2.Endpoint{AuthURL: "https://www.linkedin.com/oauth/v2/authorization", TokenURL: "https://www.linkedin.com/oauth/v2/accessToken", AuthStyle: oauth2.AuthStyleInParams}},
			fetch: fetchOIDC("linkedin", "https://api.linkedin.com/v2/userinfo"),
		}
	}
	return a
}

// Providers lists the sign-in options that are configured.
func (a *Auth) Providers() []string {
	var out []string
	for _, p := range []string{"google", "github", "linkedin"} {
		if a.providers[p] != nil {
			out = append(out, p)
		}
	}
	return out
}

// UserID returns the signed-in visitor, if any.
func (a *Auth) UserID(r *http.Request) (int64, bool) {
	c, err := r.Cookie(SessionCookie)
	if err != nil {
		return 0, false
	}
	return a.store.Session(r.Context(), c.Value, "user")
}

func (a *Auth) cookie(name, value string, maxAge int) *http.Cookie {
	c := &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode}
	if a.cookieDomain != "" && a.secure {
		c.Domain = strings.TrimPrefix(a.cookieDomain, ".")
	}
	return c
}

func (a *Auth) sign(v string) string {
	m := hmac.New(sha256.New, a.secret)
	m.Write([]byte(v))
	return v + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (a *Auth) verify(signed string) (string, bool) {
	i := strings.LastIndex(signed, ".")
	if i < 0 {
		return "", false
	}
	v := signed[:i]
	return v, hmac.Equal([]byte(a.sign(v)), []byte(signed))
}

// safeReturn only allows redirects back to our own sites.
func (a *Auth) safeReturn(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || !a.origins[u.Scheme+"://"+u.Host] {
		return a.siteURL + "/"
	}
	return u.String()
}

// Start: GET /api/auth/{provider}/start?return=<url>
func (a *Auth) Start(w http.ResponseWriter, r *http.Request) {
	p := a.providers[r.PathValue("provider")]
	if p == nil {
		httpx.Error(w, http.StatusNotFound, "sign-in provider not configured")
		return
	}
	b := make([]byte, 16)
	rand.Read(b)
	state := base64.RawURLEncoding.EncodeToString(b)
	ret := a.safeReturn(r.URL.Query().Get("return"))
	payload := state + "|" + base64.RawURLEncoding.EncodeToString([]byte(ret))
	http.SetCookie(w, a.cookie(stateCookie, a.sign(payload), 600))
	http.Redirect(w, r, p.cfg.AuthCodeURL(state), http.StatusFound)
}

// Callback: GET /api/auth/{provider}/callback
func (a *Auth) Callback(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("provider")
	p := a.providers[name]
	c, err := r.Cookie(stateCookie)
	if p == nil || err != nil {
		http.Redirect(w, r, a.siteURL+"/?login=failed", http.StatusFound)
		return
	}
	http.SetCookie(w, a.cookie(stateCookie, "", -1))
	payload, ok := a.verify(c.Value)
	parts := strings.SplitN(payload, "|", 2)
	if !ok || len(parts) != 2 || parts[0] != r.URL.Query().Get("state") {
		http.Redirect(w, r, a.siteURL+"/?login=failed", http.StatusFound)
		return
	}
	retBytes, _ := base64.RawURLEncoding.DecodeString(parts[1])
	ret := a.safeReturn(string(retBytes))
	fail := func(why string, err error) {
		log.Printf("auth %s: %s: %v", name, why, err)
		sep := "?"
		if strings.Contains(ret, "?") {
			sep = "&"
		}
		http.Redirect(w, r, ret+sep+"login=failed", http.StatusFound)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	tok, err := p.cfg.Exchange(ctx, r.URL.Query().Get("code"))
	if err != nil {
		fail("exchange", err)
		return
	}
	id, err := p.fetch(ctx, p.cfg.Client(ctx, tok))
	if err != nil {
		fail("profile", err)
		return
	}
	uid, err := a.store.UpsertIdentity(ctx, id)
	if err != nil {
		fail("store", err)
		return
	}
	sess, err := a.store.NewSession(ctx, uid, "user", SessionTTL)
	if err != nil {
		fail("session", err)
		return
	}
	http.SetCookie(w, a.cookie(SessionCookie, sess, int(SessionTTL.Seconds())))
	sep := "?"
	if strings.Contains(ret, "?") {
		sep = "&"
	}
	http.Redirect(w, r, ret+sep+"login=ok", http.StatusFound)
}

// Logout: POST /api/auth/logout
func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(SessionCookie); err == nil {
		a.store.EndSession(r.Context(), c.Value)
	}
	http.SetCookie(w, a.cookie(SessionCookie, "", -1))
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---- provider profile fetchers --------------------------------------------

func getJSON(c *http.Client, ctx context.Context, u string, v any) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	req.Header.Set("Accept", "application/json")
	res, err := c.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("%s: %d %s", u, res.StatusCode, b)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(v)
}

func fetchGitHub(ctx context.Context, c *http.Client) (store.Identity, error) {
	var u struct {
		ID        int64  `json:"id"`
		Login     string `json:"login"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
		HTMLURL   string `json:"html_url"`
	}
	if err := getJSON(c, ctx, "https://api.github.com/user", &u); err != nil {
		return store.Identity{}, err
	}
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	id := store.Identity{Provider: "github", ProviderID: fmt.Sprint(u.ID), Name: u.Name, Avatar: u.AvatarURL, ProfileURL: u.HTMLURL}
	if id.Name == "" {
		id.Name = u.Login
	}
	if err := getJSON(c, ctx, "https://api.github.com/user/emails", &emails); err == nil {
		for _, e := range emails {
			if e.Primary {
				id.Email, id.EmailVerified = e.Email, e.Verified
			}
		}
	}
	return id, nil
}

// fetchOIDC reads the standard OpenID Connect userinfo endpoint (Google, LinkedIn).
func fetchOIDC(name, endpoint string) func(context.Context, *http.Client) (store.Identity, error) {
	return func(ctx context.Context, c *http.Client) (store.Identity, error) {
		var u struct {
			Sub           string `json:"sub"`
			Name          string `json:"name"`
			Email         string `json:"email"`
			EmailVerified any    `json:"email_verified"` // bool, or "true" on some providers
			Picture       string `json:"picture"`
		}
		if err := getJSON(c, ctx, endpoint, &u); err != nil {
			return store.Identity{}, err
		}
		verified := u.EmailVerified == true || u.EmailVerified == "true"
		return store.Identity{Provider: name, ProviderID: u.Sub, Email: u.Email, EmailVerified: verified, Name: u.Name, Avatar: u.Picture}, nil
	}
}
