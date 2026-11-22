# Portfolio

The personal site of Shivam Sharma: a portfolio that plays like a game, written once and
rendered in three entirely different themes, with a learning site for free courses beside it.

- **Portfolio** at the site root: home, about, experience, projects, blog and contact
- **Learn** at `learn.` on the same domain: courses → chapters → lessons, with quizzes and progress

## Highlights

- **Three themes, one content model.** *Terminal* is an interactive hacker shell you can type into. *Quest* is a pixel RPG with a world map and quest board. *Studio* is a clean editorial layout for recruiters. Every page works in every theme, and visitors switch with one click.
- **Twelve colour palettes**, four per theme, switched instantly and remembered per visitor.
- **A points game.** Visiting pages, opening projects, running terminal commands, trying themes, finishing lessons and passing quizzes all earn XP. Visitors level up, unlock achievements (some secret) and unlock palettes. Recruiters can turn the game off with one click.
- **An admin panel at `/admin/`.** Add, edit, reorder and delete pages built from blocks, plus blog posts, courses, chapters, lessons, quizzes, your profile, the game's levels and achievements. Every save is a Git commit that deploys itself.
- **Courses with real structure.** Search, sidebar, prev/next, callouts, code highlighting, a quiz per lesson, "mark complete", per-course progress and "continue where you left off".
- **Static and fast.** Plain HTML/CSS with a little JavaScript, served by Caddy with automatic HTTPS, at zero cost.

## Quick start

```sh
nvm use                 # Node 22.23+
npm install
npm run dev             # portfolio at http://localhost:4321
npm run dev:learn       # learn site at http://localhost:4322
```

| Command | Does |
|---|---|
| `npm run build` | Build both sites into `apps/*/dist` |
| `npm test` | Unit tests for the game engine |
| `npm run test:e2e` | Browser tests against the built sites (needs Chromium; set `CHROME_PATH`) |

## Editing content

Use the admin panel at `https://<your-domain>/admin/`. Sign in with a GitHub personal
access token that has *Contents: read and write* on this repository. In Chrome or Edge you can also choose
**Work with Local Repository** to edit this folder directly, without signing in.

Or edit the files in [`content/`](content/) directly. The build validates everything and
fails with a clear message if something is wrong.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): how it fits together, and how to add a theme, block, course or achievement
- [docs/DEPLOY.md](docs/DEPLOY.md): hosting, first-time server setup and the release pipeline
- [docs/ROADMAP.md](docs/ROADMAP.md): what's next
