#!/usr/bin/env bash
# Sets the API's secrets on the host. Every prompt can be left blank to keep the
# current value. Secrets travel over SSH on stdin and are stored only in
# /etc/portfolio-api/env (root:portfolio, 0640).
#
#   ./deploy/secrets.sh [ssh-target]       (default: ubuntu@80.225.217.150)
#
# Sign-in providers: create an OAuth app on each and use these callback URLs
# (shown again when the script runs):
#   GitHub    https://github.com/settings/developers → New OAuth App
#   Google    https://console.cloud.google.com/apis/credentials → OAuth client ID (Web)
#   LinkedIn  https://www.linkedin.com/developers/apps → Products: "Sign In with LinkedIn using OpenID Connect"
set -euo pipefail

TARGET=${1:-ubuntu@80.225.217.150}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/oci-n8n}
REPO=SHIVAM-SHARMA-766/portfolio
cd "$(dirname "$0")/.."
SITE=$(node -p "require('./content/site.json').siteUrl.replace(/\/$/, '')")

declare -A SET=()
ask() { # ask VAR "Prompt" [secret]
  local v
  if [ "${3:-}" = secret ]; then read -rsp "$2: " v; echo; else read -rp "$2: " v; fi
  [ -n "$v" ] && SET[$1]="$v"
  return 0
}

echo "== Admin sign-in (blank keeps the current one)"
ask ADMIN_USER "Admin username"
read -rsp "New admin password (12+ characters, blank to keep): " PASS; echo
if [ -n "$PASS" ]; then
  [ "${#PASS}" -ge 12 ] || { echo "Password too short." >&2; exit 1; }
  read -rsp "Repeat password: " PASS2; echo
  [ "$PASS" = "$PASS2" ] || { echo "Passwords do not match." >&2; exit 1; }
fi

echo
echo "== GitHub token for saving content (fine-grained: repository $REPO only, Contents: Read and write)"
ask GITHUB_CONTENT_TOKEN "Token" secret
if [ -n "${SET[GITHUB_CONTENT_TOKEN]:-}" ]; then
  PUSH=$(curl -fsS -H "Authorization: Bearer ${SET[GITHUB_CONTENT_TOKEN]}" "https://api.github.com/repos/$REPO" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).permissions?.push===true))") || PUSH=false
  [ "$PUSH" = true ] || { echo "That token cannot write to $REPO." >&2; exit 1; }
fi

echo
echo "== Visitor sign-in providers (blank skips). Callback URLs:"
for p in github google linkedin; do echo "   $p: $SITE/api/auth/$p/callback"; done
for p in GITHUB GOOGLE LINKEDIN; do
  ask "OAUTH_${p}_ID" "$p client ID"
  [ -n "${SET[OAUTH_${p}_ID]:-}" ] && ask "OAUTH_${p}_SECRET" "$p client secret" secret
done

echo
echo "== Contact-form email notices (optional; blank skips — messages still reach the admin Inbox)"
echo "   e.g. Gmail: host smtp.gmail.com:587, user = your Gmail, password = an app password"
ask SMTP_HOST "SMTP host:port"
if [ -n "${SET[SMTP_HOST]:-}" ]; then
  ask SMTP_USER "SMTP username"
  ask SMTP_PASS "SMTP password" secret
  ask NOTIFY_EMAIL "Send notices to (email)"
fi

b64() { printf '%s' "$1" | base64 -w0; }
{
  echo "declare -A SET=()"
  for k in "${!SET[@]}"; do echo "SET[$k]=\$(printf '%s' '$(b64 "${SET[$k]}")' | base64 -d)"; done
  [ -n "$PASS" ] && echo "PASS=\$(printf '%s' '$(b64 "$PASS")' | base64 -d)" || echo "PASS="
  cat <<'REMOTE'
set -euo pipefail
ENVF=/etc/portfolio-api/env
[ -f "$ENVF" ] || { echo "Run deploy/setup-server.sh first." >&2; exit 1; }
[ -n "$PASS" ] && SET[ADMIN_PASS_HASH]=$(printf '%s\n' "$PASS" | caddy hash-password)
for k in "${!SET[@]}"; do
  python3 - "$ENVF" "$k" "${SET[$k]}" <<'PY'
import sys
path, key, val = sys.argv[1:]
lines = [l for l in open(path).read().splitlines() if l and not l.startswith(key + "=")]
lines.append(f"{key}={val}")
open(path, "w").write("\n".join(lines) + "\n")
PY
done
chown root:portfolio "$ENVF" && chmod 640 "$ENVF"
systemctl restart portfolio-api.service 2>/dev/null || true
sleep 1
echo "Updated: ${!SET[*]}"
echo "api: $(systemctl is-active portfolio-api || true)"
REMOTE
} | ssh -i "$SSH_KEY" "$TARGET" sudo bash -s
