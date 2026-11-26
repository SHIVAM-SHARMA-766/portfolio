// Build-time access to all content. Single-object JSON files are imported and
// validated here; pages and blog posts come from content collections.
import { getCollection } from 'astro:content';
import { marked } from 'marked';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { palettes } from '@portfolio/tokens';
import { z } from 'astro/zod';
import { siteSchema, profileSchema, achievementSchema, shopSchema, type Page } from './schema';
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
/**
 * The portrait, if its file exists (local paths are checked at build time so a
 * missing upload falls back to initials instead of a broken image).
 */
export const photo = (() => {
  const exists = (src: string | null | undefined, field: string) => {
    if (!src) return false;
    if (src.startsWith('/') && !existsSync(resolvePath(process.cwd(), 'public', src.slice(1)))) {
      console.warn(`[content] ${field} ${src} not found in apps/site/public; ignoring it`);
      return false;
    }
    return true;
  };
  if (!exists(site.photo, 'photo')) return null;
  return {
    src: site.photo!,
    /** Same portrait with the background removed (transparent), if provided */
    cutout: exists(site.photoCutout, 'photoCutout') ? site.photoCutout! : null,
    alt: site.photoAlt || site.name,
    position: site.photoPosition || '50% 25%',
  };
})();
export const initials = site.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export const shop = parse(shopSchema, shopRaw, 'content/shop.json').items;
export const rewards = site.game.rewards as Record<string, number>;
export const shopItem = (id: string) => shop.find((i) => i.id === id);

export const THEMES = [
  { id: 'terminal', label: 'Terminal', blurb: 'A hacker shell. Type commands.' },
  { id: 'quest', label: 'Quest', blurb: 'A pixel adventure. Explore zones.' },
  { id: 'studio', label: 'Studio', blurb: 'Clean and editorial.' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

/** Palette names and colours for the shop window. */
function shopPalettes() {
  return Object.fromEntries(Object.entries(palettes).map(([t, list]) => [t, list.map((p) => ({ id: p.id, label: p.label, colors: p.colors }))]));
}

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

/**
 * URL of a page. URLs carry no theme: the visitor's theme lives in the pf_theme
 * cookie and Caddy serves the matching build (see deploy/Caddyfile.tmpl).
 * The theme argument is kept so call sites read naturally.
 */
export function pageUrl(_theme: string, slug: string) {
  return `/${slug ? `${slug}/` : ''}`;
}

/** Link that switches to a theme and comes back to the same page. */
export function themeUrl(theme: string) {
  return `?theme=${theme}`;
}

/** Resolve a link written in content ("projects/" → "/projects/"). */
export function resolveHref(_theme: string, href: string) {
  if (/^([a-z]+:|\/|#|\?)/i.test(href)) return href;
  return `/${href}`;
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
  const pages = await getNav(); // "visit every page" counts menu pages only
  return {
    enabled: site.game.enabled,
    cookieDomain: site.cookieDomain,
    rewards: site.game.rewards,
    levels: site.game.levels,
    clickCap: site.game.clickCap,
    achievements,
    pageIds: pages.map((p) => pageId(p.slug)),
    pageId: currentPageId,
    apiUrl: site.apiUrl ?? null,
    siteUrl: site.siteUrl,
    shop,
    themes: THEMES,
    palettes: shopPalettes(),
  };
}

/** Ways to reach me for the hero: email, socials and the CV (when set). */
export const contactLinks = [
  ...(site.email ? [{ label: 'Email', href: `mailto:${site.email}`, external: false }] : []),
  ...site.socials.map((s) => ({ label: s.label, href: s.url, external: true })),
];
