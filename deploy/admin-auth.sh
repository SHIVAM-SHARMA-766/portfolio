#!/usr/bin/env bash
# Username/password sign-in for the admin panel. Re-run to change the password or token.
#
#   ./deploy/admin-auth.sh [ssh-target]        (default: ubuntu@80.225.217.150)
#
# How it works: the admin's "Sign in" button opens /admin-auth/ in a popup.
# Caddy protects that path with basic auth (bcrypt). After a correct username and
# password, the page hands the admin a GitHub token that is stored only on the
# server, using the same popup handshake that Decap/Sveltia OAuth servers use.
# fail2ban bans an IP for an hour after 5 wrong passwords in 10 minutes.
#
# The token should be a fine-grained GitHub token limited to this repository with
# "Contents: Read and write" and nothing else. Commits made in the admin are
# attributed to the token's owner.
set -euo pipefail

TARGET=${1:-ubuntu@80.225.217.150}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/oci-n8n}
REPO=SHIVAM-SHARMA-766/portfolio
cd "$(dirname "$0")/.."
. deploy/lib.sh
SITE_URL=$(node -p "require('./content/site.json').siteUrl.replace(/\/$/, '')")

read -rp "Admin username: " ADMIN_USER
[[ "$ADMIN_USER" =~ ^[A-Za-z0-9_.-]{3,32}$ ]] || { echo "Use 3-32 letters, digits, dot, dash or underscore." >&2; exit 1; }
read -rsp "Admin password (at least 12 characters): " ADMIN_PASS; echo
[ "${#ADMIN_PASS}" -ge 12 ] || { echo "Password too short." >&2; exit 1; }
read -rsp "Repeat password: " ADMIN_PASS2; echo
[ "$ADMIN_PASS" = "$ADMIN_PASS2" ] || { echo "Passwords do not match." >&2; exit 1; }
read -rsp "GitHub fine-grained token (Contents: Read and write on $REPO): " GH_TOKEN; echo

echo "Checking the token…"
PUSH=$(curl -fsS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).permissions?.push===true))") \
  || { echo "The token cannot read $REPO." >&2; exit 1; }
[ "$PUSH" = "true" ] || { echo "The token cannot write to $REPO (needs Contents: Read and write)." >&2; exit 1; }

b64() { printf '%s' "$1" | base64 -w0; }

# Secrets travel inside the script on stdin, never as command-line arguments.
{
  echo "ADMIN_USER=\$(printf '%s' '$(b64 "$ADMIN_USER")' | base64 -d)"
  echo "ADMIN_PASS=\$(printf '%s' '$(b64 "$ADMIN_PASS")' | base64 -d)"
  echo "GH_TOKEN=\$(printf '%s' '$(b64 "$GH_TOKEN")' | base64 -d)"
  echo "SITE_URL='$SITE_URL'"
  echo "CADDYFILE=\$(printf '%s' '$(b64 "$(render_caddyfile)")' | base64 -d)"
  cat <<'REMOTE'
set -euo pipefail
HASH=$(printf '%s\n' "$ADMIN_PASS" | caddy hash-password)
install -d -m 750 -o root -g caddy /etc/caddy/admin-auth.d /etc/caddy/admin-auth

cat > /etc/caddy/admin-auth.d/portfolio.caddy <<CADDY
# Sveltia requests /admin-auth (no slash) with a query string; serve the one page for any path under it.
handle /admin-auth* {
	basic_auth {
		$ADMIN_USER $HASH
	}
	root * /etc/caddy/admin-auth
	rewrite * /index.html
	file_server
	header Cache-Control "no-store"
	header Content-Security-Policy "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'none'"
}
CADDY

TOKEN_JSON=$(printf '%s' "$GH_TOKEN" | sed 's/[^A-Za-z0-9_]//g')
cat > /etc/caddy/admin-auth/index.html <<HTML
<!doctype html><meta charset="utf-8"><title>Signing in…</title>
<p>Signing in…</p>
<script>
(function () {
  var origin = '$SITE_URL';
  if (!window.opener) { document.body.textContent = 'Open this from the admin panel.'; return; }
  window.addEventListener('message', function (e) {
    if (e.origin !== origin) return;
    window.opener.postMessage('authorization:github:success:' + JSON.stringify({ token: '$TOKEN_JSON', provider: 'github' }), origin);
    setTimeout(function () { window.close(); }, 300);
  });
  window.opener.postMessage('authorizing:github', origin);
})();
</script>
HTML
chown root:caddy /etc/caddy/admin-auth.d/portfolio.caddy /etc/caddy/admin-auth/index.html
chmod 640 /etc/caddy/admin-auth.d/portfolio.caddy /etc/caddy/admin-auth/index.html

# Ban repeated wrong passwords. Only requests that sent credentials count, so
# the browser's first unauthenticated request (also a 401) never bans anyone.
cat > /etc/fail2ban/filter.d/caddy-admin-auth.conf <<'F2B'
[Definition]
failregex = "remote_ip":"<HOST>".*"uri":"/admin-auth[^"]*".*"Authorization":\["REDACTED"\].*"status":401
datepattern = "ts":{EPOCH}
F2B
cat > /etc/fail2ban/jail.d/caddy-admin-auth.conf <<'F2B'
[caddy-admin-auth]
enabled  = true
port     = http,https
filter   = caddy-admin-auth
logpath  = /var/log/caddy/access.log
backend  = auto
maxretry = 5
findtime = 10m
bantime  = 1h
F2B

# Make sure the live Caddyfile has the admin-auth import (older setups lack it)
printf '%s\n' "$CADDYFILE" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
chown -R caddy:caddy /var/log/caddy
systemctl reload caddy
systemctl reload fail2ban || systemctl restart fail2ban
echo "Admin sign-in ready for user '$ADMIN_USER'."
REMOTE
} | ssh -i "$SSH_KEY" "$TARGET" sudo bash -s
