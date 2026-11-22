import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

// Lessons live in the repo-level content/courses folder, shared with the admin
// panel. Courses whose course.json says "draft" are left out of the build.
const coursesDir = new URL('../../../content/courses/', import.meta.url);
const drafts = readdirSync(coursesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/course.json`, coursesDir)))
  .filter((d) => JSON.parse(readFileSync(new URL(`${d.name}/course.json`, coursesDir), 'utf8')).status !== 'published')
  .map((d) => `!${d.name}/**`);

export const collections = {
  docs: defineCollection({
    loader: glob({ pattern: ['**/*.{md,mdx}', ...drafts], base: '../../content/courses' }),
    schema: docsSchema({
      extend: z.object({
        difficulty: z.enum(['beginner', 'intermediate', 'advanced']).or(z.literal('')).nullish(),
        minutes: z.number().nullish(),
        lab: z.string().url().or(z.literal('')).nullish(),
        quiz: z
          .array(
            z.object({
              question: z.string(),
              options: z.array(z.string()).min(2),
              answer: z.number().int().min(0),
              explanation: z.string().nullish(),
            }),
          )
          .nullish(),
      }),
    }),
  }),
};
