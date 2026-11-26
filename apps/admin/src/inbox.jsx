// Inbox: messages sent through the site's contact form. Each one belongs to a
// CRM contact, so replying, tagging and notes all happen on the contact page.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api } from './api.js';
import { notify } from './fields.jsx';
import { Icon, Avatar, ago, dateTime, ask } from './ui.jsx';
import { navigate } from './core.js';
import { Empty } from './crm.jsx';

export const TOPICS = { job: 'Job opportunity', freelance: 'Freelance / contract', collaboration: 'Collaboration', question: 'Question', other: 'Other' };

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

const replyHref = (m) => `mailto:${m.email}?subject=${encodeURIComponent(`Re: your message on my portfolio`)}&body=${encodeURIComponent(`Hi ${m.name.split(' ')[0]},\n\n\n\n— On ${dateTime(m.createdAt)} you wrote:\n> ${m.body.split('\n').join('\n> ')}`)}`;

export function Inbox() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const load = () => api.messages().then((d) => { setList(d.messages); setUnread(d.unread); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const shown = useMemo(() => (list ?? []).filter((m) => (tab === 'all' || (tab === 'unread' ? !m.read : m.topic === tab)) && `${m.name} ${m.email} ${m.body}`.toLowerCase().includes(q.toLowerCase())), [list, tab, q]);
  const mark = async (m, read) => {
    setList((l) => l.map((x) => (x.id === m.id ? { ...x, read } : x)));
    try { const d = await api.markMessage(m.id, read); setUnread(d.unread); } catch (e) { notify(e.message, 'err'); load(); }
  };
  const toggle = (m) => { const o = open === m.id ? null : m.id; setOpen(o); if (o && !m.read) mark(m, true); };
  const del = async (m) => {
    if (!(await ask({ title: 'Delete this message?', body: `From ${m.name}. The contact and their notes stay.`, confirm: 'Delete', danger: true }))) return;
    try { const d = await api.deleteMessage(m.id); setUnread(d.unread); setList((l) => l.filter((x) => x.id !== m.id)); notify('Message deleted.'); } catch (e) { notify(e.message, 'err'); }
  };
  const counts = useMemo(() => ({ unread: (list ?? []).filter((m) => !m.read).length }), [list]);
  return (
    <>
      <header class="page-head">
        <div><h1>Inbox {list && <span class="count">{list.length}</span>}</h1><p class="muted">Messages from the contact form. Each sender is also a contact, so you can tag them, add notes and move them through the pipeline.</p></div>
        <div class="actions"><button onClick={load}><Icon name="activity" />Refresh</button></div>
      </header>
      <div class="tabs">
        {[['all', 'All'], ['unread', `Unread${counts.unread ? ` (${counts.unread})` : ''}`], ...Object.entries(TOPICS)].map(([id, l]) => <button type="button" class={`tab ${tab === id ? 'is-on' : ''}`} onClick={() => setTab(id)}>{l}</button>)}
      </div>
      <div class="toolbar"><label class="search"><Icon name="search" /><input type="search" placeholder="Search name, email or text" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></label></div>
      {err ? <div class="panel"><p class="error">{err}</p></div> : !list ? <div class="sk sk--table" /> : !shown.length ? (
        <div class="panel"><Empty icon="mail" title={list.length ? 'No messages match' : 'No messages yet'} text={list.length ? 'Try another tab or search.' : 'When someone uses the form on the contact page, it lands here.'} /></div>
      ) : (
        <ul class="panel inbox">
          {shown.map((m) => (
            <li class={`msg ${m.read ? '' : 'is-unread'} ${open === m.id ? 'is-open' : ''}`}>
              <button type="button" class="msg-row" onClick={() => toggle(m)} aria-expanded={open === m.id}>
                <Avatar name={m.name} email={m.email} size={34} />
                <span class="msg-main">
                  <span class="msg-top"><b>{m.name}</b><span class="tag">{TOPICS[m.topic] ?? m.topic}</span></span>
                  <span class="msg-preview">{m.body}</span>
                </span>
                <small class="msg-when" title={dateTime(m.createdAt)}>{ago(m.createdAt)}</small>
              </button>
              {open === m.id && (
                <div class="msg-body">
                  <p class="muted">{m.email}{m.page && <> · sent from <code>{m.page}</code></>} · {dateTime(m.createdAt)}</p>
                  <p class="msg-text">{m.body}</p>
                  <div class="msg-actions">
                    <a class="button primary" href={replyHref(m)}><Icon name="mail" />Reply</a>
                    <a class="button" href={`#/contact?id=${m.userId}`} onClick={(e) => { e.preventDefault(); navigate(`#/contact?id=${m.userId}`); }}><Icon name="user" />Open contact</a>
                    <button type="button" onClick={() => mark(m, false)}>Mark unread</button>
                    <span class="spacer" />
                    <button type="button" class="danger" onClick={() => del(m)} title="Delete message"><Icon name="trash" /></button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The messages on one contact's page. */
export function ContactMessages({ messages }) {
  if (!messages?.length) return null;
  return (
    <section class="panel">
      <div class="panel-head"><h2>Messages <span class="count">{messages.length}</span></h2><span class="muted">From the contact form</span></div>
      <ul class="notes">
        {messages.map((m) => (
          <li><p class="msg-text">{m.body}</p><small class="muted">{TOPICS[m.topic] ?? m.topic} · {dateTime(m.createdAt)}{m.page && <> · from <code>{m.page}</code></>} · <a href={replyHref(m)}>Reply</a></small></li>
        ))}
      </ul>
    </section>
  );
}
