// Shop model shared by the generator (server catalog), the sites and the
// account layer, so every place agrees on what an item is and what it needs.
//
// Item ids: "theme:<theme>" or "palette:<theme>-<palette>".
// A palette of a theme that is itself for sale requires that theme first
// (unless the item sets "requires" explicitly). Anything not in the shop is free.

export function parseItemId(id) {
  const [kind, rest = ''] = String(id).split(':');
  if (kind === 'theme') return { kind, theme: rest, palette: null };
  if (kind === 'palette') {
    const i = rest.indexOf('-');
    return { kind, theme: rest.slice(0, i), palette: rest.slice(i + 1) };
  }
  return { kind, theme: null, palette: null };
}

/** Adds kind/theme/palette and the derived "requires" to raw shop items. */
export function normalizeShop(items = []) {
  const sold = new Set(items.map((i) => i.id));
  return items.map((raw) => {
    const meta = parseItemId(raw.id);
    let requires = raw.requires ?? null;
    if (requires === null && meta.kind === 'palette' && sold.has(`theme:${meta.theme}`)) requires = `theme:${meta.theme}`;
    return { ...raw, ...meta, requires: requires || null, price: Math.max(0, Number(raw.price) || 0) };
  });
}

/**
 * Everything the shop window shows, grouped by theme: the theme itself (free or
 * for sale) and all of its palettes (free ones included, so the full set is visible).
 * palettes: { theme: [{ id, label, colors }] } from packages/tokens.
 */
export function shopView(items, palettes, themes) {
  const byId = new Map(normalizeShop(items).map((i) => [i.id, i]));
  return themes.map((t) => ({
    theme: t.id,
    label: t.label,
    blurb: t.blurb ?? '',
    item: byId.get(`theme:${t.id}`) ?? null,
    palettes: (palettes[t.id] ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      colors: p.colors,
      item: byId.get(`palette:${t.id}-${p.id}`) ?? null,
    })),
  }));
}
