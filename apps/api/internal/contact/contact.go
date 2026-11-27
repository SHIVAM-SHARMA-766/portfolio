// Package contact serves visitor messages. Only signed-in visitors can write
// (the sign-in provider vouches for a real person, which keeps spam out): each
// visitor has one conversation with the admin, who replies from the Inbox, and
// the visitor reads the replies on the site. When SMTP is configured, new
// messages email a notice (optional; off by default).
//
//	GET  /api/messages       the visitor's conversation (200 {"signedIn":false} when signed out)
//	POST /api/messages       {"body":"…","topic":"job","page":"/x/"} write a message
//	POST /api/messages/seen  the visitor opened the conversation
package contact

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/config"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/httpx"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/store"
)

const maxBody = 5000

// Topics a message can carry (the contact page lets visitors pick one); the
// message bubble sends "chat".
var Topics = []string{"chat", "job", "freelance", "collaboration", "question", "other"}

type Handler struct {
	store   *store.Store
	cfg     *config.Config
	userID  func(*http.Request) (int64, bool)
	perUser *httpx.Limiter
	daily   *httpx.Limiter
	siteURL string
	mail    func(to, subject, body, replyTo string) error // swapped in tests
}

func New(cfg *config.Config, st *store.Store, siteURL string, userID func(*http.Request) (int64, bool)) *Handler {
	h := &Handler{store: st, cfg: cfg, userID: userID, perUser: httpx.NewLimiter(30, time.Hour), daily: httpx.NewLimiter(300, 24*time.Hour), siteURL: strings.TrimRight(siteURL, "/")}
	h.mail = h.smtpSend
	return h
}

func (h *Handler) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/messages", h.thread)
	mux.HandleFunc("POST /api/messages", h.send)
	mux.HandleFunc("POST /api/messages/seen", h.seen)
}

func clean(s string, max int) (string, bool) {
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	return s, utf8.RuneCountInString(s) <= max
}

func validTopic(t string) bool {
	for _, x := range Topics {
		if x == t {
			return true
		}
	}
	return false
}

// thread: the signed-in visitor's conversation, oldest first. Signed-out
// visitors get {"signedIn":false} with 200, so browsers log no error.
func (h *Handler) thread(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		httpx.JSON(w, http.StatusOK, map[string]any{"signedIn": false})
		return
	}
	list, err := h.store.Thread(r.Context(), uid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not load messages")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"signedIn": true, "messages": list, "unseen": h.store.UnseenReplies(r.Context(), uid)})
}

func (h *Handler) send(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "Sign in to send a message.")
		return
	}
	var b struct {
		Body  string `json:"body"`
		Topic string `json:"topic"`
		Page  string `json:"page"`
	}
	if err := httpx.Decode(r, &b, 16<<10); err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad request")
		return
	}
	body, ok := clean(b.Body, maxBody)
	if !ok || body == "" {
		httpx.Error(w, http.StatusBadRequest, "Write a message (up to 5000 characters).")
		return
	}
	topic := strings.ToLower(strings.TrimSpace(b.Topic))
	if !validTopic(topic) {
		topic = "chat"
	}
	key := "u" + strconv.FormatInt(uid, 10)
	if h.perUser.Blocked(key) || h.daily.Blocked("all") {
		httpx.Error(w, http.StatusTooManyRequests, "That's a lot of messages. Please try again later.")
		return
	}
	h.perUser.Allow(key)
	h.daily.Allow("all")
	page, _ := clean(b.Page, 200)
	if !strings.HasPrefix(page, "/") || strings.HasPrefix(page, "//") {
		page = ""
	}
	m, err := h.store.VisitorMessage(r.Context(), uid, topic, body, page)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Could not send right now.")
		return
	}
	if u, err := h.store.User(r.Context(), uid); err == nil {
		h.notify(u.Name, u.Email, topic, body, page, uid)
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"message": m})
}

func (h *Handler) seen(w http.ResponseWriter, r *http.Request) {
	if uid, ok := h.userID(r); ok {
		h.store.MarkRepliesSeen(r.Context(), uid)
	}
	w.WriteHeader(http.StatusNoContent)
}

// notify emails a notice about a new message, when SMTP is configured.
func (h *Handler) notify(name, email, topic, message, page string, uid int64) {
	if h.cfg.NotifyEmail == "" || h.cfg.SMTPHost == "" {
		return
	}
	go func() {
		subject := fmt.Sprintf("Portfolio: %s from %s", topic, name)
		body := fmt.Sprintf("%s <%s> wrote (%s) from %s%s:\n\n%s\n\nOpen in the admin: %s/admin/#/inbox?c=%d\n",
			name, email, topic, h.siteURL, page, message, h.siteURL, uid)
		if err := h.mail(h.cfg.NotifyEmail, subject, body, email); err != nil {
			log.Printf("contact: notify: %v", err)
		}
	}()
}

// header strips CR/LF so user input can never add mail headers.
func header(s string) string { return strings.NewReplacer("\r", " ", "\n", " ").Replace(s) }

// smtpSend sends a plain-text mail through a submission server that speaks
// STARTTLS, e.g. smtp.gmail.com:587 with an app password (free).
func (h *Handler) smtpSend(to, subject, body, replyTo string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		from := h.cfg.SMTPFrom
		if from == "" {
			from = h.cfg.SMTPUser
		}
		msg := "From: " + header(from) + "\r\nTo: " + header(to) + "\r\nReply-To: " + header(replyTo) +
			"\r\nSubject: " + header(subject) + "\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" +
			strings.ReplaceAll(body, "\n", "\r\n")
		var auth smtp.Auth
		if h.cfg.SMTPUser != "" {
			auth = smtp.PlainAuth("", h.cfg.SMTPUser, h.cfg.SMTPPass, strings.Split(h.cfg.SMTPHost, ":")[0])
		}
		done <- smtp.SendMail(h.cfg.SMTPHost, auth, from, []string{to}, []byte(msg))
	}()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}
