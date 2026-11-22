import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { pageSchema, postSchema } from './lib/schema';

// Content lives in the repo-level content/ folder, shared with the learn site
// and edited by the admin panel.
const pages = defineCollection({
  loader: glob({ pattern: '**/*.json', base: '../../content/pages' }),
  schema: pageSchema,
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: '../../content/blog' }),
  schema: postSchema,
});

export const collections = { pages, blog };
