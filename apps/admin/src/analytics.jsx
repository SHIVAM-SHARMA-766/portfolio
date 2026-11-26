// Analytics: the site's own cookie-free statistics. Where visitors come from,
// what they read, and what they do (CV downloads, emails, outbound links).
import { useEffect, useState } from 'preact/hooks';
import { api } from './api.js';
import { Icon, BarChart, Delta } from './ui.jsx';
import { Empty } from './crm.jsx';

/** @type {[number, string][]} */
const RANGES = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']];
const EVENT_NAMES = { cv: 'CV downloads', email: 'Email link clicks', 'copy-email': 'Email address copied', contact: 'Contact form sent', outbound: 'Outbound links', theme: 'Theme switches' };
const pct = (x) => `${Math.round(x * 100)}%`;

/** A ranked list with a proportional bar behind each row. */
/** @param {{ rows: any[], empty: string, keyLabel?: (k: string, r?: any) => any, cols?: string[], extra?: ((r: any) => any) | null }} props */
function Ranked({ rows, empty, keyLabel = (k) => k, cols = ['Visits'], extra = null }) {
  if (!rows?.length) return <p class="muted rank-empty">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.n));
  return (
    <table class="table table--plain rank">
      <thead><tr><th>&nbsp;</th>{cols.map((c) => <th class="num">{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr>
            <td><span class="rank-bar" style={{ width: `${(r.n / max) * 100}%` }} /><span class="rank-key">{keyLabel(r.key, r)}</span></td>
            <td class="num">{r.n}</td>
            {extra && <td class="num">{extra(r)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Analytics() {
  const [days, setDays] = useState(() => { try { return Number(localStorage.getItem('admin.analytics.days')) || 30; } catch { return 30; } });
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stop = false;
    setD(null); setErr('');
    try { localStorage.setItem('admin.analytics.days', String(days)); } catch {}
    const load = () => api.analytics(days).then((x) => { if (!stop) setD(x); }).catch((e) => !stop && setErr(e.message));
    load();
    const t = setInterval(load, 60000);
    return () => { stop = true; clearInterval(t); };
  }, [days]);

  const t = d?.totals, p = d?.prev;
  const perVisit = (x) => (x?.visitors ? (x.views / x.visitors).toFixed(1) : '0');
  const events = d?.events ?? [];
  const byKind = events.reduce((m, e) => ({ ...m, [e.key]: (m[e.key] ?? 0) + e.n }), {});
  const outbound = events.filter((e) => e.key === 'outbound').map((e) => ({ key: e.label, n: e.n }));
  const prevLabel = days === 1 ? 'yesterday' : `the ${days} days before`;
  return (
    <>
      <header class="page-head">
        <div><h1>Analytics</h1><p class="muted">Counted by the site itself: no cookies, no IP addresses, nothing shared. Your own visits are not counted on this browser.</p></div>
        <div class="actions"><span class="seg">{RANGES.map(([n, l]) => <button type="button" class={days === n ? 'is-on' : ''} onClick={() => setDays(n)}>{l}</button>)}</span></div>
      </header>
      {err ? <div class="panel"><Empty icon="alert" title="Couldn't load analytics" text={err} /></div> : !d ? (
        <div class="skeleton-page"><div class="kpis">{[1, 2, 3, 4, 5].map(() => <div class="sk sk--card" />)}</div><div class="sk sk--table" /></div>
      ) : (
        <>
          <div class="kpis">
            <div class="kpi kpi--live"><span class="kpi-label"><i class="pulse" />Online now</span><b>{d.live ?? 0}</b><small>live connections</small></div>
            <div class="kpi" title="Counted once per person per day"><span class="kpi-label">Visitors</span><b>{t.visitors}</b><small>vs {p.visitors} {prevLabel} <Delta now={t.visitors} prev={p.visitors} /></small></div>
            <div class="kpi"><span class="kpi-label">Page views</span><b>{t.views}</b><small>vs {p.views} <Delta now={t.views} prev={p.views} /></small></div>
            <div class="kpi"><span class="kpi-label">Pages per visit</span><b>{perVisit(t)}</b><small>vs {perVisit(p)}</small></div>
            <div class="kpi" title="Visits that saw only one page"><span class="kpi-label">Bounce rate</span><b>{pct(t.bounce)}</b><small>vs {pct(p.bounce)}</small></div>
          </div>
          {days > 1 && (
            <div class="grid-2">
              <section class="panel"><div class="panel-head"><h2>Visitors</h2><span class="muted">per day</span></div><BarChart data={d.series.map((x) => ({ day: x.day, value: x.visitors }))} label="visitors" /></section>
              <section class="panel"><div class="panel-head"><h2>Page views</h2><span class="muted">per day</span></div><BarChart data={d.series.map((x) => ({ day: x.day, value: x.views }))} label="views" /></section>
            </div>
          )}
          <section class="panel">
            <div class="panel-head"><h2>Goals</h2><span class="muted">What visitors did</span></div>
            <div class="goals">
              {['contact', 'cv', 'email', 'copy-email', 'outbound'].map((k) => (
                <div class="goal"><b>{byKind[k] ?? 0}</b><span>{EVENT_NAMES[k]}</span></div>
              ))}
              <div class="goal"><b>{t.visitors ? pct(((byKind.contact ?? 0) + (byKind.cv ?? 0) + (byKind.email ?? 0) + (byKind['copy-email'] ?? 0)) / t.visitors) : '0%'}</b><span>Got in touch or took the CV, per visitor</span></div>
            </div>
          </section>
          <div class="grid-2">
            <section class="panel"><div class="panel-head"><h2>Top pages</h2></div><Ranked rows={d.pages} empty="No page views yet." cols={['Views', 'Visitors']} extra={(r) => r.v} keyLabel={(k) => <a href={k} target="_blank" rel="noopener"><code>{k}</code></a>} /></section>
            <section class="panel"><div class="panel-head"><h2>Sources</h2><span class="muted">Where visits started</span></div><Ranked rows={d.sources} empty="No visits yet." keyLabel={(k) => k || 'Direct / unknown'} /></section>
          </div>
          <div class="grid-3">
            <section class="panel"><div class="panel-head"><h2>Landing pages</h2></div><Ranked rows={d.entries} empty="No visits yet." keyLabel={(k) => <code>{k}</code>} /></section>
            <section class="panel"><div class="panel-head"><h2>Outbound links</h2></div><Ranked rows={outbound} empty="No outbound clicks yet." cols={['Clicks']} keyLabel={(k) => <span class="rank-url">{k}</span>} /></section>
            <section class="panel"><div class="panel-head"><h2>Campaigns</h2><span class="muted">utm_campaign</span></div><Ranked rows={d.campaigns} empty="Add ?utm_source=linkedin&utm_campaign=… to links you share to see them here." /></section>
          </div>
          <div class="grid-2">
            <section class="panel"><div class="panel-head"><h2>Devices</h2></div><Ranked rows={d.devices} empty="No visits yet." keyLabel={(k) => k[0].toUpperCase() + k.slice(1)} /></section>
            <section class="panel"><div class="panel-head"><h2>Themes</h2><span class="muted">Page views per theme</span></div><Ranked rows={d.themes} empty="No views yet." cols={['Views']} keyLabel={(k) => k[0].toUpperCase() + k.slice(1)} /></section>
          </div>
          <p class="muted small-print"><Icon name="check" size={12} /> Visitors are told apart for one day by a code that changes daily, so a person returning tomorrow counts again. Kept for 400 days.</p>
        </>
      )}
    </>
  );
}
