# Deploy

| Piece | Where |
|---|---|
| Host | OCI always-free `n8n-runner` (VM.Standard.E2.1.Micro, ap-mumbai-1, `80.225.217.150`), dedicated to the portfolio |
| Web server | Caddy, static files only, automatic HTTPS (Let's Encrypt), capped at 150 MB RAM |
| Files | `/srv/portfolio/site`, `/srv/portfolio/learn`, owned by the `deploy` user |
| DNS | DuckDNS: `<name>.duckdns.org` and `learn.<name>.duckdns.org` (DuckDNS resolves every sub-name to the same IP) |
| Network | Terraform in the `infra` repo: a separate `n8n-web-nsg` opens 80/443 on this instance only |
| Pipeline | `.github/workflows/deploy.yml` |

The host runs only `sshd` and Caddy. n8n was removed on 2026-11-22; its final backup is in
`~/shivam/creds/backups/` on the owner's machine. Docker is installed but disabled.
The instance keeps its historical name `n8n-runner`, because renaming it in Terraform would
recreate the VM.

## Release pipeline

1. A push to `main` (from git or from an admin-panel save) starts the workflow.
2. `npm ci`, unit tests, build both sites, browser end-to-end tests. Any failure stops here, and the live site is untouched.
3. `rsync --delete --delay-updates` uploads each `dist` folder. Files are swapped in at the end of each transfer, so visitors don't see a half-uploaded site.
4. A smoke test fetches both live URLs.

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
4. **Server** (from this repo):
   ```sh
   cd ~/shivam/portfolio
   ./deploy/setup-server.sh ubuntu@80.225.217.150 ~/.ssh/portfolio-deploy.pub
   ```
   Installs Caddy, creates the restricted `deploy` user, opens 80/443 in the host firewall and
   writes the Caddyfile. It is safe to re-run, and you must re-run it after changing `siteUrl`
   or `learnUrl`.
5. **Repository secrets** (from this repo):
   ```sh
   cd ~/shivam/portfolio
   gh secret set DEPLOY_HOST --body 80.225.217.150
   gh secret set DEPLOY_SSH_KEY < ~/.ssh/portfolio-deploy
   ssh-keyscan -t ed25519 80.225.217.150 2>/dev/null | gh secret set DEPLOY_KNOWN_HOSTS
   ```
6. **Deploy:** `gh workflow run deploy.yml`, or push to `main`.

## Changing the domain

Edit `siteUrl`, `learnUrl` and, if both share a parent domain you control,
`cookieDomain` in `content/site.json`. Re-run `deploy/setup-server.sh`, then push.

## Operations

```sh
ssh -i ~/.ssh/oci-n8n ubuntu@80.225.217.150
systemctl status caddy
journalctl -u caddy -n 100            # certificate issuance, errors
sudo tail -f /var/log/caddy/access.log
```

**Rollback:** revert the commit on `main` (`git revert <sha> && git push`). The pipeline
rebuilds and redeploys the previous content.
