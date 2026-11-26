package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
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
	// A Quest palette needs the Quest theme first.
	rec, _ = e.do("POST", "/api/shop/buy", `{"item":"palette:quest-dungeon"}`, c, true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("palette before its theme: want 409, got %d", rec.Code)
	}
	item, _ := game.FindItem("theme:quest")
	rec, out = e.do("POST", "/api/shop/buy", `{"item":"theme:quest"}`, c, true)
	if rec.Code != 200 || coins(out) != before-item.Price {
		t.Fatalf("buy: %d coins %d → %d", rec.Code, before, coins(out))
	}
	_, out = e.do("POST", "/api/shop/buy", `{"item":"theme:quest"}`, c, true)
	if coins(out) != before-item.Price {
		t.Fatal("buying twice must not charge twice")
	}
	if rec, _ := e.do("POST", "/api/shop/buy", `{"item":"palette:quest-dungeon"}`, c, true); rec.Code != 200 {
		t.Fatalf("palette after its theme: want 200, got %d", rec.Code)
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

func TestAdminCRM(t *testing.T) {
	e := setup(t)
	rec, _ := e.do("POST", "/api/admin/login", `{"username":"admin","password":"correct horse battery"}`, "", true)
	c := rec.Result().Cookies()[0]
	admin := c.Name + "=" + c.Value
	user := e.user()
	e.do("POST", "/api/events", `{"events":{"visit:home":5}}`, user, true)
	_, list := e.do("GET", "/api/admin/visitors", "", admin, false)
	v := list["visitors"].([]any)[0].(map[string]any)
	id := strconv.Itoa(int(v["id"].(float64)))
	if v["stage"] != "new" {
		t.Fatalf("default stage: %v", v["stage"])
	}

	// Stage, tags and star
	if rec, _ := e.do("PATCH", "/api/admin/visitors/"+id, `{"stage":"bogus"}`, admin, true); rec.Code != 400 {
		t.Fatalf("unknown stage accepted: %d", rec.Code)
	}
	rec, out := e.do("PATCH", "/api/admin/visitors/"+id, `{"stage":"contacted","tags":[" Recruiter ","recruiter","AWS"],"starred":true}`, admin, true)
	ct := out["contact"].(map[string]any)
	if rec.Code != 200 || ct["stage"] != "contacted" || ct["starred"] != true || len(ct["tags"].([]any)) != 2 {
		t.Fatalf("update: %d %v", rec.Code, out)
	}

	// Notes
	if rec, _ := e.do("POST", "/api/admin/visitors/"+id+"/notes", `{"body":"   "}`, admin, true); rec.Code != 400 {
		t.Fatalf("empty note accepted: %d", rec.Code)
	}
	rec, out = e.do("POST", "/api/admin/visitors/"+id+"/notes", `{"body":"Emailed about a DevOps role"}`, admin, true)
	if rec.Code != 201 {
		t.Fatalf("add note: %d %v", rec.Code, out)
	}
	noteID := strconv.Itoa(int(out["note"].(map[string]any)["id"].(float64)))
	_, out = e.do("GET", "/api/admin/visitors/"+id, "", admin, false)
	ct = out["contact"].(map[string]any)
	if len(ct["notesList"].([]any)) != 1 || len(ct["activity"].([]any)) == 0 {
		t.Fatalf("contact detail: %v", ct)
	}
	if rec, _ := e.do("DELETE", "/api/admin/visitors/"+id+"/notes/"+noteID, "", admin, true); rec.Code != 200 {
		t.Fatalf("delete note: %d", rec.Code)
	}
	if rec, _ := e.do("GET", "/api/admin/visitors/999", "", admin, false); rec.Code != 404 {
		t.Fatalf("missing contact: %d", rec.Code)
	}

	// Insights
	rec, out = e.do("GET", "/api/admin/insights", "", admin, false)
	if rec.Code != 200 || out["stages"].(map[string]any)["contacted"].(float64) != 1 || out["active7d"].(float64) != 1 {
		t.Fatalf("insights: %d %v", rec.Code, out)
	}
	// Not for visitors
	if rec, _ := e.do("GET", "/api/admin/insights", "", user, false); rec.Code != 401 {
		t.Fatalf("insights without admin: %d", rec.Code)
	}
}

func TestAdminHistoryValidation(t *testing.T) {
	e := setup(t)
	rec, _ := e.do("POST", "/api/admin/login", `{"username":"admin","password":"correct horse battery"}`, "", true)
	c := rec.Result().Cookies()[0]
	admin := c.Name + "=" + c.Value
	if rec, _ := e.do("GET", "/api/admin/history?path=../etc/passwd", "", admin, false); rec.Code != 400 {
		t.Fatalf("history with a bad path: %d", rec.Code)
	}
	if rec, _ := e.do("POST", "/api/admin/restore", `{"path":"content/site.json","commit":"abc"}`, admin, true); rec.Code != 400 {
		t.Fatalf("restore with a short sha: %d", rec.Code)
	}
	if rec, _ := e.do("POST", "/api/admin/restore", `{"path":"/etc/passwd","commit":"`+strings.Repeat("a", 40)+`"}`, admin, true); rec.Code != 400 {
		t.Fatalf("restore outside content: %d", rec.Code)
	}
	if rec, _ := e.do("GET", "/api/admin/history", "", "", false); rec.Code != 401 {
		t.Fatalf("history without admin: %d", rec.Code)
	}
}
