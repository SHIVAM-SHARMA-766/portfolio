package game

import "testing"

func TestCatalogLoaded(t *testing.T) {
	if len(Catalog().Events) == 0 || len(Catalog().Levels) == 0 {
		t.Fatal("catalog is empty; run scripts/build-game-data.mjs")
	}
	if _, ok := Points("visit:home"); !ok {
		t.Fatal("visit:home missing")
	}
	if _, ok := Points("visit:made-up"); ok {
		t.Fatal("unknown event accepted")
	}
}

func TestAchievementsAndCoins(t *testing.T) {
	s := &State{Events: map[string]int{}, Purchases: map[string]int{}}
	for _, p := range Catalog().PageIDs {
		pts, _ := Points("visit:" + p)
		s.Events["visit:"+p] = pts
	}
	unlocked := Evaluate(s)
	if !s.Ach["explorer"] || !s.Ach["first-steps"] {
		t.Fatalf("expected explorer and first-steps, got %v", unlocked)
	}
	before := Snap(s)
	s.Purchases["theme:quest"] = 100
	after := Snap(s)
	if after.XP != before.XP || after.Coins != before.Coins-100 {
		t.Fatalf("purchase must reduce coins only: %+v → %+v", before, after)
	}
}
