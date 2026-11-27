// Inbox: conversations with visitors. Messages come from the contact form and
// the message bubble on every page; replies are shown to the visitor on the
// site (once they're signed in), so no email is needed. Each sender is also a
// CRM contact, so tags, notes and the pipeline live on the contact page.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api } from './api.js';
import { notify } from './fields.jsx';
import { Icon, Avatar, ago, dateTime, ask } from './ui.jsx';
import { navigate, useRoute } from './core.js';
import { Empty } from './crm.jsx';

export const TOPICS = { job: 'Job opportunity', freelance: 'Freelance / contract', collaboration: 'Collaboration', question: 'Question', quick: 'Quick note', chat: 'Chat', other: 'Other' };

// ---- unread count, shared by the sidebar badge and the dashboard ----------------
let unread = 0;
const subs = new Set();
const setUnread = (n) => { unread = n; subs.forEach((f) => f(n)); };
export const refreshUnread = () => api.messages().then((d) => setUnread(d.unread)).catch(() => {});
/** The number of unread messages; polls every minute while the admin is open. */
export function useUnread() {
  const [n, setN] = useState(unread);
  useEffect(() => {
    subs.add(setN);
    if (subs.size === 1) refreshUnread();
    const t = setInterval(refreshUnread, 60000);
    return () => { subs.delete(setN); clearInterval(t); };
  }, []);
  return n;
}

const replyByEmail = (c) => `mailto:${c.email}?subject=${encodeURIComponent('Re: your message on my portfolio')}`;

/** Messages (newest first from the API) grouped into conversations, newest activity first. */
function conversations(list) {
  const by = new Map();
  for (const m of list) {
    if (!by.has(m.userId)) by.set(m.userId, { userId: m.userId, name: m.name, email: m.email, hasLogin: m.hasLogin, last: m, unread: 0, messages: [] });
    const c = by.get(m.userId);
    c.messages.unshift(m); // oldest first
    if (!m.fromAdmin && !m.read) c.unread++;
  }
  return [...by.values()];
}

export function Inbox() {
  const route = useRoute();
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const open = Number(route.params.c) || null;
  const load = () => api.messages().then((d) => { setList(d.messages); setUnread(d.unread); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  const convs = useMemo(() => conversations(list ?? []), [list]);
  const shown = convs.filter((c) => (tab === 'all' || c.unread > 0) && `${c.name} ${c.email} ${c.messages.map((m) => m.body).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const current = convs.find((c) => c.userId === open) ?? null;
  const pick = (id) => navigate(id ? `#/inbox?c=${id}` : '#/inbox');
  const totalUnread = convs.reduce((a, c) => a + c.unread, 0);

  return (
    <>
      <header class="page-head">
        <div><h1>Inbox {list && <span class="count">{convs.length}</span>}</h1><p class="muted">Messages from the contact form and the message bubble on every page. Your replies show up for the visitor on the site.</p></div>
        <div class="actions"><button onClick={load}><Icon name="activity" />Refresh</button></div>
      </header>
      {err ? <div class="panel"><p class="error">{err}</p></div> : !list ? <div class="sk sk--table" /> : !convs.length ? (
        <div class="panel"><Empty icon="mail" title="No messages yet" text="When someone writes through the message bubble or the contact page, the conversation appears here." /></div>
      ) : (
        <div class={`inbox-grid ${current ? 'has-open' : ''}`}>
          <aside class="panel conv-list">
            <div class="tabs tabs--tight">{[['all', 'All'], ['unread', `Unread${totalUnread ? ` (${totalUnread})` : ''}`]].map(([id, l]) => <button type="button" class={`tab ${tab === id ? 'is-on' : ''}`} onClick={() => setTab(id)}>{l}</button>)}</div>
            <label class="search search--block"><Icon name="search" /><input type="search" placeholder="Search" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></label>
            {!shown.length ? <p class="muted conv-empty">Nothing matches.</p> : (
              <ul>
                {shown.map((c) => (
                  <li><button type="button" class={`conv ${c.userId === open ? 'is-on' : ''} ${c.unread ? 'is-unread' : ''}`} onClick={() => pick(c.userId)}>
                    <Avatar name={c.name} email={c.email} size={34} />
                    <span class="conv-main">
                      <span class="conv-top"><b>{c.name || c.email}</b><small>{ago(c.last.createdAt)}</small></span>
                      <span class="conv-preview">{c.last.fromAdmin ? 'You: ' : ''}{c.last.body}</span>
                    </span>
                    {c.unread > 0 && <span class="nav-badge">{c.unread}</span>}
                  </button></li>
                ))}
              </ul>
            )}
          </aside>
          {current ? <Conversation key={current.userId} c={current} onBack={() => pick(null)} onChange={load} setList={setList} /> : (
            <section class="panel conv-placeholder"><Empty icon="mail" title="Pick a conversation" text="Choose one on the left to read it and reply." /></section>
          )}
        </div>
      )}
    </>
  );
}

function Conversation({ c, onBack, onChange, setList }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  // Opening a conversation marks its messages read
  useEffect(() => {
    const unreadIds = c.messages.filter((m) => !m.fromAdmin && !m.read).map((m) => m.id);
    if (!unreadIds.length) return;
    setList((l) => l.map((m) => (unreadIds.includes(m.id) ? { ...m, read: true } : m)));
    Promise.all(unreadIds.map((id) => api.markMessage(id, true))).then((r) => setUnread(r.at(-1).unread)).catch(() => {});
  }, [c.userId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [c.messages.length]);
  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const d = await api.reply(c.userId, text.trim());
      setText('');
      setUnread(d.unread);
      setList((l) => [{ ...d.message, name: c.name, email: c.email, hasLogin: c.hasLogin }, ...l]);
    } catch (x) { notify(x.message, 'err'); }
    setBusy(false);
  };
  const del = async (m) => {
    if (!(await ask({ title: 'Delete this message?', body: m.fromAdmin ? 'The visitor will no longer see this reply.' : 'The contact and their notes stay.', confirm: 'Delete', danger: true }))) return;
    try { const d = await api.deleteMessage(m.id); setUnread(d.unread); onChange(); } catch (x) { notify(x.message, 'err'); }
  };
  return (
    <section class="panel conv-view">
      <header class="conv-head">
        <button type="button" class="icon-btn conv-back" onClick={onBack} aria-label="Back to conversations">←</button>
        <Avatar name={c.name} email={c.email} size={36} />
        <div class="conv-who"><b>{c.name || c.email}</b><small class="muted">{c.email}</small></div>
        <span class="spacer" />
        <a class="button" href={`#/contact?id=${c.userId}`} onClick={(e) => { e.preventDefault(); navigate(`#/contact?id=${c.userId}`); }}><Icon name="user" />Contact</a>
      </header>
      <ol class="bubbles">
        {c.messages.map((m) => (
          <li class={`bubble ${m.fromAdmin ? 'bubble--me' : 'bubble--them'}`}>
            {!m.fromAdmin && m.topic && m.topic !== 'chat' && <span class="tag">{TOPICS[m.topic] ?? m.topic}</span>}
            <p class="msg-text">{m.body}</p>
            <small title={dateTime(m.createdAt)}>
              {m.fromAdmin ? `You · ${ago(m.createdAt)}${m.seen ? ' · seen' : ''}` : `${ago(m.createdAt)}${m.page ? ` · from ${m.page}` : ''}`}
              <button type="button" class="link bubble-del" onClick={() => del(m)} aria-label="Delete message"><Icon name="trash" size={12} /></button>
            </small>
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>
      <form class="conv-reply" onSubmit={send}>
        {!c.hasLogin && <p class="conv-note"><Icon name="alert" size={14} />Not signed in on the site. They'll see your reply when they sign in with <b>{c.email}</b>{c.email && <> — or <a href={replyByEmail(c)}>reply by email</a></>}.</p>}
        <textarea rows={3} value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder={`Reply to ${c.name || c.email}…`} maxLength={4000}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(e); }} />
        <div class="note-actions"><small class="muted">Ctrl+Enter to send</small><button class="primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send reply'}</button></div>
      </form>
    </section>
  );
}

/** The conversation on one contact's page, with a link to reply in the Inbox. */
export function ContactMessages({ messages, id }) {
  if (!messages?.length) return null;
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  return (
    <section class="panel">
      <div class="panel-head"><h2>Messages <span class="count">{messages.length}</span></h2><a href={`#/inbox?c=${id}`} onClick={(e) => { e.preventDefault(); navigate(`#/inbox?c=${id}`); }}>Reply in Inbox</a></div>
      <ol class="bubbles bubbles--compact">
        {sorted.map((m) => (
          <li class={`bubble ${m.fromAdmin ? 'bubble--me' : 'bubble--them'}`}><p class="msg-text">{m.body}</p><small>{m.fromAdmin ? 'You · ' : `${TOPICS[m.topic] ?? m.topic} · `}{dateTime(m.createdAt)}</small></li>
        ))}
      </ol>
    </section>
  );
}
