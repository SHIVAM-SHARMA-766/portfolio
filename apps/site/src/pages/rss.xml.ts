import { getPosts, site, pageUrl } from '../lib/content';

const esc = (s = '') => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export async function GET() {
  const posts = await getPosts();
  const items = posts
    .map((p) => {
      const url = new URL(pageUrl(site.defaultTheme, `blog/${p.id}`), site.siteUrl).href;
      return `<item><title>${esc(p.data.title)}</title><link>${url}</link><guid>${url}</guid><pubDate>${p.data.date.toUTCString()}</pubDate><description>${esc(p.data.description)}</description></item>`;
    })
    .join('');
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(site.name)} — Blog</title><link>${site.siteUrl}</link><description>${esc(site.description)}</description>${items}</channel></rss>`;
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
