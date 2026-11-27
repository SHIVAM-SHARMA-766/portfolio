// Clean URLs: the theme is not in the URL. It lives in the pf_theme cookie and
// the server serves /<theme>/<path> internally. This file mirrors the rules in
// deploy/Caddyfile.tmpl for the Astro dev server and the end-to-end tests.
//
//   /about/?theme=quest   → set pf_theme=quest, 302 to /about/
//   /quest/about/         → old URL: set pf_theme=quest, 301 to /about/
//   /about/               → serve /<pf_theme or default>/about/
//   assets, /api, /admin  → untouched

export const THEMES = ['terminal', 'quest', 'studio'];
const PASSTHROUGH = /^\/(_astro|pagefind|uploads|api|admin|images|fonts)(\/|$)|^\/(favicon\.svg|rss\.xml|404\.html|robots\.txt|sitemap[^/]*)$/;

export function themeCookie(theme, secure = false) {
  return `pf_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Returns { redirect, status, setCookie } or { rewrite } or { pass: true }. */
export function routeTheme(rawUrl, cookieHeader = '', defaultTheme = 'studio') {
  const url = new URL(rawUrl, 'http://x');
  const q = url.searchParams.get('theme');
  if (q && THEMES.includes(q)) {
    url.searchParams.delete('theme');
    return { redirect: url.pathname + (url.search || ''), status: 302, setCookie: q };
  }
  const legacy = url.pathname.match(/^\/(terminal|quest|studio)(\/.*)?$/);
  if (legacy) return { redirect: (legacy[2] || '/') + url.search, status: 301, setCookie: legacy[1] };
  if (PASSTHROUGH.test(url.pathname)) return { pass: true };
  const fromCookie = (cookieHeader.match(/(?:^|;\s*)pf_theme=(terminal|quest|studio)\b/) || [])[1];
  return { rewrite: `/${fromCookie || defaultTheme}${url.pathname}${url.search}` };
}
