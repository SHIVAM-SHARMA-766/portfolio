# Shared helpers for deploy scripts. Source from the repo root.

# Render deploy/Caddyfile.tmpl with hostnames from content/site.json.
render_caddyfile() {
  node -e '
    const fs = require("fs");
    const s = require("./content/site.json");
    const site = new URL(s.siteUrl).host, learn = new URL(s.learnUrl).host;
    const old = s.previousHosts || {};
    // Old hostnames keep working: everything 301s to the same path on the new host
    const redirect = (from, to) => `${from} {\n\timport common\n\tredir https://${to}{uri} permanent\n}\n`;
    const redirects = [...(old.site || []).map((h) => redirect(h, site)), ...(old.learn || []).map((h) => redirect(h, learn))].join("\n");
    process.stdout.write(fs.readFileSync("deploy/Caddyfile.tmpl", "utf8")
      .replaceAll("__SITE_HOST__", site).replaceAll("__LEARN_HOST__", learn)
      .replaceAll("__ACME_EMAIL__", s.email || "").replace("__REDIRECTS__", redirects));
  '
}
