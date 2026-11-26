// Editing one content file: the form, the settings panel, publish buttons,
// version history and the live preview.
import { useEffect, useState, useCallback, useMemo } from 'preact/hooks';
import { api, parseFrontmatter, stringifyFrontmatter, toJSON } from './api.js';
import { Form, MarkdownEditor } from './fields.jsx';
import * as S from './schemas.js';
import { HistoryDrawer } from './history.jsx';
import { Icon, Menu, ask } from './ui.jsx';
import { navigate, setDirty, toast, published, editHref } from './core.js';

// ---- file editors ----------------------------------------------------------

/** Loads a content file, edits it with a form, and commits on save. Fields with
 *  `side: '<Group>'` go to the settings panel; a hidden `draft` field becomes the
 *  Save draft / Publish / Update buttons. */
/** @param {{ path: string, kind: string, fields: any[], title: string, initial?: any, bodyLabel?: string, onSaved?: () => void, onDeleted?: (() => void) | null, back?: string[], viewUrl?: (d: any) => string | null }} props */
export function FileEditor({ path, kind, fields, title, initial = null, bodyLabel = undefined, onSaved = undefined, onDeleted = null, back = undefined, viewUrl = undefined }) {
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
  useEffect(() => { load(); }, [path]);
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
    try { await api.remove(path, state.sha); setDirty(false); published(null); toast('Deleted.'); onDeleted?.(); } catch (e) { toast(e.message, 'err'); }
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

export function Edit({ params }) {
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
