// Sitemap with the clean public URLs only (the per-theme copies under
// /<theme>/ are internal and never linked).
import { getPages, getPosts, site, pageUrl } from '../lib/content';
import { detailPages } from '../lib/details';

export async function GET() {
  const pages = (await getPages()).filter((p) => !p.draft);
  const posts = await getPosts();
  const urls = [
    ...pages.map((p) => ({ loc: pageUrl(site.defaultTheme, p.slug), lastmod: null as string | null })),
    ...(await detailPages()).map((d) => ({ loc: pageUrl(site.defaultTheme, d.page.slug), lastmod: null as string | null })),
    ...posts.map((p) => ({ loc: pageUrl(site.defaultTheme, `blog/${p.id}`), lastmod: p.data.date.toISOString().slice(0, 10) })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${new URL(u.loc, site.siteUrl).href}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
