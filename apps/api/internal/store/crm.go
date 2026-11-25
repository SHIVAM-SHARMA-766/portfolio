package store

// CRM data for the admin panel: a pipeline stage, tags and a star per contact,
// private notes, an activity timeline built from what the contact did on the
// site, and the numbers behind the dashboard. None of it is visible to visitors.

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
)

// ErrNotFound means the contact (or note) does not exist.
var ErrNotFound = errors.New("not found")

// Stages a contact moves through. "new" is the default for every sign-up.
var Stages = []string{"new", "contacted", "engaged", "opportunity", "archived"}

func ValidStage(s string) bool {
	for _, x := range Stages {
		if x == s {
			return true
		}
	}
	return false
}

type Note struct {
	ID        int64  `json:"id"`
	Body      string `json:"body"`
	CreatedAt int64  `json:"createdAt"`
}

// Activity is one thing a contact did: an awarded event, an achievement or a purchase.
type Activity struct {
	Kind   string `json:"kind"` // event | achievement | purchase
	ID     string `json:"id"`
	Points int    `json:"points,omitempty"`
	At     int64  `json:"at"`
}

type Contact struct {
	User
	Achievements int        `json:"achievements"`
	Purchases    []string   `json:"purchases"`
	NotesList    []Note     `json:"notesList"`
	Activity     []Activity `json:"activity"`
}

// Contact returns one user with their CRM fields, notes and recent activity.
func (s *Store) Contact(ctx context.Context, id int64, bonus map[string]int) (*Contact, error) {
	users, err := s.Users(ctx, bonus)
	if err != nil {
		return nil, err
	}
	c := &Contact{Purchases: []string{}, NotesList: []Note{}, Activity: []Activity{}}
	found := false
	for _, u := range users {
		if u.ID == id {
			c.User, found = u, true
			break
		}
	}
	if !found {
		return nil, ErrNotFound
	}
	q := func(query string, scan func(func(...any) error) error) error {
		rows, err := s.db.QueryContext(ctx, query, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if err := scan(rows.Scan); err != nil {
				return err
			}
		}
		return rows.Err()
	}
	if err := q(`SELECT id,body,created_at FROM notes WHERE user_id=? ORDER BY created_at DESC, id DESC`, func(sc func(...any) error) error {
		var n Note
		if err := sc(&n.ID, &n.Body, &n.CreatedAt); err != nil {
			return err
		}
		c.NotesList = append(c.NotesList, n)
		return nil
	}); err != nil {
		return nil, err
	}
	if err := q(`SELECT event_id,points,created_at FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT 300`, func(sc func(...any) error) error {
		a := Activity{Kind: "event"}
		if err := sc(&a.ID, &a.Points, &a.At); err != nil {
			return err
		}
		c.Activity = append(c.Activity, a)
		return nil
	}); err != nil {
		return nil, err
	}
	if err := q(`SELECT ach_id,created_at FROM achievements WHERE user_id=?`, func(sc func(...any) error) error {
		a := Activity{Kind: "achievement"}
		if err := sc(&a.ID, &a.At); err != nil {
			return err
		}
		a.Points = bonus[a.ID]
		c.Achievements++
		c.Activity = append(c.Activity, a)
		return nil
	}); err != nil {
		return nil, err
	}
	if err := q(`SELECT item_id,price,created_at FROM purchases WHERE user_id=?`, func(sc func(...any) error) error {
		a := Activity{Kind: "purchase"}
		if err := sc(&a.ID, &a.Points, &a.At); err != nil {
			return err
		}
		c.Purchases = append(c.Purchases, a.ID)
		c.Activity = append(c.Activity, a)
		return nil
	}); err != nil {
		return nil, err
	}
	sort.SliceStable(c.Activity, func(i, j int) bool { return c.Activity[i].At > c.Activity[j].At })
	return c, nil
}

// UpdateContact sets any of stage, tags and starred (nil leaves a field as it is).
func (s *Store) UpdateContact(ctx context.Context, id int64, stage *string, tags *[]string, starred *bool) error {
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE id=?`, id).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return ErrNotFound
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO crm(user_id,updated_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING`, id, now()); err != nil {
		return err
	}
	if stage != nil {
		if _, err := s.db.ExecContext(ctx, `UPDATE crm SET stage=?,updated_at=? WHERE user_id=?`, *stage, now(), id); err != nil {
			return err
		}
	}
	if tags != nil {
		if _, err := s.db.ExecContext(ctx, `UPDATE crm SET tags=?,updated_at=? WHERE user_id=?`, strings.Join(*tags, ","), now(), id); err != nil {
			return err
		}
	}
	if starred != nil {
		v := 0
		if *starred {
			v = 1
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE crm SET starred=?,updated_at=? WHERE user_id=?`, v, now(), id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) AddNote(ctx context.Context, userID int64, body string) (*Note, error) {
	n := &Note{Body: body, CreatedAt: now()}
	res, err := s.db.ExecContext(ctx, `INSERT INTO notes(user_id,body,created_at) SELECT id,?,? FROM users WHERE id=?`, body, n.CreatedAt, userID)
	if err != nil {
		return nil, err
	}
	if k, _ := res.RowsAffected(); k == 0 {
		return nil, ErrNotFound
	}
	n.ID, _ = res.LastInsertId()
	return n, nil
}

func (s *Store) DeleteNote(ctx context.Context, userID, noteID int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM notes WHERE id=? AND user_id=?`, noteID, userID)
	if err != nil {
		return err
	}
	if k, _ := res.RowsAffected(); k == 0 {
		return ErrNotFound
	}
	return nil
}

// Insights are the dashboard numbers beyond Stats.
type Insights struct {
	Active7d       int            `json:"active7d"`
	ActivePrev7d   int            `json:"activePrev7d"`
	UsersPrev7d    int            `json:"usersPrev7d"`
	Users7d        int            `json:"users7d"`
	ViewsPrev7d    int            `json:"viewsPrev7d"`
	SignupsPerDay  []PathCount    `json:"signupsPerDay"` // path holds the day
	ViewsPerDay30  []PathCount    `json:"viewsPerDay30"`
	Stages         map[string]int `json:"stages"`
	TopEvents7d    []PathCount    `json:"topEvents7d"` // most common actions
}

func (s *Store) Insights(ctx context.Context) (*Insights, error) {
	in := &Insights{Stages: map[string]int{}}
	t := time.Now().UTC()
	d7, d14, d30 := t.AddDate(0, 0, -7).Unix(), t.AddDate(0, 0, -14).Unix(), t.AddDate(0, 0, -29).Truncate(24*time.Hour)
	s.db.QueryRowContext(ctx, `SELECT COUNT(DISTINCT user_id) FROM events WHERE created_at>=?`, d7).Scan(&in.Active7d)
	s.db.QueryRowContext(ctx, `SELECT COUNT(DISTINCT user_id) FROM events WHERE created_at>=? AND created_at<?`, d14, d7).Scan(&in.ActivePrev7d)
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE created_at>=?`, d7).Scan(&in.Users7d)
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE created_at>=? AND created_at<?`, d14, d7).Scan(&in.UsersPrev7d)
	week, prev := t.AddDate(0, 0, -6).Format("2006-01-02"), t.AddDate(0, 0, -13).Format("2006-01-02")
	s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(views),0) FROM page_views WHERE day>=? AND day<?`, prev, week).Scan(&in.ViewsPrev7d)
	collect := func(query string, args ...any) []PathCount {
		out := []PathCount{}
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
	in.SignupsPerDay = collect(`SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') d, COUNT(*) FROM users WHERE created_at>=? GROUP BY d ORDER BY d`, d30.Unix())
	in.ViewsPerDay30 = collect(`SELECT day,SUM(views) FROM page_views WHERE day>=? GROUP BY day ORDER BY day`, d30.Format("2006-01-02"))
	in.TopEvents7d = collect(`SELECT substr(event_id,1,instr(event_id,':')-1) k, COUNT(*) n FROM events WHERE created_at>=? AND instr(event_id,':')>0 GROUP BY k ORDER BY n DESC LIMIT 8`, d7)
	for _, st := range Stages {
		in.Stages[st] = 0
	}
	rows, err := s.db.QueryContext(ctx, `SELECT COALESCE(c.stage,'new'), COUNT(*) FROM users u LEFT JOIN crm c ON c.user_id=u.id GROUP BY 1`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var st string
			var n int
			rows.Scan(&st, &n)
			in.Stages[st] = n
		}
	}
	return in, nil
}
