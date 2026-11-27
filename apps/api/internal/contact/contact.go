// Package contact serves visitor messages: POST /api/contact (the contact form
// and the message bubble, no sign-in needed) files a message in the admin CRM;
// signed-in visitors also get a conversation with the admin's replies
// (GET/POST /api/messages). When SMTP is configured, new messages email a notice.
//
// Spam defences, in order: the CORS layer rejects other origins; a hidden
// "website" field must stay empty (bots get a fake success); a form sent
// within three seconds of loading is refused with a "send again"; each IP may send a few messages per hour; and the whole form has a
// daily ceiling so a flood cannot fill the database or the inbox.
package contact

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/config"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/httpx"
	"github.com/SHIVAM-SHARMA-766/portfolio/apps/api/internal/store"
)

const (
	maxName    = 100
	maxEmail   = 200
	maxTopic   = 60
	maxBody    = 5000
	minBody    = 10
	minElapsed = 3000 // ms between showing the form and sending it
)

// Topics the form offers; anything else is filed as "other".
var Topics = []string{"job", "freelance", "collaboration", "question", "quick", "other"}

type Handler struct {
	store   *store.Store
	userID  func(*http.Request) (int64, bool)
	perUser *httpx.Limiter
	cfg     *config.Config
	perIP   *httpx.Limiter
	daily   *httpx.Limiter
	siteURL string
	mail    func(to, subject, body, replyTo string) error // swapped in tests
}

func New(cfg *config.Config, st *store.Store, siteURL string, userID func(*http.Request) (int64, bool)) *Handler {
	h := &Handler{store: st, cfg: cfg, userID: userID, perIP: httpx.NewLimiter(5, time.Hour), perUser: httpx.NewLimiter(30, time.Hour), daily: httpx.NewLimiter(100, 24*time.Hour), siteURL: strings.TrimRight(siteURL, "/")}
	h.mail = h.smtpSend
	return h
}

func (h *Handler) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/contact", h.post)
	mux.HandleFunc("GET /api/messages", h.thread)
	mux.HandleFunc("POST /api/messages", h.send)
	mux.HandleFunc("POST /api/messages/seen", h.seen)
}

// thread: GET /api/messages — the signed-in visitor's conversation. Signed-out
// visitors get {"signedIn":false} (200, so browsers log no error).
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

// send: POST /api/messages {"body":"…","page":"/x/"} — a signed-in visitor writes.
func (h *Handler) send(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "sign in to chat")
		return
	}
	var b struct {
		Body string `json:"body"`
		Page string `json:"page"`
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
	key := "u" + strconv.FormatInt(uid, 10)
	if h.perUser.Blocked(key) || h.daily.Blocked("all") {
		httpx.Error(w, http.StatusTooManyRequests, "That's a lot of messages. Please try again later.")
		return
	}
	h.perUser.Allow(key)
	h.daily.Allow("all")
	page, _ := clean(b.Page, 200)
	if !strings.HasPrefix(page, "/") {
		page = ""
	}
	m, err := h.store.VisitorMessage(r.Context(), uid, body, page)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not send")
		return
	}
	if u, err := h.store.User(r.Context(), uid); err == nil {
		h.notify(u.Name, u.Email, "chat", body, page, uid)
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"message": m})
}

func (h *Handler) seen(w http.ResponseWriter, r *http.Request) {
	if uid, ok := h.userID(r); ok {
		h.store.MarkRepliesSeen(r.Context(), uid)
	}
	w.WriteHeader(http.StatusNoContent)
}

type form struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Topic   string `json:"topic"`
	Message string `json:"message"`
	Page    string `json:"page"`
	Website string `json:"website"` // honeypot: people never see it
	Elapsed int64  `json:"elapsed"` // ms the form was open
}

func clean(s string, max int) (string, bool) {
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	return s, utf8.RuneCountInString(s) <= max
}

func (h *Handler) post(w http.ResponseWriter, r *http.Request) {
	var f form
	if err := httpx.Decode(r, &f, 32<<10); err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad request")
		return
	}
	// Bots fill the hidden field: pretend it worked so they learn nothing, keep nothing.
	if f.Website != "" {
		httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	// Too fast to be typed. A person (autofill + paste) just sends again.
	if f.Elapsed < minElapsed {
		httpx.Error(w, http.StatusBadRequest, "That was quick! Please check your message and send it again.")
		return
	}
	ip := httpx.ClientIP(r)
	if h.perIP.Blocked(ip) || h.daily.Blocked("all") {
		httpx.Error(w, http.StatusTooManyRequests, "Too many messages for now. Please try again later or use email.")
		return
	}
	var ok bool
	var errs []string
	if f.Email, ok = clean(f.Email, maxEmail); !ok || !validEmail(f.Email) {
		errs = append(errs, "email")
	}
	if f.Name, ok = clean(f.Name, maxName); !ok {
		errs = append(errs, "name")
	} else if f.Name == "" {
		if f.Topic != "quick" { // the message bubble asks only for an email
			errs = append(errs, "name")
		} else if i := strings.Index(f.Email, "@"); i > 0 {
			f.Name = f.Email[:i]
		}
	}
	if f.Message, ok = clean(f.Message, maxBody); !ok || utf8.RuneCountInString(f.Message) < minBody {
		errs = append(errs, "message")
	}
	f.Topic, _ = clean(strings.ToLower(f.Topic), maxTopic)
	if !validTopic(f.Topic) {
		f.Topic = "other"
	}
	f.Page, _ = clean(f.Page, 200)
	if !strings.HasPrefix(f.Page, "/") {
		f.Page = ""
	}
	if len(errs) > 0 {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": "Please check: " + strings.Join(errs, ", ") + ".", "fields": errs})
		return
	}
	h.perIP.Allow(ip)
	h.daily.Allow("all")
	m, err := h.store.NewMessage(r.Context(), f.Name, f.Email, f.Topic, f.Message, f.Page)
	if err != nil {
		log.Printf("contact: save: %v", err)
		httpx.Error(w, http.StatusInternalServerError, "Could not send right now. Please use email instead.")
		return
	}
	h.notify(f.Name, f.Email, f.Topic, f.Message, f.Page, m.UserID)
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
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

func validEmail(s string) bool {
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && strings.Contains(s[strings.LastIndex(s, "@"):], ".")
}

func validTopic(t string) bool {
	for _, x := range Topics {
		if x == t {
			return true
		}
	}
	return false
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
