package store

// Messages sent through the site's contact form. Each one is filed under a CRM
// contact: an existing visitor with the same email, or a new contact created
// for the sender (tagged "contact-form", with no sign-in identity).

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
	q := `SELECT m.id,m.user_id,u.name,u.email,m.topic,m.body,m.page,m.created_at,m.read_at
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
		var readAt int64
		if err := rows.Scan(&m.ID, &m.UserID, &m.Name, &m.Email, &m.Topic, &m.Body, &m.Page, &m.CreatedAt, &readAt); err != nil {
			return nil, err
		}
		m.Read = readAt > 0
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

// UnreadMessages counts messages not yet read.
func (s *Store) UnreadMessages(ctx context.Context) int {
	var n int
	s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM messages WHERE read_at=0`).Scan(&n)
	return n
}
