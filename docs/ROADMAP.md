# Roadmap

## Done (v1)

- Content model with block-based pages, validated at build time
- Three themes (Terminal, Quest, Studio) and twelve palettes
- Game engine: XP, levels, achievements (including secret ones), unlockable palettes, sound, recruiter "skip game" mode
- Interactive terminal with commands and tab completion
- Learn site: Docker course (4 chapters, 6 lessons), quizzes, progress, sidebar ticks, search
- Generated admin panel config: pages, blocks, blog, courses, per-chapter lessons, profile, settings, achievements
- Unit tests (game engine) and browser end-to-end tests
- CI/CD to the OCI runner with Caddy; live since 2026-11-22 at https://shivamsharma.duckdns.org and https://learn.shivamsharma.duckdns.org
- XP shared between both sites through a cookie on `.shivamsharma.duckdns.org`
- Go API: sign-in with Google/GitHub/LinkedIn, saved progress, coin shop, live presence and cursors
- Coin economy: Quest theme and extra palettes are bought with coins
- Terminal CTF: virtual filesystem and five missions
- Custom admin panel replacing Sveltia: dashboard, visitors (CSV), editors for all content, media
- Clean URLs (theme in a cookie), Studio default with Terminal and Quest for sale, theme-before-palette rule
- Refined shop (grouped, confirm step, previews), click ripple with +1 points, welcome card
- Portrait in every theme (crop, duotone + ASCII, pixel art)

## Next

| Item | Notes |
|---|---|
| Visitor survey | Optional short form after sign-in (deferred by the owner, 2026-11-22) |
| Off-host database backups | Daily SQLite copies stay on the VM today; push them to the OCI bucket |
| Leaderboard | Top players by XP, opt-in display names |
| PDF resume | Generate from `profile.json` at build time, so one edit updates site and PDF |
| GitHub sync | Daily scheduled build that pulls repo stars and releases into project cards |
| "How this site is built" page | Pipeline diagram, CI badges, Lighthouse scores |
| Ctrl+K command palette | Quick navigation in every theme |
| Discussion per lesson | Giscus (GitHub Discussions), free |
| More courses | Linux, Kubernetes, Terraform |
| Per-theme social preview images | Generated at build time |

## Later

| Item | Notes |
|---|---|
| Contact form | Cloudflare Worker → Telegram/email, no exposed address |
| Privacy-friendly analytics | Which projects and lessons get attention |
| Lighthouse CI and visual snapshots per theme × palette | Quality gates in the workflow |
| Admin previews | Custom preview templates in Sveltia per theme |

## Known limitations

- The admin's "Lessons" section for a newly added chapter appears after the next deploy, because the admin config is generated at build time.
- Guest progress is stored in the browser; sign in to keep it across devices.
- Whether a visitor really found a flag is checked in the browser (by hash); the API only checks that the event exists and assigns its points.
- New missions need a new `kind` in code to place their flag; the five kinds are editable data.
- Theme content is the same, but the Terminal theme's interactive shell has no equivalent in the other themes.
