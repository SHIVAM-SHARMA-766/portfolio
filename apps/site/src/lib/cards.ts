// Small helpers shared by every theme's Cards / Banner blocks.
import type { Card } from './schema';

/** data-xp attributes for a card that awards XP when opened. */
export const xpAttrs = (c: Card) => (c.xp ? { 'data-xp': c.xp.points, 'data-xp-id': c.xp.id, 'data-xp-label': c.xp.label } : {});

/** A stable hue per title, so generated covers differ but never change. */
export const hue = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 360;

/** Up to two initials for a generated cover ("Dohra — local…" → "D"). */
export const initialsOf = (s: string) => s.split(/\s[—–-]\s/)[0].split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export const isExternal = (href?: string | null) => !!href && /^https?:/i.test(href);
