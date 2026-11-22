// Package admin serves the custom admin panel's API: password sign-in, content
// editing (committed to GitHub, which triggers the deploy), media uploads,
// visitors and live statistics.
package admin

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/config"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/game"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/httpx"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/live"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/store"
)

const (
	cookieName = "pf_admin"
	sessionTTL = 12 * time.Hour
)

type Admin struct {
	cfg     *config.Config
	store   *store.Store
	hub     *live.Hub
	limiter *httpx.Limiter
	gh      *http.Client
	secure  bool
}

func New(cfg *config.Config, st *store.Store, hub *live.Hub) *Admin {
	return &Admin{cfg: cfg, store: st, hub: hub, limiter: httpx.NewLimiter(5, 10*time.Minute), gh: &http.Client{Timeout: 30 * time.Second}, secure: !cfg.Dev}
}

func (a *Admin) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/admin/login", a.login)
	mux.HandleFunc("POST /api/admin/logout", a.logout)
	mux.HandleFunc("GET /api/admin/me", a.auth(a.me))
	mux.HandleFunc("GET /api/admin/stats", a.auth(a.stats))
	mux.HandleFunc("GET /api/admin/visitors", a.auth(a.visitors))
	mux.HandleFunc("GET /api/admin/visitors.csv", a.auth(a.visitorsCSV))
	mux.HandleFunc("DELETE /api/admin/visitors/{id}", a.auth(a.deleteVisitor))
	mux.HandleFunc("GET /api/admin/files", a.auth(a.listFiles))
	mux.HandleFunc("GET /api/admin/file", a.auth(a.getFile))
	mux.HandleFunc("PUT /api/admin/file", a.auth(a.putFile))
	mux.HandleFunc("DELETE /api/admin/file", a.auth(a.deleteFile))
	mux.HandleFunc("GET /api/admin/deploys", a.auth(a.deploys))
}

// ---- sign-in ---------------------------------------------------------------

func (a *Admin) authLog(msg string) {
	line := fmt.Sprintf("%s %s\n", time.Now().UTC().Format(time.RFC3339), msg)
	if a.cfg.AuthLog == "" {
		log.Print(strings.TrimSpace(line))
		return
	}
	if f, err := os.OpenFile(a.cfg.AuthLog, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o640); err == nil {
		f.WriteString(line)
		f.Close()
	}
}

func (a *Admin) login(w http.ResponseWriter, r *http.Request) {
	ip := httpx.ClientIP(r)
	if !a.limiter.Allow(ip) {
		a.authLog("admin-login-throttled ip=" + ip)
		httpx.Error(w, http.StatusTooManyRequests, "too many attempts, try again in 10 minutes")
		return
	}
	var body struct{ Username, Password string }
	if httpx.Decode(r, &body, 4096) != nil {
		httpx.Error(w, http.StatusBadRequest, "bad request")
		return
	}
	userOK := a.cfg.AdminUser != "" && body.Username == a.cfg.AdminUser
	// Always run bcrypt so timing doesn't reveal whether the username exists.
	hash := a.cfg.AdminHash
	if hash == "" {
		hash = "$2a$14$invalidinvalidinvalidinvalidinvalidinvalidinvalidinval"
	}
	passOK := bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)) == nil
	if !userOK || !passOK {
		a.authLog("admin-login-failed ip=" + ip)
		time.Sleep(500 * time.Millisecond)
		httpx.Error(w, http.StatusUnauthorized, "wrong username or password")
		return
	}
	tok, err := a.store.NewSession(r.Context(), 0, "admin", sessionTTL)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "session error")
		return
	}
	a.authLog("admin-login-ok ip=" + ip)
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: tok, Path: "/api/admin", MaxAge: int(sessionTTL.Seconds()), HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteStrictMode})
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "user": a.cfg.AdminUser})
}

func (a *Admin) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		a.store.EndSession(r.Context(), c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/api/admin", MaxAge: -1, HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteStrictMode})
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *Admin) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "sign in required")
			return
		}
		if _, ok := a.store.Session(r.Context(), c.Value, "admin"); !ok {
			httpx.Error(w, http.StatusUnauthorized, "session expired")
			return
		}
		next(w, r)
	}
}

func (a *Admin) me(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"user": a.cfg.AdminUser, "repo": a.cfg.GitHubRepo, "contentEditing": a.cfg.GitHubToken != ""})
}

// ---- stats & visitors ------------------------------------------------------

func (a *Admin) stats(w http.ResponseWriter, r *http.Request) {
	st, err := a.store.Stats(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	total, pages := a.hub.Snapshot()
	httpx.JSON(w, http.StatusOK, map[string]any{"live": total, "livePages": pages, "stats": st})
}

func bonuses() map[string]int {
	m := map[string]int{}
	for _, a := range game.Catalog().Achievements {
		m[a.ID] = a.Bonus
	}
	return m
}

func (a *Admin) visitors(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.Users(r.Context(), bonuses())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if users == nil {
		users = []store.User{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"visitors": users})
}

func (a *Admin) visitorsCSV(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.Users(r.Context(), bonuses())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="visitors.csv"`)
	cw := csv.NewWriter(w)
	cw.Write([]string{"id", "name", "email", "signed_in_with", "xp", "coins", "joined", "last_seen"})
	ts := func(u int64) string { return time.Unix(u, 0).UTC().Format("2006-01-02 15:04") }
	// Prefix cells that spreadsheets would treat as formulas.
	safe := func(s string) string {
		if s != "" && strings.ContainsAny(s[:1], "=+-@\t\r") {
			return "'" + s
		}
		return s
	}
	for _, u := range users {
		cw.Write([]string{strconv.FormatInt(u.ID, 10), safe(u.Name), safe(u.Email), strings.Join(u.Providers, " "), strconv.Itoa(u.XP), strconv.Itoa(u.Coins), ts(u.CreatedAt), ts(u.LastSeen)})
	}
	cw.Flush()
}

func (a *Admin) deleteVisitor(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := a.store.DeleteUser(r.Context(), id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---- content via the GitHub API -------------------------------------------

var safePath = regexp.MustCompile(`^(content/[A-Za-z0-9_./-]+\.(json|md|mdx)|apps/site/public/uploads/[A-Za-z0-9_.-]+\.(png|jpe?g|gif|webp|svg|avif|pdf))$`)

func validPath(p string) bool {
	return safePath.MatchString(p) && !strings.Contains(p, "..") && path.Clean(p) == p
}

func (a *Admin) github(ctx context.Context, method, endpoint string, body any) (*http.Response, error) {
	if a.cfg.GitHubToken == "" {
		return nil, fmt.Errorf("content editing is not configured (no GitHub token on the server)")
	}
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequestWithContext(ctx, method, "https://api.github.com/repos/"+a.cfg.GitHubRepo+endpoint, rd)
	req.Header.Set("Authorization", "Bearer "+a.cfg.GitHubToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	return a.gh.Do(req)
}

func (a *Admin) relay(w http.ResponseWriter, res *http.Response, err error, transform func([]byte) (any, error)) {
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 20<<20))
	if res.StatusCode >= 300 {
		var gh struct{ Message string }
		json.Unmarshal(b, &gh)
		status := res.StatusCode
		if status == http.StatusConflict || status == 422 {
			gh.Message = "This file changed since you opened it. Reload it and apply your edit again. (" + gh.Message + ")"
		}
		httpx.Error(w, status, "GitHub: "+gh.Message)
		return
	}
	out, err := transform(b)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *Admin) listFiles(w http.ResponseWriter, r *http.Request) {
	res, err := a.github(r.Context(), http.MethodGet, "/git/trees/"+a.cfg.GitHubBranch+"?recursive=1", nil)
	a.relay(w, res, err, func(b []byte) (any, error) {
		var t struct {
			Tree []struct{ Path, Type, Sha string } `json:"tree"`
		}
		if err := json.Unmarshal(b, &t); err != nil {
			return nil, err
		}
		files := []map[string]string{}
		for _, e := range t.Tree {
			if e.Type == "blob" && validPath(e.Path) {
				files = append(files, map[string]string{"path": e.Path, "sha": e.Sha})
			}
		}
		return map[string]any{"files": files}, nil
	})
}

func (a *Admin) getFile(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if !validPath(p) {
		httpx.Error(w, http.StatusBadRequest, "path not allowed")
		return
	}
	res, err := a.github(r.Context(), http.MethodGet, "/contents/"+p+"?ref="+a.cfg.GitHubBranch, nil)
	a.relay(w, res, err, func(b []byte) (any, error) {
		var f struct{ Content, Sha, Encoding string }
		if err := json.Unmarshal(b, &f); err != nil {
			return nil, err
		}
		raw, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(f.Content, "\n", ""))
		if err != nil {
			return nil, err
		}
		return map[string]string{"path": p, "sha": f.Sha, "content": string(raw)}, nil
	})
}

type putBody struct {
	Path    string `json:"path"`
	Content string `json:"content"`           // text, or base64 when Binary
	Binary  bool   `json:"binary,omitempty"`  // uploads
	Sha     string `json:"sha,omitempty"`     // required when updating
	Message string `json:"message,omitempty"` // commit message
}

func (a *Admin) putFile(w http.ResponseWriter, r *http.Request) {
	var body putBody
	if err := httpx.Decode(r, &body, 15<<20); err != nil || !validPath(body.Path) {
		httpx.Error(w, http.StatusBadRequest, "bad request or path not allowed")
		return
	}
	content := body.Content
	if !body.Binary {
		if strings.HasSuffix(body.Path, ".json") && !json.Valid([]byte(body.Content)) {
			httpx.Error(w, http.StatusBadRequest, "not valid JSON")
			return
		}
		content = base64.StdEncoding.EncodeToString([]byte(body.Content))
	}
	msg := body.Message
	if msg == "" {
		verb := "Update"
		if body.Sha == "" {
			verb = "Create"
		}
		msg = fmt.Sprintf("%s %s (admin)", verb, strings.TrimPrefix(body.Path, "content/"))
	}
	req := map[string]string{"message": msg, "content": content, "branch": a.cfg.GitHubBranch}
	if body.Sha != "" {
		req["sha"] = body.Sha
	}
	res, err := a.github(r.Context(), http.MethodPut, "/contents/"+body.Path, req)
	a.relay(w, res, err, func(b []byte) (any, error) {
		var out struct {
			Content struct{ Sha string } `json:"content"`
			Commit  struct {
				Sha     string `json:"sha"`
				HTMLURL string `json:"html_url"`
			} `json:"commit"`
		}
		json.Unmarshal(b, &out)
		return map[string]string{"sha": out.Content.Sha, "commit": out.Commit.Sha}, nil
	})
}

func (a *Admin) deleteFile(w http.ResponseWriter, r *http.Request) {
	p, sha := r.URL.Query().Get("path"), r.URL.Query().Get("sha")
	if !validPath(p) || sha == "" {
		httpx.Error(w, http.StatusBadRequest, "bad request or path not allowed")
		return
	}
	req := map[string]string{"message": fmt.Sprintf("Delete %s (admin)", strings.TrimPrefix(p, "content/")), "sha": sha, "branch": a.cfg.GitHubBranch}
	res, err := a.github(r.Context(), http.MethodDelete, "/contents/"+p, req)
	a.relay(w, res, err, func([]byte) (any, error) { return map[string]bool{"ok": true}, nil })
}

func (a *Admin) deploys(w http.ResponseWriter, r *http.Request) {
	res, err := a.github(r.Context(), http.MethodGet, "/actions/runs?per_page=5&branch="+a.cfg.GitHubBranch, nil)
	a.relay(w, res, err, func(b []byte) (any, error) {
		var out struct {
			Runs []struct {
				ID           int64  `json:"id"`
				Status       string `json:"status"`
				Conclusion   string `json:"conclusion"`
				DisplayTitle string `json:"display_title"`
				CreatedAt    string `json:"created_at"`
				HTMLURL      string `json:"html_url"`
			} `json:"workflow_runs"`
		}
		if err := json.Unmarshal(b, &out); err != nil {
			return nil, err
		}
		return map[string]any{"runs": out.Runs}, nil
	})
}
