# Brand

The mark is a bold "S" with an orange dot ("S."), on a rounded dark tile.

| File | Use |
|---|---|
| `logo-mark.svg` | The mark (dark tile). Source of `apps/site/public/favicon.svg`. |
| `logo-mark-inverse.svg` | Light tile, for dark backgrounds. |
| `logo-mark-1024.png` | Profile pictures, social avatars. |
| `logo-wordmark-light.png` / `-dark.png` | Mark + name (Inter Bold) for light / dark backgrounds. |

Colours: tile `#18181b`, S `#ffffff`, dot `#f97316`. On the site the mark is
`apps/site/src/components/Logo.astro`, recoloured per theme with `--logo-bg`,
`--logo-fg` and `--logo-dot`.
