package admin

// Edit history from Git: every admin save is a commit, so the history of a file
// (or of all content) is its commit list, and restoring a version is one more
// commit with the old content. Nothing is rewritten; a restore can be undone the
// same way.

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/httpx"
)

var commitSHA = regexp.MustCompile(`^[0-9a-f]{40}$`)

type historyEntry struct {
	Sha     string `json:"sha"`
	Message string `json:"message"`
	Author  string `json:"author"`
	Date    string `json:"date"`
	URL     string `json:"url"`
	Admin   bool   `json:"admin"` // made from the admin panel
}

// GET /api/admin/history?path=content/pages/about.json&limit=30 (path optional: all content)
func (a *Admin) history(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		p = "content"
	} else if !validPath(p) {
		httpx.Error(w, http.StatusBadRequest, "path not allowed")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	q := url.Values{"sha": {a.cfg.GitHubBranch}, "path": {p}, "per_page": {strconv.Itoa(limit)}}
	res, err := a.github(r.Context(), http.MethodGet, "/commits?"+q.Encode(), nil)
	a.relay(w, res, err, func(b []byte) (any, error) {
		var list []struct {
			Sha     string `json:"sha"`
			HTMLURL string `json:"html_url"`
			Commit  struct {
				Message string `json:"message"`
				Author  struct {
					Name string `json:"name"`
					Date string `json:"date"`
				} `json:"author"`
			} `json:"commit"`
		}
		if err := json.Unmarshal(b, &list); err != nil {
			return nil, err
		}
		out := []historyEntry{}
		for _, c := range list {
			msg := strings.SplitN(c.Commit.Message, "\n", 2)[0]
			out = append(out, historyEntry{Sha: c.Sha, Message: msg, Author: c.Commit.Author.Name, Date: c.Commit.Author.Date, URL: c.HTMLURL, Admin: strings.HasSuffix(msg, "(admin)")})
		}
		return map[string]any{"path": p, "history": out}, nil
	})
}

// POST /api/admin/restore {"path": "...", "commit": "<40-hex sha>"}
func (a *Admin) restore(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path   string `json:"path"`
		Commit string `json:"commit"`
	}
	if err := httpx.Decode(r, &body, 4<<10); err != nil || !validPath(body.Path) || !commitSHA.MatchString(body.Commit) {
		httpx.Error(w, http.StatusBadRequest, "bad request: a content path and a full commit sha are needed")
		return
	}
	ctx := r.Context()
	type file struct{ Content, Sha string }
	get := func(ref string) (*file, int, error) {
		res, err := a.github(ctx, http.MethodGet, "/contents/"+body.Path+"?ref="+ref, nil)
		if err != nil {
			return nil, 0, err
		}
		defer res.Body.Close()
		if res.StatusCode == http.StatusNotFound {
			return nil, 404, nil
		}
		if res.StatusCode >= 300 {
			return nil, res.StatusCode, fmt.Errorf("GitHub answered %d", res.StatusCode)
		}
		var f file
		if err := json.NewDecoder(res.Body).Decode(&f); err != nil {
			return nil, 0, err
		}
		return &f, res.StatusCode, nil
	}
	old, _, err := get(body.Commit)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	if old == nil {
		httpx.Error(w, http.StatusNotFound, "that version of the file doesn't exist")
		return
	}
	cur, _, err := get(a.cfg.GitHubBranch) // nil when the file was deleted since
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	content := strings.ReplaceAll(old.Content, "\n", "")
	if _, err := base64.StdEncoding.DecodeString(content); err != nil {
		httpx.Error(w, http.StatusBadGateway, "could not read the old version")
		return
	}
	req := map[string]string{
		"message": fmt.Sprintf("Restore %s to version %s (admin)", strings.TrimPrefix(body.Path, "content/"), body.Commit[:7]),
		"content": content, "branch": a.cfg.GitHubBranch,
	}
	if cur != nil {
		req["sha"] = cur.Sha
	}
	res, err := a.github(ctx, http.MethodPut, "/contents/"+body.Path, req)
	a.relay(w, res, err, func([]byte) (any, error) { return map[string]bool{"ok": true}, nil })
}
