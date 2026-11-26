import { render } from 'preact';
import { useEffect, useMemo, useState, useCallback } from 'preact/hooks';
import { api, parseFrontmatter, stringifyFrontmatter, toJSON, slugify } from './api.js';
import { Form, MarkdownEditor, uploadFile, publicUrl } from './fields.jsx';
import * as S from './schemas.js';
import { Dashboard, Contacts, Contact } from './crm.jsx';
import { ProfileSection, SECTIONS } from './profile.jsx';
import { Icon, Avatar, CommandPalette } from './ui.jsx';
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
        if (!confirm('You have unsaved changes. Leave without saving?')) { history.replaceState(null, '', last); return; }
        dirty = false;
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
const navigate = (hash) => {
  if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
  dirty = false;
  location.hash = hash;
};

let toastSet = () => {};
const toast = (msg, kind = 'ok') => toastSet({ msg, kind, id: Date.now() });
let savedAt = 0; // last save, to watch the deploy
addEventListener('admin-toast', (e) => toast(e.detail.msg, e.detail.kind));
addEventListener('admin-saved', () => { savedAt = Date.now(); });

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
  useEffect(() => { if (t) { const h = setTimeout(() => setT(null), 4500); return () => clearTimeout(h); } }, [t]);
  return t ? <div class={`toast toast--${t.kind}`} role="status">{t.msg}</div> : null;
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

/** Loads a content file, edits it with a form, and commits on save. */
function FileEditor({ path, kind, fields, title, initial, bodyLabel, onSaved, onDeleted, back, viewUrl }) {
  const [state, setState] = useState(null); // { data, body, sha }
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const isNew = !!initial;

  useEffect(() => {
    setState(null); setChanged(false); setDirty(false);
    if (initial) { setState({ ...initial, sha: '' }); setChanged(true); setDirty(true); return; }
    api.file(path).then((f) => {
      if (kind === 'md') { const { data, body } = parseFrontmatter(f.content); setState({ data, body, sha: f.sha }); }
      else setState({ data: JSON.parse(f.content), sha: f.sha });
    }).catch((e) => toast(e.message, 'err'));
  }, [path]);

  const edit = (patch) => { setState((s) => ({ ...s, ...patch })); setChanged(true); setDirty(true); };
  useEffect(() => () => setDirty(false), []); // leaving the editor clears the flag

  const save = useCallback(async () => {
    if (!state || busy) return;
    setBusy(true);
    try {
      const content = kind === 'md' ? stringifyFrontmatter(state.data, state.body) : toJSON(state.data);
      const r = await api.save(path, content, state.sha);
      setState((s) => ({ ...s, sha: r.sha }));
      setChanged(false); setDirty(false);
      savedAt = Date.now();
      toast('Saved. The site will update in about a minute.');
      onSaved?.();
    } catch (e) {
      toast(e.message, 'err');
    }
    setBusy(false);
  }, [state, busy, path]);

  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [save]);

  const del = async () => {
    if (!confirm(`Delete ${path}? It disappears from the site after the next deploy.`)) return;
    try { await api.remove(path, state.sha); setDirty(false); savedAt = Date.now(); toast('Deleted.'); onDeleted?.(); } catch (e) { toast(e.message, 'err'); }
  };

  if (!state) return <p class="muted">Loading…</p>;
  return (
    <div class="editor">
      <div class="head-row sticky">
        <div>
          {back && <a class="back" href={back[0]} onClick={(e) => { e.preventDefault(); navigate(back[0]); }}>← {back[1]}</a>}
          <h1>{title}</h1>
          <code class="path">{path}</code>
        </div>
        <div class="actions">
          {!isNew && <View url={viewUrl?.(state.data)} />}
          {onDeleted && !isNew && <button class="danger" onClick={del}>Delete</button>}
          <button class="primary" onClick={save} disabled={busy || !changed}>{busy ? 'Saving…' : changed ? (isNew ? 'Create' : 'Save') : 'Saved'}</button>
        </div>
      </div>
      <Form fields={fields} value={state.data} onChange={(data) => edit({ data })} />
      {kind === 'md' && (
        <div class="field"><span class="field-label">{bodyLabel ?? 'Content'}</span><MarkdownEditor tall value={state.body ?? ''} onChange={(body) => edit({ body })} /></div>
      )}
    </div>
  );
}

// ---- collections -----------------------------------------------------------

function useFiles() {
  const [files, setFiles] = useState(null);
  const load = useCallback(() => api.files().then((d) => setFiles(d.files.map((f) => f.path))).catch((e) => toast(e.message, 'err')), []);
  useEffect(load, []);
  return [files, load];
}

function ListPage({ title, intro, items, onNew, newLabel }) {
  return (
    <>
      <div class="head-row">
        <h1>{title}</h1>
        {onNew && <button class="primary" onClick={onNew}>{newLabel ?? '+ New'}</button>}
      </div>
      {intro && <p class="muted">{intro}</p>}
      {!items ? <p class="muted">Loading…</p> : (
        <ul class="list">
          {items.map((it) => (
            <li class="row"><a href={it.href} onClick={(e) => { e.preventDefault(); navigate(it.href); }}><b>{it.label}</b>{it.sub && <small>{it.sub}</small>}</a>{it.view && <a class="row-view" href={it.view} target="_blank" rel="noopener" title="View on site">↗</a>}</li>
          ))}
          {!items.length && <li class="muted">Nothing here yet.</li>}
        </ul>
      )}
    </>
  );
}

const editHref = (path, extra = '') => `#/edit?path=${encodeURIComponent(path)}${extra}`;

/** Reads several content files (for list screens that show titles). */
function useContents(paths, parse) {
  const [out, setOut] = useState(null);
  const key = (paths ?? []).join('|');
  useEffect(() => {
    if (!paths) return;
    Promise.all(paths.map((p) => api.file(p).then((f) => ({ path: p, ...parse(f.content) })).catch(() => ({ path: p }))))
      .then(setOut);
  }, [key]);
  return out;
}

function Pages() {
  const [files] = useFiles();
  const paths = files?.filter((p) => /^content\/pages\/[^/]+\.json$/.test(p));
  const pages = useContents(paths, (c) => JSON.parse(c));
  const items = pages && [...pages].sort((x, y) => (x.order ?? 100) - (y.order ?? 100)).map((pg) => ({
    label: pg.title ?? pg.path, href: editHref(pg.path),
    sub: <>{`/${pg.slug ? `${pg.slug}/` : ''}`} · {pg.blocks?.length ?? 0} blocks{pg.draft && <span class="pill pill--warn">Draft</span>}{pg.inNav === false && <span class="pill">Not in menu</span>}</>,
    view: pg.draft ? null : `/${pg.slug ? `${pg.slug}/` : ''}`,
  }));
  const create = () => {
    const title = prompt('Page title');
    if (!title) return;
    const slug = slugify(title);
    sessionStorage.setItem('admin.new', JSON.stringify({ data: { title, slug, navLabel: title, order: 10, inNav: true, draft: true, blocks: [{ type: 'banner', heading: title, body: '' }, { type: 'text', heading: title, body: 'Write something here.' }] } }));
    navigate(editHref(`content/pages/${slug}.json`, '&new=1'));
  };
  return <ListPage title="Pages" intro="Each page is a list of blocks. All three themes render the same blocks in their own style. Start inner pages with a Banner." items={items} onNew={create} newLabel="+ New page" />;
}

function Blog({ params = {} }) {
  const [files] = useFiles();
  const paths = files?.filter((p) => /^content\/blog\/[^/]+\.md$/.test(p));
  const posts = useContents(paths, (c) => parseFrontmatter(c).data);
  const items = posts && [...posts].sort((x, y) => String(y.date ?? '').localeCompare(String(x.date ?? ''))).map((p) => {
    const slug = p.path.split('/').pop().replace('.md', '');
    return { label: p.title ?? slug, href: editHref(p.path), sub: <>{String(p.date ?? '').slice(0, 10)} · /blog/{slug}/{p.draft && <span class="pill pill--warn">Draft</span>}</>, view: p.draft ? null : `/blog/${slug}/` };
  });
  const create = () => {
    const title = prompt('Post title');
    if (!title) return;
    sessionStorage.setItem('admin.new', JSON.stringify({ data: { title, description: '', date: new Date().toISOString().slice(0, 10), tags: [], draft: true }, body: 'Start writing…' }));
    navigate(editHref(`content/blog/${slugify(title)}.md`, '&new=1'));
  };
  useEffect(() => { if (params.new) { history.replaceState(null, '', '#/blog'); create(); } }, []);
  return <ListPage title="Blog" intro="Posts start as drafts; switch off “Draft” to publish." items={items} onNew={create} newLabel="+ New post" />;
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
  const load = useCallback(() => api.files().then((d) => setAll(d.files.filter((f) => f.path.startsWith('apps/site/public/uploads/') && !f.path.split('/').pop().startsWith('.')).reverse())).catch((e) => toast(e.message, 'err')), []);
  useEffect(load, []);
  const send = async (list) => {
    if (!list?.length) return;
    setBusy(true);
    let n = 0;
    for (const file of list) { try { await uploadFile(file); n++; } catch (x) { toast(x.message, 'err'); } }
    if (n) toast(`Uploaded ${n} file${n > 1 ? 's' : ''}. Live after the next deploy (about a minute).`);
    setBusy(false); load();
  };
  const copy = (text, what) => { navigator.clipboard?.writeText(text); toast(`Copied ${what}`); };
  const del = async (f) => {
    if (!confirm(`Delete ${f.path.split('/').pop()}? Pages that use it will show a broken image.`)) return;
    try { await api.remove(f.path, f.sha); savedAt = Date.now(); toast('Deleted.'); load(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); send([...e.dataTransfer.files]); }}>
      <div class="head-row">
        <h1>Media <span class="count">{all?.length ?? ''}</span></h1>
        <label class="button primary">{busy ? 'Uploading…' : '+ Upload'}<input type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => { send([...e.currentTarget.files]); e.currentTarget.value = ''; }} disabled={busy} /></label>
      </div>
      <p class="muted">Images and PDFs for pages, projects, posts and lessons (max 8 MB each). Drop files anywhere here. Image fields in the editors can also upload directly.</p>
      <div class={`dropzone ${over ? 'is-over' : ''}`}>Drop files to upload</div>
      {!all ? <p class="muted">Loading…</p> : (
        <div class="media">
          {all.map((f) => {
            const url = publicUrl(f.path);
            const image = /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.path);
            return (
              <div class="media-item">
                <a href={url} target="_blank" rel="noopener">{image ? <img src={url} alt="" loading="lazy" /> : <span class="pdf">{f.path.split('.').pop().toUpperCase()}</span>}</a>
                <small title={f.path}>{f.path.split('/').pop()}</small>
                <div class="media-tools">
                  <button onClick={() => copy(url, 'the path')}>Copy path</button>
                  {image && <button onClick={() => copy(`![](${url})`, 'the Markdown')}>Markdown</button>}
                  <button class="danger" onClick={() => del(f)} title="Delete">✕</button>
                </div>
              </div>
            );
          })}
          {!all.length && <p class="muted">No uploads yet.</p>}
        </div>
      )}
    </div>
  );
}

// ---- app shell -------------------------------------------------------------

const NAV = [
  ['', [['#/dashboard', 'Dashboard', 'dashboard'], ['#/contacts', 'Contacts', 'contacts']]],
  ['Profile', [['#/intro', 'Intro', 'user'], ['#/about-me', 'About', 'note'], ['#/experience', 'Experience', 'briefcase'], ['#/education', 'Education', 'book'], ['#/certifications', 'Licenses & certifications', 'trophy'], ['#/projects', 'Projects', 'projects'], ['#/skills', 'Skills', 'check'], ['#/languages', 'Languages', 'globe'], ['#/awards', 'Honors & awards', 'star'], ['#/volunteering', 'Volunteering', 'contacts']]],
  ['Website', [['#/pages', 'Pages', 'pages'], ['#/blog', 'Blog', 'pen'], ['#/media', 'Media library', 'image']]],
  ['Game', [[editHref('content/shop.json'), 'Shop', 'store'], [editHref('content/missions.json'), 'Terminal missions', 'flag'], [editHref('content/achievements.json'), 'Achievements', 'trophy']]],
  ['Settings', [[editHref('content/site.json'), 'Site settings', 'settings']]],
];
const TITLES = { '/intro': 'Intro', '/about-me': 'About', '/education': 'Education', '/certifications': 'Licenses & certifications', '/skills': 'Skills', '/languages': 'Languages', '/awards': 'Honors & awards', '/volunteering': 'Volunteering', '/dashboard': 'Dashboard', '/contacts': 'Contacts', '/contact': 'Contact', '/pages': 'Pages', '/projects': 'Projects', '/project': 'Project', '/experience': 'Experience', '/job': 'Role', '/blog': 'Blog', '/courses': 'Courses', '/course': 'Course', '/media': 'Media', '/edit': 'Editor' };

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
          <DeployBadge />
        </header>
        <main class="content">{page}</main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={items} onPick={(it) => navigate(it.href)} />
      <Toast />
    </div>
  );
}

render(<App />, document.getElementById('app'));
