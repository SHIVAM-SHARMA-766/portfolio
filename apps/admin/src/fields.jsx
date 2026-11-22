// A small schema-driven form engine. Every editor in the admin is a list of
// field definitions (schemas.js) rendered by <Form>.
import { useRef, useState } from 'preact/hooks';
import { marked } from 'marked';

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
