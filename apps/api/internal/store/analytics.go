package store

// Cookie-free analytics. Each hit is a page view or a named event. Visitors are
// told apart only by a hash that changes every day (see internal/analytics), so
// "visitors" are counted per day and nobody can be followed across days.

import (
	"context"
	"time"
)

const analyticsSchema = `
CREATE TABLE IF NOT EXISTS hits (
	id        INTEGER PRIMARY KEY,
	at        INTEGER NOT NULL,
	day       TEXT NOT NULL,
	vid       TEXT NOT NULL,              -- anonymous, rotates daily
	kind      TEXT NOT NULL,              -- 'view' or an event name
	path      TEXT NOT NULL,
	label     TEXT NOT NULL DEFAULT '',
	source    TEXT NOT NULL DEFAULT '',   -- where the visit came from ('' = direct)
	campaign  TEXT NOT NULL DEFAULT '',
	device    TEXT NOT NULL DEFAULT '',
	theme     TEXT NOT NULL DEFAULT '',
	entry     INTEGER NOT NULL DEFAULT 0  -- the visitor's first view that day
);
CREATE INDEX IF NOT EXISTS hits_day ON hits(day, kind);
CREATE INDEX IF NOT EXISTS hits_vid ON hits(day, vid);
`

// Hit is one page view or event.
type Hit struct {
	VID, Kind, Path, Label, Source, Campaign, Device, Theme string
}

// AddHit records a hit. A view also bumps the daily page-view counter used by
// the dashboard. The first view of a visitor on a day is marked as the entry,
// and only it keeps the source and campaign.
func (s *Store) AddHit(ctx context.Context, h Hit) error {
	t := time.Now().UTC()
	day := t.Format("2006-01-02")
	entry := 0
	if h.Kind == "view" {
		var seen int
		s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM hits WHERE day=? AND vid=? AND kind='view')`, day, h.VID).Scan(&seen)
		if seen == 0 {
			entry = 1
		} else {
			h.Source, h.Campaign = "", ""
		}
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO hits(at,day,vid,kind,path,label,source,campaign,device,theme,entry) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		t.Unix(), day, h.VID, h.Kind, h.Path, h.Label, h.Source, h.Campaign, h.Device, h.Theme, entry); err != nil {
		return err
	}
	if h.Kind == "view" {
		s.CountView(ctx, h.Path)
	}
	return nil
}

// PruneHits drops hits older than the retention period.
func (s *Store) PruneHits(ctx context.Context, keepDays int) {
	s.db.ExecContext(ctx, `DELETE FROM hits WHERE day < ?`, time.Now().UTC().AddDate(0, 0, -keepDays).Format("2006-01-02"))
}

type Count struct {
	Key   string `json:"key"`
	Label string `json:"label,omitempty"`
	N     int    `json:"n"`
	V     int    `json:"v,omitempty"` // visitors, where it applies
}

type Totals struct {
	Visitors int     `json:"visitors"` // summed per day
	Views    int     `json:"views"`
	Bounce   float64 `json:"bounce"` // share of visits with one view
	Events   int     `json:"events"`
}

type DayPoint struct {
	Day      string `json:"day"`
	Visitors int    `json:"visitors"`
	Views    int    `json:"views"`
}

type Analytics struct {
	Days     int        `json:"days"`
	Totals   Totals     `json:"totals"`
	Prev     Totals     `json:"prev"` // the period before, for comparison
	Series   []DayPoint `json:"series"`
	Pages    []Count    `json:"pages"`
	Entries  []Count    `json:"entries"`
	Sources  []Count    `json:"sources"`
	Campaign []Count    `json:"campaigns"`
	Devices  []Count    `json:"devices"`
	Themes   []Count    `json:"themes"`
	Events   []Count    `json:"events"`
	Live     int        `json:"live,omitempty"`
}

func (s *Store) totals(ctx context.Context, from, to string) Totals {
	var t Totals
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM (SELECT DISTINCT day, vid FROM hits WHERE day>=? AND day<? AND kind='view')`, from, to).Scan(&t.Visitors)
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM hits WHERE day>=? AND day<? AND kind='view'`, from, to).Scan(&t.Views)
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM hits WHERE day>=? AND day<? AND kind<>'view'`, from, to).Scan(&t.Events)
	var single int
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM (SELECT day, vid FROM hits WHERE day>=? AND day<? AND kind='view' GROUP BY day, vid HAVING COUNT(*)=1)`, from, to).Scan(&single)
	if t.Visitors > 0 {
		t.Bounce = float64(single) / float64(t.Visitors)
	}
	return t
}

// Analytics summarises the last `days` days (today included).
func (s *Store) Analytics(ctx context.Context, days int) (*Analytics, error) {
	now := time.Now().UTC()
	to := now.AddDate(0, 0, 1).Format("2006-01-02")
	from := now.AddDate(0, 0, -(days - 1)).Format("2006-01-02")
	prevFrom := now.AddDate(0, 0, -(2*days - 1)).Format("2006-01-02")
	a := &Analytics{Days: days, Totals: s.totals(ctx, from, to), Prev: s.totals(ctx, prevFrom, from)}

	rows, err := s.db.QueryContext(ctx, `SELECT day, COUNT(DISTINCT vid), COUNT(*) FROM hits WHERE day>=? AND day<? AND kind='view' GROUP BY day`, from, to)
	if err != nil {
		return nil, err
	}
	byDay := map[string]DayPoint{}
	for rows.Next() {
		var p DayPoint
		rows.Scan(&p.Day, &p.Visitors, &p.Views)
		byDay[p.Day] = p
	}
	rows.Close()
	for i := days - 1; i >= 0; i-- {
		d := now.AddDate(0, 0, -i).Format("2006-01-02")
		p := byDay[d]
		p.Day = d
		a.Series = append(a.Series, p)
	}

	// list runs a ranking query; dest picks the Count fields its columns fill.
	list := func(dest func(c *Count) []any, q string, args ...any) []Count {
		out := []Count{}
		rows, err := s.db.QueryContext(ctx, q, args...)
		if err != nil {
			return out
		}
		defer rows.Close()
		for rows.Next() {
			var c Count
			if rows.Scan(dest(&c)...) == nil {
				out = append(out, c)
			}
		}
		return out
	}
	keyN := func(c *Count) []any { return []any{&c.Key, &c.N} }
	keyNV := func(c *Count) []any { return []any{&c.Key, &c.N, &c.V} }
	keyLabelN := func(c *Count) []any { return []any{&c.Key, &c.Label, &c.N} }
	a.Pages = list(keyNV, `SELECT path, COUNT(*) n, COUNT(DISTINCT day||vid) FROM hits WHERE day>=? AND day<? AND kind='view' GROUP BY path ORDER BY n DESC LIMIT 20`, from, to)
	a.Entries = list(keyN, `SELECT path, COUNT(*) n FROM hits WHERE day>=? AND day<? AND entry=1 GROUP BY path ORDER BY n DESC LIMIT 10`, from, to)
	a.Sources = list(keyN, `SELECT source, COUNT(*) n FROM hits WHERE day>=? AND day<? AND entry=1 GROUP BY source ORDER BY n DESC LIMIT 15`, from, to)
	a.Campaign = list(keyN, `SELECT campaign, COUNT(*) n FROM hits WHERE day>=? AND day<? AND entry=1 AND campaign<>'' GROUP BY campaign ORDER BY n DESC LIMIT 10`, from, to)
	a.Devices = list(keyN, `SELECT device, COUNT(*) n FROM hits WHERE day>=? AND day<? AND entry=1 AND device<>'' GROUP BY device ORDER BY n DESC`, from, to)
	a.Themes = list(keyN, `SELECT theme, COUNT(*) n FROM hits WHERE day>=? AND day<? AND kind='view' AND theme<>'' GROUP BY theme ORDER BY n DESC`, from, to)
	a.Events = list(keyLabelN, `SELECT kind, label, COUNT(*) n FROM hits WHERE day>=? AND day<? AND kind<>'view' GROUP BY kind, label ORDER BY n DESC LIMIT 25`, from, to)
	return a, nil
}
