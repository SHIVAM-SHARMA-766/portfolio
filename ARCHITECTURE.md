# Architecture

Two static sites built from one content folder, a small Go API beside them, and a
custom admin panel. Content changes are Git commits; CI builds, tests and deploys
everything to one always-free OCI VM.

```
                       ┌──────────────── GitHub (repo = source of truth) ────────────────┐
 admin panel ──commit──►  content/  ──CI: test, build──►  site/  learn/  admin/  api binary
 (/admin, via API)     └──────────────────────────────────────────────────────────────────┘
                                                        │ rsync over SSH (rrsync-confined key)
                                                        ▼
                    OCI VM "n8n-runner": Caddy ── /srv/portfolio/{site,learn,admin}  (static)
                                          └── /api/* → portfolio-api (Go, 127.0.0.1:8787) → SQLite
```

## Repository layout

| Path | What it is |
|---|---|
| `content/` | **All content.** Pages, blog, courses, profile, site settings, shop, missions, achievements. The admin edits only this folder (plus `apps/site/public/uploads`). |
| `apps/site/` | Portfolio (Astro): three themes in `src/themes/<theme>/`, schema in `src/lib/schema.ts` |
| `apps/learn/` | Learn site (Astro Starlight), lessons read from `content/courses` |
| `apps/admin/` | Admin panel (Preact + Vite SPA, served at `/admin/`) |
| `apps/api/` | Go API: visitor sign-in, saved progress, coin shop, live presence, admin endpoints |
| `packages/game/` | Game engine (XP, levels, achievements), account sync, live cursors, shared dialogs, event-id helpers |
| `packages/tokens/` | Colour palettes |
| `scripts/build-game-data.mjs` | Generates the API's game catalog from content (see "Trust") |
| `tests/e2e.mjs` | Browser tests against the built sites **and** the real API binary |
| `deploy/` | Caddyfile template, server setup, secrets script |

## Content model

A page is `{ title, slug, order, inNav, draft, blocks: [...] }`. A block has a `type`
(`hero`, `text`, `stats`, `experience`, `projects`, `skills`, `education`, `contact`,
`cta`, `posts`, `courses`) and its own fields. Experience, projects, skills and education
read from `profile.json`, so the resume is written once. Each theme renders each block
type its own way. `BlockRenderer.astro` falls back to a generic renderer when a theme
lacks one. The build fails on invalid content (Zod), and optional fields accept `null`/`""`.

## Themes

Each theme has `Layout.astro`, a CSS file, `blocks/`, and its own route files
(`src/pages/<theme>/…`) so a page only loads that theme's CSS. URLs are
`/<theme>/<slug>/`; `/` redirects to the visitor's last theme. Palettes are CSS custom
properties from `packages/tokens/palettes.json`, applied before first paint.

## The game

**Engine (`packages/game/src/core.js`).** State is `events: {id: points}` plus
`ach: {id: 1}`. XP, level and achievements are derived from it, never stored as totals.
Two states merge by union, which is what makes guest → account merging and cross-tab
sync safe. Event ids are built with `packages/game/src/ids.js` everywhere.

**Coins.** Coins = XP − price of owned items. Buying never lowers XP or level. Shop items
(`content/shop.json`) are `theme:<id>` or `palette:<theme>-<id>`; anything not in the
shop is free. Terminal and Studio are free; Quest and some palettes cost coins.

**Accounts (`account.js`).** Guests play with progress in `localStorage`. Signing in
(GitHub / Google / LinkedIn) sends every guest event to the API, which merges and
returns the server state. Later awards sync in batches every ~1 s. Buying requires
sign-in. If the API is down the site silently stays in guest mode.

**Theme lock.** Quest pages are still static HTML (search engines, no-JS visitors); the
game layer shows an unlock overlay (`ThemeLock.astro`) when the visitor doesn't own it.

**Trust.** Clients can send anything, so the API accepts only event ids listed in the
**game catalog**: every page visit, read, project, lesson, quiz, terminal command, flag
and so on, generated from content by `scripts/build-game-data.mjs` and embedded in the
binary at build time. Points always come from the catalog, never from the client. Site
and API are built from the same commit, so they always agree. Known limit: whether a
visitor *really* did something (e.g. found a flag) is judged client-side; flags are
checked by SHA-256 in the page, so reading the bundle reveals hashes, not answers. For a
portfolio game that is the right trade-off.

**DOM contract.** Themes only add data attributes: `data-xp`/`data-xp-id` (award on
click), `data-game-*` (HUD), `data-game-coins`, `data-shop-item` (locks and prices),
`data-theme-lock`, `data-account-*`, `data-open-login`/`data-open-shop`, `data-live`,
`data-live-cursors`. See the header of `packages/game/src/dom.js`.

## Terminal game

`themes/terminal/fs.ts` builds a virtual filesystem from content at build time
(`about.md`, `experience/*.log`, `projects/<slug>/README.md`, `blog/`, `.secrets/`,
`contact.sh`…). `shell.ts` implements the shell (`ls -a`, `cd`, `cat`, `tree`,
`grep -r`, `decode`, `open`, `shop`, `buy`, `inventory`, `status`, `login`, `hack`…).
Missions (`content/missions.json`) are CTF flags placed by `kind`: `hidden-file`,
`base64`, `grep`, `port-scan` (a binary-search mini-game, 11 probes for 1024 ports) and
`page-source` (an HTML comment in every page). `submit FLAG{…}` checks the hash and awards
`flag:<id>`.

## Live presence

`GET /api/live` is a WebSocket (`apps/api/internal/live`). Clients join with their path
and send pointer moves at ≤ ~16/s as `x` = fraction of `<main>` width and `y` = px from
`<main>` top, so pointers land on the same content across window sizes. The server relays
moves only to others on the same path, sends `{site, page}` counts once a second when
something changed, and caps connections (500 total, 8 per IP, 20 moves/s each). No names
or ids are shared beyond a random per-connection id and colour. Joins also bump a daily
page-view counter for the admin dashboard. Touch devices see counts but no cursors.

## API (`apps/api`)

| Route | Purpose |
|---|---|
| `GET /api/me` | signed-in user (or null), game state, shop, configured providers |
| `POST /api/events` | merge events (validated against the catalog) |
| `POST /api/shop/buy` | buy an item (per-user lock, 402 when short of coins) |
| `DELETE /api/me` | delete account and progress |
| `GET /api/auth/{provider}/start`, `/callback` | OAuth / OpenID Connect sign-in |
| `GET /api/live` | WebSocket presence and cursors |
| `/api/admin/*` | admin sign-in, stats, visitors (+CSV), content files, deploy status |

- **Storage:** SQLite (WAL, one connection) at `/var/lib/portfolio-api/portfolio.db`:
  users, identities (one user can sign in with several providers; linked only on a
  verified matching email), sessions (only token hashes stored), events, achievements,
  purchases, page_views.
- **Sessions:** `pf_session` cookie on the parent domain (`cookieDomain`), HttpOnly,
  Secure, SameSite=Lax, 180 days. The learn subdomain calls the API with CORS + credentials.
- **CSRF:** state-changing requests must carry an allowed `Origin` (site or learn).
- **Admin:** username + bcrypt hash from the environment; `pf_admin` cookie scoped to
  `/api/admin`, SameSite=Strict, 12 h. Failed sign-ins are rate-limited in-app (5 per 10
  min per IP, successes don't count) and logged for fail2ban.
- **Content editing:** the admin reads and commits files through the GitHub contents API
  with a fine-grained token held by the API (paths restricted to `content/**` and
  `apps/site/public/uploads/*`). The commit triggers the normal deploy, so every admin
  change is versioned, reviewable and revertible, and an invalid edit fails the build
  instead of breaking the live site.
- **Config:** environment only (`internal/config`); `DEV=1` enables localhost origins,
  insecure cookies and `POST /api/dev/login` for tests. It is never set in production.

## Admin panel (`apps/admin`)

A schema-driven SPA: `schemas.js` describes every content file as fields, and
`fields.jsx` renders them (text, markdown with preview, lists, nested objects, page
blocks with add/reorder/remove). Screens: dashboard (online now, where people are,
views), visitors (search, CSV export, delete), pages, blog, courses → chapters → lessons
(with quiz editor), profile, media uploads, shop, missions, achievements, site & game
settings. A deploy badge polls GitHub Actions after saves. Unsaved changes are guarded
on navigation, Back and reload.

## Learn site

Starlight with its loader pointed at `content/courses`, so `markdown.processedDirs`
includes that folder (callouts) and the sidebar is built explicitly from `course.json`
chapters and lesson `sidebar.order` (autogenerate only sees `src/content/docs`). Overrides:
`Head` (game config), `ThemeSelect` (live count, sign-in, XP, palettes, dialogs),
`Footer` (quiz, mark complete, course progress).

## Build, test, deploy

See [docs/DEPLOY.md](docs/DEPLOY.md). CI runs JS unit tests, Go tests, builds all three
front-ends and the API (static `CGO_ENABLED=0` binary), then runs the browser suite
against the real binary. On `main` it rsyncs the API first (a systemd path unit restarts
it), then admin, site and learn.

## Gotchas

- `apps/api/internal/game/data/game-data.json` is generated (gitignored). Run
  `npm run game-data` before `go test` or `go build` (the npm scripts do it).
- Bundled build code can't rely on `import.meta.url`; learn-site helpers resolve from
  `process.cwd()` (npm workspaces set it to the app folder).
- Astro caches rendered Markdown in `.astro/` and `node_modules/.astro`; delete them after
  changing Markdown plugins.
- Node 22.23+ (Astro 7) and Go 1.26.
- **Never rename** an achievement id, mission id, shop item id or page slug after
  launch: saved progress and purchases are keyed by them.
