# Architecture

Two static sites built from one content folder, plus a theme-agnostic game layer and a
Git-based admin panel. There is no server-side code: the build produces HTML files that
Caddy serves.

```
content/  ──(validated at build)──►  apps/site   (Astro)       → /srv/portfolio/site   → <domain>
   ▲                                 apps/learn  (Starlight)   → /srv/portfolio/learn  → learn.<domain>
   │                                      │
admin panel (/admin/, Sveltia CMS)        └── packages/game    (XP engine, both sites)
commits to GitHub → Actions builds,           packages/tokens  (colour palettes)
tests, rsyncs to the host
```

## Repository layout

| Path | What it is |
|---|---|
| `content/` | **All content.** The only folder the admin panel writes to (plus `apps/site/public/uploads` for media). |
| `content/site.json` | Name, URLs, socials, default theme and palettes, game rewards and levels |
| `content/profile.json` | Resume data: experience, projects, skills, education, certifications |
| `content/pages/*.json` | Portfolio pages. Each is an ordered list of **blocks** |
| `content/blog/*.md` | Blog posts |
| `content/achievements.json` | Achievements and their unlock rules |
| `content/courses/<course>/` | `course.json` (metadata and chapter list), `index.md` (overview), `<chapter>/<lesson>.md` |
| `apps/site/` | The portfolio (Astro). Three themes in `src/themes/<theme>/` |
| `apps/site/src/lib/schema.ts` | **The content contract.** Zod schemas for every content file |
| `apps/site/src/pages/admin/config.yml.ts` | Admin panel config, generated at build time |
| `apps/learn/` | The learn site (Astro Starlight) |
| `packages/game/` | Game engine: pure logic (`core.js`), storage, DOM binding, shared achievements dialog |
| `packages/tokens/palettes.json` | Every palette's colours, and the XP needed to unlock it |
| `tests/e2e.mjs` | Browser tests against the built output |
| `deploy/` | Caddyfile template and the one-time server setup script |

## Content model: pages are blocks

A page is `{ title, slug, order, inNav, draft, blocks: [...] }`. A block has a `type` and
its own fields:

| Block | Data |
|---|---|
| `hero`, `text`, `stats`, `cta`, `contact` | Their own fields |
| `experience`, `projects`, `skills`, `education` | Read from `profile.json`, so the resume is written once |
| `posts` | Blog posts |
| `courses` | Published courses from `content/courses` |

This is why the same content fits entirely different themes: content says *what* a block
is, and each theme decides *how* it looks. `src/components/BlockRenderer.astro` picks
`themes/<theme>/blocks/<Type>.astro` and falls back to `GenericBlock.astro`, so a theme
without a renderer for a new block type still works.

The build fails on invalid content: Zod validation, duplicate page slugs, or missing
required fields. Optional fields accept `null` and `""` because the admin panel writes those.

## Themes

Each theme is a folder with `Layout.astro`, a CSS file and `blocks/`. Each theme also has
**its own route files** (`src/pages/<theme>/[...slug].astro` and `blog/[post].astro`).
That is deliberate: Astro bundles CSS per route, and one shared `[theme]` route made every
page load all three themes' CSS.

URLs are `/<theme>/<slug>/`. `/` redirects to the theme the visitor used last, or the
default from `site.json`. Canonical URLs always point at the default theme.

Palettes are CSS custom properties (`--bg --surface --fg --muted --accent --accent-2
--border`) generated from `packages/tokens/palettes.json` and selected with
`html[data-palette]`. An inline script in `<head>` applies the saved palette before
first paint, so nothing flashes.

**Adding a theme:** add it to `THEMES` in `src/lib/content.ts`, add its palettes to
`palettes.json` and `defaultPalettes`, create `src/themes/<id>/`, copy the two route files,
and add it to the admin's `defaultTheme` options.

## The game

`packages/game` holds no theme knowledge. Themes only add data attributes:

| Attribute | Effect |
|---|---|
| `data-xp="15" data-xp-id="project:dohra"` | Clicking awards 15 XP, once per id |
| `data-game-end` | Reaching it awards `read:<page>` |
| `data-game-xp`, `-level`, `-level-name`, `-next`, `-progress`, `-achievements`, `-ach-count` | Filled in by the engine |
| `data-game-toggle`, `data-game-sound`, `data-game-reset` | Controls |
| `data-unlock-xp="60"` | Gets `data-locked` until the visitor has 60 XP |
| `.g-only` | Hidden when the visitor turns the game off |

**State is derived, never stored as totals.** Storage holds `events: { id: points }` and
`ach: { id: 1 }`. XP is the sum of event points plus achievement bonuses. Two states merge
by union, which is what makes cross-subdomain sync safe (see below). Each event can only
be awarded once, so reloading or re-clicking never inflates XP.

Event id prefixes: `visit:` `read:` `theme:` `palette:` `project:` `exp:` `contact:`
`terminal:` `secret:` `lesson:` `quiz:` `course:`. Achievement rules (`xp`, `event`,
`events` with a prefix and minimum, `all-of`, `all-pages`) are data in
`achievements.json`, editable in the admin. **Never change an achievement or event id
after publishing**, because visitors' progress is keyed by it.

**Cross-site progress.** `localStorage` is per origin, so the portfolio and `learn.`
have separate stores. When `site.json` sets `cookieDomain` (e.g. `.example.com`), state is
also mirrored to a cookie on the parent domain and merged on load. Cookies are capped near
4 KB; past that the mirror is skipped and each site keeps its own progress.
`cookieDomain` needs a domain that both sites share.

## Learn site

Starlight, with the collection loader pointed at `content/courses` instead of
`src/content/docs`. Two consequences, both handled in `apps/learn/astro.config.mjs`:

- Starlight's Markdown transforms (callouts, heading links) only run on allow-listed
  folders, so `markdown.processedDirs` includes `content/courses`.
- Sidebar `autogenerate` matches by path under `src/content/docs`, so it finds nothing.
  The sidebar is built explicitly from `course.json` chapters and each lesson's
  `sidebar.order`.

Courses with `"status": "draft"` are excluded by a negative glob. Lesson frontmatter
extends Starlight's schema with `difficulty`, `minutes`, `lab` and `quiz` (in
`src/content.config.ts`). The `Footer` override renders the quiz, "mark complete" and
course progress. The `ThemeSelect` override adds the XP chip and accent palettes. The
`Head` override adds the game config.

## Admin panel

[Sveltia CMS](https://github.com/sveltia/sveltia-cms) (pinned in
`apps/site/public/admin/index.html`) with the GitHub backend. Every save is a commit on
`main`, which triggers the deploy workflow. Sign-in uses a GitHub personal access token,
so no OAuth server is needed.

The config is **generated** (`src/pages/admin/config.yml.ts`) so that each chapter of
each course becomes its own "Lessons" section. A new chapter's section appears after the
deploy that adds the chapter. To add a block type, add it to the schema, to `blockTypes`
in the admin config, and optionally to each theme.

## Build and deploy

See [docs/DEPLOY.md](docs/DEPLOY.md). In short: GitHub Actions runs unit tests, builds,
runs browser tests, then rsyncs both `dist` folders to the always-free OCI VM
`n8n-runner`. There, Caddy serves them with automatic HTTPS. The deploy SSH key can only
rsync inside `/srv/portfolio`.

## Gotchas

- **Paths in build code:** bundled code cannot rely on `import.meta.url`. Learn-site
  helpers resolve from `process.cwd()`, which npm workspaces set to the app folder.
- **Stale renders:** Astro caches rendered Markdown in `.astro/` and
  `node_modules/.astro`. After changing Markdown plugins, delete them.
- **Node 22.23+** is required by Astro 7.
