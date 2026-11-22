// Shared static-path builders. Each theme has its own route files so a page
// only bundles that theme's CSS and scripts.
import { getPages, getPosts } from './content';

export async function pagePaths() {
  const pages = await getPages();
  return pages.map((page) => ({ params: { slug: page.slug || undefined }, props: { page } }));
}

export async function postPaths() {
  const posts = await getPosts();
  return posts.map((post) => ({ params: { post: post.id }, props: { post } }));
}
