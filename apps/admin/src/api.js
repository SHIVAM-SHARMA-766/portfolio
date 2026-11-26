// Thin client for /api/admin/*. Content edits become commits on GitHub, which
// the deploy workflow builds and publishes.
import YAML from 'yaml';

async function call(method, path, body) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = /** @type {Error & { status?: number }} */ (new Error(data.error || `${res.status} ${res.statusText}`));
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (username, password) => call('POST', '/login', { username, password }),
  logout: () => call('POST', '/logout'),
  me: () => call('GET', '/me'),
  stats: () => call('GET', '/stats'),
  visitors: () => call('GET', '/visitors'),
  deleteVisitor: (id) => call('DELETE', `/visitors/${id}`),
  contact: (id) => call('GET', `/visitors/${id}`),
  updateContact: (id, patch) => call('PATCH', `/visitors/${id}`, patch),
  addNote: (id, body) => call('POST', `/visitors/${id}/notes`, { body }),
  deleteNote: (id, note) => call('DELETE', `/visitors/${id}/notes/${note}`),
  insights: () => call('GET', '/insights'),
  messages: () => call('GET', '/messages'),
  markMessage: (id, read) => call('PATCH', `/messages/${id}`, { read }),
  deleteMessage: (id) => call('DELETE', `/messages/${id}`),
  files: () => call('GET', '/files'),
  file: (path) => call('GET', `/file?path=${encodeURIComponent(path)}`),
  save: (path, content, sha, message) => call('PUT', '/file', { path, content, sha: sha || undefined, message }),
  upload: (path, base64) => call('PUT', '/file', { path, content: base64, binary: true }),
  remove: (path, sha) => call('DELETE', `/file?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(sha)}`),
  deploys: () => call('GET', '/deploys'),
  history: (path) => call('GET', `/history${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  restore: (path, commit) => call('POST', '/restore', { path, commit }),
};

// ---- formats ----------------------------------------------------------------

export function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: src };
  return { data: YAML.parse(m[1]) ?? {}, body: m[2].replace(/^\n/, '') };
}

export function stringifyFrontmatter(data, body) {
  const clean = prune(data);
  return `---\n${YAML.stringify(clean, { lineWidth: 0 }).trimEnd()}\n---\n\n${(body ?? '').trimEnd()}\n`;
}

export const toJSON = (data) => JSON.stringify(prune(data), null, 2) + '\n';

// Keys whose empty value is meaningful (the home page's slug is "").
const KEEP_EMPTY = new Set(['slug']);

/** Drop empty optional values so files stay tidy (the build accepts missing fields). */
export function prune(v) {
  if (Array.isArray(v)) return v.map(prune);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);
      if (p === undefined || p === null || (p === '' && !KEEP_EMPTY.has(k))) continue;
      out[k] = p;
    }
    return out;
  }
  return v;
}

export const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
