package live

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/httpx"
)

func dial(t *testing.T, url string) *websocket.Conn {
	c, _, err := websocket.Dial(context.Background(), url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

func send(t *testing.T, c *websocket.Conn, v any) {
	b, _ := json.Marshal(v)
	if err := c.Write(context.Background(), websocket.MessageText, b); err != nil {
		t.Fatal(err)
	}
}

// waitFor reads messages until one of type typ arrives.
func waitFor(t *testing.T, c *websocket.Conn, typ string) map[string]any {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	for {
		_, b, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("waiting for %s: %v", typ, err)
		}
		var m map[string]any
		json.Unmarshal(b, &m)
		if m["t"] == typ {
			return m
		}
	}
}

func TestPresenceAndCursors(t *testing.T) {
	views := make(chan string, 10)
	srv := httptest.NewServer(NewHub(httpx.NewOrigins("http://127.0.0.1"), func(p string) { views <- p }))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	a, b, other := dial(t, url), dial(t, url), dial(t, url)
	waitFor(t, a, "hello")
	waitFor(t, b, "hello")
	send(t, a, map[string]any{"t": "join", "path": "/terminal/"})
	send(t, b, map[string]any{"t": "join", "path": "/terminal/"})
	send(t, other, map[string]any{"t": "join", "path": "/studio/"})

	cnt := waitFor(t, a, "count")
	for cnt["site"].(float64) != 3 || cnt["page"].(float64) != 2 {
		cnt = waitFor(t, a, "count")
	}
	send(t, a, map[string]any{"t": "move", "x": 0.5, "y": 100})
	cur := waitFor(t, b, "cursor")
	if cur["x"].(float64) != 0.5 || cur["name"] != nil {
		t.Fatalf("unexpected cursor message %v", cur)
	}
	// The visitor on another page must not receive it.
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	for {
		_, msg, err := other.Read(ctx)
		if err != nil {
			break
		}
		if strings.Contains(string(msg), `"cursor"`) {
			t.Fatal("cursor leaked to another page")
		}
	}
	if len(views) < 2 {
		t.Fatal("page views not counted")
	}
}
