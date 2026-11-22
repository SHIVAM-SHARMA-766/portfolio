# Roadmap

## Done (v1)

- Content model with block-based pages, validated at build time
- Three themes (Terminal, Quest, Studio) and twelve palettes
- Game engine: XP, levels, achievements (including secret ones), unlockable palettes, sound, recruiter "skip game" mode
- Interactive terminal with commands and tab completion
- Learn site: Docker course (4 chapters, 6 lessons), quizzes, progress, sidebar ticks, search
- Generated admin panel config: pages, blocks, blog, courses, per-chapter lessons, profile, settings, achievements
- Unit tests (game engine) and browser end-to-end tests
- CI/CD to the OCI runner with Caddy

## Next

| Item | Notes |
|---|---|
| Go live | Terraform apply, DuckDNS name, server setup, secrets (see DEPLOY.md) |
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
| Global leaderboard / guestbook | Small API; would need persistence and moderation |
| Privacy-friendly analytics | Which projects and lessons get attention |
| Shared XP across subdomains | Needs `cookieDomain`; works on DuckDNS or a custom domain |
| Lighthouse CI and visual snapshots per theme × palette | Quality gates in the workflow |
| Admin previews | Custom preview templates in Sveltia per theme |

## Known limitations

- The admin's "Lessons" section for a newly added chapter appears after the next deploy, because the admin config is generated at build time.
- Progress is stored in the visitor's browser. Clearing site data or switching device resets it.
- Theme content is the same, but the Terminal theme's interactive shell has no equivalent in the other themes.
