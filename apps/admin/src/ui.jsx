// Shared UI pieces for the admin: icons, avatars, stage pills, small charts,
// relative times and the command palette.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

// ---- icons (24×24 stroke icons, drawn inline so the CSP stays strict) ------

const PATHS = {
  dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  contacts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  pages: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  projects: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  briefcase: 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2',
  pen: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  image: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 21',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  store: 'M3 9l1.5-5h15L21 9M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9M3 9h18M9 21v-6h6v6',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.35-4.35',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M22 6l-10 7L2 6',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  trash: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M3 12h18M3 6h18M3 18h18',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  note: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  arrowUp: 'M7 17 17 7M7 7h10v10',
  arrowDown: 'M17 7 7 17M17 17H7V7',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  check: 'M20 6 9 17l-5-5',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0M12 9v4M12 17h.01',
  sort: 'M8 9l4-4 4 4M16 15l-4 4-4-4',
};

export function Icon({ name, size = 16, class: cls = '', fill = false }) {
  return (
    <svg class={`ic ${cls}`} width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

// ---- people ------------------------------------------------------------------

const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#2563eb'];
export function Avatar({ name, email, src, size = 32 }) {
  const label = (name || email || '?').trim();
  const initials = label.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const color = COLORS[[...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
  const [broken, setBroken] = useState(false);
  return src && !broken
    ? <img class="avatar" src={src} alt="" width={size} height={size} style={{ width: `${size}px`, height: `${size}px` }} onError={() => setBroken(true)} referrerpolicy="no-referrer" />
    : <span class="avatar" style={{ width: `${size}px`, height: `${size}px`, background: color, fontSize: `${Math.round(size * 0.38)}px` }}>{initials}</span>;
}

export const STAGES = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'engaged', label: 'Engaged' },
  { id: 'opportunity', label: 'Opportunity' },
  { id: 'archived', label: 'Archived' },
];
export const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label ?? id;
export const StagePill = ({ stage }) => <span class={`stage stage--${stage}`}>{stageLabel(stage)}</span>;

export function StageSelect({ value, onChange, compact }) {
  return (
    <select class={`stage-select stage--${value} ${compact ? 'is-compact' : ''}`} value={value} onChange={(e) => onChange(e.currentTarget.value)} onClick={(e) => e.stopPropagation()} aria-label="Stage">
      {STAGES.map((s) => <option value={s.id}>{s.label}</option>)}
    </select>
  );
}

// ---- time ----------------------------------------------------------------------

export function ago(unix) {
  if (!unix) return '—';
  const s = Date.now() / 1000 - unix;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const date = (unix) => (unix ? new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (unix) => (unix ? new Date(unix * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

// ---- charts --------------------------------------------------------------------

/** Fills missing days so a chart shows the whole range. */
export function lastDays(points, days) {
  const map = Object.fromEntries((points ?? []).map((p) => [p.path, p.views]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ day: d, value: map[d] ?? 0 });
  }
  return out;
}

export function BarChart({ data, height = 160, label = 'views' }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState(null);
  const h = hover ?? data.length - 1;
  return (
    <div class="chart">
      <div class="chart-head"><b>{data[h]?.value ?? 0}</b> <span class="muted">{label} · {data[h] ? new Date(data[h].day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</span></div>
      <div class="chart-bars" style={{ height: `${height}px` }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <div class={`chart-bar ${i === h ? 'is-on' : ''}`} onMouseEnter={() => setHover(i)} title={`${d.day}: ${d.value}`}>
            <span style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div class="chart-axis"><span>{data[0]?.day.slice(5)}</span><span>{data.at(-1)?.day.slice(5)}</span></div>
    </div>
  );
}

export function Delta({ now, prev }) {
  if (!prev && !now) return <span class="delta">—</span>;
  if (!prev) return <span class="delta delta--up"><Icon name="arrowUp" size={12} />new</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return <span class="delta">0%</span>;
  return <span class={`delta ${pct > 0 ? 'delta--up' : 'delta--down'}`}><Icon name={pct > 0 ? 'arrowUp' : 'arrowDown'} size={12} />{Math.abs(pct)}%</span>;
}

// ---- command palette -------------------------------------------------------------

/** Ctrl/Cmd+K: jump to any screen, contact or content file. */
export function CommandPalette({ open, onClose, items, onPick }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef(null);
  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? items.filter((it) => `${it.label} ${it.hint ?? ''} ${it.group}`.toLowerCase().includes(s)) : items.filter((it) => it.group !== 'Contacts' && it.group !== 'Content');
    return list.slice(0, 40);
  }, [q, items]);
  useEffect(() => setI(0), [q]);
  if (!open) return null;
  const key = (e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(shown.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter' && shown[i]) { onPick(shown[i]); onClose(); }
  };
  let last = '';
  return (
    <div class="modal cmdk" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="cmdk-box" role="dialog" aria-label="Search">
        <div class="cmdk-input"><Icon name="search" size={18} /><input ref={input} value={q} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={key} placeholder="Search screens, contacts, pages, posts…" /><kbd>esc</kbd></div>
        <div class="cmdk-list">
          {!shown.length && <p class="muted cmdk-empty">No results for “{q}”.</p>}
          {shown.map((it, k) => {
            const head = it.group !== last ? (last = it.group) : null;
            return (
              <>
                {head && <p class="cmdk-group">{head}</p>}
                <button type="button" class={`cmdk-item ${k === i ? 'is-on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => { onPick(it); onClose(); }}>
                  {it.icon && <Icon name={it.icon} />}<span>{it.label}</span>{it.hint && <small>{it.hint}</small>}
                </button>
              </>
            );
          })}
        </div>
      </div>
    </div>
  );
}
