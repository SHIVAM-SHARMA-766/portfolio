// A small schema-driven form engine. Every editor in the admin is a list of
// field definitions (schemas.js) rendered by <Form>.
import { useEffect, useRef, useState } from 'preact/hooks';
import { marked } from 'marked';
import { api, slugify } from './api.js';

// The shell listens for these (toasts, deploy watching) so fields stay standalone.
export const notify = (msg, kind = 'ok') => dispatchEvent(new CustomEvent('admin-toast', { detail: { msg, kind } }));
const markSaved = () => dispatchEvent(new CustomEvent('admin-saved'));
const UPLOADS = 'apps/site/public/uploads/';
export const publicUrl = (repoPath) => repoPath.replace('apps/site/public', '');

/** Uploads a File to the media folder and returns its public URL (/uploads/…). */
export async function uploadFile(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is over 8 MB.`);
  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${UPLOADS}${slugify(file.name.replace(/\.[^.]+$/, '')) || 'file'}-${Date.now().toString(36)}.${ext}`;
  const b64 = await new Promise((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = fail; fr.readAsDataURL(file); });
  await api.upload(path, b64);
  markSaved();
  return publicUrl(path);
}

const update = (obj, key, val) => ({ ...(obj ?? {}), [key]: val });

export function Form({ fields, value, onChange }) {
  return (
    <div class="form">
      {fields.map((f) => (
        <Field key={f.name} field={f} value={value?.[f.name]} onChange={(v) => onChange(update(value, f.name, v))} />
      ))}
    </div>
  );
}

function Label({ field, children, inline }) {
  return (
    <label class={`field ${inline ? 'field--inline' : ''}`}>
      <span class="field-label">{field.label}{field.required && <b class="req"> *</b>}</span>
      {children}
      {field.help && <small class="field-help">{field.help}</small>}
    </label>
  );
}

export function Field({ field, value, onChange }) {
  switch (field.type) {
    case 'string':
      return (
        <Label field={field}>
          <input type="text" value={value ?? ''} pattern={field.pattern} required={field.required} onInput={(e) => onChange(e.currentTarget.value)} />
        </Label>
      );
    case 'image':
    case 'file':
      return <MediaField field={field} value={value} onChange={onChange} />;
    case 'text':
      return (
        <Label field={field}>
          <textarea rows={3} value={value ?? ''} onInput={(e) => onChange(e.currentTarget.value)} />
        </Label>
      );
    case 'markdown':
      return <Label field={field}><MarkdownEditor value={value ?? ''} onChange={onChange} /></Label>;
    case 'number':
      return (
        <Label field={field}>
          <input type="number" value={value ?? ''} onInput={(e) => { const v = e.currentTarget.value; onChange(v === '' ? undefined : Number(v)); }} />
        </Label>
      );
    case 'boolean':
      return (
        <Label field={field} inline>
          <input type="checkbox" class="switch" checked={!!value} onChange={(e) => onChange(e.currentTarget.checked)} />
        </Label>
      );
    case 'select':
      return (
        <Label field={field}>
          <select value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value || undefined)}>
            {!field.options.includes('') && !value && <option value="">—</option>}
            {field.options.map((o) => <option value={o}>{o || '—'}</option>)}
          </select>
        </Label>
      );
    case 'date': {
      const v = value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'string' ? value.slice(0, 10) : '';
      return <Label field={field}><input type="date" value={v} onInput={(e) => onChange(e.currentTarget.value)} /></Label>;
    }
    case 'strings':
      return (
        <Label field={field}>
          <textarea rows={Math.min(8, Math.max(2, (value?.length ?? 0) + 1))} value={(value ?? []).join('\n')}
            onInput={(e) => onChange(e.currentTarget.value.split('\n').map((x) => x.trim()).filter(Boolean))} />
          <small class="field-help">One per line.</small>
        </Label>
      );
    case 'object':
      return (
        <fieldset class="group">
          <legend>{field.label}</legend>
          <Form fields={field.fields} value={value} onChange={onChange} />
        </fieldset>
      );
    case 'list':
      return <ListField field={field} value={value ?? []} onChange={onChange} />;
    case 'blocks':
      return <BlocksField field={field} value={value ?? []} onChange={onChange} />;
    default:
      return null;
  }
}

function move(arr, i, d) {
  const a = [...arr];
  const j = i + d;
  if (j < 0 || j >= a.length) return a;
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

function ItemCard({ title, index, count, onMove, onRemove, children, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div class={`item ${open ? 'is-open' : ''}`}>
      <div class="item-head">
        <button type="button" class="item-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span class="chev">{open ? '▾' : '▸'}</span> {title || <em>Untitled</em>}
        </button>
        <div class="item-tools">
          <button type="button" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" title="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
          <button type="button" title="Remove" class="danger" onClick={() => confirm('Remove this item?') && onRemove()}>✕</button>
        </div>
      </div>
      {open && <div class="item-body">{children}</div>}
    </div>
  );
}

function ListField({ field, value, onChange }) {
  const [added, setAdded] = useState(-1);
  return (
    <fieldset class="group">
      <legend>{field.label} <span class="count">{value.length}</span></legend>
      {value.map((item, i) => (
        <ItemCard key={i} index={i} count={value.length} defaultOpen={i === added}
          title={field.summary ? item?.[field.summary] : `${field.label} ${i + 1}`}
          onMove={(d) => onChange(move(value, i, d))}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}>
          <Form fields={field.fields} value={item} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} />
        </ItemCard>
      ))}
      <button type="button" class="add" onClick={() => { onChange([...value, {}]); setAdded(value.length); }}>+ Add</button>
    </fieldset>
  );
}

function BlocksField({ field, value, onChange }) {
  const [added, setAdded] = useState(-1);
  const add = (type) => { onChange([...value, { type }]); setAdded(value.length); };
  return (
    <fieldset class="group blocks">
      <legend>{field.label} <span class="count">{value.length}</span></legend>
      {value.map((block, i) => {
        const def = field.types[block.type];
        return (
          <ItemCard key={i} index={i} count={value.length} defaultOpen={i === added}
            title={<><span class="badge">{def?.label ?? block.type}</span> {block.heading ?? ''}</>}
            onMove={(d) => onChange(move(value, i, d))}
            onRemove={() => onChange(value.filter((_, j) => j !== i))}>
            {def ? <Form fields={def.fields} value={block} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...v, type: block.type } : x)))} />
              : <p class="muted">Unknown block type "{block.type}".</p>}
          </ItemCard>
        );
      })}
      <div class="add-block">
        <span>Add block:</span>
        {Object.entries(field.types).map(([type, def]) => <button type="button" onClick={() => add(type)}>{def.label.replace(/ \(.*\)/, '')}</button>)}
      </div>
    </fieldset>
  );
}

export function MarkdownEditor({ value, onChange, tall }) {
  const ref = useRef(null);
  const [view, setView] = useState('split');
  const wrap = (before, after = before, placeholder = 'text') => {
    const ta = ref.current;
    const { selectionStart: a, selectionEnd: b } = ta;
    const sel = value.slice(a, b) || placeholder;
    const next = value.slice(0, a) + before + sel + after + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(a + before.length, a + before.length + sel.length); });
  };
  const line = (prefix) => {
    const ta = ref.current;
    const a = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    onChange(value.slice(0, a) + prefix + value.slice(a));
    requestAnimationFrame(() => ta.focus());
  };
  return (
    <div class={`md md--${view} ${tall ? 'md--tall' : ''}`}>
      <div class="md-toolbar">
        <button type="button" onClick={() => wrap('**')} title="Bold"><b>B</b></button>
        <button type="button" onClick={() => wrap('_')} title="Italic"><i>I</i></button>
        <button type="button" onClick={() => line('## ')} title="Heading">H2</button>
        <button type="button" onClick={() => line('- ')} title="List">•</button>
        <button type="button" onClick={() => wrap('[', '](https://)', 'link text')} title="Link">🔗</button>
        <button type="button" onClick={() => wrap('`')} title="Inline code">{'</>'}</button>
        <button type="button" onClick={() => wrap('\n```bash\n', '\n```\n', 'command')} title="Code block">▤</button>
        <button type="button" onClick={() => wrap('\n:::tip\n', '\n:::\n', 'A helpful tip')} title="Callout (learn site)">💡</button>
        <span class="spacer" />
        {['write', 'split', 'preview'].map((v) => <button type="button" class={view === v ? 'on' : ''} onClick={() => setView(v)}>{v}</button>)}
      </div>
      <div class="md-panes">
        {view !== 'preview' && <textarea ref={ref} value={value} onInput={(e) => onChange(e.currentTarget.value)} spellcheck />}
        {view !== 'write' && <div class="md-preview prose" dangerouslySetInnerHTML={{ __html: marked.parse(value || '*Nothing yet.*') }} />}
      </div>
    </div>
  );
}

// ---- images and files ------------------------------------------------------

const isImage = (u) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(u ?? '');

/** Pick an image/file: upload a new one, choose an uploaded one, or type a path/URL. */
function MediaField({ field, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [local, setLocal] = useState(null); // preview of a fresh upload (not deployed yet)
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [value]);
  const accept = field.type === 'file' ? (field.accept ?? 'application/pdf') : 'image/*';
  const upload = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadFile(file);
      if (isImage(file.name)) setLocal({ url, src: URL.createObjectURL(file) });
      onChange(url);
      notify('Uploaded. It goes live with your next save.');
    } catch (x) { notify(x.message, 'err'); }
    setBusy(false);
  };
  const src = local && local.url === value ? local.src : value;
  return (
    <div class="field">
      <span class="field-label">{field.label}</span>
      <div class="mf">
        <div class="mf-thumb">
          {!value ? <span class="muted">{field.type === 'file' ? 'No file' : 'No image'}</span>
            : isImage(value) && !broken ? <img src={src} alt="" onError={() => setBroken(true)} />
            : <span class="mf-name">{isImage(value) ? '🖼️' : '📄'} {value.split('/').pop()}<small>{broken ? 'live after the next deploy' : ''}</small></span>}
        </div>
        <div class="mf-tools">
          <label class={`button ${busy ? 'is-busy' : ''}`}>{busy ? 'Uploading…' : '⬆ Upload'}<input type="file" accept={accept} hidden disabled={busy} onChange={upload} /></label>
          <button type="button" onClick={() => setPicking(true)}>Choose from media</button>
          {value && <button type="button" class="danger" onClick={() => onChange(undefined)}>Remove</button>}
          <input type="text" class="mf-path" placeholder="/uploads/… or https://…" value={value ?? ''} onInput={(e) => onChange(e.currentTarget.value || undefined)} />
        </div>
      </div>
      {field.help && <small class="field-help">{field.help}</small>}
      {picking && <MediaPicker images={field.type !== 'file'} onPick={(u) => { onChange(u); setPicking(false); }} onClose={() => setPicking(false)} />}
    </div>
  );
}

export function MediaPicker({ images, onPick, onClose }) {
  const [files, setFiles] = useState(null);
  useEffect(() => { api.files().then((d) => setFiles(d.files.map((f) => f.path).filter((p) => p.startsWith(UPLOADS) && !p.split('/').pop().startsWith('.')).reverse())).catch((e) => notify(e.message, 'err')); }, []);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const shown = (files ?? []).filter((p) => !images || isImage(p));
  return (
    <div class="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal-box" role="dialog" aria-label="Choose a file">
        <div class="head-row"><h2>Choose from media</h2><button type="button" onClick={onClose}>✕</button></div>
        {!files ? <p class="muted">Loading…</p> : !shown.length ? <p class="muted">Nothing uploaded yet. Use “Upload” instead.</p> : (
          <div class="media">
            {shown.map((p) => (
              <button type="button" class="media-item" onClick={() => onPick(publicUrl(p))}>
                {isImage(p) ? <img src={publicUrl(p)} alt="" loading="lazy" /> : <span class="pdf">{p.split('.').pop().toUpperCase()}</span>}
                <small>{p.split('/').pop()}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
