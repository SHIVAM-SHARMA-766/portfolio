# Portfolio

The personal site of Shivam Sharma: a portfolio that plays like a game, written once and
rendered in three entirely different themes, with a learning site for free courses beside it.

- **Portfolio** at the site root: home, about, experience, projects, blog and contact
- **Learn** at `learn.` on the same domain: courses → chapters → lessons, with quizzes and progress

## Highlights

- **Three themes, one content model, clean URLs.** *Studio* (default) is a clean editorial layout for recruiters. *Terminal* is a real shell to explore. *Quest* is a pixel RPG with a world map and quest board. Every page works in every theme at the same address, like `/about/`.
- **A game with an economy.** Clicking around, visiting pages, opening projects, running commands, finishing lessons and capturing flags earn XP and coins, with a ripple and +1 on every click. Spend coins to unlock the Terminal and Quest themes, then their extra palettes. Locked themes can be previewed for free. Levels, achievements (some secret) and a one-click "skip the game" for recruiters.
- **A terminal CTF.** Explore a filesystem built from the portfolio (`ls -a`, `cat`, `grep -r`, `tree`), find five flags hidden in dotfiles, base64, logs, page source and a port-scan mini-game, and `submit` them.
- **Accounts.** Visitors sign in with Google, GitHub or LinkedIn to save progress across devices; everything earned as a guest comes along. They can delete their account at any time.
- **Live presence.** See how many people are online and on the same page, with their pointers moving in real time, anonymously.
- **Learn site** at `learn.`: courses → chapters → lessons with quizzes, progress and search.
- **Custom admin panel** at `/admin/`: a dashboard of who's online and where, the list of signed-up visitors (with CSV export), and editors for pages and blocks, blog, courses and lessons, profile, media, shop, missions, achievements and settings. Every save is a Git commit that deploys itself in about a minute.
- **Zero cost.** Static sites plus a single Go binary and SQLite on an always-free VM, served by Caddy with automatic HTTPS.

## Quick start

```sh
nvm use                 # Node 22.23+
npm install
npm run dev             # portfolio at http://localhost:4321
npm run dev:learn       # learn site at http://localhost:4322
```

| Command | Does |
|---|---|
| `npm run build` | Generate game data, build site, learn and admin into `apps/*/dist` |
| `npm run build:api` | Build the API binary into `dist/portfolio-api` (needs Go 1.26) |
| `npm test` / `npm run test:api` | Game-engine unit tests / Go API tests |
| `npm run test:e2e` | Browser tests of everything against the real API (needs Chromium; `CHROME_PATH`) |
| `npm run dev:admin` | Admin panel dev server (expects the API on 127.0.0.1:8787) |

## Editing content

Open `https://<your-domain>/admin/` and sign in with the admin username and password
(set with `deploy/secrets.sh`). Saving commits to GitHub; the deploy badge in the admin
shows when the change is live. If a change is invalid the build fails and the live site
stays as it was. You can also edit [`content/`](content/) directly and push.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): how it fits together, and how to add a theme, block, course or achievement
- [docs/DEPLOY.md](docs/DEPLOY.md): hosting, first-time server setup and the release pipeline
- [docs/ROADMAP.md](docs/ROADMAP.md): what's next
