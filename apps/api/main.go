// portfolio-api: the small backend behind the static portfolio. It serves
// visitor sign-in and saved progress, the coin shop, live presence and cursors,
// and the admin panel's API. Caddy proxies /api/* to it.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/admin"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/analytics"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/auth"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/config"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/contact"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/game"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/httpx"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/live"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/preview"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/store"
)

type server struct {
	store *store.Store
	auth  *auth.Auth
	locks sync.Map // per-user mutex for purchases
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()

	handler, s := buildHandler(cfg, st)
	srv := &http.Server{Addr: cfg.Listen, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		for range time.Tick(time.Hour) {
			st.PruneSessions(context.Background())
		}
	}()
	go func() {
		log.Printf("portfolio-api listening on %s (%d events in catalog, sign-in: %v)", cfg.Listen, len(game.Catalog().Events), s.auth.Providers())
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}

// buildHandler wires every route; split out of main so tests can use it.
func buildHandler(cfg *config.Config, st *store.Store) (http.Handler, *server) {
	cat := game.Catalog()
	originURLs := []string{cat.SiteURL}
	if cfg.Dev {
		originURLs = append(originURLs, "http://localhost:4321", "http://localhost:4322", "http://localhost:4501", "http://localhost:4502", "http://localhost:4330", "http://localhost:4620")
	}
	origins := httpx.NewOrigins(originURLs...)

	s := &server{store: st, auth: auth.New(cfg, st, cat.SiteURL, cat.CookieDomain, origins)}
	// Page views are counted by the analytics beacon, not by live connections.
	hub := live.NewHub(origins, func(string) {})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { httpx.JSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/me", s.me)
	mux.HandleFunc("POST /api/events", s.events)
	mux.HandleFunc("POST /api/shop/buy", s.buy)
	mux.HandleFunc("DELETE /api/me", s.deleteMe)
	mux.HandleFunc("GET /api/auth/{provider}/start", s.auth.Start)
	mux.HandleFunc("GET /api/auth/{provider}/callback", s.auth.Callback)
	mux.HandleFunc("POST /api/auth/logout", s.auth.Logout)
	mux.Handle("GET /api/live", hub)
	admin.New(cfg, st, hub).Routes(mux)
	contact.New(cfg, st, cat.SiteURL).Routes(mux)
	analytics.New(st, cat.SiteURL).Routes(mux)
	preview.New(cfg.SessionSecret, !cfg.Dev).Routes(mux)
	if cfg.Dev {
		// Local testing only: sign in without an OAuth provider. Never enabled in
		// production (DEV is unset in /etc/portfolio-api/env).
		mux.HandleFunc("POST /api/dev/login", func(w http.ResponseWriter, r *http.Request) {
			uid, err := st.UpsertIdentity(r.Context(), store.Identity{Provider: "dev", ProviderID: "tester", Email: "tester@example.com", EmailVerified: true, Name: "Test Visitor"})
			if err != nil {
				httpx.Error(w, 500, err.Error())
				return
			}
			tok, _ := st.NewSession(r.Context(), uid, "user", time.Hour)
			http.SetCookie(w, &http.Cookie{Name: auth.SessionCookie, Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
			httpx.JSON(w, 200, map[string]bool{"ok": true})
		})
	}
	return origins.CORS(mux), s
}

func (s *server) stateFor(r *http.Request, uid int64) (*game.State, error) {
	gs, err := s.store.LoadState(r.Context(), uid)
	if err != nil {
		return nil, err
	}
	return &game.State{Events: gs.Events, Purchases: gs.Purchases, Ach: gs.Ach}, nil
}

// me: GET /api/me — who is signed in, their game state, and the shop.
func (s *server) me(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"providers": s.auth.Providers(), "shop": game.Catalog().Shop, "user": nil}
	if uid, ok := s.auth.UserID(r); ok {
		u, err := s.store.User(r.Context(), uid)
		if err == nil {
			st, err := s.stateFor(r, uid)
			if err == nil {
				s.store.Touch(r.Context(), uid)
				out["user"] = u
				out["state"] = game.Snap(st)
			}
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

// events: POST /api/events {"events":{"id":points,...}} — merge progress.
// Only catalog events are kept, at the catalog's value; anything else is ignored.
func (s *server) events(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.auth.UserID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "sign in to save progress")
		return
	}
	var body struct {
		Events map[string]int `json:"events"`
	}
	if err := httpx.Decode(r, &body, 64<<10); err != nil || len(body.Events) > 500 {
		httpx.Error(w, http.StatusBadRequest, "bad request")
		return
	}
	valid := map[string]int{}
	for id := range body.Events {
		if pts, ok := game.Points(id); ok {
			valid[id] = pts
		}
	}
	if err := s.store.AddEvents(r.Context(), uid, valid); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not save")
		return
	}
	st, err := s.stateFor(r, uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not load")
		return
	}
	if unlocked := game.Evaluate(st); len(unlocked) > 0 {
		s.store.AddAchievements(r.Context(), uid, unlocked)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"state": game.Snap(st)})
}

// buy: POST /api/shop/buy {"item":"theme:quest"}
func (s *server) buy(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.auth.UserID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "sign in to buy")
		return
	}
	var body struct {
		Item string `json:"item"`
	}
	if httpx.Decode(r, &body, 1024) != nil {
		httpx.Error(w, http.StatusBadRequest, "bad request")
		return
	}
	item, ok := game.FindItem(body.Item)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "no such item")
		return
	}
	mu, _ := s.locks.LoadOrStore(uid, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	defer mu.(*sync.Mutex).Unlock()

	st, err := s.stateFor(r, uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not load")
		return
	}
	if _, owned := st.Purchases[item.ID]; owned {
		httpx.JSON(w, http.StatusOK, map[string]any{"state": game.Snap(st)})
		return
	}
	if item.Requires != "" && !game.Owns(st, item.Requires) {
		req, _ := game.FindItem(item.Requires)
		httpx.JSON(w, http.StatusConflict, map[string]any{"error": "unlock " + req.Label + " first", "requires": item.Requires, "state": game.Snap(st)})
		return
	}
	if snap := game.Snap(st); snap.Coins < item.Price {
		httpx.JSON(w, http.StatusPaymentRequired, map[string]any{"error": "not enough coins", "state": snap})
		return
	}
	if err := s.store.Buy(r.Context(), uid, item.ID, item.Price); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not buy")
		return
	}
	st.Purchases[item.ID] = item.Price
	httpx.JSON(w, http.StatusOK, map[string]any{"state": game.Snap(st), "bought": item})
}

// deleteMe: DELETE /api/me — a visitor deletes their account and progress.
func (s *server) deleteMe(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.auth.UserID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "not signed in")
		return
	}
	if err := s.store.DeleteUser(r.Context(), uid); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not delete")
		return
	}
	s.auth.Logout(w, r)
}
