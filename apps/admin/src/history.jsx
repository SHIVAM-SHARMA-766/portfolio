// Edit history: every save in the admin is a Git commit, so a file's history is
// its commits. Restoring a version writes that old content as a new commit —
// nothing is lost, and a restore can itself be undone.
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { api } from './api.js';
import { notify } from './fields.jsx';
import { Icon, ask } from './ui.jsx';

const when = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const exact = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** "Update pages/about.json (admin)" → "content/pages/about.json" (admin commits name the file) */
export const pathOf = (msg) => { const m = msg.match(/\b((?:pages|blog|profile|site|shop|missions|achievements)[\w./-]*\.(?:json|md))\b/); return m ? `content/${m[1]}` : null; };
const verbOf = (msg) => msg.replace(/\s*\(admin\)$/, '');

function Entry({ e, current, onRestore }) {
  return (
    <li class={`hist ${current ? 'is-current' : ''}`}>
      <span class={`hist-dot ${e.admin ? 'hist-dot--admin' : ''}`} />
      <div class="hist-main">
        <b>{verbOf(e.message)}</b>
        <small title={exact(e.date)}>{when(e.date)} · {e.author}{e.admin ? ' · admin panel' : ' · code'}</small>
      </div>
      <div class="hist-tools">
        {current ? <span class="pill pill--ok">Current</span> : onRestore && <button type="button" onClick={() => onRestore(e)}>Restore</button>}
        <a class="icon-btn" href={e.url} target="_blank" rel="noopener" title="See the exact change on GitHub"><Icon name="external" /></a>
      </div>
    </li>
  );
}

/** Side panel with the versions of one file, newest first. */
export function HistoryDrawer({ path, title, onClose, onRestored }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.history(path).then((d) => setList(d.history)).catch((e) => setErr(e.message)); }, [path]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const restore = async (e) => {
    if (!(await ask({ title: 'Restore this version?', body: `“${title}” goes back to how it was ${when(e.date)} (${exact(e.date)}). This is saved as a new version, so you can undo it the same way.`, confirm: 'Restore' }))) return;
    setBusy(true);
    try {
      await api.restore(path, e.sha);
      dispatchEvent(new CustomEvent('admin-saved', { detail: {} }));
      notify('Version restored.');
      onRestored?.();
      onClose();
    } catch (x) { notify(x.message, 'err'); }
    setBusy(false);
  };
  return (
    <div class="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="drawer" role="dialog" aria-label="Version history">
        <header class="drawer-head"><div><h2>Version history</h2><small class="muted">{title}</small></div><button type="button" class="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button></header>
        <div class="drawer-body">
          {err ? <p class="error">{err}</p> : !list ? <div class="sk sk--table" /> : !list.length ? <p class="muted">No history yet.</p> : (
            <ul class={`hist-list ${busy ? 'is-busy' : ''}`}>
              {list.map((e, i) => <Entry e={e} current={i === 0} onRestore={restore} />)}
            </ul>
          )}
          <p class="muted hist-note">Every save is kept. Restoring creates a new version; nothing is deleted.</p>
        </div>
      </div>
    </div>
  );
}

/** All recent content changes, from the admin panel and from code. */
export function HistoryPage() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('all');
  const load = useCallback(() => api.history('').then((d) => setList(d.history)).catch((e) => setErr(e.message)), []);
  useEffect(load, []);
  const shown = useMemo(() => (list ?? []).filter((e) => (only === 'all' || (only === 'admin') === e.admin) && `${e.message} ${e.author}`.toLowerCase().includes(q.toLowerCase())), [list, q, only]);
  const groups = [];
  for (const e of shown) {
    const day = new Date(e.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1).items.push(e);
  }
  return (
    <>
      <header class="page-head">
        <div><h1>History</h1><p class="muted">Every change to the site's content, newest first. Open a file to see its versions and restore one.</p></div>
        <div class="actions"><button onClick={load}><Icon name="activity" />Refresh</button></div>
      </header>
      <div class="tabs">{[['all', 'All changes'], ['admin', 'From the admin'], ['code', 'From code']].map(([id, l]) => <button type="button" class={`tab ${only === id ? 'is-on' : ''}`} onClick={() => setOnly(id)}>{l}</button>)}</div>
      <div class="toolbar"><label class="search"><Icon name="search" /><input type="search" placeholder="Search changes" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></label></div>
      {err ? <div class="panel"><p class="error">{err}</p></div> : !list ? <div class="sk sk--table" /> : !shown.length ? <div class="panel"><p class="muted">No changes match.</p></div> : (
        <div class="panel hist-page">
          {groups.map((g) => (
            <section>
              <p class="tl-date">{g.day}</p>
              <ul class="hist-list">
                {g.items.map((e) => {
                  const p = pathOf(e.message);
                  return (
                    <li class="hist">
                      <span class={`hist-dot ${e.admin ? 'hist-dot--admin' : ''}`} />
                      <div class="hist-main"><b>{verbOf(e.message)}</b><small title={exact(e.date)}>{new Date(e.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {e.author}{e.admin ? ' · admin panel' : ' · code'}</small></div>
                      <div class="hist-tools">
                        {p && <a class="button" href={hrefFor(p)}>Open</a>}
                        <a class="icon-btn" href={e.url} target="_blank" rel="noopener" title="See the exact change on GitHub"><Icon name="external" /></a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

const hrefFor = (p) => (p === 'content/profile.json' ? '#/experience' : p === 'content/site.json' ? '#/intro' : `#/edit?path=${encodeURIComponent(p)}`);
