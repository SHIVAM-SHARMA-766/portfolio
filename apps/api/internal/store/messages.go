package store

// Messages between visitors and the admin. A visitor writes through the contact
// form or the message bubble; each message is filed under a CRM contact (an
// existing visitor with the same email, or a new contact tagged "contact-form").
// The admin replies from the Inbox; signed-in visitors read replies on the site
// (a contact created from the form sees them after signing in with that email,
// since sign-in links accounts by verified email).

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

const messagesSchema = `
CREATE TABLE IF NOT EXISTS messages (
	id          INTEGER PRIMARY KEY,
	user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	topic       TEXT NOT NULL DEFAULT '',
	body        TEXT NOT NULL,
	page        TEXT NOT NULL DEFAULT '',
	created_at  INTEGER NOT NULL,
	read_at     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS messages_time ON messages(created_at);
`

// migrateMessages adds columns introduced after the first release.
func (s *Store) migrateMessages() error {
	have := map[string]bool{}
	rows, err := s.db.Query(`SELECT name FROM pragma_table_info('messages')`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var n string
		rows.Scan(&n)
		have[n] = true
	}
	rows.Close()
	for col, def := range map[string]string{
		"from_admin": "INTEGER NOT NULL DEFAULT 0", // 1 = a reply from the admin
		"seen_at":    "INTEGER NOT NULL DEFAULT 0", // when the visitor saw a reply
	} {
		if !have[col] {
			if _, err := s.db.Exec(`ALTER TABLE messages ADD COLUMN ` + col + ` ` + def); err != nil {
				return err
			}
		}
	}
	return nil
}

// FormTag marks contacts who wrote through the contact form.
const FormTag = "contact-form"

type Message struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"userId"`
	Name      string `json:"name,omitempty"`
	Email     string `json:"email,omitempty"`
	Topic     string `json:"topic"`
	Body      string `json:"body"`
	Page      string `json:"page"`
	CreatedAt int64  `json:"createdAt"`
	Read      bool   `json:"read"`
	FromAdmin bool   `json:"fromAdmin,omitempty"`
	Seen      bool   `json:"seen,omitempty"` // a reply the visitor has seen
	HasLogin  bool   `json:"hasLogin,omitempty"` // the contact can sign in and read replies on the site
}

// NewMessage files a contact-form message and returns it with its contact.
func (s *Store) NewMessage(ctx context.Context, name, email, topic, body, page string) (*Message, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var uid int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM users WHERE email=? COLLATE NOCASE ORDER BY id LIMIT 1`, email).Scan(&uid)
	if errors.Is(err, sql.ErrNoRows) {
		res, err := tx.ExecContext(ctx, `INSERT INTO users(email,name,avatar,created_at,last_seen) VALUES(?,?,'',?,?)`, email, name, now(), now())
		if err != nil {
			return nil, err
		}
		uid, _ = res.LastInsertId()
	} else if err != nil {
		return nil, err
	} else {
		// A known contact: only fill a missing name, never overwrite.
		tx.ExecContext(ctx, `UPDATE users SET name=CASE WHEN name='' THEN ? ELSE name END WHERE id=?`, name, uid)
	}
	// Tag the contact, keeping existing tags and stage.
	var tags string
	err = tx.QueryRowContext(ctx, `SELECT tags FROM crm WHERE user_id=?`, uid).Scan(&tags)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if _, err := tx.ExecContext(ctx, `INSERT INTO crm(user_id,tags,updated_at) VALUES(?,?,?)`, uid, FormTag, now()); err != nil {
			return nil, err
		}
	case err != nil:
		return nil, err
	default:
		if !hasTag(tags, FormTag) {
			if tags != "" {
				tags += ","
			}
			if _, err := tx.ExecContext(ctx, `UPDATE crm SET tags=?,updated_at=? WHERE user_id=?`, tags+FormTag, now(), uid); err != nil {
				return nil, err
			}
		}
	}
	m := &Message{UserID: uid, Name: name, Email: email, Topic: topic, Body: body, Page: page, CreatedAt: now()}
	res, err := tx.ExecContext(ctx, `INSERT INTO messages(user_id,topic,body,page,created_at) VALUES(?,?,?,?,?)`, uid, topic, body, page, m.CreatedAt)
	if err != nil {
		return nil, err
	}
	m.ID, _ = res.LastInsertId()
	return m, tx.Commit()
}

func hasTag(csv, tag string) bool {
	for _, t := range strings.Split(csv, ",") {
		if t == tag {
			return true
		}
	}
	return false
}

// Messages lists messages newest first: all of them, or one contact's (userID > 0).
func (s *Store) Messages(ctx context.Context, userID int64, limit int) ([]Message, error) {
	q := `SELECT m.id,m.user_id,u.name,u.email,m.topic,m.body,m.page,m.created_at,m.read_at,m.from_admin,m.seen_at,
		EXISTS(SELECT 1 FROM identities i WHERE i.user_id=u.id)
		FROM messages m JOIN users u ON u.id=m.user_id`
	args := []any{}
	if userID > 0 {
		q += ` WHERE m.user_id=?`
		args = append(args, userID)
	}
	q += ` ORDER BY m.created_at DESC, m.id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		var m Message
		var readAt, fromAdmin, seenAt, login int64
		if err := rows.Scan(&m.ID, &m.UserID, &m.Name, &m.Email, &m.Topic, &m.Body, &m.Page, &m.CreatedAt, &readAt, &fromAdmin, &seenAt, &login); err != nil {
			return nil, err
		}
		m.Read, m.FromAdmin, m.Seen, m.HasLogin = readAt > 0, fromAdmin == 1, seenAt > 0, login == 1
		out = append(out, m)
	}
	return out, rows.Err()
}

// MarkMessage sets a message read or unread.
func (s *Store) MarkMessage(ctx context.Context, id int64, read bool) error {
	v := int64(0)
	if read {
		v = now()
	}
	res, err := s.db.ExecContext(ctx, `UPDATE messages SET read_at=? WHERE id=?`, v, id)
	if err != nil {
		return err
	}
	if k, _ := res.RowsAffected(); k == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteMessage(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM messages WHERE id=?`, id)
	if err != nil {
		return err
	}
	if k, _ := res.RowsAffected(); k == 0 {
		return ErrNotFound
	}
	return nil
}

// UnreadMessages counts visitor messages the admin has not read.
func (s *Store) UnreadMessages(ctx context.Context) int {
	var n int
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages WHERE read_at=0 AND from_admin=0`).Scan(&n)
	return n
}

// VisitorMessage files a message from a signed-in visitor (the message bubble).
func (s *Store) VisitorMessage(ctx context.Context, uid int64, body, page string) (*Message, error) {
	m := &Message{UserID: uid, Topic: "chat", Body: body, Page: page, CreatedAt: now()}
	res, err := s.db.ExecContext(ctx, `INSERT INTO messages(user_id,topic,body,page,created_at) SELECT id,'chat',?,?,? FROM users WHERE id=?`, body, page, m.CreatedAt, uid)
	if err != nil {
		return nil, err
	}
	if k, _ := res.RowsAffected(); k == 0 {
		return nil, ErrNotFound
	}
	m.ID, _ = res.LastInsertId()
	return m, nil
}

// Reply adds the admin's reply to a contact's conversation. Replying also marks
// their messages read.
func (s *Store) Reply(ctx context.Context, uid int64, body string) (*Message, error) {
	m := &Message{UserID: uid, Topic: "reply", Body: body, CreatedAt: now(), Read: true, FromAdmin: true}
	res, err := s.db.ExecContext(ctx, `INSERT INTO messages(user_id,topic,body,page,created_at,read_at,from_admin) SELECT id,'reply',?,'',?,?,1 FROM users WHERE id=?`, body, m.CreatedAt, m.CreatedAt, uid)
	if err != nil {
		return nil, err
	}
	if k, _ := res.RowsAffected(); k == 0 {
		return nil, ErrNotFound
	}
	m.ID, _ = res.LastInsertId()
	s.db.ExecContext(ctx, `UPDATE messages SET read_at=? WHERE user_id=? AND from_admin=0 AND read_at=0`, now(), uid)
	return m, nil
}

// Thread is one visitor's conversation, oldest first, for the site.
func (s *Store) Thread(ctx context.Context, uid int64) ([]Message, error) {
	list, err := s.Messages(ctx, uid, 200)
	if err != nil {
		return nil, err
	}
	for i, j := 0, len(list)-1; i < j; i, j = i+1, j-1 {
		list[i], list[j] = list[j], list[i]
	}
	return list, nil
}

// UnseenReplies counts admin replies the visitor has not opened yet.
func (s *Store) UnseenReplies(ctx context.Context, uid int64) int {
	var n int
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages WHERE user_id=? AND from_admin=1 AND seen_at=0`, uid).Scan(&n)
	return n
}

// MarkRepliesSeen records that the visitor opened their conversation.
func (s *Store) MarkRepliesSeen(ctx context.Context, uid int64) {
	s.db.ExecContext(ctx, `UPDATE messages SET seen_at=? WHERE user_id=? AND from_admin=1 AND seen_at=0`, now(), uid)
}
