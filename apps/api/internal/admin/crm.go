package admin

// CRM endpoints: one contact with notes and activity, pipeline stage, tags and
// a star, private notes, and dashboard insights.

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/httpx"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/store"
)

const (
	maxTags    = 12
	maxTagLen  = 32
	maxNoteLen = 4000
)

func pathID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	return id, err == nil && id > 0
}

func storeError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		httpx.Error(w, http.StatusNotFound, "not found")
		return
	}
	httpx.Error(w, http.StatusInternalServerError, err.Error())
}

func (a *Admin) contact(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "bad id")
		return
	}
	c, err := a.store.Contact(r.Context(), id, bonuses())
	if err != nil {
		storeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"contact": c, "stages": store.Stages})
}

// cleanTags trims, lower-cases, de-duplicates and bounds tags.
func cleanTags(in []string) ([]string, bool) {
	out, seen := []string{}, map[string]bool{}
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(strings.ReplaceAll(t, ",", " ")))
		if t == "" || seen[t] {
			continue
		}
		if utf8.RuneCountInString(t) > maxTagLen {
			return nil, false
		}
		seen[t] = true
		out = append(out, t)
	}
	return out, len(out) <= maxTags
}

func (a *Admin) updateContact(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "bad id")
		return
	}
	var body struct {
		Stage   *string   `json:"stage"`
		Tags    *[]string `json:"tags"`
		Starred *bool     `json:"starred"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad json")
		return
	}
	if body.Stage != nil && !store.ValidStage(*body.Stage) {
		httpx.Error(w, http.StatusBadRequest, "unknown stage")
		return
	}
	if body.Tags != nil {
		tags, ok := cleanTags(*body.Tags)
		if !ok {
			httpx.Error(w, http.StatusBadRequest, "too many or too long tags")
			return
		}
		body.Tags = &tags
	}
	if err := a.store.UpdateContact(r.Context(), id, body.Stage, body.Tags, body.Starred); err != nil {
		storeError(w, err)
		return
	}
	a.contact(w, r)
}

func (a *Admin) addNote(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "bad id")
		return
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad json")
		return
	}
	text := strings.TrimSpace(body.Body)
	if text == "" || utf8.RuneCountInString(text) > maxNoteLen {
		httpx.Error(w, http.StatusBadRequest, "a note needs 1–4000 characters")
		return
	}
	n, err := a.store.AddNote(r.Context(), id, text)
	if err != nil {
		storeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"note": n})
}

func (a *Admin) deleteNote(w http.ResponseWriter, r *http.Request) {
	id, ok1 := pathID(r, "id")
	note, ok2 := pathID(r, "note")
	if !ok1 || !ok2 {
		httpx.Error(w, http.StatusBadRequest, "bad id")
		return
	}
	if err := a.store.DeleteNote(r.Context(), id, note); err != nil {
		storeError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *Admin) insights(w http.ResponseWriter, r *http.Request) {
	in, err := a.store.Insights(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, in)
}
