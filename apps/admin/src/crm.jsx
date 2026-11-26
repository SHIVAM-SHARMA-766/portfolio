// The CRM side of the admin: dashboard, contacts (people who signed in on the
// site) and one contact's page with stage, tags, notes and activity.
import { useEffect, useMemo, useState, useCallback } from 'preact/hooks';
import { api } from './api.js';
import { notify } from './fields.jsx';
import { Icon, Avatar, StagePill, StageSelect, STAGES, stageLabel, ago, date, dateTime, BarChart, Delta, lastDays, ask } from './ui.jsx';

const go = (hash) => (e) => { e?.preventDefault?.(); location.hash = hash; };

// ---- describing what a contact did ---------------------------------------------

const pretty = (s) => s.replace(/[-_]/g, ' ');
export function describe(a) {
  if (a.kind === 'achievement') return { icon: 'trophy', text: <>Unlocked the achievement <b>{pretty(a.id)}</b></> };
  if (a.kind === 'purchase') {
    const [, what] = a.id.split(':');
    return { icon: 'store', text: <>Bought <b>{pretty(what ?? a.id)}</b> for {a.points} coins</> };
  }
  const [kind, ...rest] = a.id.split(':');
  const v = rest.join(':');
  const page = v === 'home' ? 'the home page' : `/${v}/`;
  switch (kind) {
    case 'visit': return { icon: 'eye', text: <>Visited <b>{page}</b></> };
    case 'read': return { icon: 'book', text: <>Read <b>{page}</b> to the end</> };
    case 'project': return { icon: 'projects', text: <>Opened the project <b>{pretty(v)}</b></> };
    case 'exp': return { icon: 'briefcase', text: <>Read about <b>{pretty(v).split(' ').slice(0, 3).join(' ')}</b></> };
    case 'contact': return { icon: 'mail', text: <>Clicked the <b>{pretty(v)}</b> link</> };
    case 'terminal': return { icon: 'activity', text: <>Ran <code>{v}</code> in the terminal</> };
    case 'flag': return { icon: 'flag', text: <>Captured the flag <b>{pretty(v)}</b></> };
    case 'secret': return { icon: 'star', text: <>Found the secret <b>{pretty(v)}</b></> };
    case 'theme': return { icon: 'globe', text: <>Tried the <b>{v}</b> theme</> };
    case 'palette': return { icon: 'globe', text: <>Tried the <b>{pretty(v)}</b> palette</> };
    case 'lesson': return { icon: 'book', text: <>Completed the lesson <b>{pretty(v.split('/').pop())}</b></> };
    case 'quiz': return { icon: 'check', text: <>Passed the quiz in <b>{pretty(v.split('/').pop())}</b></> };
    case 'course': return { icon: 'book', text: <>Finished the course <b>{pretty(v)}</b></> };
    default: return { icon: 'activity', text: <>{a.id}</> };
  }
}
const EMPTY_INSIGHTS = { active7d: 0, activePrev7d: 0, users7d: 0, usersPrev7d: 0, viewsPrev7d: 0, signupsPerDay: [], viewsPerDay30: [], stages: { new: 0, contacted: 0, engaged: 0, opportunity: 0, archived: 0 }, topEvents7d: [] };
const ACTION_NAMES = { visit: 'Page visits', read: 'Pages read', project: 'Projects opened', exp: 'Experience read', contact: 'Contact links', terminal: 'Terminal commands', flag: 'Flags captured', theme: 'Themes tried', palette: 'Palettes tried', lesson: 'Lessons', quiz: 'Quizzes', course: 'Courses', secret: 'Secrets', click: 'Clicks' };

// ---- dashboard ------------------------------------------------------------------

export function Dashboard() {
  const [d, setD] = useState(null);
  const [ins, setIns] = useState(null);
  const [failed, setFailed] = useState(false);
  const [people, setPeople] = useState(null);
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const [s, i] = await Promise.allSettled([api.stats(), api.insights()]);
      if (!stop) {
        if (s.status === 'fulfilled') setD(s.value);
        setIns(i.status === 'fulfilled' ? i.value : (x) => x ?? EMPTY_INSIGHTS);
        setFailed(s.status === 'rejected' || i.status === 'rejected');
      }
      if (!stop) setTimeout(load, 15000);
    };
    load();
    api.visitors().then((x) => setPeople(x.visitors)).catch(() => setPeople([]));
    contentHealth().then(setHealth).catch(() => setHealth('error'));
    return () => { stop = true; };
  }, []);
  if (failed && !d) return <div class="panel"><Empty icon="alert" title="Couldn't load the dashboard" text="The API didn't answer. It may be restarting after a deploy." /><p style="text-align:center"><button onClick={() => location.reload()}>Try again</button></p></div>;
  if (!d || !ins) return <div class="skeleton-page"><div class="sk sk--title" /><div class="kpis">{[1, 2, 3, 4, 5].map(() => <div class="sk sk--card" />)}</div></div>;
  const live = Object.entries(d.livePages ?? {}).sort((a, b) => b[1] - a[1]);
  const totalStage = Object.values(ins.stages).reduce((a, b) => a + b, 0) || 1;
  const recent = (people ?? []).slice(0, 6);
  return (
    <>
      {failed && <div class="banner banner--warn"><Icon name="alert" />Some numbers couldn't be loaded and may be missing. They refresh every 15 seconds.</div>}
      <header class="page-head">
        <div><h1>Dashboard</h1><p class="muted">How the site is doing, who signed in, and what needs attention.</p></div>
        <div class="actions">
          <a class="button" href="#/blog?new=1" onClick={go('#/blog?new=1')}><Icon name="pen" />New post</a>
          <a class="button primary" href="#/projects?new=1" onClick={go('#/projects?new=1')}><Icon name="plus" />New project</a>
        </div>
      </header>
      <div class="kpis">
        <div class="kpi kpi--live"><span class="kpi-label"><i class="pulse" />Online now</span><b>{d.live}</b><small>{live.length ? `on ${live.length} page${live.length > 1 ? 's' : ''}` : 'nobody right now'}</small></div>
        <a class="kpi" href="#/contacts" onClick={go('#/contacts')}><span class="kpi-label">Contacts</span><b>{d.stats.users}</b><small>+{ins.users7d} this week <Delta now={ins.users7d} prev={ins.usersPrev7d} /></small></a>
        <div class="kpi"><span class="kpi-label">Active contacts · 7 days</span><b>{ins.active7d}</b><small>vs {ins.activePrev7d} the week before <Delta now={ins.active7d} prev={ins.activePrev7d} /></small></div>
        <div class="kpi"><span class="kpi-label">Page views · 7 days</span><b>{d.stats.views7d}</b><small>vs {ins.viewsPrev7d} <Delta now={d.stats.views7d} prev={ins.viewsPrev7d} /></small></div>
        <div class="kpi"><span class="kpi-label">Page views today</span><b>{d.stats.viewsToday}</b><small>{d.stats.usersToday} new contact{d.stats.usersToday === 1 ? '' : 's'} today</small></div>
      </div>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>Page views</h2><span class="muted">Last 30 days</span></div><BarChart data={lastDays(ins.viewsPerDay30, 30)} label="views" /></section>
        <section class="panel"><div class="panel-head"><h2>New contacts</h2><span class="muted">Last 30 days</span></div><BarChart data={lastDays(ins.signupsPerDay, 30)} label="sign-ups" /></section>
      </div>
      <div class="grid-3">
        <section class="panel">
          <div class="panel-head"><h2>Pipeline</h2><a href="#/contacts" onClick={go('#/contacts')}>All contacts</a></div>
          <div class="pipeline">
            {STAGES.map((s) => (
              <a class="pipe-row" href={`#/contacts?stage=${s.id}`} onClick={go(`#/contacts?stage=${s.id}`)}>
                <span class="pipe-label"><StagePill stage={s.id} /></span>
                <span class="pipe-bar"><span class={`stage-bg--${s.id}`} style={{ width: `${(ins.stages[s.id] / totalStage) * 100}%` }} /></span>
                <b>{ins.stages[s.id]}</b>
              </a>
            ))}
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Recent contacts</h2><a href="#/contacts" onClick={go('#/contacts')}>View all</a></div>
          {!people ? <p class="muted">Loading…</p> : !recent.length ? <Empty icon="contacts" title="No contacts yet" text="People who sign in on the site appear here." /> : (
            <ul class="mini-list">
              {recent.map((v) => (
                <li><a href={`#/contact?id=${v.id}`} onClick={go(`#/contact?id=${v.id}`)}>
                  <Avatar name={v.name} email={v.email} src={v.avatar} size={30} />
                  <span class="mini-main"><b>{v.name || v.email}</b><small>{v.email}</small></span>
                  <span class="mini-side"><StagePill stage={v.stage ?? 'new'} /><small>{ago(v.createdAt)}</small></span>
                </a></li>
              ))}
            </ul>
          )}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Content health</h2><span class="muted">What to improve next</span></div>
          {!health ? <p class="muted">Checking…</p> : health === 'error' ? <Empty icon="alert" title="Couldn't check content" text="Content editing isn't reachable right now." /> : !health.length ? <Empty icon="check" title="All good" text="Every project has a cover and a story." /> : (
            <ul class="health">{health.map((h) => <li><Icon name="alert" class="warn" /><a href={h.href} onClick={go(h.href)}>{h.text}</a></li>)}</ul>
          )}
        </section>
      </div>
      <div class="grid-3">
        <section class="panel">
          <div class="panel-head"><h2>Where people are now</h2><span class="muted">Live</span></div>
          {live.length ? <table class="table table--plain"><tbody>{live.map(([p, n]) => <tr><td><code>{p}</code></td><td class="num">{n}</td></tr>)}</tbody></table> : <Empty icon="globe" title="Quiet right now" text="Live visitors show up here." />}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Top pages</h2><span class="muted">7 days</span></div>
          {d.stats.topPages7d?.length ? <table class="table table--plain"><tbody>{d.stats.topPages7d.map((x) => <tr><td><code>{x.path}</code></td><td class="num">{x.views}</td></tr>)}</tbody></table> : <Empty icon="eye" title="No views yet" />}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>What people do</h2><span class="muted">Signed-in contacts, 7 days</span></div>
          {ins.topEvents7d?.length ? <table class="table table--plain"><tbody>{ins.topEvents7d.map((x) => <tr><td>{ACTION_NAMES[x.path] ?? x.path}</td><td class="num">{x.views}</td></tr>)}</tbody></table> : <Empty icon="activity" title="No activity yet" />}
        </section>
      </div>
    </>
  );
}

async function contentHealth() {
  const out = [];
  const [profile, files] = await Promise.all([api.file('content/profile.json').then((f) => JSON.parse(f.content)), api.files().then((x) => x.files.map((f) => f.path))]);
  (profile.projects ?? []).forEach((p, i) => {
    if (!p.cover) out.push({ text: `“${p.name}” has no cover image`, href: `#/projects?edit=${i}` });
    if (!p.body) out.push({ text: `“${p.name}” has no full story`, href: `#/projects?edit=${i}` });
  });
  const site = await api.file('content/site.json').then((f) => JSON.parse(f.content)).catch(() => ({}));
  const settings = '#/intro';
  if (!site.resume) out.push({ text: 'No CV uploaded yet', href: settings });
  if (!(site.socials ?? []).some((s) => /linkedin/i.test(s.label))) out.push({ text: 'No LinkedIn link in the socials', href: settings });
  const posts = files.filter((p) => /^content\/blog\/.+\.md$/.test(p)).length;
  if (posts < 3) out.push({ text: `Only ${posts} blog post${posts === 1 ? '' : 's'}: write another`, href: '#/blog?new=1' });
  return out.slice(0, 8);
}

export function Empty({ icon, title, text = '' }) {
  return <div class="empty"><span class="empty-icon"><Icon name={icon} size={20} /></span><b>{title}</b>{text && <small>{text}</small>}</div>;
}

// ---- contacts --------------------------------------------------------------------

const COLUMNS = [
  { key: 'name', label: 'Contact', get: (v) => (v.name || v.email || '').toLowerCase() },
  { key: 'stage', label: 'Stage', get: (v) => STAGES.findIndex((s) => s.id === (v.stage ?? 'new')) },
  { key: 'tags', label: 'Tags', get: (v) => (v.tags ?? []).join(',') },
  { key: 'xp', label: 'XP', get: (v) => v.xp ?? 0, num: true },
  { key: 'lastActive', label: 'Last active', get: (v) => v.lastActive ?? v.lastSeen ?? 0 },
  { key: 'createdAt', label: 'Joined', get: (v) => v.createdAt ?? 0 },
];

function csvOf(rows) {
  const esc = (s) => { const v = String(s ?? ''); const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
  const head = ['name', 'email', 'stage', 'tags', 'signed_in_with', 'xp', 'coins', 'notes', 'joined', 'last_active'];
  const body = rows.map((v) => [v.name, v.email, v.stage ?? 'new', (v.tags ?? []).join(' '), (v.providers ?? []).join(' '), v.xp ?? 0, v.coins ?? 0, v.notes ?? 0, date(v.createdAt), date(v.lastActive ?? v.lastSeen)].map(esc).join(','));
  return [head.join(','), ...body].join('\n');
}

/** @param {{ params?: any }} props */
export function Contacts({ params = {} }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState(params.stage ?? 'all');
  const [starred, setStarred] = useState(false);
  const [sort, setSort] = useState({ key: 'createdAt', dir: -1 });
  const [sel, setSel] = useState(new Set());
  const load = useCallback(() => api.visitors().then((d) => setList(d.visitors)).catch((e) => notify(e.message, 'err')), []);
  useEffect(() => { load(); }, []);
  useEffect(() => { if (params.stage) setStage(params.stage); }, [params.stage]);
  const counts = useMemo(() => Object.fromEntries([['all', (list ?? []).length], ...STAGES.map((s) => [s.id, (list ?? []).filter((v) => (v.stage ?? 'new') === s.id).length])]), [list]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const col = COLUMNS.find((c) => c.key === sort.key);
    return (list ?? [])
      .filter((v) => stage === 'all' || (v.stage ?? 'new') === stage)
      .filter((v) => !starred || v.starred)
      .filter((v) => !s || `${v.name} ${v.email} ${(v.tags ?? []).join(' ')}`.toLowerCase().includes(s))
      .sort((a, b) => { const x = col.get(a), y = col.get(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
  }, [list, q, stage, starred, sort]);
  const patch = async (v, change) => {
    setList((l) => l.map((x) => (x.id === v.id ? { ...x, ...change } : x)));
    try { await api.updateContact(v.id, change); } catch (e) { notify(e.message, 'err'); load(); }
  };
  const bulkStage = async (st) => {
    const ids = [...sel];
    await Promise.all(ids.map((id) => api.updateContact(id, { stage: st }).catch(() => null)));
    notify(`Moved ${ids.length} contact${ids.length > 1 ? 's' : ''} to ${stageLabel(st)}.`);
    setSel(new Set()); load();
  };
  const exportRows = (rows) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csvOf(rows)], { type: 'text/csv' }));
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  const toggleAll = () => setSel(sel.size === shown.length ? new Set() : new Set(shown.map((v) => v.id)));
  const th = (c) => (
    <th class={c.num ? 'num' : ''}><button type="button" class={`th-sort ${sort.key === c.key ? 'is-on' : ''}`} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}>{c.label}{sort.key === c.key && <span>{sort.dir > 0 ? '↑' : '↓'}</span>}</button></th>
  );
  return (
    <>
      <header class="page-head">
        <div><h1>Contacts <span class="count">{list?.length ?? ''}</span></h1><p class="muted">Everyone who signed in on the site. Move them through the pipeline, tag them and keep notes.</p></div>
        <div class="actions"><button onClick={() => exportRows(shown)}><Icon name="download" />Export CSV</button></div>
      </header>
      <div class="tabs">
        {[{ id: 'all', label: 'All' }, ...STAGES].map((s) => (
          <button type="button" class={`tab ${stage === s.id ? 'is-on' : ''}`} onClick={() => { setStage(s.id); setSel(new Set()); }}>{s.label}<span>{counts[s.id] ?? 0}</span></button>
        ))}
      </div>
      <div class="toolbar">
        <label class="search"><Icon name="search" /><input type="search" placeholder="Search name, email or tag" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></label>
        <button type="button" class={`chip ${starred ? 'is-on' : ''}`} onClick={() => setStarred(!starred)}><Icon name="star" fill={starred} />Starred</button>
        <span class="spacer" />
        {sel.size > 0 && (
          <div class="bulk">
            <span>{sel.size} selected</span>
            <select onChange={(e) => { if (e.currentTarget.value) bulkStage(e.currentTarget.value); e.currentTarget.value = ''; }}>
              <option value="">Move to…</option>{STAGES.map((s) => <option value={s.id}>{s.label}</option>)}
            </select>
            <button onClick={() => exportRows(shown.filter((v) => sel.has(v.id)))}><Icon name="download" />Export</button>
          </div>
        )}
      </div>
      {!list ? <div class="sk sk--table" /> : !shown.length ? (
        <div class="panel"><Empty icon="contacts" title={list.length ? 'No contacts match' : 'No contacts yet'} text={list.length ? 'Try another search or stage.' : 'People who sign in with Google or GitHub on the site appear here.'} /></div>
      ) : (
        <div class="table-wrap">
          <table class="table table--crm">
            <thead><tr><th class="cb"><input type="checkbox" checked={sel.size === shown.length} onChange={toggleAll} aria-label="Select all" /></th><th class="star-col" />{COLUMNS.map(th)}<th>Signed in with</th></tr></thead>
            <tbody>
              {shown.map((v) => (
                <tr class={sel.has(v.id) ? 'is-selected' : ''} onClick={() => (location.hash = `#/contact?id=${v.id}`)}>
                  <td class="cb" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(v.id)} onChange={() => { const n = new Set(sel); n.has(v.id) ? n.delete(v.id) : n.add(v.id); setSel(n); }} aria-label={`Select ${v.name || v.email}`} /></td>
                  <td class="star-col" onClick={(e) => { e.stopPropagation(); patch(v, { starred: !v.starred }); }}><button type="button" class={`star ${v.starred ? 'is-on' : ''}`} aria-label={v.starred ? 'Unstar' : 'Star'}><Icon name="star" fill={v.starred} /></button></td>
                  <td><span class="who"><Avatar name={v.name} email={v.email} src={v.avatar} size={30} /><span><b>{v.name || '—'}</b><small>{v.email || 'no email shared'}</small></span></span></td>
                  <td onClick={(e) => e.stopPropagation()}><StageSelect compact value={v.stage ?? 'new'} onChange={(st) => patch(v, { stage: st })} /></td>
                  <td>{(v.tags ?? []).slice(0, 3).map((t) => <span class="tag">{t}</span>)}{(v.tags ?? []).length > 3 && <span class="tag">+{v.tags.length - 3}</span>}</td>
                  <td class="num">{v.xp ?? 0}</td>
                  <td title={dateTime(v.lastActive ?? v.lastSeen)}>{ago(v.lastActive ?? v.lastSeen)}</td>
                  <td title={dateTime(v.createdAt)}>{date(v.createdAt)}</td>
                  <td class="muted">{(v.providers ?? []).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---- one contact --------------------------------------------------------------------

export function Contact({ id }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.contact(id).then((d) => setC(d.contact)).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { setC(null); load(); }, [id]);
  if (err) return <div class="panel"><Empty icon="alert" title="Contact not found" text={err} /><p><a href="#/contacts" onClick={go('#/contacts')}>← Back to contacts</a></p></div>;
  if (!c) return <div class="skeleton-page"><div class="sk sk--title" /><div class="sk sk--table" /></div>;
  const patch = async (change) => {
    setC((x) => ({ ...x, ...change }));
    try { const d = await api.updateContact(c.id, change); setC(d.contact); } catch (e) { notify(e.message, 'err'); load(); }
  };
  const addTag = (e) => {
    e.preventDefault();
    const t = tag.trim().toLowerCase();
    if (!t) return;
    setTag('');
    if (!(c.tags ?? []).includes(t)) patch({ tags: [...(c.tags ?? []), t] });
  };
  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try { await api.addNote(c.id, note); setNote(''); notify('Note added.'); load(); } catch (x) { notify(x.message, 'err'); }
    setBusy(false);
  };
  const delNote = async (n) => {
    if (!(await ask({ title: 'Delete this note?', confirm: 'Delete', danger: true }))) return;
    try { await api.deleteNote(c.id, n.id); load(); } catch (x) { notify(x.message, 'err'); }
  };
  const del = async () => {
    if (!(await ask({ title: `Delete ${c.name || c.email}?`, body: 'Their account, progress, notes and activity are removed for good. This cannot be undone.', confirm: 'Delete contact', danger: true }))) return;
    try { await api.deleteVisitor(c.id); notify('Contact deleted.'); location.hash = '#/contacts'; } catch (x) { notify(x.message, 'err'); }
  };
  const copy = () => { navigator.clipboard?.writeText(c.email); notify('Email copied.'); };
  // activity grouped by day; individual clicks collapse into one line per day
  const groups = [];
  for (const a of c.activity) {
    const day = new Date(a.at * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    let g = groups.at(-1);
    if (!g || g.day !== day) groups.push((g = { day, items: [], clicks: 0 }));
    if (a.kind === 'event' && a.id.startsWith('click:')) g.clicks++;
    else g.items.push(a);
  }
  return (
    <>
      <a class="back" href="#/contacts" onClick={go('#/contacts')}>← Contacts</a>
      <header class="contact-head">
        <Avatar name={c.name} email={c.email} src={c.avatar} size={64} />
        <div class="contact-id">
          <h1>{c.name || c.email || 'Unnamed contact'} <button type="button" class={`star ${c.starred ? 'is-on' : ''}`} onClick={() => patch({ starred: !c.starred })} aria-label={c.starred ? 'Unstar' : 'Star'}><Icon name="star" size={18} fill={c.starred} /></button></h1>
          <p class="muted">{c.email || 'No email shared'} · joined {date(c.createdAt)} · last active {ago(c.lastActive ?? c.lastSeen)}</p>
        </div>
        <div class="actions">
          <StageSelect value={c.stage ?? 'new'} onChange={(st) => patch({ stage: st })} />
          {c.email && <a class="button primary" href={`mailto:${c.email}`}><Icon name="mail" />Email</a>}
          {c.email && <button onClick={copy} title="Copy email"><Icon name="copy" /></button>}
          <button class="danger" onClick={del} title="Delete contact"><Icon name="trash" /></button>
        </div>
      </header>
      <div class="contact-grid">
        <div class="contact-side">
          <section class="panel">
            <div class="panel-head"><h2>Details</h2></div>
            <dl class="facts">
              <div><dt>Stage</dt><dd><StagePill stage={c.stage ?? 'new'} /></dd></div>
              <div><dt>Signed in with</dt><dd>{(c.providers ?? []).join(', ') || '—'}</dd></div>
              <div><dt>XP · coins</dt><dd>{c.xp ?? 0} · {c.coins ?? 0}</dd></div>
              <div><dt>Achievements</dt><dd>{c.achievements}</dd></div>
              <div><dt>Bought</dt><dd>{c.purchases.length ? c.purchases.map((p) => p.split(':')[1] ?? p).join(', ') : '—'}</dd></div>
              <div><dt>Actions on site</dt><dd>{c.events ?? 0}</dd></div>
              <div><dt>Joined</dt><dd>{dateTime(c.createdAt)}</dd></div>
            </dl>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Tags</h2></div>
            <div class="tags-edit">
              {(c.tags ?? []).map((t) => <span class="tag tag--edit">{t}<button type="button" onClick={() => patch({ tags: c.tags.filter((x) => x !== t) })} aria-label={`Remove ${t}`}><Icon name="x" size={12} /></button></span>)}
              <form onSubmit={addTag}><input value={tag} onInput={(e) => setTag(e.currentTarget.value)} placeholder="Add a tag and press Enter" maxLength={32} /></form>
            </div>
            <small class="muted">e.g. recruiter, hiring manager, aws, follow-up</small>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Notes <span class="count">{c.notesList.length}</span></h2></div>
            <form class="note-form" onSubmit={addNote}>
              <textarea rows={3} value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="Write a private note — a call, an email, what they're looking for…" maxLength={4000} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') addNote(e); }} />
              <div class="note-actions"><small class="muted">Ctrl+Enter to save</small><button class="primary" disabled={busy || !note.trim()}>{busy ? 'Saving…' : 'Add note'}</button></div>
            </form>
            <ul class="notes">
              {c.notesList.map((n) => (
                <li><p>{n.body}</p><small class="muted">{dateTime(n.createdAt)} · <button type="button" class="link danger" onClick={() => delNote(n)}>Delete</button></small></li>
              ))}
            </ul>
          </section>
        </div>
        <section class="panel">
          <div class="panel-head"><h2>Activity</h2><span class="muted">What they did on the site</span></div>
          {!groups.length ? <Empty icon="activity" title="No activity yet" text="Pages they visit and things they do show up here." /> : (
            <div class="timeline">
              {groups.map((g) => (
                <div class="tl-day">
                  <p class="tl-date">{g.day}</p>
                  <ul>
                    {g.items.map((a) => { const d = describe(a); return <li><span class={`tl-icon tl-icon--${a.kind}`}><Icon name={d.icon} size={14} /></span><span class="tl-text">{d.text}</span><span class="tl-meta">{a.kind === 'purchase' ? <span class="spent">−{a.points} coins</span> : a.points ? <span class="xp">+{a.points} XP</span> : null}<small>{new Date(a.at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small></span></li>; })}
                    {g.clicks > 0 && <li><span class="tl-icon"><Icon name="activity" size={14} /></span><span class="tl-text">Clicked around <b>{g.clicks}</b> time{g.clicks > 1 ? 's' : ''}</span><span class="tl-meta"><span class="xp">+{g.clicks}</span></span></li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
