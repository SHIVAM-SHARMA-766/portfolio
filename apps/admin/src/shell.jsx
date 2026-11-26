// The admin shell: sign-in, sidebar and top bar, toasts, the publish tracker,
// the command palette, and the router that picks a screen.
import { useEffect, useState } from 'preact/hooks';
import { api } from './api.js';
import * as S from './schemas.js';
import { Dashboard, Contacts, Contact } from './crm.jsx';
import { ProfileSection } from './profile.jsx';
import { HistoryPage } from './history.jsx';
import { Icon, Avatar, CommandPalette, DialogHost, ShortcutsHelp } from './ui.jsx';
import { useRoute, navigate, registerToast, registerPublish, lastSave, editHref, setPreviewSite } from './core.js';
import { FileEditor, Edit } from './editor.jsx';
import { Pages, Blog } from './content.jsx';
import { Media } from './media.jsx';
import { Inbox, useUnread } from './inbox.jsx';
import { Analytics } from './analytics.jsx';

export const Logo = ({ size = 28 }) => (
  <svg class="logo" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="#18181b" />
    <path d="M20.6 10.4c-.9-1.6-2.6-2.4-4.9-2.4-2.9 0-4.8 1.5-4.8 3.6 0 5 10.2 2.5 10.2 7.9 0 2.3-2.1 4-5.2 4-2.6 0-4.5-1-5.5-2.8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" />
    <circle cx="24.6" cy="23.6" r="2.1" fill="#f97316" />
  </svg>
);

function Toast() {
  const [t, setT] = useState(null);
  registerToast(setT);
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
  registerPublish((x) => setW({ ...x, state: 'building' }));
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
      const busy = Date.now() - lastSave() < 10 * 60e3;
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

// ---- app shell -------------------------------------------------------------

/** @type {[string, string[][]][]} */
const NAV = [
  ['', [['#/dashboard', 'Dashboard', 'dashboard'], ['#/inbox', 'Inbox', 'mail'], ['#/analytics', 'Analytics', 'chart'], ['#/contacts', 'Contacts', 'contacts'], ['#/history', 'History', 'activity']]],
  ['Profile', [['#/intro', 'Intro', 'user'], ['#/about-me', 'About', 'note'], ['#/experience', 'Experience', 'briefcase'], ['#/education', 'Education', 'book'], ['#/certifications', 'Licenses & certifications', 'trophy'], ['#/projects', 'Projects', 'projects'], ['#/skills', 'Skills', 'check'], ['#/languages', 'Languages', 'globe'], ['#/awards', 'Honors & awards', 'star'], ['#/volunteering', 'Volunteering', 'contacts']]],
  ['Website', [['#/pages', 'Pages', 'pages'], ['#/blog', 'Blog', 'pen'], ['#/media', 'Media library', 'image']]],
  ['Game', [[editHref('content/shop.json'), 'Shop', 'store'], [editHref('content/missions.json'), 'Terminal missions', 'flag'], [editHref('content/achievements.json'), 'Achievements', 'trophy']]],
  ['Settings', [[editHref('content/site.json'), 'Site settings', 'settings']]],
];
const TITLES = { '/inbox': 'Inbox', '/analytics': 'Analytics', '/history': 'History', '/intro': 'Intro', '/about-me': 'About', '/education': 'Education', '/certifications': 'Licenses & certifications', '/skills': 'Skills', '/languages': 'Languages', '/awards': 'Honors & awards', '/volunteering': 'Volunteering', '/dashboard': 'Dashboard', '/contacts': 'Contacts', '/contact': 'Contact', '/pages': 'Pages', '/projects': 'Projects', '/project': 'Project', '/experience': 'Experience', '/job': 'Role', '/blog': 'Blog', '/courses': 'Courses', '/course': 'Course', '/media': 'Media', '/edit': 'Editor' };

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

export function App() {
  const [me, setMe] = useState(undefined);
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const route = useRoute();
  const check = () => api.me().then((m) => { setPreviewSite(m.previewUrl); setMe(m); try { localStorage.setItem('pf.noTrack', '1'); } catch {} }).catch(() => setMe(null));
  useEffect(() => { check(); }, []);
  useEffect(() => setMenu(false), [route.path, route.params.path]);
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  const items = usePaletteItems(palette);
  const unread = useUnread();

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
    case '/inbox': page = <Inbox />; break;
    case '/analytics': page = <Analytics />; break;
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
              <a href={href} class={isOn(current, href) ? 'on' : ''} onClick={(e) => { e.preventDefault(); navigate(href); }}><Icon name={icon} />{label}{href === '#/inbox' && unread > 0 && <span class="nav-badge" aria-label={`${unread} unread`}>{unread}</span>}</a>
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
