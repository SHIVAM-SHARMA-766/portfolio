// Game config for the learn site: same levels and achievements as the
// portfolio, so XP feels like one game across both sites.
import site from '../../../../content/site.json';
import achievementsFile from '../../../../content/achievements.json';
import shopFile from '../../../../content/shop.json';

export const gameConfig = {
  enabled: site.game.enabled,
  cookieDomain: site.cookieDomain,
  rewards: site.game.rewards,
  levels: site.game.levels,
  achievements: achievementsFile.achievements,
  pageIds: [] as string[],
  pageId: null,
  apiUrl: (site as any).apiUrl ?? null,
  shop: shopFile.items,
};

export const LEARN_PALETTES = [
  { id: 'green', label: 'Green' },
  { id: 'amber', label: 'Amber' },
  { id: 'violet', label: 'Violet' },
  { id: 'ocean', label: 'Ocean' },
];

export { site };
