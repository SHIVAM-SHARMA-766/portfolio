package store

// Messages between signed-in visitors and the admin: one conversation per
// visitor (CRM contact). The admin replies from the Inbox and the visitor reads
// the replies on the site. (Older rows may come from the retired anonymous
// contact form; their contacts see replies after signing in with that email.)

import (
	"context"
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
	Seen      bool   `json:"seen,omitempty"`     // a reply the visitor has seen
	HasLogin  bool   `json:"hasLogin,omitempty"` // the contact can sign in and read replies on the site
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

// VisitorMessage files a message from a signed-in visitor.
func (s *Store) VisitorMessage(ctx context.Context, uid int64, topic, body, page string) (*Message, error) {
	m := &Message{UserID: uid, Topic: topic, Body: body, Page: page, CreatedAt: now()}
	res, err := s.db.ExecContext(ctx, `INSERT INTO messages(user_id,topic,body,page,created_at) SELECT id,?,?,?,? FROM users WHERE id=?`, topic, body, page, m.CreatedAt, uid)
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
