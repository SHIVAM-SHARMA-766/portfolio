// Package store is the SQLite persistence layer: users and their sign-in
// identities, sessions, awarded events, achievements, purchases and page-view
// counters. SQLite in WAL mode is plenty for a personal site on one VM.
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id          INTEGER PRIMARY KEY,
	email       TEXT NOT NULL DEFAULT '',
	name        TEXT NOT NULL DEFAULT '',
	avatar      TEXT NOT NULL DEFAULT '',
	created_at  INTEGER NOT NULL,
	last_seen   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_email ON users(email);
CREATE TABLE IF NOT EXISTS identities (
	provider     TEXT NOT NULL,
	provider_id  TEXT NOT NULL,
	user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	profile_url  TEXT NOT NULL DEFAULT '',
	created_at   INTEGER NOT NULL,
	PRIMARY KEY (provider, provider_id)
);
CREATE TABLE IF NOT EXISTS sessions (
	token_hash  TEXT PRIMARY KEY,
	user_id     INTEGER NOT NULL DEFAULT 0,
	kind        TEXT NOT NULL,          -- 'user' or 'admin'
	created_at  INTEGER NOT NULL,
	expires_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	event_id    TEXT NOT NULL,
	points      INTEGER NOT NULL,
	created_at  INTEGER NOT NULL,
	PRIMARY KEY (user_id, event_id)
);
CREATE TABLE IF NOT EXISTS achievements (
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	ach_id      TEXT NOT NULL,
	created_at  INTEGER NOT NULL,
	PRIMARY KEY (user_id, ach_id)
);
CREATE TABLE IF NOT EXISTS purchases (
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	item_id     TEXT NOT NULL,
	price       INTEGER NOT NULL,
	created_at  INTEGER NOT NULL,
	PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS page_views (
	day    TEXT NOT NULL,
	path   TEXT NOT NULL,
	views  INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, path)
);
`

func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // one writer; avoids SQLITE_BUSY under load
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func now() int64 { return time.Now().Unix() }

// ---- users & identities ----------------------------------------------------

type User struct {
	ID        int64    `json:"id"`
	Email     string   `json:"email"`
	Name      string   `json:"name"`
	Avatar    string   `json:"avatar"`
	CreatedAt int64    `json:"createdAt"`
	LastSeen  int64    `json:"lastSeen"`
	Providers []string `json:"providers,omitempty"`
	XP        int      `json:"xp,omitempty"`
	Coins     int      `json:"coins,omitempty"`
}

type Identity struct {
	Provider, ProviderID, Email, Name, Avatar, ProfileURL string
	EmailVerified                                         bool
}

// UpsertIdentity finds or creates the user for a sign-in. A new provider is
// linked to an existing account only when both share a verified email.
func (s *Store) UpsertIdentity(ctx context.Context, id Identity) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var uid int64
	err = tx.QueryRowContext(ctx, `SELECT user_id FROM identities WHERE provider=? AND provider_id=?`, id.Provider, id.ProviderID).Scan(&uid)
	switch {
	case err == nil:
		// existing identity: refresh profile fields
	case errors.Is(err, sql.ErrNoRows):
		if id.EmailVerified && id.Email != "" {
			_ = tx.QueryRowContext(ctx, `SELECT id FROM users WHERE email=? COLLATE NOCASE ORDER BY id LIMIT 1`, id.Email).Scan(&uid)
		}
		if uid == 0 {
			res, err := tx.ExecContext(ctx, `INSERT INTO users(email,name,avatar,created_at,last_seen) VALUES(?,?,?,?,?)`, id.Email, id.Name, id.Avatar, now(), now())
			if err != nil {
				return 0, err
			}
			uid, _ = res.LastInsertId()
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO identities(provider,provider_id,user_id,profile_url,created_at) VALUES(?,?,?,?,?)`, id.Provider, id.ProviderID, uid, id.ProfileURL, now()); err != nil {
			return 0, err
		}
	default:
		return 0, err
	}
	// Fill in blanks without overwriting what another provider gave us.
	if _, err := tx.ExecContext(ctx, `UPDATE users SET
		email  = CASE WHEN email='' THEN ? ELSE email END,
		name   = CASE WHEN name=''  THEN ? ELSE name END,
		avatar = CASE WHEN ?<>'' THEN ? ELSE avatar END,
		last_seen = ? WHERE id=?`, id.Email, id.Name, id.Avatar, id.Avatar, now(), uid); err != nil {
		return 0, err
	}
	return uid, tx.Commit()
}

func (s *Store) User(ctx context.Context, id int64) (*User, error) {
	u := &User{}
	err := s.db.QueryRowContext(ctx, `SELECT id,email,name,avatar,created_at,last_seen FROM users WHERE id=?`, id).
		Scan(&u.ID, &u.Email, &u.Name, &u.Avatar, &u.CreatedAt, &u.LastSeen)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT provider FROM identities WHERE user_id=? ORDER BY provider`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var p string
			rows.Scan(&p)
			u.Providers = append(u.Providers, p)
		}
	}
	return u, nil
}

func (s *Store) Touch(ctx context.Context, id int64) {
	s.db.ExecContext(ctx, `UPDATE users SET last_seen=? WHERE id=?`, now(), id)
}

func (s *Store) DeleteUser(ctx context.Context, id int64) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=? AND kind='user'`, id); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE id=?`, id)
	return err
}

// Users lists accounts for the admin, newest first, with XP and coins.
func (s *Store) Users(ctx context.Context, bonus map[string]int) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id,u.email,u.name,u.avatar,u.created_at,u.last_seen,
			COALESCE((SELECT group_concat(provider) FROM identities WHERE user_id=u.id),''),
			COALESCE((SELECT SUM(points) FROM events WHERE user_id=u.id),0),
			COALESCE((SELECT SUM(price) FROM purchases WHERE user_id=u.id),0),
			COALESCE((SELECT group_concat(ach_id) FROM achievements WHERE user_id=u.id),'')
		FROM users u ORDER BY u.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		var providers, achs string
		var pts, spent int
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Avatar, &u.CreatedAt, &u.LastSeen, &providers, &pts, &spent, &achs); err != nil {
			return nil, err
		}
		if providers != "" {
			u.Providers = strings.Split(providers, ",")
		}
		for _, a := range strings.Split(achs, ",") {
			pts += bonus[a]
		}
		u.XP, u.Coins = pts, pts-spent
		out = append(out, u)
	}
	return out, rows.Err()
}

// ---- sessions --------------------------------------------------------------

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

// NewSession returns a random token; only its hash is stored.
func (s *Store) NewSession(ctx context.Context, userID int64, kind string, ttl time.Duration) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	_, err := s.db.ExecContext(ctx, `INSERT INTO sessions(token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,?,?)`,
		hashToken(tok), userID, kind, now(), time.Now().Add(ttl).Unix())
	return tok, err
}

// Session returns the user id for a valid token of the given kind.
func (s *Store) Session(ctx context.Context, tok, kind string) (int64, bool) {
	if tok == "" {
		return 0, false
	}
	var uid int64
	err := s.db.QueryRowContext(ctx, `SELECT user_id FROM sessions WHERE token_hash=? AND kind=? AND expires_at>?`, hashToken(tok), kind, now()).Scan(&uid)
	return uid, err == nil
}

func (s *Store) EndSession(ctx context.Context, tok string) {
	s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash=?`, hashToken(tok))
}

func (s *Store) PruneSessions(ctx context.Context) {
	s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at<=?`, now())
}

// ---- game state ------------------------------------------------------------

type GameState struct {
	Events    map[string]int
	Purchases map[string]int
	Ach       map[string]bool
}

func (s *Store) LoadState(ctx context.Context, uid int64) (*GameState, error) {
	st := &GameState{Events: map[string]int{}, Purchases: map[string]int{}, Ach: map[string]bool{}}
	q := func(query string, fn func(*sql.Rows) error) error {
		rows, err := s.db.QueryContext(ctx, query, uid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if err := fn(rows); err != nil {
				return err
			}
		}
		return rows.Err()
	}
	if err := q(`SELECT event_id,points FROM events WHERE user_id=?`, func(r *sql.Rows) error {
		var id string
		var p int
		err := r.Scan(&id, &p)
		st.Events[id] = p
		return err
	}); err != nil {
		return nil, err
	}
	if err := q(`SELECT item_id,price FROM purchases WHERE user_id=?`, func(r *sql.Rows) error {
		var id string
		var p int
		err := r.Scan(&id, &p)
		st.Purchases[id] = p
		return err
	}); err != nil {
		return nil, err
	}
	if err := q(`SELECT ach_id FROM achievements WHERE user_id=?`, func(r *sql.Rows) error {
		var id string
		err := r.Scan(&id)
		st.Ach[id] = true
		return err
	}); err != nil {
		return nil, err
	}
	return st, nil
}

// AddEvents inserts events that are new for the user (existing ones are kept).
func (s *Store) AddEvents(ctx context.Context, uid int64, events map[string]int) error {
	if len(events) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `INSERT OR IGNORE INTO events(user_id,event_id,points,created_at) VALUES(?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for id, p := range events {
		if _, err := stmt.ExecContext(ctx, uid, id, p, now()); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) AddAchievements(ctx context.Context, uid int64, ids []string) error {
	for _, id := range ids {
		if _, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO achievements(user_id,ach_id,created_at) VALUES(?,?,?)`, uid, id, now()); err != nil {
			return err
		}
	}
	return nil
}

// Buy records a purchase if the user can afford it. coins is computed by the
// caller from the same state, inside one request; the primary key prevents
// buying the same item twice.
func (s *Store) Buy(ctx context.Context, uid int64, item string, price int) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO purchases(user_id,item_id,price,created_at) VALUES(?,?,?,?)`, uid, item, price, now())
	return err
}

// ---- stats -----------------------------------------------------------------

func (s *Store) CountView(ctx context.Context, path string) {
	day := time.Now().UTC().Format("2006-01-02")
	s.db.ExecContext(ctx, `INSERT INTO page_views(day,path,views) VALUES(?,?,1) ON CONFLICT(day,path) DO UPDATE SET views=views+1`, day, path)
}

type PathCount struct {
	Path  string `json:"path"`
	Views int    `json:"views"`
}

type Stats struct {
	Users       int         `json:"users"`
	UsersToday  int         `json:"usersToday"`
	ViewsToday  int         `json:"viewsToday"`
	Views7d     int         `json:"views7d"`
	TopPages7d  []PathCount `json:"topPages7d"`
	ViewsPerDay []PathCount `json:"viewsPerDay"` // path holds the day
}

func (s *Store) Stats(ctx context.Context) (*Stats, error) {
	st := &Stats{}
	today := time.Now().UTC().Format("2006-01-02")
	week := time.Now().UTC().AddDate(0, 0, -6).Format("2006-01-02")
	dayStart := time.Now().UTC().Truncate(24 * time.Hour).Unix()
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&st.Users)
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE created_at>=?`, dayStart).Scan(&st.UsersToday)
	s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(views),0) FROM page_views WHERE day=?`, today).Scan(&st.ViewsToday)
	s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(views),0) FROM page_views WHERE day>=?`, week).Scan(&st.Views7d)
	collect := func(query string, args ...any) []PathCount {
		var out []PathCount
		rows, err := s.db.QueryContext(ctx, query, args...)
		if err != nil {
			return out
		}
		defer rows.Close()
		for rows.Next() {
			var pc PathCount
			rows.Scan(&pc.Path, &pc.Views)
			out = append(out, pc)
		}
		return out
	}
	st.TopPages7d = collect(`SELECT path,SUM(views) v FROM page_views WHERE day>=? GROUP BY path ORDER BY v DESC LIMIT 10`, week)
	st.ViewsPerDay = collect(`SELECT day,SUM(views) FROM page_views WHERE day>=? GROUP BY day ORDER BY day`, week)
	return st, nil
}
