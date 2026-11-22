// Package live tracks who is on the site right now and relays anonymous cursor
// positions between visitors on the same page. Nothing is stored and no names
// are shared: each connection gets a random id and a colour.
//
// Client → server:  {"t":"join","path":"/terminal/projects/"}
//
//	{"t":"move","x":0.42,"y":812}     x: fraction of content width, y: px from content top
//	{"t":"hide"}                       cursor left the window
//
// Server → client:  {"t":"hello","id":"a1b2c3","color":"#..."}
//
//	{"t":"count","site":12,"page":3}
//	{"t":"cursor","id":"..","color":"..","x":..,"y":..}
//	{"t":"leave","id":".."}
package live

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/httpx"
)

const (
	maxConns      = 500
	maxPerIP      = 8
	maxMovesPerS  = 20
	writeTimeout  = 5 * time.Second
	countInterval = time.Second
)

type conn struct {
	id, color, ip string
	path          string
	ws            *websocket.Conn
	out           chan []byte
	moves         int
	window        time.Time
}

type Hub struct {
	mu      sync.Mutex
	conns   map[*conn]bool
	perIP   map[string]int
	dirty   bool
	origins []string
	onView  func(path string)
}

func NewHub(origins httpx.Origins, onView func(string)) *Hub {
	h := &Hub{conns: map[*conn]bool{}, perIP: map[string]int{}, origins: origins.Hosts(), onView: onView}
	go h.countLoop()
	return h
}

var palette = []string{"#f97316", "#22c55e", "#3b82f6", "#e11d48", "#a855f7", "#eab308", "#14b8a6", "#ec4899"}

func newID() string {
	b := make([]byte, 3)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Snapshot is the admin view: total and per-page counts.
func (h *Hub) Snapshot() (int, map[string]int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	pages := map[string]int{}
	for c := range h.conns {
		if c.path != "" {
			pages[c.path]++
		}
	}
	return len(h.conns), pages
}

func (h *Hub) send(c *conn, v any) {
	b, _ := json.Marshal(v)
	select {
	case c.out <- b:
	default: // slow client: drop rather than block everyone
	}
}

func (h *Hub) countLoop() {
	for range time.Tick(countInterval) {
		h.mu.Lock()
		if !h.dirty {
			h.mu.Unlock()
			continue
		}
		h.dirty = false
		pages := map[string]int{}
		for c := range h.conns {
			pages[c.path]++
		}
		total := len(h.conns)
		for c := range h.conns {
			h.send(c, map[string]any{"t": "count", "site": total, "page": pages[c.path]})
		}
		h.mu.Unlock()
	}
}

func (h *Hub) broadcastPage(from *conn, path string, v any) {
	for c := range h.conns {
		if c != from && c.path == path {
			h.send(c, v)
		}
	}
}

func cleanPath(p string) string {
	if len(p) > 200 || !strings.HasPrefix(p, "/") {
		return ""
	}
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}
	return p
}

// ServeHTTP upgrades /api/live to a WebSocket.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ip := httpx.ClientIP(r)
	h.mu.Lock()
	if len(h.conns) >= maxConns || h.perIP[ip] >= maxPerIP {
		h.mu.Unlock()
		http.Error(w, "busy", http.StatusServiceUnavailable)
		return
	}
	h.mu.Unlock()

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.origins})
	if err != nil {
		return
	}
	ws.SetReadLimit(512)
	id := newID()
	c := &conn{id: id, ip: ip, ws: ws, out: make(chan []byte, 64), window: time.Now()}
	var idx int
	fmt.Sscanf(id[:2], "%x", &idx)
	c.color = palette[idx%len(palette)]

	h.mu.Lock()
	h.conns[c] = true
	h.perIP[ip]++
	h.dirty = true
	h.mu.Unlock()

	ctx, cancel := context.WithCancel(r.Context())
	defer func() {
		cancel()
		h.mu.Lock()
		delete(h.conns, c)
		h.perIP[ip]--
		if h.perIP[ip] <= 0 {
			delete(h.perIP, ip)
		}
		h.broadcastPage(c, c.path, map[string]any{"t": "leave", "id": c.id})
		h.dirty = true
		h.mu.Unlock()
		ws.Close(websocket.StatusNormalClosure, "")
	}()

	go func() { // writer
		ping := time.NewTicker(30 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case b := <-c.out:
				wctx, wc := context.WithTimeout(ctx, writeTimeout)
				err := ws.Write(wctx, websocket.MessageText, b)
				wc()
				if err != nil {
					cancel()
					return
				}
			case <-ping.C:
				pctx, pc := context.WithTimeout(ctx, writeTimeout)
				err := ws.Ping(pctx)
				pc()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()

	h.send(c, map[string]any{"t": "hello", "id": c.id, "color": c.color})
	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		var m struct {
			T    string  `json:"t"`
			Path string  `json:"path"`
			X    float64 `json:"x"`
			Y    float64 `json:"y"`
		}
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.T {
		case "join":
			p := cleanPath(m.Path)
			h.mu.Lock()
			old := c.path
			if old != "" && old != p {
				h.broadcastPage(c, old, map[string]any{"t": "leave", "id": c.id})
			}
			c.path = p
			h.dirty = true
			h.mu.Unlock()
			if p != "" && p != old && h.onView != nil {
				h.onView(p)
			}
		case "move":
			if time.Since(c.window) > time.Second {
				c.window, c.moves = time.Now(), 0
			}
			c.moves++
			if c.moves > maxMovesPerS || m.X < -0.2 || m.X > 1.2 || m.Y < -2000 || m.Y > 200000 {
				continue
			}
			h.mu.Lock()
			h.broadcastPage(c, c.path, map[string]any{"t": "cursor", "id": c.id, "color": c.color, "x": m.X, "y": m.Y})
			h.mu.Unlock()
		case "hide":
			h.mu.Lock()
			h.broadcastPage(c, c.path, map[string]any{"t": "leave", "id": c.id})
			h.mu.Unlock()
		}
	}
}

func init() { log.SetFlags(log.LstdFlags | log.Lmsgprefix) }
