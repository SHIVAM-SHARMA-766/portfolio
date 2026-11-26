// The media library: upload, search, details, delete.
import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { api } from './api.js';
import { uploadFile, publicUrl } from './fields.jsx';
import { Icon, ask } from './ui.jsx';
import { toast, published } from './core.js';

// ---- media -----------------------------------------------------------------

export function Media() {
  const [all, setAll] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.files().then((d) => setAll(d.files.filter((f) => f.path.startsWith('apps/site/public/uploads/') && !f.path.split('/').pop().startsWith('.')).reverse())).catch((e) => toast(e.message, 'err')), []);
  useEffect(() => { load(); }, []);
  const send = async (list) => {
    if (!list?.length) return;
    setBusy(true);
    let n = 0;
    for (const file of list) { try { await uploadFile(file); n++; } catch (x) { toast(x.message, 'err'); } }
    if (n) toast(`Uploaded ${n} file${n > 1 ? 's' : ''}.`);
    setBusy(false); load();
  };
  const copy = (text, what) => { navigator.clipboard?.writeText(text); toast(`Copied ${what}.`); };
  const del = async (f) => {
    if (!(await ask({ title: `Delete ${f.path.split('/').pop()}?`, body: 'Pages that use it will show a broken image after the next deploy.', confirm: 'Delete file', danger: true }))) return;
    try { await api.remove(f.path, f.sha); published(null); toast('File deleted.'); setOpen(null); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const isImage = (p) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p);
  const shown = (all ?? []).filter((f) => f.path.toLowerCase().includes(q.toLowerCase()));
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); send([...e.dataTransfer.files]); }}>
      <header class="page-head">
        <div><h1>Media library <span class="count">{all?.length ?? ''}</span></h1><p class="muted">Every uploaded image and PDF. You can also add media while editing: the Image button, paste, or drop into the text.</p></div>
        <div class="actions"><label class="button primary"><Icon name="plus" />{busy ? 'Uploading…' : 'Upload'}<input type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => { send([...e.currentTarget.files]); e.currentTarget.value = ''; }} disabled={busy} /></label></div>
      </header>
      <div class="toolbar"><label class="search"><Icon name="search" /><input type="search" placeholder="Search files" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></label><span class="muted">Max 8 MB each · drop files anywhere here</span></div>
      <div class={`dropzone ${over ? 'is-over' : ''}`}>Drop files to upload</div>
      {!all ? <div class="sk sk--table" /> : !shown.length ? (
        <div class="panel"><div class="empty"><span class="empty-icon"><Icon name="image" size={20} /></span><b>{all.length ? 'No file matches' : 'No uploads yet'}</b><small>Upload images for covers, banners and posts.</small></div></div>
      ) : (
        <div class="media">
          {shown.map((f) => {
            const url = publicUrl(f.path);
            return (
              <button type="button" class={`media-item ${open?.path === f.path ? 'is-on' : ''}`} onClick={() => setOpen(f)}>
                {isImage(f.path) ? <img src={url} alt="" loading="lazy" /> : <span class="pdf">{f.path.split('.').pop().toUpperCase()}</span>}
                <small title={f.path}>{f.path.split('/').pop()}</small>
              </button>
            );
          })}
        </div>
      )}
      {open && <MediaDetails file={open} isImage={isImage(open.path)} onClose={() => setOpen(null)} onCopy={copy} onDelete={() => del(open)} />}
    </div>
  );
}

function MediaDetails({ file, isImage, onClose, onCopy, onDelete }) {
  const url = publicUrl(file.path);
  const [dims, setDims] = useState(null);
  const [size, setSize] = useState(null);
  const img = useRef(null);
  // A cached image can finish loading before onLoad is attached, so measure on mount too
  const measure = () => { const i = img.current; if (i?.naturalWidth) setDims(`${i.naturalWidth} × ${i.naturalHeight}`); };
  useEffect(() => {
    setDims(null); setSize(null);
    requestAnimationFrame(measure);
    fetch(url, { method: 'HEAD' }).then((r) => setSize(Number(r.headers.get('content-length')) || null)).catch(() => {});
  }, [file.path]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const kb = size ? (size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`) : '—';
  return (
    <div class="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="drawer" role="dialog" aria-label="File details">
        <header class="drawer-head"><h2>File details</h2><button type="button" class="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button></header>
        <div class="drawer-body">
          <div class="media-preview">{isImage ? <img ref={img} src={url} alt="" onLoad={measure} /> : <span class="pdf">{file.path.split('.').pop().toUpperCase()}</span>}</div>
          <dl class="facts">
            <div><dt>Name</dt><dd>{file.path.split('/').pop()}</dd></div>
            <div><dt>Dimensions</dt><dd>{dims ?? (isImage ? '…' : '—')}</dd></div>
            <div><dt>Size</dt><dd>{kb}</dd></div>
            <div><dt>Address</dt><dd><code>{url}</code></dd></div>
          </dl>
          <div class="actions media-actions">
            <button onClick={() => onCopy(url, 'the address')}><Icon name="copy" />Copy address</button>
            {isImage && <button onClick={() => onCopy(`![](${url})`, 'the Markdown')}><Icon name="copy" />Copy Markdown</button>}
            <a class="button" href={url} target="_blank" rel="noopener"><Icon name="external" />Open</a>
          </div>
        </div>
        <footer class="drawer-foot"><button type="button" class="danger" onClick={onDelete}><Icon name="trash" />Delete file</button><span class="spacer" /><button type="button" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}
