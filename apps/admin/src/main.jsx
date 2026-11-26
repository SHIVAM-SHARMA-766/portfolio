import { render } from 'preact';
import { useEffect, useMemo, useState, useCallback, useRef } from 'preact/hooks';
import { api, parseFrontmatter, stringifyFrontmatter, toJSON, slugify } from './api.js';
import { Form, MarkdownEditor, uploadFile, publicUrl } from './fields.jsx';
import * as S from './schemas.js';
import { Dashboard, Contacts, Contact } from './crm.jsx';
import { ProfileSection, SECTIONS } from './profile.jsx';
import { HistoryDrawer, HistoryPage } from './history.jsx';
import { Icon, Avatar, CommandPalette, DialogHost, ShortcutsHelp, Menu, ask, askText } from './ui.jsx';
import './style.css';

// ---- tiny router & shared state ---------------------------------------------

function useRoute() {
  const get = () => {
    const [path, q] = (location.hash.slice(1) || '/dashboard').split('?');
    return { path, params: Object.fromEntries(new URLSearchParams(q)) };
  };
  const [route, setRoute] = useState(get);
  useEffect(() => {
    let last = location.hash;
    const on = () => {
      // Back/forward or a typed URL while an editor has unsaved changes.
      if (dirty && location.hash !== last) {
        // Stay put, then ask; leave only if confirmed
        const target = location.hash;
        history.replaceState(null, '', last);
        ask({ title: 'Leave without saving?', body: 'Your changes on this page will be lost.', confirm: 'Leave', danger: true }).then((yes) => { if (yes) { dirty = false; location.hash = target; } });
        return;
      }
      last = location.hash;
      setRoute(get());
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

let dirty = false;
const setDirty = (v) => { dirty = v; };
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
const navigate = async (hash) => {
  if (dirty && !(await ask({ title: 'Leave without saving?', body: 'Your changes on this page will be lost.', confirm: 'Leave', danger: true }))) return;
  dirty = false;
  location.hash = hash;
};

let toastSet = () => {};
const toast = (msg, kind = 'ok', action) => toastSet({ msg, kind, action, id: Date.now() });
let savedAt = 0; // last save, to watch the deploy
let publishSet = () => {};
addEventListener('admin-toast', (e) => toast(e.detail.msg, e.detail.kind, e.detail.action));
addEventListener('admin-saved', (e) => { savedAt = Date.now(); publishSet({ since: savedAt, url: e.detail?.url ?? null }); });
const published = (url) => dispatchEvent(new CustomEvent('admin-saved', { detail: { url } }));

const Logo = ({ size = 28 }) => (
  <svg class="logo" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="#18181b" />
    <path d="M20.6 10.4c-.9-1.6-2.6-2.4-4.9-2.4-2.9 0-4.8 1.5-4.8 3.6 0 5 10.2 2.5 10.2 7.9 0 2.3-2.1 4-5.2 4-2.6 0-4.5-1-5.5-2.8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" />
    <circle cx="24.6" cy="23.6" r="2.1" fill="#f97316" />
  </svg>
);
const go = (e) => { e.preventDefault(); navigate(e.currentTarget.getAttribute('href')); };
const View = ({ url }) => url ? <a class="button" href={url} target="_blank" rel="noopener">View on site ↗</a> : null;

function Toast() {
  const [t, setT] = useState(null);
  toastSet = setT;
  useEffect(() => { if (t) { const h = setTimeout(() => setT(null), t.action ? 8000 : 4500); return () => clearTimeout(h); } }, [t]);
  return t ? (
    <div class={`toast toast--${t.kind}`} role="status">
      <span>{t.msg}</span>
      {t.action && <button type="button" class="toast-action" onClick={() => { t.action.run(); setT(null); }}>{t.action.label}</button>}
    </div>
  ) : null;
}

/** After a save: follows the deploy until the change is live (or failed). */
function PublishTracker() {
  const [w, setW] = useState(null); // { since, url, state, link }
  publishSet = (x) => setW({ ...x, state: 'building' });
  useEffect(() => {
    if (!w || w.state !== 'building') return;
    let stop = false;
    const tick = async () => {
      try {
        const d = await api.deploys();
        const run = (d.runs ?? []).find((r) => new Date(r.created_at).getTime() >= w.since - 60000);
        if (run && run.status === 'completed' && !stop) {
          setW((x) => x && { ...x, state: run.conclusion === 'success' ? 'live' : 'failed', link: run.html_url });
          if (run.conclusion === 'success') dispatchEvent(new CustomEvent('admin-live'));
          return;
        }
      } catch {}
      if (!stop) setTimeout(tick, 6000);
    };
    const h = setTimeout(tick, 4000);
    return () => { stop = true; clearTimeout(h); };
  }, [w?.since]);
  useEffect(() => { if (w?.state === 'live') { const h = setTimeout(() => setW(null), 12000); return () => clearTimeout(h); } }, [w?.state]);
  if (!w) return null;
  return (
    <div class={`publish publish--${w.state}`} role="status">
      {w.state === 'building' && <><span class="spinner" /><span><b>Publishing your change…</b><small>The site updates in about a minute.</small></span></>}
      {w.state === 'live' && <><span class="publish-ok"><Icon name="check" size={14} /></span><span><b>Live</b><small>Your change is on the site.</small></span>{w.url && <a class="button" href={w.url} target="_blank" rel="noopener">View ↗</a>}</>}
      {w.state === 'failed' && <><span class="publish-bad"><Icon name="alert" size={14} /></span><span><b>Publishing failed</b><small>The site was not changed.</small></span>{w.link && <a class="button" href={w.link} target="_blank" rel="noopener">See why ↗</a>}</>}
      <button type="button" class="icon-btn" aria-label="Dismiss" onClick={() => setW(null)}><Icon name="x" size={14} /></button>
    </div>
  );
}

const fmt = (unix) => new Date(unix * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

// ---- deploy status ---------------------------------------------------------

function DeployBadge() {
  const [run, setRun] = useState(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try { const d = await api.deploys(); if (!stop) setRun(d.runs?.[0] ?? null); } catch {}
      const busy = Date.now() - savedAt < 10 * 60e3;
      if (!stop) setTimeout(tick, busy ? 8000 : 60000);
    };
    tick();
    return () => { stop = true; };
  }, []);
  if (!run) return null;
  const state = run.status !== 'completed' ? 'running' : run.conclusion === 'success' ? 'ok' : 'fail';
  const label = { running: 'Deploying…', ok: 'Live', fail: 'Deploy failed' }[state];
  return (
    <a class={`deploy deploy--${state}`} href={run.html_url} target="_blank" rel="noopener" title={`${run.display_title} · ${ago(run.created_at)}`}>
      <span class="dot" />{label}
    </a>
  );
}

// ---- login -----------------------------------------------------------------

function Login({ onDone }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api.login(u, p); onDone(); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <main class="login">
      <form onSubmit={submit} class="card login-card">
        <div class="login-brand"><Logo size={40} /><div><h1>Welcome back</h1><p class="muted">Sign in to manage your portfolio.</p></div></div>
        <label class="field"><span class="field-label">Username</span><input autocomplete="username" value={u} onInput={(e) => setU(e.currentTarget.value)} required autofocus /></label>
        <label class="field"><span class="field-label">Password</span><input type="password" autocomplete="current-password" value={p} onInput={(e) => setP(e.currentTarget.value)} required /></label>
        {err && <p class="error">{err}</p>}
        <button class="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

// ---- file editors ----------------------------------------------------------

/** Loads a content file, edits it with a form, and commits on save. Fields with
 *  `side: '<Group>'` go to the settings panel; a hidden `draft` field becomes the
 *  Save draft / Publish / Update buttons. */
function FileEditor({ path, kind, fields, title, initial, bodyLabel, onSaved, onDeleted, back, viewUrl }) {
  const [state, setState] = useState(null); // { data, body, sha }
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const [preview, setPreview] = useState(() => { try { return localStorage.getItem('admin.preview') === '1'; } catch { return false; } });
  const isNew = !!initial;
  const publishable = fields.some((f) => f.name === 'draft');

  const load = useCallback(() => {
    setState(null); setChanged(false); setDirty(false); setError('');
    if (initial) { setState({ ...initial, sha: '' }); setChanged(true); setDirty(true); return; }
    api.file(path).then((f) => {
      if (kind === 'md') { const { data, body } = parseFrontmatter(f.content); setState({ data, body, sha: f.sha }); }
      else setState({ data: JSON.parse(f.content), sha: f.sha });
    }).catch((e) => setError(e.message));
  }, [path]);
  useEffect(load, [path]);
  const togglePreview = () => { const v = !preview; setPreview(v); try { localStorage.setItem('admin.preview', v ? '1' : '0'); } catch {} };

  const edit = (patch) => { setState((s) => ({ ...s, ...patch })); setChanged(true); setDirty(true); };
  useEffect(() => () => setDirty(false), []); // leaving the editor clears the flag

  const missing = state ? fields.filter((f) => f.required && !String(state.data?.[f.name] ?? '').trim()).map((f) => f.label) : [];
  const save = useCallback(async (overrides = {}) => {
    if (!state || busy) return;
    if (missing.length) { toast(`Fill in: ${missing.join(', ')}`, 'err'); return; }
    setBusy(true);
    try {
      const data = { ...state.data, ...overrides };
      const content = kind === 'md' ? stringifyFrontmatter(data, state.body) : toJSON(data);
      const r = await api.save(path, content, state.sha);
      setState((s) => ({ ...s, data, sha: r.sha }));
      setChanged(false); setDirty(false);
      published(data.draft ? null : viewUrl?.(data) ?? null);
      onSaved?.();
    } catch (e) {
      toast(/sha|conflict|409/i.test(e.message) ? 'Someone changed this file since you opened it. Reload to get the latest version.' : e.message, 'err');
    }
    setBusy(false);
  }, [state, busy, path, missing.join()]);

  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [save]);

  const del = async () => {
    if (!(await ask({ title: `Delete “${state.data?.title ?? title}”?`, body: 'It disappears from the site after the next deploy. Git history keeps a copy.', confirm: 'Delete', danger: true }))) return;
    try { await api.remove(path, state.sha); setDirty(false); savedAt = Date.now(); toast('Deleted.'); onDeleted?.(); } catch (e) { toast(e.message, 'err'); }
  };

  if (error) return <div class="panel"><p class="error">Couldn't open {path}: {error}</p><button onClick={() => location.reload()}>Try again</button></div>;
  if (!state) return <div class="skeleton-page"><div class="sk sk--title" /><div class="sk sk--table" /></div>;
  const draft = !!state.data?.draft;
  const main = fields.filter((f) => !f.side && !f.hidden);
  const groups = [...new Set(fields.filter((f) => f.side && !f.hidden).map((f) => f.side))];
  const url = viewUrl?.(state.data);
  const showPreview = preview && !isNew && url && !draft;
  return (
    <div class="editor">
      {history && <HistoryDrawer path={path} title={state.data?.title || title} onClose={() => setHistory(false)} onRestored={load} />}
      <div class="editor-bar">
        <div class="editor-title">
          {back && <a class="back" href={back[0]} onClick={(e) => { e.preventDefault(); navigate(back[0]); }}>← {back[1]}</a>}
          <h1>{state.data?.title || title}</h1>
          <span class="editor-meta">
            {publishable && <span class={`pill ${draft ? 'pill--warn' : 'pill--ok'}`}>{isNew ? 'New' : draft ? 'Draft' : 'Published'}</span>}
            {changed && !isNew && <span class="unsaved"><i />Unsaved changes</span>}
            {!changed && <code class="path">{path}</code>}
          </span>
        </div>
        <div class="actions">
          {!isNew && url && !draft && <button type="button" class={preview ? 'is-active' : ''} onClick={togglePreview} title="Show the live page next to the editor"><Icon name="eye" />Preview</button>}
          {!isNew && <Menu items={[
            url && !draft && { label: 'View on site', icon: 'external', href: url, external: true },
            { label: 'Version history', icon: 'activity', onClick: () => setHistory(true) },
            publishable && !draft && { label: 'Switch to draft', icon: 'eye', onClick: () => save({ draft: true }) },
            { label: 'Copy file path', icon: 'copy', onClick: () => { navigator.clipboard?.writeText(path); toast('Path copied.'); } },
            onDeleted && { label: 'Delete', icon: 'trash', danger: true, onClick: del },
          ]} />}
          {publishable ? (
            draft || isNew ? <>
              <button onClick={() => save({ draft: true })} disabled={busy || (!changed && draft)}>{busy ? 'Saving…' : 'Save draft'}</button>
              <button class="primary" onClick={() => save({ draft: false })} disabled={busy}>Publish</button>
            </> : <button class="primary" onClick={() => save()} disabled={busy || !changed}>{busy ? 'Saving…' : changed ? 'Update' : 'Up to date'}</button>
          ) : (
            <button class="primary" onClick={() => save()} disabled={busy || !changed}>{busy ? 'Saving…' : changed ? (isNew ? 'Create' : 'Save changes') : 'Saved'}</button>
          )}
        </div>
      </div>
      <div class={showPreview ? 'editor-grid editor-grid--preview' : groups.length ? 'editor-grid' : ''}>
        <div class="editor-main">
          <Form fields={main} value={state.data} onChange={(data) => edit({ data })} />
          {kind === 'md' && (
            <div class="field"><span class="field-label">{bodyLabel ?? 'Content'}</span><MarkdownEditor tall value={state.body ?? ''} onChange={(body) => edit({ body })} /></div>
          )}
          {showPreview && groups.map((g) => (
            <section class="panel side-panel side-panel--inline"><h2>{g}</h2><Form fields={fields.filter((f) => f.side === g && !f.hidden)} value={state.data} onChange={(data) => edit({ data })} /></section>
          ))}
        </div>
        {showPreview && <LivePreview url={url} changed={changed} onClose={togglePreview} />}
        {!showPreview && groups.length > 0 && (
          <aside class="editor-side">
            {groups.map((g) => (
              <section class="panel side-panel">
                <h2>{g}</h2>
                <Form fields={fields.filter((f) => f.side === g && !f.hidden)} value={state.data} onChange={(data) => edit({ data })} />
              </section>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

/** The live page next to the editor. It reloads by itself when a save goes live. */
function LivePreview({ url, changed, onClose }) {
  const [device, setDevice] = useState('desktop');
  const [key, setKey] = useState(0);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const live = () => { setKey((k) => k + 1); setFresh(true); setTimeout(() => setFresh(false), 4000); };
    addEventListener('admin-live', live);
    return () => removeEventListener('admin-live', live);
  }, []);
  return (
    <aside class="preview">
      <div class="preview-bar">
        <span class="seg">
          <button type="button" class={device === 'desktop' ? 'is-on' : ''} onClick={() => setDevice('desktop')}>Desktop</button>
          <button type="button" class={device === 'mobile' ? 'is-on' : ''} onClick={() => setDevice('mobile')}>Phone</button>
        </span>
        <span class="spacer" />
        <button type="button" class="icon-btn" title="Reload" onClick={() => setKey((k) => k + 1)}>↻</button>
        <a class="icon-btn" href={url} target="_blank" rel="noopener" title="Open in a new tab"><Icon name="external" /></a>
        <button type="button" class="icon-btn" title="Close preview" onClick={onClose}><Icon name="x" /></button>
      </div>
      <p class={`preview-note ${fresh ? 'is-fresh' : ''}`}>{fresh ? '✓ Updated with your latest change.' : changed ? 'Showing the live page. Your unsaved edits appear here about a minute after you save.' : 'Showing the live page.'}</p>
      <div class={`preview-frame preview-frame--${device}`}>
        <iframe key={key} src={url} title="Live preview" loading="lazy" />
      </div>
    </aside>
  );
}

// ---- collections -----------------------------------------------------------

function useFiles() {
  const [files, setFiles] = useState(null);
  const load = useCallback(() => api.files().then((d) => setFiles(d.files)).catch((e) => toast(e.message, 'err')), []);
  useEffect(load, []);
  return [files, load];
}

const editHref = (path, extra = '') => `#/edit?path=${encodeURIComponent(path)}${extra}`;

/** Reads several content files (for list screens that show titles). */
function useContents(files, parse) {
  const [out, setOut] = useState(null);
  const key = (files ?? []).map((f) => f.sha).join('|');
  useEffect(() => {
    if (!files) return;
    Promise.all(files.map((f) => api.file(f.path).then((x) => ({ path: f.path, sha: f.sha, raw: x.content, ...parse(x.content) })).catch(() => ({ path: f.path, sha: f.sha }))))
      .then(setOut);
  }, [key]);
  return out;
}

/** A content list as a table: search, status tabs, row actions. */
function ContentTable({ title, intro, rows, columns, onNew, newLabel, empty }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const counts = { all: rows?.length ?? 0, published: rows?.filter((r) => !r.draft).length ?? 0, draft: rows?.filter((r) => r.draft).length ?? 0 };
  const shown = (rows ?? []).filter((r) => (tab === 'all' || (tab === 'draft') === !!r.draft) && `${r.title} ${r.url}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <header class="page-head">
        <div><h1>{title} <span class="count">{rows?.length ?? ''}</span></h1><p class="muted">{intro}</p></div>
        <div class="actions"><button class="primary" onClick={onNew}><Icon name="plus" />{newLabel}</button></div>
      </header>
      <div class="tabs">
        {[['all', 'All'], ['published', 'Published'], ['draft', 'Drafts']].map(([id, label]) => <button type="button" class={`tab ${tab === id ? 'is-on' : ''}`} onClick={() => setTab(id)}>{label}<span>{counts[id]}</span></button>)}
      </div>
      <div class="toolbar"><label class="search"><Icon name="search" /><input type="search" placeholder={`Search ${title.toLowerCase()}`} value={q} onInput={(e) => setQ(e.currentTarget.value)} /></label></div>
      {!rows ? <div class="sk sk--table" /> : !shown.length ? (
        <div class="panel"><div class="empty"><span class="empty-icon"><Icon name="pages" size={20} /></span><b>{rows.length ? 'Nothing matches' : empty}</b>{!rows.length && <button class="primary" onClick={onNew}><Icon name="plus" />{newLabel}</button>}</div></div>
      ) : (
        <div class="table-wrap">
          <table class="table table--crm">
            <thead><tr><th>Title</th>{columns.map((c) => <th class={c.num ? 'num' : ''}>{c.label}</th>)}<th class="actions-col" /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr onClick={() => navigate(r.href)}>
                  <td><span class="row-title"><b>{r.title}</b><small>{r.url}</small></span></td>
                  {columns.map((c) => <td class={c.num ? 'num' : ''}>{c.render(r)}</td>)}
                  <td class="actions-col"><Menu items={r.actions} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Pages() {
  const [files, reload] = useFiles();
  const list = files?.filter((f) => /^content\/pages\/[^/]+\.json$/.test(f.path));
  const pages = useContents(list, (c) => JSON.parse(c));
  const create = async () => {
    const title = await askText({ title: 'New page', label: 'Page title', placeholder: 'e.g. Uses', confirm: 'Create page', help: (t) => (t ? `Its address will be /${slugify(t)}/` : 'You can change the address later.') });
    if (!title) return;
    const slug = slugify(title);
    if ((pages ?? []).some((p) => p.slug === slug)) return toast(`A page already uses /${slug}/.`, 'err');
    sessionStorage.setItem('admin.new', JSON.stringify({ data: { title, slug, navLabel: title, order: 10, inNav: true, draft: true, blocks: [{ type: 'banner', heading: title, body: '' }, { type: 'text', heading: null, body: 'Write something here.' }] } }));
    navigate(editHref(`content/pages/${slug}.json`, '&new=1'));
  };
  const duplicate = async (p) => {
    const slug = `${p.slug || 'home'}-copy`;
    const copy = { ...JSON.parse(p.raw), title: `${p.title} (copy)`, slug, draft: true, inNav: false };
    try { await api.save(`content/pages/${slug}.json`, toJSON(copy)); published(null); toast('Copy created as a draft.'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async (p) => {
    if (!(await ask({ title: `Delete “${p.title}”?`, body: 'It disappears from the site after the next deploy. Git history keeps a copy.', confirm: 'Delete page', danger: true }))) return;
    try { await api.remove(p.path, p.sha); published(null); toast('Page deleted.'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const rows = pages && [...pages].sort((x, y) => (x.order ?? 100) - (y.order ?? 100)).map((p) => {
    const url = `/${p.slug ? `${p.slug}/` : ''}`;
    return { ...p, title: p.title ?? p.path, url, href: editHref(p.path), actions: [
      { label: 'Edit', icon: 'pen', onClick: () => navigate(editHref(p.path)) },
      !p.draft && { label: 'View on site', icon: 'external', href: url, external: true },
      { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(p) },
      p.slug !== '' && { label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(p) },
    ] };
  });
  return <ContentTable title="Pages" intro="Each page is a list of blocks. All three themes render the same blocks in their own style." rows={rows} onNew={create} newLabel="New page" empty="No pages yet"
    columns={[
      { label: 'Status', render: (r) => <span class={`pill ${r.draft ? 'pill--warn' : 'pill--ok'}`}>{r.draft ? 'Draft' : 'Published'}</span> },
      { label: 'Menu', render: (r) => (r.inNav === false ? <span class="muted">Hidden</span> : `#${r.order ?? '—'} · ${r.navLabel ?? r.title}`) },
      { label: 'Blocks', num: true, render: (r) => r.blocks?.length ?? 0 },
    ]} />;
}

function Blog({ params = {} }) {
  const [files, reload] = useFiles();
  const list = files?.filter((f) => /^content\/blog\/[^/]+\.md$/.test(f.path));
  const posts = useContents(list, (c) => parseFrontmatter(c).data);
  const create = async () => {
    const title = await askText({ title: 'New post', label: 'Post title', placeholder: 'e.g. How I cut our AWS bill', confirm: 'Start writing', help: (t) => (t ? `Its address will be /blog/${slugify(t)}/` : 'It starts as a draft.') });
    if (!title) return;
    sessionStorage.setItem('admin.new', JSON.stringify({ data: { title, description: '', date: new Date().toISOString().slice(0, 10), tags: [], draft: true }, body: '' }));
    navigate(editHref(`content/blog/${slugify(title)}.md`, '&new=1'));
  };
  const remove = async (p) => {
    if (!(await ask({ title: `Delete “${p.title}”?`, body: 'It disappears from the site after the next deploy. Git history keeps a copy.', confirm: 'Delete post', danger: true }))) return;
    try { await api.remove(p.path, p.sha); published(null); toast('Post deleted.'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  useEffect(() => { if (params.new) { history.replaceState(null, '', '#/blog'); create(); } }, []);
  const rows = posts && [...posts].sort((x, y) => String(y.date ?? '').localeCompare(String(x.date ?? ''))).map((p) => {
    const slug = p.path.split('/').pop().replace('.md', '');
    const url = `/blog/${slug}/`;
    return { ...p, title: p.title ?? slug, url, href: editHref(p.path), actions: [
      { label: 'Edit', icon: 'pen', onClick: () => navigate(editHref(p.path)) },
      !p.draft && { label: 'View on site', icon: 'external', href: url, external: true },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(p) },
    ] };
  });
  return <ContentTable title="Blog" intro="Posts start as drafts. Publish when they're ready." rows={rows} onNew={create} newLabel="New post" empty="No posts yet"
    columns={[
      { label: 'Status', render: (r) => <span class={`pill ${r.draft ? 'pill--warn' : 'pill--ok'}`}>{r.draft ? 'Draft' : 'Published'}</span> },
      { label: 'Date', render: (r) => String(r.date ?? '').slice(0, 10) || '—' },
      { label: 'Tags', render: (r) => (r.tags ?? []).slice(0, 3).map((t) => <span class="tag">{t}</span>) },
    ]} />;
}

/** Chooses the right schema for a content path. */
function editorFor(path) {
  if (/^content\/pages\/.+\.json$/.test(path)) return { kind: 'json', fields: S.pageFields, title: 'Page', back: ['#/pages', 'Pages'], deletable: true, viewUrl: (d) => (d.draft ? null : `/${d.slug ? `${d.slug}/` : ''}`) };
  if (/^content\/blog\/.+\.md$/.test(path)) return { kind: 'md', fields: S.postFields, title: 'Blog post', back: ['#/blog', 'Blog'], deletable: true, viewUrl: (d) => (d.draft ? null : `/blog/${path.split('/').pop().replace('.md', '')}/`) };
  const single = {
    'content/site.json': ['Site settings', S.siteFields],
    'content/shop.json': ['Shop', S.shopFields],
    'content/missions.json': ['Terminal missions', S.missionFields],
    'content/achievements.json': ['Achievements', S.achievementFields],
  }[path];
  if (single) return { kind: 'json', fields: single[1], title: single[0] };
  return null;
}

function Edit({ params }) {
  const path = params.path;
  const ed = editorFor(path);
  const initial = useMemo(() => {
    if (!params.new) return null;
    try { return JSON.parse(sessionStorage.getItem('admin.new')); } catch { return null; }
  }, [path, params.new]);
  if (!ed) return <p class="error">This file can't be edited here.</p>;
  const back = ed.back;
  return (
    <FileEditor key={path} path={path} kind={ed.kind} fields={ed.fields} title={ed.title} bodyLabel={ed.bodyLabel} initial={initial} back={back} viewUrl={ed.viewUrl}
      onSaved={() => { if (params.new) { sessionStorage.removeItem('admin.new'); history.replaceState(null, '', editHref(path, params.course ? `&course=${params.course}` : '')); } }}
      onDeleted={ed.deletable ? () => navigate(back?.[0] ?? '#/dashboard') : null} />
  );
}

// ---- media -----------------------------------------------------------------

function Media() {
  const [all, setAll] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.files().then((d) => setAll(d.files.filter((f) => f.path.startsWith('apps/site/public/uploads/') && !f.path.split('/').pop().startsWith('.')).reverse())).catch((e) => toast(e.message, 'err')), []);
  useEffect(load, []);
  const send = async (list) => {
    if (!list?.length) return;
    setBusy(true);
    let n = 0;
    for (const file of list) { try { await uploadFile(file); n++; } catch (x) { toast(x.message, 'err'); } }
    if (n) toast(`Uploaded ${n} file${n > 1 ? 's' : ''}.`);
    setBusy(false); load();
  };
  const copy = (text, what) => { navigator.clipboard?.writeText(text); toast(`Copied ${what}.`); };
  const del = async (f) => {
    if (!(await ask({ title: `Delete ${f.path.split('/').pop()}?`, body: 'Pages that use it will show a broken image after the next deploy.', confirm: 'Delete file', danger: true }))) return;
    try { await api.remove(f.path, f.sha); published(null); toast('File deleted.'); setOpen(null); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const isImage = (p) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p);
  const shown = (all ?? []).filter((f) => f.path.toLowerCase().includes(q.toLowerCase()));
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); send([...e.dataTransfer.files]); }}>
      <header class="page-head">
        <div><h1>Media library <span class="count">{all?.length ?? ''}</span></h1><p class="muted">Every uploaded image and PDF. You can also add media while editing: the Image button, paste, or drop into the text.</p></div>
        <div class="actions"><label class="button primary"><Icon name="plus" />{busy ? 'Uploading…' : 'Upload'}<input type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => { send([...e.currentTarget.files]); e.currentTarget.value = ''; }} disabled={busy} /></label></div>
      </header>
      <div class="toolbar"><label class="search"><Icon name="search" /><input type="search" placeholder="Search files" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></label><span class="muted">Max 8 MB each · drop files anywhere here</span></div>
      <div class={`dropzone ${over ? 'is-over' : ''}`}>Drop files to upload</div>
      {!all ? <div class="sk sk--table" /> : !shown.length ? (
        <div class="panel"><div class="empty"><span class="empty-icon"><Icon name="image" size={20} /></span><b>{all.length ? 'No file matches' : 'No uploads yet'}</b><small>Upload images for covers, banners and posts.</small></div></div>
      ) : (
        <div class="media">
          {shown.map((f) => {
            const url = publicUrl(f.path);
            return (
              <button type="button" class={`media-item ${open?.path === f.path ? 'is-on' : ''}`} onClick={() => setOpen(f)}>
                {isImage(f.path) ? <img src={url} alt="" loading="lazy" /> : <span class="pdf">{f.path.split('.').pop().toUpperCase()}</span>}
                <small title={f.path}>{f.path.split('/').pop()}</small>
              </button>
            );
          })}
        </div>
      )}
      {open && <MediaDetails file={open} isImage={isImage(open.path)} onClose={() => setOpen(null)} onCopy={copy} onDelete={() => del(open)} />}
    </div>
  );
}

function MediaDetails({ file, isImage, onClose, onCopy, onDelete }) {
  const url = publicUrl(file.path);
  const [dims, setDims] = useState(null);
  const [size, setSize] = useState(null);
  const img = useRef(null);
  // A cached image can finish loading before onLoad is attached, so measure on mount too
  const measure = () => { const i = img.current; if (i?.naturalWidth) setDims(`${i.naturalWidth} × ${i.naturalHeight}`); };
  useEffect(() => {
    setDims(null); setSize(null);
    requestAnimationFrame(measure);
    fetch(url, { method: 'HEAD' }).then((r) => setSize(Number(r.headers.get('content-length')) || null)).catch(() => {});
  }, [file.path]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const kb = size ? (size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`) : '—';
  return (
    <div class="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="drawer" role="dialog" aria-label="File details">
        <header class="drawer-head"><h2>File details</h2><button type="button" class="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button></header>
        <div class="drawer-body">
          <div class="media-preview">{isImage ? <img ref={img} src={url} alt="" onLoad={measure} /> : <span class="pdf">{file.path.split('.').pop().toUpperCase()}</span>}</div>
          <dl class="facts">
            <div><dt>Name</dt><dd>{file.path.split('/').pop()}</dd></div>
            <div><dt>Dimensions</dt><dd>{dims ?? (isImage ? '…' : '—')}</dd></div>
            <div><dt>Size</dt><dd>{kb}</dd></div>
            <div><dt>Address</dt><dd><code>{url}</code></dd></div>
          </dl>
          <div class="actions media-actions">
            <button onClick={() => onCopy(url, 'the address')}><Icon name="copy" />Copy address</button>
            {isImage && <button onClick={() => onCopy(`![](${url})`, 'the Markdown')}><Icon name="copy" />Copy Markdown</button>}
            <a class="button" href={url} target="_blank" rel="noopener"><Icon name="external" />Open</a>
          </div>
        </div>
        <footer class="drawer-foot"><button type="button" class="danger" onClick={onDelete}><Icon name="trash" />Delete file</button><span class="spacer" /><button type="button" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}

// ---- app shell -------------------------------------------------------------

const NAV = [
  ['', [['#/dashboard', 'Dashboard', 'dashboard'], ['#/contacts', 'Contacts', 'contacts'], ['#/history', 'History', 'activity']]],
  ['Profile', [['#/intro', 'Intro', 'user'], ['#/about-me', 'About', 'note'], ['#/experience', 'Experience', 'briefcase'], ['#/education', 'Education', 'book'], ['#/certifications', 'Licenses & certifications', 'trophy'], ['#/projects', 'Projects', 'projects'], ['#/skills', 'Skills', 'check'], ['#/languages', 'Languages', 'globe'], ['#/awards', 'Honors & awards', 'star'], ['#/volunteering', 'Volunteering', 'contacts']]],
  ['Website', [['#/pages', 'Pages', 'pages'], ['#/blog', 'Blog', 'pen'], ['#/media', 'Media library', 'image']]],
  ['Game', [[editHref('content/shop.json'), 'Shop', 'store'], [editHref('content/missions.json'), 'Terminal missions', 'flag'], [editHref('content/achievements.json'), 'Achievements', 'trophy']]],
  ['Settings', [[editHref('content/site.json'), 'Site settings', 'settings']]],
];
const TITLES = { '/history': 'History', '/intro': 'Intro', '/about-me': 'About', '/education': 'Education', '/certifications': 'Licenses & certifications', '/skills': 'Skills', '/languages': 'Languages', '/awards': 'Honors & awards', '/volunteering': 'Volunteering', '/dashboard': 'Dashboard', '/contacts': 'Contacts', '/contact': 'Contact', '/pages': 'Pages', '/projects': 'Projects', '/project': 'Project', '/experience': 'Experience', '/job': 'Role', '/blog': 'Blog', '/courses': 'Courses', '/course': 'Course', '/media': 'Media', '/edit': 'Editor' };

function isOn(current, href) {
  if (current === href) return true;
  if (href.includes('?')) return false;
  const path = current.split('?')[0];
  return path === href || (href === '#/contacts' && path === '#/contact');
}

/** Everything the command palette can jump to: screens, contacts and content files. */
function usePaletteItems(open) {
  const [extra, setExtra] = useState([]);
  useEffect(() => {
    if (!open || extra.length) return;
    Promise.all([api.visitors().catch(() => ({ visitors: [] })), api.files().catch(() => ({ files: [] }))]).then(([v, f]) => {
      const people = v.visitors.map((x) => ({ group: 'Contacts', label: x.name || x.email, hint: x.email, icon: 'user', href: `#/contact?id=${x.id}` }));
      const files = f.files.map((x) => x.path).filter((p) => /^content\/(pages|blog)\//.test(p)).map((p) => ({ group: 'Content', label: p.split('/').pop().replace(/\.(json|md)$/, ''), hint: p.includes('/blog/') ? 'Blog post' : 'Page', icon: p.includes('/blog/') ? 'pen' : 'pages', href: editHref(p) }));
      setExtra([...people, ...files]);
    });
  }, [open]);
  const screens = NAV.flatMap(([group, links]) => links.map(([href, label, icon]) => ({ group: 'Go to', label, icon, href })));
  const actions = [
    { group: 'Create', label: 'New blog post', icon: 'pen', href: '#/blog?new=1' },
    { group: 'Create', label: 'New project', icon: 'projects', href: '#/projects?new=1' },
    { group: 'Create', label: 'Upload media', icon: 'image', href: '#/media' },
  ];
  return [...screens, ...actions, ...extra];
}

function App() {
  const [me, setMe] = useState(undefined);
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const route = useRoute();
  const check = () => api.me().then(setMe).catch(() => setMe(null));
  useEffect(check, []);
  useEffect(() => setMenu(false), [route.path, route.params.path]);
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  const items = usePaletteItems(palette);

  if (me === undefined) return <p class="muted center">Loading…</p>;
  if (me === null) return <><Login onDone={check} /><Toast /></>;

  const current = location.hash || '#/dashboard';
  let page;
  switch (route.path) {
    case '/visitors': case '/contacts': page = <Contacts params={route.params} />; break;
    case '/contact': page = <Contact key={route.params.id} id={route.params.id} />; break;
    case '/pages': page = <Pages />; break;
    case '/blog': page = <Blog params={route.params} />; break;
    case '/projects': case '/experience': case '/education': case '/certifications': case '/skills': case '/languages': case '/awards': case '/volunteering':
      page = <ProfileSection key={route.path} kind={route.path.slice(1)} params={route.params} />; break;
    // old links
    case '/project': page = <ProfileSection key="projects" kind="projects" params={{ edit: route.params.i, new: route.params.new }} />; break;
    case '/job': page = <ProfileSection key="experience" kind="experience" params={{ edit: route.params.i, new: route.params.new }} />; break;
    case '/intro': page = <FileEditor key="intro" path="content/site.json" kind="json" fields={S.introFields} title="Intro" viewUrl={() => '/'} />; break;
    case '/about-me': page = <FileEditor key="about" path="content/profile.json" kind="json" fields={S.aboutFields} title="About" viewUrl={() => '/about/'} />; break;
    case '/edit': page = <Edit params={route.params} />; break;
    case '/media': page = <Media />; break;
    case '/history': page = <HistoryPage />; break;
    default: page = <Dashboard />;
  }
  return (
    <div class={`shell ${menu ? 'menu-open' : ''}`}>
      <aside class="side">
        <a class="brand" href="#/dashboard" onClick={(e) => { e.preventDefault(); navigate('#/dashboard'); }}><Logo size={28} /><span><b>Shivam Sharma</b><small>Portfolio admin</small></span></a>
        <button type="button" class="side-search" onClick={() => setPalette(true)}><Icon name="search" /><span>Search</span><kbd>Ctrl K</kbd></button>
        {NAV.map(([group, links]) => (
          <nav>
            {group && <h3>{group}</h3>}
            {links.map(([href, label, icon]) => (
              <a href={href} class={isOn(current, href) ? 'on' : ''} onClick={(e) => { e.preventDefault(); navigate(href); }}><Icon name={icon} />{label}</a>
            ))}
          </nav>
        ))}
        <div class="side-foot">
          <a class="side-link" href="/" target="_blank" rel="noopener"><Icon name="external" />View site</a>
          <div class="side-user">
            <Avatar name={me.user} size={28} />
            <span><b>{me.user}</b><small>Administrator</small></span>
            <button type="button" class="icon-btn" title="Sign out" onClick={async () => { await api.logout(); setMe(null); }}><Icon name="logout" /></button>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="top">
          <button class="menu-btn icon-btn" onClick={() => setMenu(!menu)} aria-label="Menu"><Icon name="menu" size={18} /></button>
          <nav class="crumbs" aria-label="Breadcrumb"><span>Admin</span><span class="sep">/</span><b>{TITLES[route.path] ?? 'Dashboard'}</b></nav>
          <span class="spacer" />
          <button type="button" class="top-search" onClick={() => setPalette(true)}><Icon name="search" /><span>Search or jump to…</span><kbd>Ctrl K</kbd></button>
          {!me.contentEditing && <span class="pill pill--warn">Content editing is not configured</span>}
          <button type="button" class="icon-btn" title="Keyboard shortcuts (?)" onClick={() => dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}>?</button>
          <DeployBadge />
        </header>
        <main class="content">{page}</main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={items} onPick={(it) => navigate(it.href)} />
      <DialogHost />
      <ShortcutsHelp />
      <PublishTracker />
      <Toast />
    </div>
  );
}

render(<App />, document.getElementById('app'));
