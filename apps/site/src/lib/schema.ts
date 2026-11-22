// The content contract. Every theme renders these shapes, the admin panel
// edits them, and the build fails if content doesn't match.
import { z } from 'astro/zod';

const link = z.object({ label: z.string(), url: z.string() });
const cta = z.object({ label: z.string(), href: z.string() });

// Block types. Adding one: add it here, to the admin config, and (optionally)
// a renderer per theme — themes without one fall back to a generic renderer.
export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hero'), heading: z.string(), subheading: z.string().nullish(), body: z.string().nullish(), ctas: z.array(cta).default([]) }),
  z.object({ type: z.literal('text'), heading: z.string().nullish(), body: z.string() }),
  z.object({ type: z.literal('stats'), heading: z.string().nullish(), items: z.array(z.object({ value: z.string(), label: z.string() })) }),
  z.object({ type: z.literal('experience'), heading: z.string().nullish() }),
  z.object({ type: z.literal('projects'), heading: z.string().nullish(), filter: z.enum(['all', 'featured']).default('all'), limit: z.number().int().positive().nullish() }),
  z.object({ type: z.literal('skills'), heading: z.string().nullish() }),
  z.object({ type: z.literal('education'), heading: z.string().nullish() }),
  z.object({ type: z.literal('contact'), heading: z.string().nullish(), body: z.string().nullish() }),
  z.object({ type: z.literal('cta'), heading: z.string(), body: z.string().nullish(), label: z.string(), href: z.string() }),
  z.object({ type: z.literal('posts'), heading: z.string().nullish(), limit: z.number().int().positive().nullish() }),
  z.object({ type: z.literal('courses'), heading: z.string().nullish() }),
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockOf<T extends Block['type']> = Extract<Block, { type: T }>;

export const pageSchema = z.object({
  title: z.string(),
  slug: z.string().regex(/^[a-z0-9-]*$/, 'lowercase letters, digits and dashes; empty for the home page'),
  navLabel: z.string().nullish(),
  icon: z.string().nullish(),
  order: z.number().default(100),
  inNav: z.boolean().default(true),
  draft: z.boolean().default(false),
  description: z.string().nullish(),
  blocks: z.array(blockSchema).default([]),
});
export type Page = z.infer<typeof pageSchema>;

export const postSchema = z.object({
  title: z.string(),
  description: z.string().nullish(),
  date: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});

export const siteSchema = z.object({
  name: z.string(),
  shortName: z.string(),
  role: z.string(),
  tagline: z.string(),
  description: z.string(),
  location: z.string().nullish(),
  email: z.string().nullish(),
  siteUrl: z.string().url(),
  learnUrl: z.string().url().nullish(),
  cookieDomain: z.string().default(''),
  socials: z.array(link).default([]),
  defaultTheme: z.enum(['terminal', 'quest', 'studio']),
  defaultPalettes: z.record(z.string(), z.string()),
  game: z.object({
    enabled: z.boolean().default(true),
    rewards: z.record(z.string(), z.number()),
    levels: z.array(z.object({ xp: z.number(), name: z.string() })).min(1),
  }),
});
export type Site = z.infer<typeof siteSchema>;

export const profileSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  experience: z.array(z.object({
    company: z.string(),
    role: z.string(),
    location: z.string().nullish(),
    start: z.string(),
    end: z.string().nullish(),
    progression: z.string().nullish(),
    engagements: z.array(z.object({ title: z.string(), highlights: z.array(z.string()) })).default([]),
    highlights: z.array(z.string()).default([]),
  })),
  projects: z.array(z.object({
    slug: z.string(),
    name: z.string(),
    year: z.string().nullish(),
    featured: z.boolean().default(false),
    summary: z.string(),
    highlights: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    links: z.array(link).default([]),
  })),
  skills: z.array(z.object({ group: z.string(), items: z.array(z.string()) })),
  education: z.array(z.object({ degree: z.string(), institution: z.string(), end: z.string().nullish() })).default([]),
  certifications: z.array(z.object({ name: z.string(), status: z.string().nullish() })).default([]),
});
export type Profile = z.infer<typeof profileSchema>;

export const achievementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string().nullish(),
  bonus: z.number().default(0),
  hidden: z.boolean().default(false),
  rule: z.discriminatedUnion('type', [
    z.object({ type: z.literal('xp'), min: z.number() }),
    z.object({ type: z.literal('event'), id: z.string() }),
    z.object({ type: z.literal('events'), prefix: z.string(), min: z.number().nullish().transform((v) => v ?? 1) }),
    z.object({ type: z.literal('all-of'), ids: z.array(z.string()) }),
    z.object({ type: z.literal('all-pages') }),
  ]),
});

export const courseSchema = z.object({
  title: z.string(),
  description: z.string(),
  level: z.string().nullish(),
  duration: z.string().nullish(),
  icon: z.string().nullish(),
  status: z.enum(['draft', 'published']).default('draft'),
  order: z.number().default(100),
  tags: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
  chapters: z.array(z.object({ slug: z.string(), title: z.string() })),
});
