// Checks every internal link, image and srcset in the built site resolves to a
// file, in every theme build. Run after `npm run build`:  npm run check:links
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '../apps/site', process.argv[2] ?? 'dist');
const THEMES = ['studio', 'terminal', 'quest'];
// Served by Caddy/the API, not files in dist
const external = /^\/(api|admin|_preview)(\/|$)/;

async function* html(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* html(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}
const exists = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };

// A clean URL is served from the visitor's theme build (see scripts/theme-routing.mjs).
async function resolves(url, theme) {
  let path = decodeURIComponent(url.split(/[?#]/)[0]);
  if (path.endsWith('/')) path += 'index.html';
  const candidates = [join(dist, path)];
  if (theme) candidates.push(join(dist, theme, path));
  if (!/\.[a-z0-9]+$/i.test(path)) candidates.push(join(dist, path, 'index.html'), ...(theme ? [join(dist, theme, path, 'index.html')] : []));
  for (const c of candidates) if (await exists(c)) return true;
  return false;
}

const broken = new Map();
let pages = 0, checked = 0;
for await (const file of html(dist)) {
  pages++;
  const rel = file.slice(dist.length + 1);
  const theme = THEMES.find((t) => rel.startsWith(`${t}/`)) ?? 'studio';
  const s = await readFile(file, 'utf8');
  const urls = new Set();
  for (const m of s.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) urls.add(m[1]);
  for (const m of s.matchAll(/\ssrcset="([^"]+)"/g)) for (const c of m[1].split(',')) urls.add(c.trim().split(/\s+/)[0]);
  for (const u of urls) {
    if (!u.startsWith('/') || u.startsWith('//') || external.test(u)) continue;
    checked++;
    if (!(await resolves(u, theme))) {
      if (!broken.has(u)) broken.set(u, []);
      broken.get(u).push(rel);
    }
  }
}
if (broken.size) {
  for (const [u, from] of broken) console.error(`✗ ${u}  (on ${from.length} page${from.length > 1 ? 's' : ''}, e.g. ${from[0]})`);
  console.error(`\n${broken.size} broken link${broken.size > 1 ? 's' : ''} in ${pages} pages`);
  process.exit(1);
}
console.log(`✓ ${checked} internal links on ${pages} pages resolve`);
