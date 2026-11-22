// Palette tokens shared by every app. palettes.json is the single source;
// this module turns it into CSS custom properties.
import palettes from './palettes.json' with { type: 'json' };

export { palettes };

/** All palettes for one theme. */
export function palettesFor(theme) {
  return palettes[theme] ?? [];
}

/**
 * CSS for every palette of a theme, scoped by [data-palette].
 * The first palette is also the fallback when no palette attribute is set.
 */
export function paletteCss(theme) {
  const list = palettesFor(theme);
  const vars = (c) =>
    Object.entries(c)
      .map(([k, v]) => `--${k === 'accent2' ? 'accent-2' : k}:${v};`)
      .join('');
  const rules = list.map((p) => `:root[data-palette="${p.id}"]{${vars(p.colors)}}`);
  if (list[0]) rules.unshift(`:root{${vars(list[0].colors)}}`);
  return rules.join('\n');
}
