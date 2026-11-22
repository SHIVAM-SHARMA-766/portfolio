// Build-time access to all content. Single-object JSON files are imported and
// validated here; pages and blog posts come from content collections.
import { getCollection } from 'astro:content';
import { marked } from 'marked';
import { z } from 'astro/zod';
import { siteSchema, profileSchema, achievementSchema, courseSchema, shopSchema, type Page } from './schema';
import siteRaw from '../../../../content/site.json';
import profileRaw from '../../../../content/profile.json';
import achievementsRaw from '../../../../content/achievements.json';
import shopRaw from '../../../../content/shop.json';
export { ids, slugify } from '@portfolio/game/ids';

function parse<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new Error(`Invalid content in ${file}:\n${z.prettifyError(r.error)}`);
  return r.data;
}

export const site = parse(siteSchema, siteRaw, 'content/site.json');
export const profile = parse(profileSchema, profileRaw, 'content/profile.json');
export const achievements = parse(z.array(achievementSchema), achievementsRaw.achievements, 'content/achievements.json');
export const shop = parse(shopSchema, shopRaw, 'content/shop.json').items;
export const rewards = site.game.rewards as Record<string, number>;
export const shopItem = (id: string) => shop.find((i) => i.id === id);

export const THEMES = [
  { id: 'terminal', label: 'Terminal', blurb: 'A hacker shell. Type commands.' },
  { id: 'quest', label: 'Quest', blurb: 'A pixel adventure. Explore zones.' },
  { id: 'studio', label: 'Studio', blurb: 'Clean and editorial.' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

export async function getPages(): Promise<Page[]> {
  const all = await getCollection('pages');
  const pages = all.map((e) => e.data).filter((p) => !p.draft);
  const slugs = new Set<string>();
  for (const p of pages) {
    if (slugs.has(p.slug)) throw new Error(`Two pages share the slug "${p.slug}"`);
    slugs.add(p.slug);
  }
  return pages.sort((a, b) => a.order - b.order);
}

export async function getNav() {
  return (await getPages()).filter((p) => p.inNav);
}

export async function getPosts() {
  const all = await getCollection('blog');
  return all
    .filter((e) => !e.data.draft)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

// Courses are owned by the learn site; the portfolio only lists them.
const courseFiles = import.meta.glob('../../../../content/courses/*/course.json', { eager: true, import: 'default' });
const lessonFiles = import.meta.glob('../../../../content/courses/*/*/*.{md,mdx}');

export function getCourses() {
  return Object.entries(courseFiles)
    .map(([path, raw]) => {
      const slug = path.split('/').at(-2)!;
      const course = parse(courseSchema, raw, `content/courses/${slug}/course.json`);
      const lessons = Object.keys(lessonFiles).filter((p) => p.includes(`/courses/${slug}/`)).length;
      const url = site.learnUrl ? `${site.learnUrl.replace(/\/$/, '')}/${slug}/` : '#';
      return { slug, ...course, lessons, url };
    })
    .filter((c) => c.status === 'published')
    .sort((a, b) => a.order - b.order);
}

/** URL of a page in a theme. */
export function pageUrl(theme: string, slug: string) {
  return `/${theme}/${slug ? `${slug}/` : ''}`;
}

/** Resolve a link written in content. Relative links stay inside the current theme. */
export function resolveHref(theme: string, href: string) {
  if (/^([a-z]+:|\/|#)/i.test(href)) return href;
  return `/${theme}/${href}`;
}

export function md(src = '') {
  return marked.parse(src, { async: false }) as string;
}

export function mdInline(src = '') {
  return marked.parseInline(src, { async: false }) as string;
}

export function formatMonth(ym?: string) {
  if (!ym) return 'Present';
  const [y, m] = ym.split('-').map(Number);
  if (!m) return String(y);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function pageId(slug: string) {
  return slug === '' ? 'home' : slug;
}

/** Config handed to the game engine on every page. */
export async function gameConfig(currentPageId: string | null) {
  const pages = await getPages();
  return {
    enabled: site.game.enabled,
    cookieDomain: site.cookieDomain,
    rewards: site.game.rewards,
    levels: site.game.levels,
    achievements,
    pageIds: pages.map((p) => pageId(p.slug)),
    pageId: currentPageId,
    apiUrl: site.apiUrl ?? null,
    shop,
  };
}
