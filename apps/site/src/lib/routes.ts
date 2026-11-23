// Shared static-path builders. Each theme has its own route files so a page
// only bundles that theme's CSS and scripts.
import { getPages, getPosts } from './content';
import { detailPages } from './details';

export async function pagePaths() {
  const pages = await getPages();
  const details = await detailPages();
  return [
    ...pages.map((page) => ({ params: { slug: page.slug || undefined }, props: { page, current: page.slug, detail: false } })),
    // Project / experience pages: not in the menu, highlight their parent page
    ...details.map((d) => ({ params: { slug: d.page.slug }, props: { page: d.page, current: d.current, detail: true } })),
  ];
}

export async function postPaths() {
  const posts = await getPosts();
  return posts.map((post) => ({ params: { post: post.id }, props: { post } }));
}
