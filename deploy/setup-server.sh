#!/usr/bin/env bash
# One-time (and re-runnable) setup of the web host for the portfolio.
#
# Run from your machine, in the repo root:
#   ./deploy/setup-server.sh <ssh-target> <deploy-public-key-file>
#   ./deploy/setup-server.sh ubuntu@80.225.217.150 ~/.ssh/portfolio-deploy.pub
#
# What it does on the host (idempotent):
#   1. installs Caddy from its official apt repository
#   2. creates a `deploy` user whose SSH key can only rsync into /srv/portfolio
#   3. opens 80/443 in the host firewall (the OCI NSG is opened by Terraform)
#   4. writes /etc/caddy/Caddyfile from deploy/Caddyfile.tmpl and reloads Caddy
#
# Hostnames come from content/site.json (siteUrl, learnUrl).
set -euo pipefail

TARGET=${1:?usage: setup-server.sh <ssh-target> <deploy-public-key-file>}
PUBKEY_FILE=${2:?usage: setup-server.sh <ssh-target> <deploy-public-key-file>}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/oci-n8n}
cd "$(dirname "$0")/.."

host_of() { node -e "console.log(new URL(require('./content/site.json')['$1']).host)"; }
SITE_HOST=$(host_of siteUrl)
LEARN_HOST=$(host_of learnUrl)
ACME_EMAIL=$(node -e "console.log(require('./content/site.json').email || '')")
PUBKEY=$(cat "$PUBKEY_FILE")

CADDYFILE=$(sed -e "s/__SITE_HOST__/$SITE_HOST/" -e "s/__LEARN_HOST__/$LEARN_HOST/" -e "s/__ACME_EMAIL__/$ACME_EMAIL/" deploy/Caddyfile.tmpl)

echo "Setting up $TARGET for $SITE_HOST and $LEARN_HOST"

# Values travel base64-encoded so no quoting can break them.
ssh -i "$SSH_KEY" "$TARGET" sudo bash -s -- "$(printf '%s' "$PUBKEY" | base64 -w0)" "$(printf '%s' "$CADDYFILE" | base64 -w0)" <<'REMOTE'
set -euo pipefail
PUBKEY=$(printf '%s' "$1" | base64 -d)
CADDYFILE=$(printf '%s' "$2" | base64 -d)
case "$PUBKEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-*) ;; *) echo "Not an SSH public key" >&2; exit 1 ;; esac

# 1. Caddy
if ! command -v caddy >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi
# Keep Caddy bounded on a 1 GB host.
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/limits.conf <<'UNIT'
[Service]
MemoryMax=150M
UNIT
systemctl daemon-reload

# 2. Deploy user: key restricted to rsync inside /srv/portfolio
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
mkdir -p /srv/portfolio/site /srv/portfolio/learn /home/deploy/.ssh /var/log/caddy
chown -R deploy:deploy /srv/portfolio
chmod 755 /srv/portfolio /srv/portfolio/site /srv/portfolio/learn
echo "command=\"/usr/bin/rrsync /srv/portfolio\",restrict $PUBKEY" > /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
[ -f /srv/portfolio/site/index.html ] || echo '<!doctype html><title>Coming soon</title><p>Deploying…</p>' > /srv/portfolio/site/index.html
[ -f /srv/portfolio/learn/index.html ] || cp /srv/portfolio/site/index.html /srv/portfolio/learn/index.html
chown -R deploy:deploy /srv/portfolio

# 3. Host firewall: insert before the final REJECT, then persist
for port in 80 443; do
  iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT "$(iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')" -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null; else iptables-save > /etc/iptables/rules.v4; fi

# 4. Caddyfile
printf '%s\n' "$CADDYFILE" > /etc/caddy/Caddyfile
chown -R caddy:caddy /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy >/dev/null
systemctl restart caddy
systemctl is-active caddy
echo "Host ready."
REMOTE
