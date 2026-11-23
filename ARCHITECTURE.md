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
(`banner`, `cards`, `hero`, `text`, `stats`, `experience`, `projects`, `skills`,
`education`, `contact`, `cta`, `posts`, `courses`) and its own fields. Every inner page
starts with a `banner` (eyebrow, heading, text, optional image, tags, buttons, back link);
`cards` is a grid of cards (image or generated cover, meta, badge, tags, link).

**Detail pages.** `src/lib/details.ts` turns `profile.json` into pages made of those
blocks: `/<projects page>/<project>/` (+ `/<sub-page>/` for each entry in the project's
`pages`), `/<experience page>/<company>/` and `/<experience page>/<company>/<engagement>/`
(+ sub-pages). They are added to each theme's catch-all route (`lib/routes.ts`), highlight
their parent in the menu, and appear in the sitemap. Projects and engagements take
optional `cover`, `summary`, `body` (markdown) and `pages`. The projects and experience
blocks render cards linking there; opening a card awards the `project:` / `exp:` event,
so the game catalog is unchanged. Detail pages have no page id (no visit/read XP).
The banner image (project cover) is also the page's share image.

**Blog covers.** Posts take optional `cover` / `coverAlt`; the posts block renders cards
with the cover, the post page shows it on top, and it is the post's share image. Experience, projects, skills and education
read from `profile.json`, so the resume is written once. Each theme renders each block
type its own way. `BlockRenderer.astro` falls back to a generic renderer when a theme
lacks one. The build fails on invalid content (Zod), and optional fields accept `null`/`""`.

## Themes

Each theme has `Layout.astro`, a CSS file, `blocks/`, and its own route files
(`src/pages/<theme>/…`) so a page only loads that theme's CSS. Palettes are CSS custom
properties from `packages/tokens/palettes.json`, applied before first paint.

**Clean URLs.** Public URLs carry no theme (`/about/`). Each theme is built to
`dist/<theme>/…`; the visitor's theme lives in the `pf_theme` cookie and Caddy serves
`/<theme>/<path>` internally (`deploy/Caddyfile.tmpl`). `?theme=<name>` sets the cookie
and redirects back to the clean URL (works without JavaScript); old `/<theme>/…` links
301 to the clean path. The same rules live in `scripts/theme-routing.mjs` for the Astro
dev server and the e2e tests. Studio is the default. After the build,
`scripts/copy-default-theme.mjs` also copies the default theme to the site root, so clean
URLs work on a host without the routing.

**Portrait.** `site.json` `photo` (+ `photoAlt`, `photoPosition` as an `object-position`
crop focus) and optional `photoCutout`: the same portrait with the background removed
(transparent WebP/PNG). With a cut-out every theme shows it plainly on a soft tile in
its own style (Studio: rounded tile with an accent tint; Terminal: panel with a thin
accent frame; Quest: accent tile inside the pixel frame, plus a face crop as the HUD
avatar). `cat portrait.jpg` renders it as ASCII (transparent pixels blank). Without a
cut-out the photo is cropped with `photoPosition`. A missing file falls back to initials
at build time.

**Logo.** `components/Logo.astro`: a bold "S" with an accent dot on a rounded tile,
coloured by `--logo-bg/--logo-fg/--logo-dot` per theme. Brand files (SVG, PNG,
wordmarks) live in `brand/`; `public/favicon.svg` and `public/images/apple-touch-icon.png`
are copies.

**Shared bits.** `components/FooterColumns.astro` (Explore: the menu; Connect: email,
socials, CV when `site.resume` is set; More: learn, RSS, privacy) in every theme's footer,
next to the logo, tagline and a "say hello" link; `components/CopyEmail.astro` next to the address on
the contact page. Headers show only the logo, and the signed-in chip only the avatar (or
an initial), with the name as its label. `src/pages/404.astro` is one neutral page for
all themes (light/dark by system). `sitemap.xml` and `robots.txt` are endpoints listing
clean URLs only.

## The game

**Engine (`packages/game/src/core.js`).** State is `events: {id: points}` plus
`ach: {id: 1}`. XP, level and achievements are derived from it, never stored as totals.
Two states merge by union, which is what makes guest → account merging and cross-tab
sync safe. Event ids are built with `packages/game/src/ids.js` everywhere.

**Coins.** Coins = XP − price of owned items. Buying never lowers XP or level. Shop items
(`content/shop.json`) are `theme:<id>` or `palette:<theme>-<id>`; anything not in the
shop is free. Studio is free; Terminal and Quest and some palettes cost coins. A palette
of a paid theme **requires that theme** first (`packages/game/src/shop.js` derives it; the
API enforces it with 409). Buying is a two-step confirm. Locked controls open the shop at
that item; a locked theme gets a 90-second preview per session, then an unlock screen.

**Clicks.** Every click ripples (theme-styled); the first `clickCap` clicks (100) earn a
point each as `click:1…click:100` catalog events, throttled to one per 300 ms. Points are
awarded on `click`, not `pointerdown`: markup only re-renders when it changed, but the
new coin total changes buy-button text, and re-creating a button between pointerdown and
click would swallow the click.

**Always on.** The game is part of the site: there is no off switch (an old saved
"game off" preference is cleared).

**First visit.** A welcome card explains the game (one "Let's go" button). Until it is
dismissed, game toasts are held (XP toasts dropped since the HUD shows the total; achievements shown after). On
phones the welcome card and toasts come in from the top, because the bottom belongs to
the theme preview bar. The live count hides itself when there is no connection.

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
`flag:<id>`. The shell only scrolls to follow its output after the visitor's first
command, so the boot lines never pull the page away from the top on load.

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
blocks with add/reorder/remove, and **image / file fields** that upload straight to
`apps/site/public/uploads/`, pick from what's uploaded, or take a path/URL). Screens:
dashboard (quick actions, online now, where people are, views), visitors (search, CSV
export, delete), pages and blog (titles, URLs, draft badges, view-on-site links),
**projects** and **experience** (one card per project / role with cover, badges for
missing cover or story, reorder; each opens its own editor, all saved into
`profile.json`), courses → chapters → lessons (with quiz editor), about & skills, media
(multi-upload, drag and drop, copy path or Markdown, delete), shop, missions,
achievements, site & game settings. Every editor has "View on site". A deploy badge polls
GitHub Actions after saves. Unsaved changes are guarded on navigation, Back and reload.

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
