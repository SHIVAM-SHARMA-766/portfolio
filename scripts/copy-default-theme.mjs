// After the site build: copy the default theme's pages to the root of dist, so
// clean URLs work on any static host even without the cookie-based theme
// routing (deploy/Caddyfile.tmpl). With that routing in place these copies are
// simply never served.
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { defaultTheme } = JSON.parse(readFileSync(join(root, 'content/site.json'), 'utf8'));
const dist = join(root, 'apps/site/dist');
const from = join(dist, defaultTheme);
if (!existsSync(from)) throw new Error(`no build for the default theme at ${from}`);
cpSync(from, dist, { recursive: true });
console.log(`copied ${defaultTheme} pages to the site root`);
