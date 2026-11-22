import { render } from 'preact';
import { useEffect, useMemo, useState, useCallback } from 'preact/hooks';
import { api, parseFrontmatter, stringifyFrontmatter, toJSON, slugify } from './api.js';
import { Form, MarkdownEditor } from './fields.jsx';
import * as S from './schemas.js';
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
      <form onSubmit={submit} class="card">
        <h1>Admin</h1>
        <label class="field"><span class="field-label">Username</span><input autocomplete="username" value={u} onInput={(e) => setU(e.currentTarget.value)} required autofocus /></label>
        <label class="field"><span class="field-label">Password</span><input type="password" autocomplete="current-password" value={p} onInput={(e) => setP(e.currentTarget.value)} required /></label>
        {err && <p class="error">{err}</p>}
        <button class="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

// ---- dashboard -------------------------------------------------------------

function Dashboard() {
  const [d, setD] = useState(null);
  useEffect(() => {
    let stop = false;
    const load = async () => { try { const x = await api.stats(); if (!stop) setD(x); } catch {} if (!stop) setTimeout(load, 10000); };
    load();
    return () => { stop = true; };
  }, []);
  if (!d) return <p class="muted">Loading…</p>;
  const max = Math.max(1, ...(d.stats.viewsPerDay ?? []).map((x) => x.views));
  const pages = Object.entries(d.livePages ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <h1>Dashboard</h1>
      <div class="tiles">
        <div class="tile tile--live"><span>Online now</span><b>{d.live}</b></div>
        <div class="tile"><span>Signed-up visitors</span><b>{d.stats.users}</b><small>+{d.stats.usersToday} today</small></div>
        <div class="tile"><span>Page views today</span><b>{d.stats.viewsToday}</b></div>
        <div class="tile"><span>Page views, 7 days</span><b>{d.stats.views7d}</b></div>
      </div>
      <div class="cols">
        <section class="card">
          <h2>Where people are right now</h2>
          {pages.length ? <table class="table"><tbody>{pages.map(([p, n]) => <tr><td><code>{p}</code></td><td class="num">{n}</td></tr>)}</tbody></table> : <p class="muted">Nobody online at the moment.</p>}
        </section>
        <section class="card">
          <h2>Views per day</h2>
          <div class="bars">
            {(d.stats.viewsPerDay ?? []).map((x) => (
              <div class="bar" title={`${x.path}: ${x.views}`}><span style={{ height: `${(x.views / max) * 100}%` }} /><small>{x.path.slice(5)}</small></div>
            ))}
          </div>
        </section>
      </div>
      <section class="card">
        <h2>Top pages, 7 days</h2>
        {d.stats.topPages7d?.length ? <table class="table"><tbody>{d.stats.topPages7d.map((x) => <tr><td><code>{x.path}</code></td><td class="num">{x.views}</td></tr>)}</tbody></table> : <p class="muted">No views yet.</p>}
      </section>
    </>
  );
}

// ---- visitors --------------------------------------------------------------

function Visitors() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const load = () => api.visitors().then((d) => setList(d.visitors)).catch((e) => toast(e.message, 'err'));
  useEffect(load, []);
  const shown = useMemo(() => (list ?? []).filter((v) => `${v.name} ${v.email}`.toLowerCase().includes(q.toLowerCase())), [list, q]);
  const del = async (v) => {
    if (!confirm(`Delete ${v.email || v.name} and all their progress?`)) return;
    try { await api.deleteVisitor(v.id); toast('Visitor deleted'); load(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <>
      <div class="head-row">
        <h1>Visitors <span class="count">{list?.length ?? ''}</span></h1>
        <div class="actions">
          <input type="search" placeholder="Search name or email" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          <a class="button" href="/api/admin/visitors.csv">Export CSV</a>
        </div>
      </div>
      <p class="muted">People who signed in to save their progress. Use their email to get in touch.</p>
      {!list ? <p class="muted">Loading…</p> : !shown.length ? <p class="muted">No visitors yet.</p> : (
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Name</th><th>Email</th><th>Signed in with</th><th class="num">XP</th><th class="num">Coins</th><th>Joined</th><th>Last seen</th><th /></tr></thead>
            <tbody>
              {shown.map((v) => (
                <tr>
                  <td class="who">{v.avatar && <img src={v.avatar} alt="" width="24" height="24" />}{v.name || '—'}</td>
                  <td>{v.email ? <a href={`mailto:${v.email}`}>{v.email}</a> : '—'}</td>
                  <td>{(v.providers ?? []).join(', ')}</td>
                  <td class="num">{v.xp}</td>
                  <td class="num">{v.coins}</td>
                  <td>{fmt(v.createdAt)}</td>
                  <td>{fmt(v.lastSeen)}</td>
                  <td><button class="link danger" onClick={() => del(v)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---- file editors ----------------------------------------------------------

/** Loads a content file, edits it with a form, and commits on save. */
function FileEditor({ path, kind, fields, title, initial, bodyLabel, onSaved, onDeleted, back }) {
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
            <li><a href={it.href} onClick={(e) => { e.preventDefault(); navigate(it.href); }}><b>{it.label}</b>{it.sub && <small>{it.sub}</small>}</a></li>
          ))}
          {!items.length && <li class="muted">Nothing here yet.</li>}
        </ul>
      )}
    </>
  );
}

const editHref = (path, extra = '') => `#/edit?path=${encodeURIComponent(path)}${extra}`;

function Pages() {
  const [files] = useFiles();
  const items = files?.filter((p) => /^content\/pages\/[^/]+\.json$/.test(p)).map((p) => {
    const name = p.split('/').pop().replace('.json', '');
    return { label: name === 'index' ? 'Home' : name, sub: p, href: editHref(p) };
  });
  const create = () => {
    const title = prompt('Page title');
    if (!title) return;
    const slug = slugify(title);
    sessionStorage.setItem('admin.new', JSON.stringify({ data: { title, slug, navLabel: title, order: 10, inNav: true, draft: true, blocks: [{ type: 'text', heading: title, body: 'Write something here.' }] } }));
    navigate(editHref(`content/pages/${slug}.json`, '&new=1'));
  };
  return <ListPage title="Pages" intro="Each page is a list of blocks. All three themes render the same blocks in their own style." items={items} onNew={create} newLabel="+ New page" />;
}

function Blog() {
  const [files] = useFiles();
  const items = files?.filter((p) => /^content\/blog\/[^/]+\.md$/.test(p)).map((p) => ({ label: p.split('/').pop().replace('.md', ''), sub: p, href: editHref(p) }));
  const create = () => {
    const title = prompt('Post title');
    if (!title) return;
    sessionStorage.setItem('admin.new', JSON.stringify({ data: { title, description: '', date: new Date().toISOString().slice(0, 10), tags: [], draft: true }, body: 'Start writing…' }));
    navigate(editHref(`content/blog/${slugify(title)}.md`, '&new=1'));
  };
  return <ListPage title="Blog" items={items} onNew={create} newLabel="+ New post" />;
}

function Courses() {
  const [files] = useFiles();
  const items = files?.filter((p) => /^content\/courses\/[^/]+\/course\.json$/.test(p)).map((p) => {
    const slug = p.split('/')[2];
    return { label: slug, sub: 'Details, chapters and lessons', href: `#/course?slug=${slug}` };
  });
  const create = async () => {
    const title = prompt('Course title (e.g. Kubernetes basics)');
    if (!title) return;
    const slug = slugify(title);
    try {
      await api.save(`content/courses/${slug}/course.json`, toJSON({ title, description: '', level: 'Beginner', status: 'draft', order: 10, chapters: [{ slug: 'introduction', title: '1. Introduction' }] }));
      await api.save(`content/courses/${slug}/index.md`, stringifyFrontmatter({ title, description: '', sidebar: { order: 0, label: 'Course overview' } }, `Welcome to ${title}.`));
      savedAt = Date.now();
      toast('Course created as a draft.');
      navigate(`#/course?slug=${slug}`);
    } catch (e) { toast(e.message, 'err'); }
  };
  return <ListPage title="Courses" intro="Courses live on the learn site. A course is hidden until its status is “published”." items={items} onNew={create} newLabel="+ New course" />;
}

function Course({ slug }) {
  const [files, reload] = useFiles();
  const [meta, setMeta] = useState(null);
  useEffect(() => { api.file(`content/courses/${slug}/course.json`).then((f) => setMeta(JSON.parse(f.content))).catch((e) => toast(e.message, 'err')); }, [slug]);
  const lessons = (ch) => (files ?? []).filter((p) => p.startsWith(`content/courses/${slug}/${ch}/`) && /\.mdx?$/.test(p));
  const newLesson = (ch) => {
    const title = prompt('Lesson title');
    if (!title) return;
    const order = lessons(ch).length + 1;
    sessionStorage.setItem('admin.new', JSON.stringify({ data: { title, description: '', sidebar: { order }, difficulty: 'beginner', minutes: 10, draft: true, quiz: [] }, body: 'Write the lesson here.' }));
    navigate(editHref(`content/courses/${slug}/${ch}/${slugify(title)}.md`, `&new=1&course=${slug}`));
  };
  return (
    <>
      <a class="back" href="#/courses" onClick={(e) => { e.preventDefault(); navigate('#/courses'); }}>← Courses</a>
      <div class="head-row"><h1>{meta?.title ?? slug}</h1><span class={`pill ${meta?.status === 'published' ? 'pill--ok' : ''}`}>{meta?.status ?? ''}</span></div>
      <div class="cols">
        <a class="card card--link" href={editHref(`content/courses/${slug}/course.json`, `&course=${slug}`)} onClick={(e) => { e.preventDefault(); navigate(e.currentTarget.getAttribute('href')); }}><b>Course details & chapters</b><small>Title, level, status, chapter list</small></a>
        <a class="card card--link" href={editHref(`content/courses/${slug}/index.md`, `&course=${slug}`)} onClick={(e) => { e.preventDefault(); navigate(e.currentTarget.getAttribute('href')); }}><b>Overview page</b><small>The course's landing page</small></a>
      </div>
      {(meta?.chapters ?? []).map((ch) => (
        <section class="card">
          <div class="head-row"><h2>{ch.title}</h2><button onClick={() => newLesson(ch.slug)}>+ Lesson</button></div>
          <ul class="list list--compact">
            {lessons(ch.slug).map((p) => <li><a href={editHref(p, `&course=${slug}`)} onClick={(e) => { e.preventDefault(); navigate(e.currentTarget.getAttribute('href')); }}>{p.split('/').pop().replace(/\.mdx?$/, '')}</a></li>)}
            {!lessons(ch.slug).length && <li class="muted">No lessons yet.</li>}
          </ul>
        </section>
      ))}
      <p class="muted">Add or rename chapters under “Course details & chapters”. <button class="link" onClick={reload}>Refresh</button></p>
    </>
  );
}

/** Chooses the right schema for a content path. */
function editorFor(path) {
  if (/^content\/pages\/.+\.json$/.test(path)) return { kind: 'json', fields: S.pageFields, title: 'Page', back: ['#/pages', 'Pages'], deletable: true };
  if (/^content\/blog\/.+\.md$/.test(path)) return { kind: 'md', fields: S.postFields, title: 'Blog post', back: ['#/blog', 'Blog'], deletable: true };
  if (/^content\/courses\/[^/]+\/course\.json$/.test(path)) return { kind: 'json', fields: S.courseFields, title: 'Course details' };
  if (/^content\/courses\/[^/]+\/index\.md$/.test(path)) return { kind: 'md', fields: S.overviewFields, title: 'Course overview', bodyLabel: 'Overview' };
  if (/^content\/courses\/[^/]+\/[^/]+\/.+\.mdx?$/.test(path)) return { kind: 'md', fields: S.lessonFields, title: 'Lesson', bodyLabel: 'Lesson', deletable: true };
  const single = {
    'content/profile.json': ['Profile', S.profileFields],
    'content/site.json': ['Site & game settings', S.siteFields],
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
  const back = params.course ? [`#/course?slug=${params.course}`, 'Course'] : ed.back;
  return (
    <FileEditor key={path} path={path} kind={ed.kind} fields={ed.fields} title={ed.title} bodyLabel={ed.bodyLabel} initial={initial} back={back}
      onSaved={() => { if (params.new) { sessionStorage.removeItem('admin.new'); history.replaceState(null, '', editHref(path, params.course ? `&course=${params.course}` : '')); } }}
      onDeleted={ed.deletable ? () => navigate(back?.[0] ?? '#/dashboard') : null} />
  );
}

// ---- media -----------------------------------------------------------------

function Media() {
  const [files, reload] = useFiles();
  const [busy, setBusy] = useState(false);
  const uploads = files?.filter((p) => p.startsWith('apps/site/public/uploads/')) ?? null;
  const upload = async (e) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return toast('Files must be under 8 MB.', 'err');
    const ext = file.name.split('.').pop().toLowerCase();
    const name = `${slugify(file.name.replace(/\.[^.]+$/, ''))}-${Date.now().toString(36)}.${ext}`;
    setBusy(true);
    const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(file); });
    try { await api.upload(`apps/site/public/uploads/${name}`, b64); savedAt = Date.now(); toast('Uploaded. Available after the next deploy.'); reload(); } catch (x) { toast(x.message, 'err'); }
    setBusy(false);
    e.currentTarget.value = '';
  };
  const copy = (p) => { const url = p.replace('apps/site/public', ''); navigator.clipboard?.writeText(`![](${url})`); toast(`Copied ![](${url})`); };
  return (
    <>
      <div class="head-row">
        <h1>Media</h1>
        <label class="button primary">{busy ? 'Uploading…' : '+ Upload image'}<input type="file" accept="image/*,application/pdf" hidden onChange={upload} disabled={busy} /></label>
      </div>
      <p class="muted">Images for pages, posts and lessons. Click one to copy its Markdown.</p>
      {!uploads ? <p class="muted">Loading…</p> : (
        <div class="media">
          {uploads.map((p) => (
            <button class="media-item" onClick={() => copy(p)} title="Copy Markdown">
              {/\.pdf$/.test(p) ? <span class="pdf">PDF</span> : <img src={p.replace('apps/site/public', '')} alt="" loading="lazy" />}
              <small>{p.split('/').pop()}</small>
            </button>
          ))}
          {!uploads.length && <p class="muted">No uploads yet.</p>}
        </div>
      )}
    </>
  );
}

// ---- app shell -------------------------------------------------------------

const NAV = [
  ['Overview', [['#/dashboard', 'Dashboard'], ['#/visitors', 'Visitors']]],
  ['Content', [['#/pages', 'Pages'], ['#/blog', 'Blog'], ['#/courses', 'Courses'], [editHref('content/profile.json'), 'Profile'], ['#/media', 'Media']]],
  ['Game', [[editHref('content/shop.json'), 'Shop'], [editHref('content/missions.json'), 'Terminal missions'], [editHref('content/achievements.json'), 'Achievements']]],
  ['Settings', [[editHref('content/site.json'), 'Site & game']]],
];

function App() {
  const [me, setMe] = useState(undefined);
  const [menu, setMenu] = useState(false);
  const route = useRoute();
  const check = () => api.me().then(setMe).catch(() => setMe(null));
  useEffect(check, []);
  useEffect(() => setMenu(false), [route.path, route.params.path]);

  if (me === undefined) return <p class="muted center">Loading…</p>;
  if (me === null) return <><Login onDone={check} /><Toast /></>;

  const current = location.hash || '#/dashboard';
  let page;
  switch (route.path) {
    case '/visitors': page = <Visitors />; break;
    case '/pages': page = <Pages />; break;
    case '/blog': page = <Blog />; break;
    case '/courses': page = <Courses />; break;
    case '/course': page = <Course slug={route.params.slug} />; break;
    case '/edit': page = <Edit params={route.params} />; break;
    case '/media': page = <Media />; break;
    default: page = <Dashboard />;
  }
  return (
    <div class={`shell ${menu ? 'menu-open' : ''}`}>
      <aside class="side">
        <a class="brand" href="#/dashboard">Portfolio admin</a>
        {NAV.map(([group, links]) => (
          <nav>
            <h3>{group}</h3>
            {links.map(([href, label]) => (
              <a href={href} class={current === href || (!href.includes('?') && current.split('?')[0] === href) ? 'on' : ''}
                onClick={(e) => { e.preventDefault(); navigate(href); }}>{label}</a>
            ))}
          </nav>
        ))}
        <div class="side-foot">
          <a href="/" target="_blank" rel="noopener">View site ↗</a>
          <button class="link" onClick={async () => { await api.logout(); setMe(null); }}>Sign out ({me.user})</button>
        </div>
      </aside>
      <div class="main">
        <header class="top">
          <button class="menu-btn" onClick={() => setMenu(!menu)} aria-label="Menu">☰</button>
          <span class="spacer" />
          {!me.contentEditing && <span class="pill pill--warn">Content editing is not configured on the server</span>}
          <DeployBadge />
        </header>
        <main class="content">{page}</main>
      </div>
      <Toast />
    </div>
  );
}

render(<App />, document.getElementById('app'));
