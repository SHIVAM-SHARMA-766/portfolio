// LinkedIn-style profile editing: each section (experience, education,
// licenses & certifications, projects, skills, languages, honors & awards,
// volunteering) is a list of cards with + Add and ✏️ Edit; the form opens in a
// side drawer. Everything is saved into content/profile.json.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, toJSON, slugify } from './api.js';
import { Form, notify } from './fields.jsx';
import { Icon, ask } from './ui.jsx';
import * as S from './schemas.js';
import { HistoryDrawer } from './history.jsx';

const PROFILE = 'content/profile.json';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-').map(Number); return m ? `${MONTHS[m - 1]} ${y}` : String(y); };
const range = (a, b, present = 'Present') => (a || b ? `${month(a) || '…'} – ${b ? month(b) : present}` : '');
function duration(a, b) {
  if (!a) return '';
  const [y1, m1] = a.split('-').map(Number);
  const e = b ? b.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  const n = (e[0] - y1) * 12 + (e[1] - (m1 || 1)) + 1;
  if (n <= 0) return '';
  const y = Math.floor(n / 12), m = n % 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ');
}
const join = (...xs) => xs.filter(Boolean).join(' · ');

// What each section looks like, how a card reads, and how a new item starts
export const SECTIONS = {
  experience: {
    title: 'Experience', icon: 'briefcase', fields: () => S.jobFields, add: 'Add position',
    intro: 'Your roles. Each company gets a page, and each client or engagement inside it gets its own page too.',
    blank: () => ({ engagements: [], positions: [], skills: [] }),
    card: (x) => ({ title: x.role, sub: join(x.company, x.employmentType), meta: join(range(x.start, x.end), duration(x.start, x.end)), extra: join(x.location, x.locationType), chips: x.skills, note: x.positions?.length > 1 ? `${x.positions.length} positions · ${(x.engagements ?? []).length} clients` : (x.engagements ?? []).length ? `${x.engagements.length} clients / engagements` : '' }),
    url: (x) => (x.company ? `/experience/${x.slug || slugify(x.company)}/` : null),
    logo: (x) => x.logo, initials: (x) => x.company,
  },
  education: {
    title: 'Education', icon: 'book', fields: () => S.educationFields, add: 'Add education',
    intro: 'Schools and degrees. Certifications have their own section.',
    blank: () => ({ skills: [] }),
    card: (x) => ({ title: x.school, sub: join([x.degree, x.field].filter(Boolean).join(', ')), meta: join(range(x.start, x.end, ''), x.grade && `Grade: ${x.grade}`), chips: x.skills }),
    logo: (x) => x.logo, initials: (x) => x.school,
  },
  certifications: {
    title: 'Licenses & certifications', icon: 'trophy', fields: () => S.certificationFields, add: 'Add certification',
    intro: 'Certifications you hold, are working towards, or plan to take.',
    blank: () => ({ status: 'earned', skills: [] }),
    card: (x) => ({ title: x.name, sub: x.issuer, meta: join(x.issued && `Issued ${month(x.issued)}`, x.expires ? `Expires ${month(x.expires)}` : x.issued && 'No expiration date', x.credentialId && `ID ${x.credentialId}`), badge: { earned: '', 'in-progress': 'In progress', planned: 'Planned' }[x.status ?? 'earned'], chips: x.skills }),
    initials: (x) => x.issuer || x.name,
  },
  projects: {
    title: 'Projects', icon: 'projects', fields: () => S.projectFields, add: 'Add project',
    intro: 'Each project gets its own page with a banner, an “At a glance” box, the full story and optional extra pages. The order here is the order on the site.',
    blank: () => ({ tags: [], links: [], highlights: [], associatedWith: 'Personal project' }),
    card: (x) => ({ title: x.name, sub: x.associatedWith, meta: join(range(x.start, x.end) || x.year, x.role), chips: (x.tags ?? []).slice(0, 6), flags: [x.featured && ['ok', 'Featured'], !x.cover && ['', 'No cover'], !x.body && ['', 'No full story']].filter(Boolean) }),
    url: (x) => (x.slug ? `/projects/${x.slug}/` : null),
    logo: (x) => x.cover, initials: (x) => x.name, wide: true,
    prepare: (x) => ({ ...x, slug: x.slug || slugify(x.name ?? '') }),
  },
  skills: {
    title: 'Skills', icon: 'check', fields: () => S.skillGroupFields, add: 'Add skill group',
    intro: 'Grouped skills, shown in the toolbox on the About page. Suggestions come from your experience and projects.',
    blank: () => ({ items: [] }), card: (x) => ({ title: x.group, sub: `${(x.items ?? []).length} skills`, chips: x.items }),
    noLogo: true,
  },
  languages: {
    title: 'Languages', icon: 'globe', fields: () => S.languageFields, add: 'Add language',
    intro: 'Languages you speak and how well.', blank: () => ({}), card: (x) => ({ title: x.name, sub: x.proficiency && `${x.proficiency} proficiency` }), noLogo: true,
  },
  awards: {
    title: 'Honors & awards', icon: 'star', fields: () => S.awardFields, add: 'Add award',
    intro: 'Recognition, prizes, scholarships, hackathons.', blank: () => ({}), card: (x) => ({ title: x.title, sub: x.issuer, meta: month(x.date) }), noLogo: true,
  },
  volunteering: {
    title: 'Volunteering', icon: 'contacts', fields: () => S.volunteeringFields, add: 'Add volunteering',
    intro: 'Communities and causes you give time to.', blank: () => ({}), card: (x) => ({ title: x.role, sub: x.organization, meta: join(range(x.start, x.end), x.cause) }), noLogo: true,
  },
};

function useProfile() {
  const [p, setP] = useState(null);
  const load = useCallback(() => api.file(PROFILE).then((f) => { const data = JSON.parse(f.content); S.fillPool(data); setP({ data, sha: f.sha }); }).catch((e) => notify(e.message, 'err')), []);
  useEffect(() => { load(); }, []);
  const save = async (data, message) => {
    const r = await api.save(PROFILE, toJSON(data), p.sha, message);
    dispatchEvent(new CustomEvent('admin-saved'));
    S.fillPool(data);
    setP({ data, sha: r.sha });
  };
  return [p, save];
}

function Logo({ src, name }) {
  const [broken, setBroken] = useState(false);
  const letters = (name ?? '?').split(/[\s—–-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  return src && !broken ? <img class="pf-logo" src={src} alt="" onError={() => setBroken(true)} /> : <span class="pf-logo pf-logo--text">{letters}</span>;
}

/** @param {{ kind: string, params?: any }} props */
export function ProfileSection({ kind, params = {} }) {
  const sec = SECTIONS[kind];
  const coll = kind;
  const [p, save] = useProfile();
  const [editing, setEditing] = useState(null); // { index, item } — index -1 for a new item
  const [history, setHistory] = useState(false);
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const items = p?.data[coll] ?? null;

  // deep links: ?new=1 opens an empty form, ?edit=3 opens item 3
  useEffect(() => {
    if (!items) return;
    if (params.new) setEditing({ index: -1, item: sec.blank() });
    else if (params.edit != null && items[Number(params.edit)]) setEditing({ index: Number(params.edit), item: structuredClone(items[Number(params.edit)]) });
  }, [!!items, params.new, params.edit]);

  const close = () => { setEditing(null); if (params.new || params.edit != null) window.history.replaceState(null, '', `#/${kind}`); };
  const reorder = async (from, to) => {
    if (from === to) return;
    const a = [...items]; const [x] = a.splice(from, 1); a.splice(to, 0, x);
    try { await save({ ...p.data, [coll]: a }, `Reorder ${sec.title.toLowerCase()} (admin)`); notify('Order saved.'); } catch (e) { notify(e.message, 'err'); }
  };
  const move = async (i, d) => {
    const a = [...items]; const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    try { await save({ ...p.data, [coll]: a }, `Reorder ${sec.title.toLowerCase()} (admin)`); notify('Order saved.'); } catch (e) { notify(e.message, 'err'); }
  };
  const commit = async (item) => {
    const it = sec.prepare ? sec.prepare(item) : item;
    if (kind === 'projects' && items.some((x, i) => x.slug === it.slug && i !== editing.index)) throw new Error(`Another project already uses the URL slug “${it.slug}”.`);
    const list = [...items];
    if (editing.index < 0) list.push(it); else list[editing.index] = it;
    await save({ ...p.data, [coll]: list }, `${editing.index < 0 ? 'Add' : 'Update'} ${sec.title.toLowerCase()}: ${sec.card(it).title ?? ''} (admin)`);
    close();
  };
  const remove = async () => {
    const label = sec.card(editing.item).title;
    if (!(await ask({ title: `Delete “${label}”?`, body: 'It disappears from the site after the next deploy.', confirm: 'Delete', danger: true }))) return;
    const before = p.data;
    await save({ ...p.data, [coll]: items.filter((_, i) => i !== editing.index) }, `Delete from ${sec.title.toLowerCase()}: ${label} (admin)`);
    close();
    // Undo puts the old list back (one more commit)
    dispatchEvent(new CustomEvent('admin-toast', { detail: { msg: `Deleted “${label}”.`, kind: 'ok', action: { label: 'Undo', run: () => save(before, `Restore ${label} (admin)`).then(() => notify('Restored.')).catch((e) => notify(e.message, 'err')) } } }));
  };

  return (
    <>
      <header class="page-head">
        <div><h1>{sec.title} <span class="count">{items?.length ?? ''}</span></h1><p class="muted">{sec.intro}</p></div>
        <div class="actions">
          <button onClick={() => setHistory(true)} title="Version history of the profile"><Icon name="activity" />History</button>
          <button class="primary" onClick={() => setEditing({ index: -1, item: sec.blank() })} disabled={!items}><Icon name="plus" />{sec.add}</button>
        </div>
      </header>
      {!items ? <div class="sk sk--table" /> : !items.length ? (
        <div class="panel pf-empty">
          <span class="empty-icon"><Icon name={sec.icon} size={20} /></span>
          <b>Nothing in {sec.title.toLowerCase()} yet</b>
          <small class="muted">Sections without entries are hidden on the site.</small>
          <button class="primary" onClick={() => setEditing({ index: -1, item: sec.blank() })}><Icon name="plus" />{sec.add}</button>
        </div>
      ) : (
        <div class="panel pf-list">
          {items.map((x, i) => {
            const c = sec.card(x);
            const url = sec.url?.(x);
            return (
              <div class={`pf-item ${dragFrom === i ? 'is-dragging' : ''} ${dragFrom !== null && dragOver === i && dragFrom !== i ? 'is-over' : ''}`}
                onDragOver={(e) => { if (dragFrom === null) return; e.preventDefault(); setDragOver(i); }}
                onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) reorder(dragFrom, i); setDragFrom(null); setDragOver(null); }}>
                {items.length > 1 && <span class="drag-handle" title="Drag to reorder" aria-hidden="true" draggable
                  onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); const row = e.currentTarget.closest('.pf-item'); if (row) e.dataTransfer.setDragImage(row, 24, 24); }}
                  onDragEnd={() => { setDragFrom(null); setDragOver(null); }}>⋮⋮</span>}
                {!sec.noLogo && <span class={sec.wide ? 'pf-media' : ''}><Logo src={sec.logo?.(x)} name={sec.initials?.(x) ?? c.title} /></span>}
                <button type="button" class="pf-main" onClick={() => setEditing({ index: i, item: structuredClone(x) })}>
                  <b>{c.title || <em>Untitled</em>}{c.badge && <span class="pill pill--warn">{c.badge}</span>}{(c.flags ?? []).map(([k, t]) => <span class={`pill ${k ? `pill--${k}` : ''}`}>{t}</span>)}</b>
                  {c.sub && <span>{c.sub}</span>}
                  {c.meta && <small>{c.meta}</small>}
                  {c.extra && <small>{c.extra}</small>}
                  {c.note && <small>{c.note}</small>}
                  {c.chips?.length > 0 && <span class="pf-chips">{c.chips.slice(0, 8).map((t) => <span class="tag">{t}</span>)}{c.chips.length > 8 && <span class="tag">+{c.chips.length - 8}</span>}</span>}
                </button>
                <div class="pf-tools">
                  {url && <a class="icon-btn" href={url} target="_blank" rel="noopener" title="View on site"><Icon name="external" /></a>}
                  <button type="button" class="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" class="icon-btn" title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button type="button" class="icon-btn" title="Edit" onClick={() => setEditing({ index: i, item: structuredClone(x) })}><Icon name="pen" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {history && <HistoryDrawer path={PROFILE} title="Profile (experience, education, projects…)" onClose={() => setHistory(false)} onRestored={() => location.reload()} />}
      {editing && <Drawer key={editing.index} title={`${editing.index < 0 ? sec.add : `Edit ${sec.title.toLowerCase().replace(/s$/, '')}`}`} wide={kind === 'projects' || kind === 'experience'}
        item={editing.item} fields={sec.fields()} onSave={commit} onDelete={editing.index < 0 ? null : remove} onClose={close} />}
    </>
  );
}

/** A side panel with the form, Save / Cancel / Delete, and a guard for unsaved changes. */
function Drawer({ title, item, fields, onSave, onDelete, onClose, wide }) {
  const [value, setValue] = useState(item);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const close = async () => { if (!changed || (await ask({ title: 'Discard your changes?', body: 'What you typed in this form will be lost.', confirm: 'Discard', danger: true }))) onClose(); };
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try { await onSave(value); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') close(); if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); submit(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });
  return (
    <div class="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form class={`drawer ${wide ? 'drawer--wide' : ''}`} role="none" aria-modal="true" aria-label={title} onSubmit={submit}>
        <header class="drawer-head"><h2>{title}</h2><button type="button" class="icon-btn" onClick={close} aria-label="Close"><Icon name="x" size={18} /></button></header>
        <div class="drawer-body"><Form fields={fields} value={value} onChange={(v) => { setValue(v); setChanged(true); }} /></div>
        <footer class="drawer-foot">
          {onDelete && <button type="button" class="danger" onClick={() => onDelete().catch((x) => setErr(x.message))}><Icon name="trash" />Delete</button>}
          <span class="spacer" />
          {err && <span class="error">{err}</span>}
          <button type="button" onClick={close}>Cancel</button>
          <button class="primary" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save'}</button>
        </footer>
      </form>
    </div>
  );
}
