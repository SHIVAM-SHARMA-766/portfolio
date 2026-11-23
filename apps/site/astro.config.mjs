import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import { routeTheme, themeCookie } from '../../scripts/theme-routing.mjs';

const site = JSON.parse(readFileSync(new URL('../../content/site.json', import.meta.url), 'utf8'));

// Dev server: same clean-URL theme routing as Caddy in production.
const themeRouting = {
  name: 'theme-routing',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url.startsWith('/@') || req.url.startsWith('/node_modules') || req.url.startsWith('/src/')) return next();
      const r = routeTheme(req.url, req.headers.cookie, site.defaultTheme);
      if (r.redirect) {
        res.statusCode = r.status;
        res.setHeader('Set-Cookie', themeCookie(r.setCookie));
        res.setHeader('Location', r.redirect);
        return res.end();
      }
      if (r.rewrite) req.url = r.rewrite;
      next();
    });
  },
};

export default defineConfig({
  site: site.siteUrl,
  vite: { plugins: [themeRouting] },
  trailingSlash: 'ignore',
  build: { format: 'directory' },
});
