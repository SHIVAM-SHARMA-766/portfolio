# Shared helpers for deploy scripts. Source from the repo root.

# Render deploy/Caddyfile.tmpl with hostnames from content/site.json.
render_caddyfile() {
  local site learn email
  site=$(node -e "console.log(new URL(require('./content/site.json').siteUrl).host)")
  learn=$(node -e "console.log(new URL(require('./content/site.json').learnUrl).host)")
  email=$(node -e "console.log(require('./content/site.json').email || '')")
  sed -e "s/__SITE_HOST__/$site/" -e "s/__LEARN_HOST__/$learn/" -e "s/__ACME_EMAIL__/$email/" deploy/Caddyfile.tmpl
}
