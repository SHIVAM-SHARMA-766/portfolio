// Pages and blog posts as tables: status tabs, search, row actions.
import { useEffect, useState, useCallback } from 'preact/hooks';
import { api, parseFrontmatter, toJSON, slugify } from './api.js';
import { Icon, Menu, ask, askText } from './ui.jsx';
import { navigate, toast, published, editHref } from './core.js';

// ---- collections -----------------------------------------------------------

function useFiles() {
  const [files, setFiles] = useState(null);
  const load = useCallback(() => api.files().then((d) => setFiles(d.files)).catch((e) => toast(e.message, 'err')), []);
  useEffect(() => { load(); }, []);
  return [files, load];
}


/** Reads several content files (for list screens that show titles). */
function useContents(files, parse) {
  const [out, setOut] = useState(null);
  const key = (files ?? []).map((f) => f.sha).join('|');
  useEffect(() => {
    if (!files) return;
    Promise.all(files.map((f) => api.file(f.path).then((x) => ({ path: f.path, sha: f.sha, raw: x.content, ...parse(x.content) })).catch(() => ({ path: f.path, sha: f.sha }))))
      .then(setOut);
  }, [key]);
  return out;
}

/** A content list as a table: search, status tabs, row actions. */
function ContentTable({ title, intro, rows, columns, onNew, newLabel, empty }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const counts = { all: rows?.length ?? 0, published: rows?.filter((r) => !r.draft).length ?? 0, draft: rows?.filter((r) => r.draft).length ?? 0 };
  const shown = (rows ?? []).filter((r) => (tab === 'all' || (tab === 'draft') === !!r.draft) && `${r.title} ${r.url}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <header class="page-head">
        <div><h1>{title} <span class="count">{rows?.length ?? ''}</span></h1><p class="muted">{intro}</p></div>
        <div class="actions"><button class="primary" onClick={onNew}><Icon name="plus" />{newLabel}</button></div>
      </header>
      <div class="tabs">
        {[['all', 'All'], ['published', 'Published'], ['draft', 'Drafts']].map(([id, label]) => <button type="button" class={`tab ${tab === id ? 'is-on' : ''}`} onClick={() => setTab(id)}>{label}<span>{counts[id]}</span></button>)}
      </div>
      <div class="toolbar"><label class="search"><Icon name="search" /><input type="search" placeholder={`Search ${title.toLowerCase()}`} value={q} onInput={(e) => setQ(e.currentTarget.value)} /></label></div>
      {!rows ? <div class="sk sk--table" /> : !shown.length ? (
        <div class="panel"><div class="empty"><span class="empty-icon"><Icon name="pages" size={20} /></span><b>{rows.length ? 'Nothing matches' : empty}</b>{!rows.length && <button class="primary" onClick={onNew}><Icon name="plus" />{newLabel}</button>}</div></div>
      ) : (
        <div class="table-wrap">
          <table class="table table--crm">
            <thead><tr><th>Title</th>{columns.map((c) => <th class={c.num ? 'num' : ''}>{c.label}</th>)}<th class="actions-col" /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr onClick={() => navigate(r.href)}>
                  <td><span class="row-title"><b>{r.title}</b><small>{r.url}</small></span></td>
                  {columns.map((c) => <td class={c.num ? 'num' : ''}>{c.render(r)}</td>)}
                  <td class="actions-col"><Menu items={r.actions} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function Pages() {
  const [files, reload] = useFiles();
  const list = files?.filter((f) => /^content\/pages\/[^/]+\.json$/.test(f.path));
  const pages = useContents(list, (c) => JSON.parse(c));
  const create = async () => {
    const title = await askText({ title: 'New page', label: 'Page title', placeholder: 'e.g. Uses', confirm: 'Create page', help: (t) => (t ? `Its address will be /${slugify(t)}/` : 'You can change the address later.') });
    if (!title) return;
    const slug = slugify(title);
    if ((pages ?? []).some((p) => p.slug === slug)) return toast(`A page already uses /${slug}/.`, 'err');
    sessionStorage.setItem('admin.new', JSON.stringify({ data: { title, slug, navLabel: title, order: 10, inNav: true, draft: true, blocks: [{ type: 'banner', heading: title, body: '' }, { type: 'text', heading: null, body: 'Write something here.' }] } }));
    navigate(editHref(`content/pages/${slug}.json`, '&new=1'));
  };
  const duplicate = async (p) => {
    const slug = `${p.slug || 'home'}-copy`;
    const copy = { ...JSON.parse(p.raw), title: `${p.title} (copy)`, slug, draft: true, inNav: false };
    try { await api.save(`content/pages/${slug}.json`, toJSON(copy)); published(null); toast('Copy created as a draft.'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async (p) => {
    if (!(await ask({ title: `Delete “${p.title}”?`, body: 'It disappears from the site after the next deploy. Git history keeps a copy.', confirm: 'Delete page', danger: true }))) return;
    try { await api.remove(p.path, p.sha); published(null); toast('Page deleted.'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const rows = pages && [...pages].sort((x, y) => (x.order ?? 100) - (y.order ?? 100)).map((p) => {
    const url = `/${p.slug ? `${p.slug}/` : ''}`;
    return { ...p, title: p.title ?? p.path, url, href: editHref(p.path), actions: [
      { label: 'Edit', icon: 'pen', onClick: () => navigate(editHref(p.path)) },
      !p.draft && { label: 'View on site', icon: 'external', href: url, external: true },
      { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(p) },
      p.slug !== '' && { label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(p) },
    ] };
  });
  return <ContentTable title="Pages" intro="Each page is a list of blocks. All three themes render the same blocks in their own style." rows={rows} onNew={create} newLabel="New page" empty="No pages yet"
    columns={[
      { label: 'Status', render: (r) => <span class={`pill ${r.draft ? 'pill--warn' : 'pill--ok'}`}>{r.draft ? 'Draft' : 'Published'}</span> },
      { label: 'Menu', render: (r) => (r.inNav === false ? <span class="muted">Hidden</span> : `#${r.order ?? '—'} · ${r.navLabel ?? r.title}`) },
      { label: 'Blocks', num: true, render: (r) => r.blocks?.length ?? 0 },
    ]} />;
}

/** @param {{ params?: any }} props */
export function Blog({ params = {} }) {
  const [files, reload] = useFiles();
  const list = files?.filter((f) => /^content\/blog\/[^/]+\.md$/.test(f.path));
  const posts = useContents(list, (c) => parseFrontmatter(c).data);
  const create = async () => {
    const title = await askText({ title: 'New post', label: 'Post title', placeholder: 'e.g. How I cut our AWS bill', confirm: 'Start writing', help: (t) => (t ? `Its address will be /blog/${slugify(t)}/` : 'It starts as a draft.') });
    if (!title) return;
    sessionStorage.setItem('admin.new', JSON.stringify({ data: { title, description: '', date: new Date().toISOString().slice(0, 10), tags: [], draft: true }, body: '' }));
    navigate(editHref(`content/blog/${slugify(title)}.md`, '&new=1'));
  };
  const remove = async (p) => {
    if (!(await ask({ title: `Delete “${p.title}”?`, body: 'It disappears from the site after the next deploy. Git history keeps a copy.', confirm: 'Delete post', danger: true }))) return;
    try { await api.remove(p.path, p.sha); published(null); toast('Post deleted.'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  useEffect(() => { if (params.new) { history.replaceState(null, '', '#/blog'); create(); } }, []);
  const rows = posts && [...posts].sort((x, y) => String(y.date ?? '').localeCompare(String(x.date ?? ''))).map((p) => {
    const slug = p.path.split('/').pop().replace('.md', '');
    const url = `/blog/${slug}/`;
    return { ...p, title: p.title ?? slug, url, href: editHref(p.path), actions: [
      { label: 'Edit', icon: 'pen', onClick: () => navigate(editHref(p.path)) },
      !p.draft && { label: 'View on site', icon: 'external', href: url, external: true },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(p) },
    ] };
  });
  return <ContentTable title="Blog" intro="Posts start as drafts. Publish when they're ready." rows={rows} onNew={create} newLabel="New post" empty="No posts yet"
    columns={[
      { label: 'Status', render: (r) => <span class={`pill ${r.draft ? 'pill--warn' : 'pill--ok'}`}>{r.draft ? 'Draft' : 'Published'}</span> },
      { label: 'Date', render: (r) => String(r.date ?? '').slice(0, 10) || '—' },
      { label: 'Tags', render: (r) => (r.tags ?? []).slice(0, 3).map((t) => <span class="tag">{t}</span>) },
    ]} />;
}
