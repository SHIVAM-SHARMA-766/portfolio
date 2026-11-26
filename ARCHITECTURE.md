# Architecture

A static site built from one content folder, a small Go API beside it, and a custom
admin panel. (The courses moved to their own project, [dev2ops learn](https://github.com/SHIVAM-SHARMA-766/dev2ops-learn), on 2026-11-26.) Content changes are Git commits; CI builds, tests and deploys
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
with the cover, the post page shows it on top, and it is the post's share image. Experience, projects, skills, education, certifications, languages,
awards and volunteering read from `profile.json` (one block type each; empty ones render nothing). Each theme renders each block
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
or ids are shared beyond a random per-connection id and colour.
Touch devices see counts but no cursors.

## API (`apps/api`)

| Route | Purpose |
|---|---|
| `GET /api/me` | signed-in user (or null), game state, shop, configured providers |
| `POST /api/events` | merge events (validated against the catalog) |
| `POST /api/shop/buy` | buy an item (per-user lock, 402 when short of coins) |
| `DELETE /api/me` | delete account and progress |
| `GET /api/auth/{provider}/start`, `/callback` | OAuth / OpenID Connect sign-in |
| `GET /api/live` | WebSocket presence and cursors |
| `POST /api/contact` | contact form → CRM inbox (+ optional email notice) |
| `POST /api/collect` | cookie-free analytics beacon (page view or event); always 204 |
| `/api/admin/*` | admin sign-in, stats and insights, inbox (messages), contacts (+CSV, stage, tags, notes, activity), content files, history and restore, deploy status |

- **Storage:** SQLite (WAL, one connection) at `/var/lib/portfolio-api/portfolio.db`:
  users, identities (one user can sign in with several providers; linked only on a
  verified matching email), sessions (only token hashes stored), events, achievements,
  purchases, page_views, messages, hits (analytics).
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

A Preact SPA styled like a CRM: a sidebar with icons, breadcrumbs, a **command palette**
(Ctrl/Cmd+K: screens, create actions, contacts, pages and posts), light and dark.

- **Dashboard** (`crm.jsx`): KPI cards with week-over-week deltas (online now, contacts,
  active contacts, views), 30-day charts for views and sign-ups, the pipeline by stage,
  recent contacts, content health (projects without a cover or story, no CV, no LinkedIn,
  few posts), live pages, top pages and the most common actions.
- **Contacts**: everyone who signed in. Stage tabs with counts, search (name, email,
  tag), starred filter, sortable columns, inline stage change, bulk move and CSV export.
  A contact's page has stage, star, tags, private notes and an **activity timeline**
  (every event, achievement and purchase, in plain words, grouped by day).
- **Profile** (`profile.jsx`), LinkedIn-style: Intro (name, headline, photo, CV, contact
  info), About, Experience (several positions per company, employment and location type,
  skills, clients), Education, Licenses & certifications (issuer, dates, credential, status),
  Projects, Skills, Languages, Honors & awards, Volunteering. Each section is a list of
  cards with + Add and ✏️ Edit; forms open in a side drawer with month pickers, "currently
  here" toggles and skill chips that suggest from the rest of the profile. Empty sections
  are hidden on the site.
- **Media while editing**: the Markdown editor's Image button uploads or picks from the
  library, and images pasted or dropped into the text upload and insert themselves; image
  fields upload directly. The Media library page lists, copies and deletes uploads.
- **Editing UX**: page and post editors put content in the main column and settings
  (URL, menu, SEO, date, tags, cover) in a side panel (`side:` on a field); a hidden
  `draft` field turns into Save draft / Publish / Update. A sticky bar shows status and
  unsaved changes. Blocks are added from a searchable picker (icon + description per type),
  inserted anywhere and duplicated. Pages and Blog are tables with status tabs, search and
  row actions (view, duplicate, delete). Confirmations and prompts are in-app dialogs
  (`ask`, `askText`); deleting a profile item offers Undo. After every save a publish
  tracker follows the GitHub Actions run until the change is live (or failed). `?` lists
  keyboard shortcuts. Blocks, list items and profile cards reorder by drag and drop (the
  ⋮⋮ handle; ↑↓ stay for keyboards).
- **Preview**: page and post editors can show the live page beside the form (desktop or
  phone width); it reloads by itself when a save goes live. The site's CSP allows framing
  by its own origin only (`frame-ancestors 'self'`), and the game skips the welcome card
  inside the frame.
- **History**: `GET /api/admin/history?path=` lists a file's commits (or all of
  `content/`), `POST /api/admin/restore {path, commit}` writes that version back as a new
  commit. Every editor has "Version history" (restore in one click), profile sections a
  History button, and the History screen lists all recent changes, from the admin or code.
- **Content**: schema-driven editors (`schemas.js` + `fields.jsx`): pages and blocks,
  projects and experience (each item its own editor inside `profile.json`), blog, courses
  → chapters → lessons, about & skills, media (multi-upload, drag and drop, delete), shop,
  missions, achievements, site settings. Image / file fields upload directly. Every editor
  has "View on site"; a deploy badge polls GitHub Actions after saves; unsaved changes are
  guarded.

CRM data lives in the API's SQLite (`crm`: stage, tags, star per user; `notes`), served by
`GET/PATCH /api/admin/visitors/{id}`, `POST/DELETE …/notes`, and `GET /api/admin/insights`.
Stages: new, contacted, engaged, opportunity, archived.

**Analytics** (package `internal/analytics`, store `analytics.go`). `components/Analytics.astro`
in the shared head sends one beacon per page load (`sendBeacon`, text/plain JSON) and on
clicks: CV (`site.resume` or any PDF), `mailto:`, copy-email, outbound links, and a sent
contact form. No cookies or storage. The API drops bots (user-agent pattern, empty UA),
`/admin` and `/api` paths, unknown events, and more than 300 hits per IP per 10 minutes.
Paths lose the query and any theme prefix. A visitor id is `sha256(salt, day, IP, UA)`; the
salt is random, kept only in memory and replaced daily, so ids can't be reversed or linked
across days, and "visitors" are counted per day. The first view of a visitor on a day is the
entry and keeps the source (utm_source / `?ref=`, else the referrer host, with common hosts
named: Google, LinkedIn, GitHub…) and utm_campaign. Views also bump `page_views` for the
dashboard. Hits are kept 400 days. The admin's Analytics screen (`GET /api/admin/analytics?days=1|7|30|90|365`)
shows visitors, views, pages per visit, bounce rate against the previous period, per-day
charts, goals, top and landing pages, sources, campaigns, outbound links, devices and
themes. Signing in to the admin sets `localStorage['pf.noTrack']` so your own visits on that
browser are not counted; the live preview iframe never counts.

**Contact form.** The `contact` block with `form: true` renders `components/ContactForm.astro`
in every theme. `POST /api/contact` (package `internal/contact`) validates name, email, topic
and message, and files the message in `messages` under the contact with the same email
(case-insensitive) or a new contact tagged `contact-form` (no sign-in identity). Spam
defences: the CORS origin check, a hidden honeypot field, a 3-second minimum fill time
(answered with "send again"; a filled honeypot gets a fake success and nothing is stored), 5 messages per IP per hour and 100 per day
overall. With `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (`SMTP_FROM`) and `NOTIFY_EMAIL` set, a
plain-text notice is mailed (STARTTLS, e.g. Gmail on port 587 with an app password;
headers are stripped of CR/LF). The admin's Inbox (`GET /api/admin/messages`,
`PATCH`/`DELETE /api/admin/messages/{id}`) shows them with an unread badge; the contact page
shows each person's messages.

## Learn site

Moved out to its own repository, [dev2ops-learn](https://github.com/SHIVAM-SHARMA-766/dev2ops-learn)
(served at `learn.dev2ops.in` from the same VM, with its own deploy user and Caddy file in
`/etc/caddy/sites/`). The portfolio only links to it (`site.learnUrl`). The main Caddyfile
imports `/etc/caddy/sites/*.caddy` so other projects on the host can add their sites.

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
