// A small schema-driven form engine. Every editor in the admin is a list of
// field definitions (schemas.js) rendered by <Form>.
import { useEffect, useRef, useState } from 'preact/hooks';
import { marked } from 'marked';
import { api, slugify } from './api.js';
import { ask, Icon } from './ui.jsx';

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
      {fields.filter((f) => !f.hidden).map((f) => (
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
          <input type="text" value={value ?? ''} pattern={field.pattern} required={field.required} placeholder={field.placeholder} list={field.suggest ? `dl-${field.name}` : undefined} onInput={(e) => onChange(e.currentTarget.value)} />
          {field.suggest && <datalist id={`dl-${field.name}`}>{(typeof field.suggest === 'function' ? field.suggest() : field.suggest).map((o) => <option value={o} />)}</datalist>}
        </Label>
      );
    case 'section':
      return <div class="form-section"><h3>{field.label}</h3>{field.help && <p class="muted">{field.help}</p>}</div>;
    case 'month':
      return <MonthField field={field} value={value} onChange={onChange} />;
    case 'tags':
      return <TagsField field={field} value={value ?? []} onChange={onChange} />;
    case 'url':
      return (
        <Label field={field}>
          <input type="url" inputMode="url" placeholder="https://…" value={value ?? ''} onInput={(e) => onChange(e.currentTarget.value || undefined)} />
        </Label>
      );
    case 'image':
    case 'file':
      return <MediaField field={field} value={value} onChange={onChange} />;
    case 'text':
      return (
        <Label field={field}>
          <textarea rows={field.rows ?? 3} value={value ?? ''} placeholder={field.placeholder} onInput={(e) => onChange(e.currentTarget.value)} />
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
            {field.options.map((o) => <option value={o}>{field.labels?.[o] ?? (o || '—')}</option>)}
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

/** Drag to reorder: grab the ⋮⋮ handle, drop on another item. Events from a
 *  nested list are handled there and don't reach the outer one. */
function useReorder(value, onChange) {
  const [from, setFrom] = useState(null);
  const [over, setOver] = useState(null);
  return (i) => ({
    dragging: from === i,
    over: from !== null && over === i && from !== i,
    target: {
      onDragOver: (e) => { if (from === null) return; e.preventDefault(); e.stopPropagation(); if (over !== i) setOver(i); },
      onDrop: (e) => {
        if (from === null) return;
        e.preventDefault(); e.stopPropagation();
        if (from !== i) { const a = [...value]; const [x] = a.splice(from, 1); a.splice(i, 0, x); onChange(a); }
        setFrom(null); setOver(null);
      },
    },
    handle: {
      draggable: true,
      onDragStart: (e) => { e.stopPropagation(); setFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); const card = e.currentTarget.closest('.item'); if (card) e.dataTransfer.setDragImage(card, 24, 18); },
      onDragEnd: () => { setFrom(null); setOver(null); },
    },
  });
}

function ItemCard({ title, index, count, onMove, onRemove, children, defaultOpen, extraTools, removeLabel = 'this item', drag }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div class={`item ${open ? 'is-open' : ''} ${drag?.dragging ? 'is-dragging' : ''} ${drag?.over ? 'is-over' : ''}`} {...(drag?.target ?? {})}>
      <div class="item-head">
        {drag && <span class="drag-handle" title="Drag to reorder" aria-hidden="true" {...drag.handle}>⋮⋮</span>}
        <button type="button" class="item-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span class="chev">{open ? '▾' : '▸'}</span> {title || <em>Untitled</em>}
        </button>
        <div class="item-tools">
          {extraTools}
          <button type="button" class="icon-btn" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" class="icon-btn" title="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
          <button type="button" class="icon-btn danger" title="Remove" onClick={async () => { if (await ask({ title: `Remove ${removeLabel}?`, body: 'It disappears when you save.', confirm: 'Remove', danger: true })) onRemove(); }}><Icon name="trash" /></button>
        </div>
      </div>
      {open && <div class="item-body">{children}</div>}
    </div>
  );
}

function ListField({ field, value, onChange }) {
  const [added, setAdded] = useState(-1);
  const drag = useReorder(value, onChange);
  return (
    <fieldset class="group">
      <legend>{field.label} <span class="count">{value.length}</span></legend>
      {field.help && <small class="field-help">{field.help}</small>}
      {value.map((item, i) => (
        <ItemCard key={i} index={i} count={value.length} defaultOpen={i === added} drag={value.length > 1 ? drag(i) : null} removeLabel={`“${(field.summary && item?.[field.summary]) || 'this item'}”`}
          title={field.summary ? item?.[field.summary] : `${field.label} ${i + 1}`}
          onMove={(d) => onChange(move(value, i, d))}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}>
          <Form fields={field.fields} value={item} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} />
        </ItemCard>
      ))}
      <button type="button" class="add" onClick={() => { onChange([...value, {}]); setAdded(value.length); }}><Icon name="plus" />Add</button>
    </fieldset>
  );
}

/** Pick a block type: a searchable grid with icons and one-line descriptions. */
function BlockPicker({ types, onPick, onClose }) {
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const list = Object.entries(types).filter(([, d]) => `${d.label} ${d.desc ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div class="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="picker" role="dialog" aria-label="Add a block">
        <div class="cmdk-input"><Icon name="search" size={18} /><input ref={ref} value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Search blocks…" onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) onPick(list[0][0]); }} /><kbd>esc</kbd></div>
        <div class="picker-grid">
          {list.map(([type, d]) => (
            <button type="button" class="picker-item" onClick={() => onPick(type)}>
              <span class="picker-icon"><Icon name={d.icon ?? 'pages'} size={18} /></span>
              <span><b>{d.label.replace(/ \(.*\)/, '')}</b><small>{d.desc}</small></span>
            </button>
          ))}
          {!list.length && <p class="muted">No block matches “{q}”.</p>}
        </div>
      </div>
    </div>
  );
}

function BlocksField({ field, value, onChange }) {
  const [added, setAdded] = useState(-1);
  const [picking, setPicking] = useState(null); // index to insert at
  const insert = (type, at) => { const next = [...value]; next.splice(at, 0, { type }); onChange(next); setAdded(at); setPicking(null); };
  const duplicate = (i) => { const next = [...value]; next.splice(i + 1, 0, structuredClone(value[i])); onChange(next); };
  const drag = useReorder(value, onChange);
  return (
    <fieldset class="group blocks">
      <legend>{field.label} <span class="count">{value.length}</span></legend>
      {!value.length && <p class="muted">No blocks yet. Add the first one.</p>}
      {value.map((block, i) => {
        const def = field.types[block.type];
        return (
          <ItemCard key={`${i}-${block.type}`} index={i} count={value.length} defaultOpen={i === added} removeLabel="this block" drag={value.length > 1 ? drag(i) : null}
            title={<><span class="badge">{def?.icon && <Icon name={def.icon} size={12} />}{def?.label.replace(/ \(.*\)/, '') ?? block.type}</span> {block.heading ?? ''}</>}
            extraTools={<>
              <button type="button" class="icon-btn" title="Duplicate" onClick={() => duplicate(i)}><Icon name="copy" /></button>
              <button type="button" class="icon-btn" title="Add a block below" onClick={() => setPicking(i + 1)}><Icon name="plus" /></button>
            </>}
            onMove={(d) => onChange(move(value, i, d))}
            onRemove={() => onChange(value.filter((_, j) => j !== i))}>
            {def ? <Form fields={def.fields} value={block} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...v, type: block.type } : x)))} />
              : <p class="muted">Unknown block type "{block.type}".</p>}
          </ItemCard>
        );
      })}
      <button type="button" class="add add--block" onClick={() => setPicking(value.length)}><Icon name="plus" />Add block</button>
      {picking !== null && <BlockPicker types={field.types} onPick={(t) => insert(t, picking)} onClose={() => setPicking(null)} />}
    </fieldset>
  );
}

export function MarkdownEditor({ value, onChange, tall }) {
  const ref = useRef(null);
  const [view, setView] = useState('split');
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(0);
  // Insert text at the cursor (or the end)
  const insert = (text) => {
    const ta = ref.current;
    const at = ta ? ta.selectionStart : value.length;
    const next = value.slice(0, at) + text + value.slice(at);
    onChange(next);
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.setSelectionRange(at + text.length, at + text.length); } });
  };
  const altOf = (name) => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  // Images dropped or pasted into the editor upload straight away, like WordPress
  const uploadAll = async (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return false;
    setUploading((n) => n + imgs.length);
    for (const f of imgs) {
      try { const url = await uploadFile(f); insert(`\n![${altOf(f.name)}](${url})\n`); notify('Image uploaded. It goes live with your next save.'); }
      catch (x) { notify(x.message, 'err'); }
      setUploading((n) => n - 1);
    }
    return true;
  };
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
        <button type="button" onClick={() => setPicking(true)} title="Insert an image (or paste / drop one into the text)">🖼 Image</button>
        {uploading > 0 && <span class="muted md-uploading">Uploading {uploading}…</span>}
        <span class="spacer" />
        {['write', 'split', 'preview'].map((v) => <button type="button" class={view === v ? 'on' : ''} onClick={() => setView(v)}>{v}</button>)}
      </div>
      <div class="md-panes">
        {view !== 'preview' && <textarea ref={ref} value={value} onInput={(e) => onChange(e.currentTarget.value)} spellcheck
          onPaste={(e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); uploadAll(e.clipboardData.files); } }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); uploadAll(e.dataTransfer.files); } }} />}
        {view !== 'write' && <div class="md-preview prose" dangerouslySetInnerHTML={{ __html: marked.parse(value || '*Nothing yet.*') }} />}
      </div>
      {picking && <MediaPicker images onUpload={async (f) => { setPicking(false); await uploadAll([f]); }} onPick={(u) => { setPicking(false); insert(`\n![${altOf(u.split('/').pop())}](${u})\n`); }} onClose={() => setPicking(false)} />}
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

export function MediaPicker({ images, onPick, onClose, onUpload }) {
  const [files, setFiles] = useState(null);
  useEffect(() => { api.files().then((d) => setFiles(d.files.map((f) => f.path).filter((p) => p.startsWith(UPLOADS) && !p.split('/').pop().startsWith('.')).reverse())).catch((e) => notify(e.message, 'err')); }, []);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const shown = (files ?? []).filter((p) => !images || isImage(p));
  return (
    <div class="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal-box" role="dialog" aria-label="Choose a file">
        <div class="head-row"><h2>{onUpload ? 'Add an image' : 'Choose from media'}</h2><div class="actions">{onUpload && <label class="button primary">⬆ Upload new<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) onUpload(f); }} /></label>}<button type="button" onClick={onClose}>✕</button></div></div>
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

// ---- dates and skills ---------------------------------------------------------

/** Month + year (YYYY-MM), optionally with a "present" checkbox that clears it. */
function MonthField({ field, value, onChange }) {
  const [present, setPresent] = useState(field.present && !value);
  useEffect(() => { if (value) setPresent(false); }, [value]);
  return (
    <div class="field">
      <span class="field-label">{field.label}</span>
      <div class="month-row">
        <input type="month" value={present ? '' : (value ?? '')} disabled={present} onInput={(e) => onChange(e.currentTarget.value || undefined)} />
        {field.present && (
          <label class="month-present"><input type="checkbox" checked={present} onChange={(e) => { setPresent(e.currentTarget.checked); if (e.currentTarget.checked) onChange(undefined); }} />{field.present}</label>
        )}
      </div>
      {field.help && <small class="field-help">{field.help}</small>}
    </div>
  );
}

/** Chips: type and press Enter (or comma); suggestions come from the rest of the profile. */
function TagsField({ field, value, onChange }) {
  const [text, setText] = useState('');
  const add = (raw) => {
    const t = raw.trim().replace(/,$/, '');
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setText('');
  };
  const options = (typeof field.suggest === 'function' ? field.suggest() : field.suggest ?? []).filter((o) => !value.includes(o));
  return (
    <div class="field">
      <span class="field-label">{field.label}</span>
      <div class="chips-input">
        {value.map((t) => <span class="tag tag--edit">{t}<button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>×</button></span>)}
        <input value={text} list={`dl-${field.name}`} placeholder={value.length ? 'Add another…' : (field.placeholder ?? 'Type and press Enter')}
          onInput={(e) => { const v = e.currentTarget.value; if (v.endsWith(',')) add(v); else setText(v); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
          onBlur={() => text && add(text)} />
        <datalist id={`dl-${field.name}`}>{options.map((o) => <option value={o} />)}</datalist>
      </div>
      {field.help && <small class="field-help">{field.help}</small>}
    </div>
  );
}
