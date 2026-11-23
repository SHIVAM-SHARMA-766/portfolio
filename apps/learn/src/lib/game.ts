// Game config for the learn site: same levels and achievements as the
// portfolio, so XP feels like one game across both sites.
import site from '../../../../content/site.json';
import achievementsFile from '../../../../content/achievements.json';
import shopFile from '../../../../content/shop.json';
import { palettes } from '@portfolio/tokens';

const THEMES = [
  { id: 'terminal', label: 'Terminal', blurb: 'A hacker shell. Type commands.' },
  { id: 'quest', label: 'Quest', blurb: 'A pixel adventure. Explore zones.' },
  { id: 'studio', label: 'Studio', blurb: 'Clean and editorial.' },
];

export const gameConfig = {
  enabled: site.game.enabled,
  cookieDomain: site.cookieDomain,
  rewards: site.game.rewards,
  levels: site.game.levels,
  clickCap: (site.game as any).clickCap ?? 0,
  achievements: achievementsFile.achievements,
  pageIds: [] as string[],
  pageId: null,
  apiUrl: (site as any).apiUrl ?? null,
  shop: shopFile.items,
  siteUrl: site.siteUrl,
  theme: null,
  themes: THEMES,
  palettes: Object.fromEntries(Object.entries(palettes).map(([t, l]) => [t, (l as any[]).map((p) => ({ id: p.id, label: p.label, colors: p.colors }))])),
};

export const LEARN_PALETTES = [
  { id: 'green', label: 'Green' },
  { id: 'amber', label: 'Amber' },
  { id: 'violet', label: 'Violet' },
  { id: 'ocean', label: 'Ocean' },
];

export { site };
