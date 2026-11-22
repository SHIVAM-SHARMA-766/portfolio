package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/config"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/game"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/store"
)

type env struct {
	t      *testing.T
	h      http.Handler
	st     *store.Store
	origin string
}

func setup(t *testing.T) *env {
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	hash, _ := bcrypt.GenerateFromPassword([]byte("correct horse battery"), bcrypt.MinCost)
	cfg := &config.Config{SessionSecret: []byte(strings.Repeat("s", 32)), AdminUser: "admin", AdminHash: string(hash), OAuth: map[string]config.OAuthApp{}}
	h, _ := buildHandler(cfg, st)
	return &env{t: t, h: h, st: st, origin: game.Catalog().SiteURL}
}

func (e *env) do(method, path, body, cookie string, origin bool) (*httptest.ResponseRecorder, map[string]any) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if origin {
		req.Header.Set("Origin", e.origin)
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func (e *env) user() string {
	uid, err := e.st.UpsertIdentity(context.Background(), store.Identity{Provider: "github", ProviderID: "1", Email: "a@example.com", EmailVerified: true, Name: "A"})
	if err != nil {
		e.t.Fatal(err)
	}
	tok, _ := e.st.NewSession(context.Background(), uid, "user", time.Hour)
	return "pf_session=" + tok
}

func coins(out map[string]any) int { return int(out["state"].(map[string]any)["coins"].(float64)) }

func TestEventsAreValidatedAgainstCatalog(t *testing.T) {
	e := setup(t)
	c := e.user()
	rec, out := e.do("POST", "/api/events", `{"events":{"visit:home":999,"visit:made-up":50,"secret:konami":0}}`, c, true)
	if rec.Code != 200 {
		t.Fatalf("status %d %v", rec.Code, out)
	}
	ev := out["state"].(map[string]any)["events"].(map[string]any)
	want, _ := game.Points("visit:home")
	if int(ev["visit:home"].(float64)) != want {
		t.Fatalf("client points must be replaced by catalog points, got %v", ev["visit:home"])
	}
	if _, ok := ev["visit:made-up"]; ok {
		t.Fatal("unknown event was stored")
	}
	if !out["state"].(map[string]any)["achievements"].(map[string]any)["konami"].(bool) {
		t.Fatal("konami achievement should unlock")
	}
}

func TestShop(t *testing.T) {
	e := setup(t)
	c := e.user()
	rec, out := e.do("POST", "/api/shop/buy", `{"item":"theme:quest"}`, c, true)
	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402 with no coins, got %d", rec.Code)
	}
	all := map[string]int{}
	for id := range game.Catalog().Events {
		all[id] = 1
	}
	b, _ := json.Marshal(map[string]any{"events": all})
	_, out = e.do("POST", "/api/events", string(b), c, true)
	before := coins(out)
	item, _ := game.FindItem("theme:quest")
	rec, out = e.do("POST", "/api/shop/buy", `{"item":"theme:quest"}`, c, true)
	if rec.Code != 200 || coins(out) != before-item.Price {
		t.Fatalf("buy: %d coins %d → %d", rec.Code, before, coins(out))
	}
	_, out = e.do("POST", "/api/shop/buy", `{"item":"theme:quest"}`, c, true)
	if coins(out) != before-item.Price {
		t.Fatal("buying twice must not charge twice")
	}
}

func TestWritesNeedOriginAndSession(t *testing.T) {
	e := setup(t)
	c := e.user()
	if rec, _ := e.do("POST", "/api/events", `{"events":{}}`, c, false); rec.Code != http.StatusForbidden {
		t.Fatalf("missing origin: want 403, got %d", rec.Code)
	}
	if rec, _ := e.do("POST", "/api/events", `{"events":{}}`, "", true); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session: want 401, got %d", rec.Code)
	}
	_, out := e.do("GET", "/api/me", "", "", false)
	if out["user"] != nil {
		t.Fatal("anonymous /api/me must have no user")
	}
}

func TestAdminLoginAndLimit(t *testing.T) {
	e := setup(t)
	if rec, _ := e.do("GET", "/api/admin/visitors", "", "", false); rec.Code != 401 {
		t.Fatalf("admin without session: %d", rec.Code)
	}
	rec, _ := e.do("POST", "/api/admin/login", `{"username":"admin","password":"correct horse battery"}`, "", true)
	if rec.Code != 200 {
		t.Fatalf("login: %d", rec.Code)
	}
	cookie := rec.Result().Cookies()[0]
	e.user()
	rec, out := e.do("GET", "/api/admin/visitors", "", cookie.Name+"="+cookie.Value, false)
	if rec.Code != 200 || len(out["visitors"].([]any)) != 1 {
		t.Fatalf("visitors: %d %v", rec.Code, out)
	}
	// Successful sign-ins never count towards the limit.
	for i := 0; i < 6; i++ {
		if rec, _ := e.do("POST", "/api/admin/login", `{"username":"admin","password":"correct horse battery"}`, "", true); rec.Code != 200 {
			t.Fatalf("repeated good logins must not be throttled: %d", rec.Code)
		}
	}
	codes := []int{}
	for i := 0; i < 6; i++ {
		rec, _ := e.do("POST", "/api/admin/login", `{"username":"admin","password":"nope"}`, "", true)
		codes = append(codes, rec.Code)
	}
	if codes[len(codes)-1] != http.StatusTooManyRequests {
		t.Fatalf("expected throttling, got %v", codes)
	}
}
