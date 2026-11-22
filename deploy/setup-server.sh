#!/usr/bin/env bash
# Sets up (or updates) the web host. Safe to re-run; asks no questions.
#
#   ./deploy/setup-server.sh [ssh-target] [deploy-public-key-file]
#   defaults: ubuntu@80.225.217.150  ~/.ssh/portfolio-deploy.pub
#
# On the host it:
#   1. installs Caddy (official apt repo) and sqlite3
#   2. creates the `deploy` user, whose SSH key can only rsync inside /srv/portfolio
#   3. opens 80/443 in the host firewall (the OCI NSG is opened by Terraform)
#   4. installs the portfolio API as a systemd service running as `portfolio`,
#      restarted automatically when CI uploads a new binary
#   5. creates /etc/portfolio-api/env with a generated SESSION_SECRET, and moves
#      the admin password and GitHub token over from the old Caddy basic-auth setup
#   6. adds fail2ban for admin sign-in, and a daily database backup (14 kept)
#   7. writes the Caddyfile from deploy/Caddyfile.tmpl and reloads Caddy
#
# Secrets (admin password, GitHub token, sign-in providers): ./deploy/secrets.sh
set -euo pipefail

TARGET=${1:-ubuntu@80.225.217.150}
PUBKEY_FILE=${2:-$HOME/.ssh/portfolio-deploy.pub}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/oci-n8n}
cd "$(dirname "$0")/.."
. deploy/lib.sh

PUBKEY=$(cat "$PUBKEY_FILE")
CADDYFILE=$(render_caddyfile)
echo "Setting up $TARGET"

b64() { printf '%s' "$1" | base64 -w0; }
{
  echo "PUBKEY=\$(printf '%s' '$(b64 "$PUBKEY")' | base64 -d)"
  echo "CADDYFILE=\$(printf '%s' '$(b64 "$CADDYFILE")' | base64 -d)"
  cat <<'REMOTE'
set -euo pipefail
case "$PUBKEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-*) ;; *) echo "Not an SSH public key" >&2; exit 1 ;; esac

# 1. packages
if ! command -v caddy >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi
command -v sqlite3 >/dev/null || apt-get install -y -qq sqlite3
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nMemoryMax=150M\n' > /etc/systemd/system/caddy.service.d/limits.conf

# 2. deploy user: key restricted to rsync inside /srv/portfolio
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
mkdir -p /srv/portfolio/{site,learn,admin,api} /home/deploy/.ssh /var/log/caddy
echo "command=\"/usr/bin/rrsync /srv/portfolio\",restrict $PUBKEY" > /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh /srv/portfolio
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
chmod 755 /srv/portfolio /srv/portfolio/*

# 3. host firewall
for port in 80 443; do
  iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT "$(iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')" -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null; else iptables-save > /etc/iptables/rules.v4; fi

# 4. API service
id portfolio >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin portfolio
install -d -m 750 -o portfolio -g portfolio /var/lib/portfolio-api /var/lib/portfolio-api/backups /var/log/portfolio-api
install -d -m 750 -o root -g portfolio /etc/portfolio-api

cat > /etc/systemd/system/portfolio-api.service <<'UNIT'
[Unit]
Description=Portfolio API (sign-in, progress, shop, live presence, admin)
After=network-online.target
Wants=network-online.target
ConditionPathExists=/srv/portfolio/api/portfolio-api

[Service]
User=portfolio
Group=portfolio
EnvironmentFile=/etc/portfolio-api/env
ExecStart=/srv/portfolio/api/portfolio-api
Restart=always
RestartSec=3
MemoryMax=120M
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ReadWritePaths=/var/lib/portfolio-api /var/log/portfolio-api
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
UNIT

# Restart the API whenever CI uploads a new binary.
cat > /etc/systemd/system/portfolio-api-restart.path <<'UNIT'
[Unit]
Description=Restart the portfolio API when its binary changes

[Path]
PathChanged=/srv/portfolio/api/portfolio-api

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/portfolio-api-restart.service <<'UNIT'
[Unit]
Description=Restart the portfolio API

[Service]
Type=oneshot
ExecStart=/bin/systemctl restart portfolio-api.service
UNIT

# 5. environment file
ENVF=/etc/portfolio-api/env
touch "$ENVF"
setkey() { # setkey KEY VALUE — add or replace a line
  python3 - "$ENVF" "$1" "$2" <<'PY'
import sys
path, key, val = sys.argv[1:]
lines = [l for l in open(path).read().splitlines() if l and not l.startswith(key + "=")]
lines.append(f"{key}={val}")
open(path, "w").write("\n".join(lines) + "\n")
PY
}
getkey() { grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2- || true; }
[ -n "$(getkey SESSION_SECRET)" ] || setkey SESSION_SECRET "$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 48)"
setkey LISTEN 127.0.0.1:8787
setkey DB_PATH /var/lib/portfolio-api/portfolio.db
setkey AUTH_LOG /var/log/portfolio-api/auth.log
# Move admin credentials and the GitHub token from the old Caddy basic-auth setup.
if [ -f /etc/caddy/admin-auth.d/portfolio.caddy ] && [ -z "$(getkey ADMIN_PASS_HASH)" ]; then
  read -r OLD_USER OLD_HASH < <(awk '/basic_auth/ {getline; print $1, $2}' /etc/caddy/admin-auth.d/portfolio.caddy)
  [ -n "$OLD_USER" ] && setkey ADMIN_USER "$OLD_USER" && setkey ADMIN_PASS_HASH "$OLD_HASH" && echo "Moved admin login for '$OLD_USER'."
fi
if [ -f /etc/caddy/admin-auth/index.html ] && [ -z "$(getkey GITHUB_CONTENT_TOKEN)" ]; then
  OLD_TOKEN=$(grep -o "token: '[^']*'" /etc/caddy/admin-auth/index.html | cut -d"'" -f2 || true)
  [ -n "$OLD_TOKEN" ] && setkey GITHUB_CONTENT_TOKEN "$OLD_TOKEN" && echo "Moved the GitHub content token."
fi
chown root:portfolio "$ENVF" && chmod 640 "$ENVF"
# The old basic-auth setup is replaced by the API's own sign-in.
rm -rf /etc/caddy/admin-auth.d /etc/caddy/admin-auth /etc/fail2ban/jail.d/caddy-admin-auth.conf /etc/fail2ban/filter.d/caddy-admin-auth.conf

# 6. fail2ban for admin sign-in, and daily database backups
touch /var/log/portfolio-api/auth.log && chown portfolio:portfolio /var/log/portfolio-api/auth.log
cat > /etc/fail2ban/filter.d/portfolio-admin.conf <<'F2B'
[Definition]
failregex = admin-login-failed ip=<HOST>$
F2B
cat > /etc/fail2ban/jail.d/portfolio-admin.conf <<'F2B'
[portfolio-admin]
enabled  = true
port     = http,https
filter   = portfolio-admin
logpath  = /var/log/portfolio-api/auth.log
backend  = auto
maxretry = 5
findtime = 10m
bantime  = 1h
F2B
cat > /usr/local/bin/portfolio-db-backup <<'SH'
#!/bin/sh
# Consistent online copy of the SQLite database; keeps the newest 14.
set -eu
DIR=/var/lib/portfolio-api/backups
[ -f /var/lib/portfolio-api/portfolio.db ] || exit 0
sqlite3 /var/lib/portfolio-api/portfolio.db ".backup '$DIR/portfolio-$(date -u +%Y%m%d-%H%M%S).db'"
ls -1t "$DIR"/portfolio-*.db | tail -n +15 | xargs -r rm -f
SH
chmod 755 /usr/local/bin/portfolio-db-backup
cat > /etc/systemd/system/portfolio-db-backup.service <<'UNIT'
[Unit]
Description=Back up the portfolio database

[Service]
Type=oneshot
User=portfolio
ExecStart=/usr/local/bin/portfolio-db-backup
UNIT
cat > /etc/systemd/system/portfolio-db-backup.timer <<'UNIT'
[Unit]
Description=Daily portfolio database backup

[Timer]
OnCalendar=*-*-* 02:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now portfolio-api-restart.path portfolio-db-backup.timer >/dev/null
systemctl enable portfolio-api.service >/dev/null
[ -x /srv/portfolio/api/portfolio-api ] && systemctl restart portfolio-api.service || echo "API binary not uploaded yet; CI will start it."
systemctl reload fail2ban 2>/dev/null || systemctl restart fail2ban

# 7. Caddy
printf '%s\n' "$CADDYFILE" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
chown -R caddy:caddy /var/log/caddy
systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy
echo "caddy: $(systemctl is-active caddy) · api: $(systemctl is-active portfolio-api || true)"
echo "Host ready. Set or change secrets with ./deploy/secrets.sh"
REMOTE
} | ssh -i "$SSH_KEY" "$TARGET" sudo bash -s
