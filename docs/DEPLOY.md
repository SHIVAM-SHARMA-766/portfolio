# Deploy

| Piece | Where |
|---|---|
| Host | OCI always-free `n8n-runner` (VM.Standard.E2.1.Micro, ap-mumbai-1, `80.225.217.150`), dedicated to the portfolio |
| Web server | Caddy: static files, `/api/*` proxied to the API, automatic HTTPS (Let's Encrypt), capped at 150 MB RAM |
| API | `portfolio-api` systemd service (user `portfolio`, 120 MB cap, hardened), SQLite in `/var/lib/portfolio-api`, secrets in `/etc/portfolio-api/env` |
| Files | `/srv/portfolio/{site,learn,admin,api}`, owned by the `deploy` user |
| DNS | DuckDNS: `shivamsharma.duckdns.org` and `learn.shivamsharma.duckdns.org` (DuckDNS resolves every sub-name to the same IP) |
| Live | https://shivamsharma.duckdns.org · https://learn.shivamsharma.duckdns.org · admin at `/admin/` |
| Network | Terraform in the `infra` repo: a separate `n8n-web-nsg` opens 80/443 on this instance only |
| Pipeline | `.github/workflows/deploy.yml` |

The host runs `sshd`, Caddy and the API. n8n was removed on 2026-11-22; its final backup is in
`~/shivam/creds/backups/` on the owner's machine. Docker is installed but disabled.
The instance keeps its historical name `n8n-runner`, because renaming it in Terraform would
recreate the VM.

## Release pipeline

1. A push to `main` (from git or an admin save) starts the workflow.
2. JS unit tests, Go tests, build site/learn/admin, build the API binary, browser end-to-end tests against that binary. Any failure stops here; the live site is untouched.
3. rsync uploads the API binary first; a systemd path unit restarts the service when the file changes. Then admin, site and learn (`--delete --delay-updates`, so files swap in at the end).
4. A smoke test fetches the site, learn site, admin and `/api/health`.

Pull requests run steps 1–2 only.

## First-time setup

Run these once, in order. Values are filled in for the current host.

1. **Open the ports** (from the `infra` repo):
   ```sh
   cd ~/shivam/infra
   make plan STACK=oci     # expect: 3 to add, 1 to change (runner NSG list), 0 to destroy
   make apply STACK=oci
   ```
2. **DNS:** in the DuckDNS dashboard, create the name in `content/site.json` (`siteUrl`,
   currently `shivamsharma`) and point it at `80.225.217.150`. `learn.` works automatically.
3. **Deploy key** (used only by CI):
   ```sh
   ssh-keygen -t ed25519 -N '' -C portfolio-deploy -f ~/.ssh/portfolio-deploy
   ```
4. **Server** (from this repo; safe to re-run after any change to `deploy/`):
   ```sh
   cd ~/shivam/portfolio
   ./deploy/setup-server.sh
   ```
   Re-run it whenever `deploy/Caddyfile.tmpl` changes (e.g. the clean-URL theme routing).
   Installs Caddy and sqlite3, the restricted `deploy` user, firewall rules, the API service
   and its restart-on-upload unit, fail2ban for admin sign-in, daily database backups, and
   the Caddyfile. It generates `SESSION_SECRET` and moves an existing admin password and
   GitHub token from the old basic-auth setup.
5. **Secrets** (interactive; blank keeps the current value):
   ```sh
   ./deploy/secrets.sh
   ```
   Admin username/password, the GitHub content token (fine-grained, `portfolio` only,
   Contents: Read and write) and the sign-in providers' client IDs and secrets. It prints the
   callback URLs to register:
   `https://<site>/api/auth/{github,google,linkedin}/callback`.
   **Repository secrets** for CI (once):
   ```sh
   gh secret set DEPLOY_HOST --body 80.225.217.150
   gh secret set DEPLOY_SSH_KEY < ~/.ssh/portfolio-deploy
   ssh-keyscan -t ed25519 80.225.217.150 2>/dev/null | gh secret set DEPLOY_KNOWN_HOSTS
   ```
6. **Deploy:** `gh workflow run deploy.yml`, or push to `main`.

## Sign-in providers

| Provider | Where | Notes |
|---|---|---|
| GitHub | github.com/settings/developers → New OAuth App | Homepage = site URL; callback above |
| Google | console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (Web application) | Configure the consent screen (External, scopes: email, profile, openid). Basic scopes need no verification |
| LinkedIn | linkedin.com/developers/apps → your app → Products → *Sign In with LinkedIn using OpenID Connect* | Add the callback under Auth → Authorized redirect URLs |

Only providers with both an ID and a secret are shown to visitors.

## Changing the domain

Edit `siteUrl`, `learnUrl` and, if both share a parent domain you control,
`cookieDomain` in `content/site.json`. Re-run `deploy/setup-server.sh`, then push.

## Operations

```sh
ssh -i ~/.ssh/oci-n8n ubuntu@80.225.217.150
systemctl status caddy portfolio-api
journalctl -u portfolio-api -n 100    # API logs (sign-in errors, startup)
journalctl -u caddy -n 100            # certificate issuance, errors
sudo tail -f /var/log/caddy/access.log
sudo fail2ban-client status portfolio-admin          # admin sign-in bans
sudo fail2ban-client set portfolio-admin unbanip <ip>
ls /var/lib/portfolio-api/backups/   # daily SQLite backups, newest 14 kept
```

**Restore the database:** `sudo systemctl stop portfolio-api && sudo cp <backup>.db /var/lib/portfolio-api/portfolio.db && sudo chown portfolio: /var/lib/portfolio-api/portfolio.db && sudo systemctl start portfolio-api`.

**Rollback:** revert the commit on `main` (`git revert <sha> && git push`). The pipeline
rebuilds and redeploys the previous content.
