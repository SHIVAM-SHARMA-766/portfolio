// Package game holds the server-side game rules. It mirrors packages/game/src/core.js:
// state is a set of awarded events plus purchases, and XP, level, coins and
// achievements are all derived from it. Only events in the embedded catalog
// (scripts/build-game-data.mjs) are accepted, at the catalog's point value.
package game

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

//go:embed data/game-data.json
var raw []byte

type Level struct {
	XP   int    `json:"xp"`
	Name string `json:"name"`
}

type Rule struct {
	Type   string   `json:"type"`
	Min    *int     `json:"min"`
	ID     string   `json:"id"`
	Prefix string   `json:"prefix"`
	IDs    []string `json:"ids"`
}

type Achievement struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	Bonus       int    `json:"bonus"`
	Hidden      bool   `json:"hidden"`
	Rule        Rule   `json:"rule"`
}

type Item struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Price       int    `json:"price"`
	Requires    string `json:"requires,omitempty"` // item that must be owned first, e.g. the palette's theme
}

type Data struct {
	SiteURL      string         `json:"siteUrl"`
	LearnURL     string         `json:"learnUrl"`
	CookieDomain string         `json:"cookieDomain"`
	Levels       []Level        `json:"levels"`
	PageIDs      []string       `json:"pageIds"`
	Achievements []Achievement  `json:"achievements"`
	Shop         []Item         `json:"shop"`
	Events       map[string]int `json:"events"`
}

var catalog Data

func init() {
	if err := json.Unmarshal(raw, &catalog); err != nil {
		panic(fmt.Sprintf("game data: %v", err))
	}
	sort.Slice(catalog.Levels, func(i, j int) bool { return catalog.Levels[i].XP < catalog.Levels[j].XP })
}

// Catalog returns the embedded game data.
func Catalog() *Data { return &catalog }

// Points returns the value of an event, and whether the event exists.
func Points(id string) (int, bool) {
	p, ok := catalog.Events[id]
	return p, ok
}

// FindItem returns a shop item by id.
func FindItem(id string) (Item, bool) {
	for _, it := range catalog.Shop {
		if it.ID == id {
			return it, true
		}
	}
	return Item{}, false
}

// State is everything a player has: awarded events and owned items.
type State struct {
	Events    map[string]int  `json:"events"`
	Purchases map[string]int  `json:"purchases"` // item id → price paid
	Ach       map[string]bool `json:"ach"`
}

type LevelInfo struct {
	Number   int     `json:"number"`
	Name     string  `json:"name"`
	Next     *Level  `json:"next"`
	Progress float64 `json:"progress"`
}

type Snapshot struct {
	XP           int             `json:"xp"`
	Coins        int             `json:"coins"`
	Level        LevelInfo       `json:"level"`
	Events       map[string]int  `json:"events"`
	Purchases    map[string]int  `json:"purchases"`
	Achievements map[string]bool `json:"achievements"`
}

func countPrefix(s *State, prefix string) int {
	n := 0
	for id := range s.Events {
		if strings.HasPrefix(id, prefix) {
			n++
		}
	}
	return n
}

func ruleMet(r Rule, s *State, xp int) bool {
	min := func(def int) int {
		if r.Min != nil {
			return *r.Min
		}
		return def
	}
	switch r.Type {
	case "xp":
		return xp >= min(0)
	case "event":
		_, ok := s.Events[r.ID]
		return ok
	case "events":
		return countPrefix(s, r.Prefix) >= min(1)
	case "all-of":
		for _, id := range r.IDs {
			if _, ok := s.Events[id]; !ok {
				return false
			}
		}
		return len(r.IDs) > 0
	case "all-pages":
		for _, p := range catalog.PageIDs {
			if _, ok := s.Events["visit:"+p]; !ok {
				return false
			}
		}
		return len(catalog.PageIDs) > 0
	}
	return false
}

// XP is event points plus bonuses of unlocked achievements.
func XP(s *State) int {
	xp := 0
	for _, p := range s.Events {
		xp += p
	}
	for _, a := range catalog.Achievements {
		if s.Ach[a.ID] {
			xp += a.Bonus
		}
	}
	return xp
}

// Evaluate unlocks every achievement whose rule is met (repeating, since a
// bonus can push XP over another threshold) and returns the newly unlocked ids.
func Evaluate(s *State) []string {
	if s.Ach == nil {
		s.Ach = map[string]bool{}
	}
	var unlocked []string
	for changed := true; changed; {
		changed = false
		xp := XP(s)
		for _, a := range catalog.Achievements {
			if !s.Ach[a.ID] && ruleMet(a.Rule, s, xp) {
				s.Ach[a.ID] = true
				unlocked = append(unlocked, a.ID)
				changed = true
			}
		}
	}
	return unlocked
}

func levelFor(xp int) LevelInfo {
	idx := 0
	for i, l := range catalog.Levels {
		if xp >= l.XP {
			idx = i
		}
	}
	cur := catalog.Levels[idx]
	li := LevelInfo{Number: idx + 1, Name: cur.Name, Progress: 1}
	if idx+1 < len(catalog.Levels) {
		next := catalog.Levels[idx+1]
		li.Next = &next
		li.Progress = float64(xp-cur.XP) / float64(next.XP-cur.XP)
	}
	return li
}

// Owns reports whether a state owns an item. Items not in the shop, or free, are always owned.
func Owns(s *State, id string) bool {
	it, ok := FindItem(id)
	if !ok || it.Price <= 0 {
		return true
	}
	_, bought := s.Purchases[id]
	return bought
}

// Spent is the total price of owned items.
func Spent(s *State) int {
	n := 0
	for _, p := range s.Purchases {
		n += p
	}
	return n
}

// Snap derives the public view of a state.
func Snap(s *State) Snapshot {
	xp := XP(s)
	return Snapshot{XP: xp, Coins: xp - Spent(s), Level: levelFor(xp), Events: s.Events, Purchases: s.Purchases, Achievements: s.Ach}
}
