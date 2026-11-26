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

func TestContactForm(t *testing.T) {
	e := setup(t)
	good := `{"name":"Asha","email":"asha@example.com","topic":"job","message":"We have a DevOps role you might like.","page":"/contact/","elapsed":9000}`
	// Needs the site's origin
	if rec, _ := e.do("POST", "/api/contact", good, "", false); rec.Code != 403 {
		t.Fatalf("no origin: %d", rec.Code)
	}
	// Validation
	rec, out := e.do("POST", "/api/contact", `{"name":"","email":"nope","message":"hi","elapsed":9000}`, "", true)
	if rec.Code != 400 || len(out["fields"].([]any)) != 3 {
		t.Fatalf("validation: %d %v", rec.Code, out)
	}
	// The honeypot looks accepted but stores nothing; too fast asks to send again
	if rec, _ := e.do("POST", "/api/contact", strings.Replace(good, `"elapsed":9000`, `"elapsed":9000,"website":"x"`, 1), "", true); rec.Code != 200 {
		t.Fatalf("honeypot: %d", rec.Code)
	}
	if rec, _ := e.do("POST", "/api/contact", strings.Replace(good, `"elapsed":9000`, `"elapsed":500`, 1), "", true); rec.Code != 400 {
		t.Fatalf("too fast: %d", rec.Code)
	}
	if n := e.st.UnreadMessages(context.Background()); n != 0 {
		t.Fatalf("bot messages stored: %d", n)
	}
	// A real one creates a tagged contact with the message
	if rec, _ := e.do("POST", "/api/contact", good, "", true); rec.Code != 200 {
		t.Fatalf("send: %d", rec.Code)
	}
	rec, _ = e.do("POST", "/api/admin/login", `{"username":"admin","password":"correct horse battery"}`, "", true)
	c := rec.Result().Cookies()[0]
	admin := c.Name + "=" + c.Value
	_, out = e.do("GET", "/api/admin/messages", "", admin, false)
	msgs := out["messages"].([]any)
	m := msgs[0].(map[string]any)
	if len(msgs) != 1 || out["unread"].(float64) != 1 || m["email"] != "asha@example.com" || m["topic"] != "job" {
		t.Fatalf("inbox: %v", out)
	}
	uid := strconv.Itoa(int(m["userId"].(float64)))
	_, out = e.do("GET", "/api/admin/visitors/"+uid, "", admin, false)
	ct := out["contact"].(map[string]any)
	if ct["tags"].([]any)[0] != "contact-form" || len(ct["messageList"].([]any)) != 1 {
		t.Fatalf("contact: %v", ct)
	}
	// A second message from the same address joins the same contact
	e.do("POST", "/api/contact", strings.Replace(good, "asha@", "ASHA@", 1), "", true)
	_, out = e.do("GET", "/api/admin/visitors", "", admin, false)
	if n := len(out["visitors"].([]any)); n != 1 {
		t.Fatalf("contacts after second message: %d", n)
	}
	// Mark read, delete
	mid := strconv.Itoa(int(m["id"].(float64)))
	if rec, out := e.do("PATCH", "/api/admin/messages/"+mid, `{"read":true}`, admin, true); rec.Code != 200 || out["unread"].(float64) != 1 {
		t.Fatalf("mark read: %d %v", rec.Code, out)
	}
	if rec, _ := e.do("DELETE", "/api/admin/messages/"+mid, "", admin, true); rec.Code != 200 {
		t.Fatalf("delete: %d", rec.Code)
	}
	// Per-IP limit: 5 accepted messages an hour
	for i := 0; i < 3; i++ {
		e.do("POST", "/api/contact", good, "", true)
	}
	if rec, _ := e.do("POST", "/api/contact", good, "", true); rec.Code != 429 {
		t.Fatalf("rate limit: %d", rec.Code)
	}
	// Inbox is admin-only
	if rec, _ := e.do("GET", "/api/admin/messages", "", "", false); rec.Code != 401 {
		t.Fatalf("inbox without admin: %d", rec.Code)
	}
}

func TestAnalytics(t *testing.T) {
	e := setup(t)
	hit := func(body, ua, ip string) int {
		req := httptest.NewRequest("POST", "/api/collect", strings.NewReader(body))
		req.Header.Set("Content-Type", "text/plain;charset=UTF-8") // what sendBeacon sends
		req.Header.Set("Origin", e.origin)
		req.Header.Set("User-Agent", ua)
		req.RemoteAddr = ip + ":1234"
		rec := httptest.NewRecorder()
		e.h.ServeHTTP(rec, req)
		return rec.Code
	}
	chrome := "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36"
	// Visitor 1 lands from LinkedIn on the terminal theme, reads two more pages, downloads the CV
	if c := hit(`{"k":"view","p":"/terminal/projects/vault","r":"https://www.linkedin.com/feed/","w":1400,"t":"terminal"}`, chrome, "10.0.0.1"); c != 204 {
		t.Fatalf("collect: %d", c)
	}
	hit(`{"k":"view","p":"/about/","r":"https://www.linkedin.com/feed/","w":1400,"t":"studio"}`, chrome, "10.0.0.1")
	hit(`{"k":"view","p":"/experience/?x=1","w":1400}`, chrome, "10.0.0.1")
	hit(`{"k":"cv","p":"/about/","l":"/uploads/cv.pdf"}`, chrome, "10.0.0.1")
	// Visitor 2: one page from a campaign link, on a phone
	hit(`{"k":"view","p":"/","s":"Newsletter","c":"Nov-Launch","w":390}`, chrome, "10.0.0.2")
	// Ignored: bots, unknown events, admin pages, junk
	hit(`{"k":"view","p":"/"}`, "Googlebot/2.1 (+http://www.google.com/bot.html)", "10.0.0.3")
	hit(`{"k":"view","p":"/"}`, "", "10.0.0.3")
	hit(`{"k":"purchase","p":"/"}`, chrome, "10.0.0.3")
	hit(`{"k":"view","p":"/admin/"}`, chrome, "10.0.0.3")
	hit(`{"k":"view","p":"https://evil.example/"}`, chrome, "10.0.0.3")
	hit(`not json`, chrome, "10.0.0.3")

	rec, _ := e.do("POST", "/api/admin/login", `{"username":"admin","password":"correct horse battery"}`, "", true)
	c := rec.Result().Cookies()[0]
	admin := c.Name + "=" + c.Value
	if rec, _ := e.do("GET", "/api/admin/analytics", "", "", false); rec.Code != 401 {
		t.Fatalf("analytics without admin: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/admin/analytics?days=7", nil)
	req.Header.Set("Cookie", admin)
	e.h.ServeHTTP(rec, req)
	var a store.Analytics
	if err := json.Unmarshal(rec.Body.Bytes(), &a); err != nil || rec.Code != 200 {
		t.Fatalf("analytics: %d %s", rec.Code, rec.Body.String())
	}
	if a.Totals.Visitors != 2 || a.Totals.Views != 4 || a.Totals.Events != 1 || a.Totals.Bounce != 0.5 {
		t.Fatalf("totals: %+v", a.Totals)
	}
	if len(a.Series) != 7 || a.Series[6].Views != 4 {
		t.Fatalf("series: %+v", a.Series)
	}
	find := func(list []store.Count, key string) int {
		for _, x := range list {
			if x.Key == key {
				return x.N
			}
		}
		return 0
	}
	if find(a.Pages, "/projects/vault/") != 1 || find(a.Pages, "/experience/") != 1 || a.Pages[0].V != 1 {
		t.Fatalf("paths not cleaned: %+v", a.Pages)
	}
	if find(a.Sources, "LinkedIn") != 1 || find(a.Sources, "newsletter") != 1 || len(a.Sources) != 2 {
		t.Fatalf("sources (entry only): %+v", a.Sources)
	}
	if find(a.Campaign, "nov-launch") != 1 || find(a.Devices, "mobile") != 1 || find(a.Themes, "terminal") != 1 {
		t.Fatalf("campaign/devices/themes: %+v %+v %+v", a.Campaign, a.Devices, a.Themes)
	}
	if len(a.Events) != 1 || a.Events[0].Key != "cv" || a.Events[0].Label != "/uploads/cv.pdf" || a.Events[0].N != 1 {
		t.Fatalf("events: %+v", a.Events)
	}
	// The dashboard's daily counter follows the beacon
	_, st := e.do("GET", "/api/admin/stats", "", admin, false)
	if st["stats"].(map[string]any)["viewsToday"].(float64) != 4 {
		t.Fatalf("page_views: %v", st["stats"])
	}
}

func TestDraftPreview(t *testing.T) {
	e := setup(t)
	rec, _ := e.do("POST", "/api/admin/login", `{"username":"admin","password":"correct horse battery"}`, "", true)
	c := rec.Result().Cookies()[0]
	admin := c.Name + "=" + c.Value
	// Not configured: no link
	if rec, _ := e.do("POST", "/api/admin/preview-link", `{"path":"/blog/x/"}`, admin, true); rec.Code != 404 {
		t.Fatalf("unconfigured: %d", rec.Code)
	}
	st, _ := store.Open(filepath.Join(t.TempDir(), "p.db"))
	defer st.Close()
	hash, _ := bcrypt.GenerateFromPassword([]byte("correct horse battery"), bcrypt.MinCost)
	cfg := &config.Config{SessionSecret: []byte(strings.Repeat("s", 32)), AdminUser: "admin", AdminHash: string(hash), OAuth: map[string]config.OAuthApp{}, PreviewURL: "https://preview.example.com"}
	h, _ := buildHandler(cfg, st)
	e = &env{t: t, h: h, st: st, origin: game.Catalog().SiteURL}
	rec, _ = e.do("POST", "/api/admin/login", `{"username":"admin","password":"correct horse battery"}`, "", true)
	c = rec.Result().Cookies()[0]
	admin = c.Name + "=" + c.Value
	if rec, _ := e.do("POST", "/api/admin/preview-link", `{"path":"/blog/x/"}`, "", true); rec.Code != 401 {
		t.Fatalf("link without admin: %d", rec.Code)
	}
	_, out := e.do("POST", "/api/admin/preview-link", `{"path":"/blog/x/"}`, admin, true)
	link := out["url"].(string)
	if !strings.HasPrefix(link, "https://preview.example.com/_preview/enter?t=link.") {
		t.Fatalf("link: %s", link)
	}
	q := link[strings.Index(link, "?"):]
	// No cookie: the check refuses
	if rec, _ := e.do("GET", "/api/preview/check", "", "", false); rec.Code != 401 {
		t.Fatalf("check without cookie: %d", rec.Code)
	}
	// A tampered link is refused
	if rec, _ := e.do("GET", "/api/preview/enter"+strings.Replace(q, "link.", "link.9", 1), "", "", false); rec.Code != 401 {
		t.Fatalf("tampered link: %d", rec.Code)
	}
	// The real link sets the cookie and goes to the page
	rec, _ = e.do("GET", "/api/preview/enter"+q, "", "", false)
	if rec.Code != 302 || rec.Header().Get("Location") != "/blog/x/" {
		t.Fatalf("enter: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	pc := rec.Result().Cookies()[0]
	if pc.Name != "pf_preview" || !pc.HttpOnly {
		t.Fatalf("cookie: %+v", pc)
	}
	if rec, _ := e.do("GET", "/api/preview/check", "", pc.Name+"="+pc.Value, false); rec.Code != 204 {
		t.Fatalf("check with cookie: %d", rec.Code)
	}
	// A link token is not a view token, and an open redirect is not possible
	if rec, _ := e.do("GET", "/api/preview/check", "", "pf_preview="+strings.TrimPrefix(q[3:strings.Index(q, "&")], ""), false); rec.Code != 401 {
		t.Fatalf("link token used as cookie: %d", rec.Code)
	}
	rec, _ = e.do("GET", "/api/preview/enter"+strings.Replace(q, "%2Fblog%2Fx%2F", "%2F%2Fevil.example", 1), "", "", false)
	if rec.Header().Get("Location") != "/" {
		t.Fatalf("open redirect: %s", rec.Header().Get("Location"))
	}
}
