// Builds the game catalog the API embeds: every valid event id and its points,
// plus levels, achievements and shop items. The API rejects any event that is
// not in this catalog, so visitors cannot invent events to farm points.
//
//   node scripts/build-game-data.mjs [outfile]
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ids, slugify, TERMINAL_COMMANDS, SECRETS } from '../packages/game/src/ids.js';

const root = resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const out = resolve(process.argv[2] ?? join(root, 'apps/api/internal/game/data/game-data.json'));

const site = read('content/site.json');
const profile = read('content/profile.json');
const { achievements } = read('content/achievements.json');
const shop = read('content/shop.json');
const palettes = read('packages/tokens/palettes.json');
const missions = existsSync(join(root, 'content/missions.json')) ? read('content/missions.json').missions : [];
const r = site.game.rewards;
const THEMES = ['terminal', 'quest', 'studio'];

const frontmatter = (src) => src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
const isDraft = (src) => /^draft:\s*true\s*$/m.test(frontmatter(src));

const pages = readdirSync(join(root, 'content/pages'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => read(`content/pages/${f}`))
  .filter((p) => !p.draft)
  .map((p) => (p.slug === '' ? 'home' : p.slug));

const posts = readdirSync(join(root, 'content/blog'))
  .filter((f) => f.endsWith('.md') && !isDraft(readFileSync(join(root, 'content/blog', f), 'utf8')))
  .map((f) => `blog/${f.replace(/\.md$/, '')}`);

const courses = [];
const lessons = [];
for (const d of readdirSync(join(root, 'content/courses'), { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const metaPath = join(root, 'content/courses', d.name, 'course.json');
  if (!existsSync(metaPath)) continue;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  if (meta.status !== 'published') continue;
  courses.push(d.name);
  for (const ch of meta.chapters) {
    const dir = join(root, 'content/courses', d.name, ch.slug);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/\.mdx?$/.test(f) || isDraft(readFileSync(join(dir, f), 'utf8'))) continue;
      lessons.push(`${d.name}/${ch.slug}/${f.replace(/\.mdx?$/, '')}`);
    }
  }
}

const events = {};
const add = (id, pts) => { events[id] = pts ?? 0; };
for (const p of [...pages, ...posts]) { add(ids.visit(p), r.visit); add(ids.read(p), r.read); }
for (const t of THEMES) add(ids.theme(t), r.theme);
for (const t of THEMES) for (const p of palettes[t] ?? []) add(ids.palette(t, p.id), r.palette);
for (const p of profile.projects) add(ids.project(p.slug), r.project);
for (const job of profile.experience) for (const e of job.engagements ?? []) add(ids.experience(e.title), r.experience);
add(ids.contact('email'), r.contactEmail);
for (const s of site.socials) add(ids.contact(s.label), r.contact);
for (const c of TERMINAL_COMMANDS) add(ids.terminal(c), r.terminalCommand);
for (const l of lessons) { add(ids.lesson(l), r.lesson); add(ids.quiz(l), r.quiz); }
for (const c of courses) add(ids.course(c), r.course);
for (const s of SECRETS) add(ids.secret(s), 0);
for (const m of missions) add(ids.flag(m.id), m.reward ?? r.flag);

const data = {
  generated: new Date().toISOString(),
  siteUrl: site.siteUrl,
  learnUrl: site.learnUrl,
  cookieDomain: site.cookieDomain,
  levels: site.game.levels,
  pageIds: pages,
  achievements,
  shop: shop.items,
  events,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data, null, 2));
console.log(`game data: ${Object.keys(events).length} events, ${achievements.length} achievements, ${shop.items.length} shop items → ${out}`);
