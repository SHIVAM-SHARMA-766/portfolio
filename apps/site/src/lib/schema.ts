// The content contract. Every theme renders these shapes, the admin panel
// edits them, and the build fails if content doesn't match.
import { z } from 'astro/zod';

const link = z.object({ label: z.string(), url: z.string() });
const cta = z.object({ label: z.string(), href: z.string() });
// A card: projects, engagements, sub-pages and hand-written lists all render as these
export const cardSchema = z.object({
  title: z.string(),
  body: z.string().nullish(),
  href: z.string().nullish(),
  meta: z.string().nullish(),
  badge: z.string().nullish(),
  image: z.string().nullish(),
  icon: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  cta: z.string().nullish(),
  // Award XP when the card is opened (set by generated cards, not in content)
  xp: z.object({ id: z.string(), points: z.number(), label: z.string() }).nullish(),
});
export type Card = z.infer<typeof cardSchema>;
// A sub-page of a project or an engagement
const subPage = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), title: z.string(), summary: z.string().nullish(), body: z.string().default('') });

// Block types. Adding one: add it here, to the admin config, and (optionally)
// a renderer per theme — themes without one fall back to a generic renderer.
export const blockSchema = z.discriminatedUnion('type', [
  // Page banner: the top of every inner page and of every project / experience page
  z.object({ type: z.literal('banner'), eyebrow: z.string().nullish(), heading: z.string(), body: z.string().nullish(), image: z.string().nullish(), tags: z.array(z.string()).default([]), ctas: z.array(cta).default([]), back: cta.nullish() }),
  // "At a glance": key facts on the left, key points on the right (project / client pages)
  z.object({ type: z.literal('glance'), heading: z.string().nullish(), facts: z.array(z.object({ label: z.string(), value: z.string(), href: z.string().nullish() })).default([]), points: z.array(z.string()).default([]) }),
  // A dated journey (about page)
  z.object({ type: z.literal('timeline'), heading: z.string().nullish(), body: z.string().nullish(), items: z.array(z.object({ date: z.string(), title: z.string(), body: z.string().nullish(), href: z.string().nullish(), tag: z.string().nullish() })).default([]) }),
  z.object({ type: z.literal('cards'), heading: z.string().nullish(), body: z.string().nullish(), columns: z.number().int().min(1).max(4).nullish(), items: z.array(cardSchema).default([]) }),
  z.object({ type: z.literal('hero'), heading: z.string(), subheading: z.string().nullish(), body: z.string().nullish(), ctas: z.array(cta).default([]) }),
  z.object({ type: z.literal('text'), heading: z.string().nullish(), body: z.string() }),
  z.object({ type: z.literal('stats'), heading: z.string().nullish(), items: z.array(z.object({ value: z.string(), label: z.string() })) }),
  z.object({ type: z.literal('experience'), heading: z.string().nullish(), compact: z.boolean().default(false) }),
  z.object({ type: z.literal('projects'), heading: z.string().nullish(), filter: z.enum(['all', 'featured']).default('all'), limit: z.number().int().positive().nullish() }),
  z.object({ type: z.literal('skills'), heading: z.string().nullish() }),
  z.object({ type: z.literal('education'), heading: z.string().nullish() }),
  z.object({ type: z.literal('volunteering'), heading: z.string().nullish() }),
  z.object({ type: z.literal('awards'), heading: z.string().nullish() }),
  z.object({ type: z.literal('languages'), heading: z.string().nullish() }),
  z.object({ type: z.literal('certifications'), heading: z.string().nullish() }),
  z.object({ type: z.literal('contact'), heading: z.string().nullish(), body: z.string().nullish(), form: z.boolean().nullish() }),
  z.object({ type: z.literal('cta'), heading: z.string(), body: z.string().nullish(), label: z.string(), href: z.string() }),
  z.object({ type: z.literal('posts'), heading: z.string().nullish(), limit: z.number().int().positive().nullish() }),
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
  cover: z.string().nullish(),
  coverAlt: z.string().nullish(),
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
  previewUrl: z.string().url().nullish(), // draft-preview site; see deploy/Caddyfile.tmpl
  apiUrl: z.string().url().nullish(),
  resume: z.string().nullish(),
  availability: z.string().nullish(),
  photo: z.string().nullish(),
  photoCutout: z.string().nullish(),
  photoAlt: z.string().nullish(),
  photoPosition: z.string().nullish(),
  cookieDomain: z.string().default(''),
  // Old hostnames that now redirect (301) to the site / learn site (deploy/Caddyfile.tmpl)
  previousHosts: z.object({ site: z.array(z.string()).default([]), learn: z.array(z.string()).default([]) }).default({ site: [], learn: [] }),
  socials: z.array(link).default([]),
  defaultTheme: z.enum(['terminal', 'quest', 'studio']),
  defaultPalettes: z.record(z.string(), z.string()),
  game: z.object({
    enabled: z.boolean().default(true),
    rewards: z.record(z.string(), z.number()),
    levels: z.array(z.object({ xp: z.number(), name: z.string() })).min(1),
    clickCap: z.number().int().min(0).default(0),
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
    employmentType: z.string().nullish(),   // Full-time, Internship, Contract…
    locationType: z.string().nullish(),     // On-site, Hybrid, Remote
    // Several titles at one company, newest first (LinkedIn-style promotions)
    positions: z.array(z.object({ title: z.string(), start: z.string().nullish(), end: z.string().nullish() })).default([]),
    skills: z.array(z.string()).default([]),
    slug: z.string().regex(/^[a-z0-9-]+$/).nullish(),
    summary: z.string().nullish(),
    logo: z.string().nullish(),
    engagements: z.array(z.object({
      title: z.string(),
      slug: z.string().regex(/^[a-z0-9-]+$/).nullish(),
      summary: z.string().nullish(),
      cover: z.string().nullish(),
      tags: z.array(z.string()).default([]),
      highlights: z.array(z.string()).default([]),
      body: z.string().default(''),
      pages: z.array(subPage).default([]),
    })).default([]),
    highlights: z.array(z.string()).default([]),
  })),
  projects: z.array(z.object({
    slug: z.string(),
    name: z.string(),
    year: z.string().nullish(),
    featured: z.boolean().default(false),
    role: z.string().nullish(),
    start: z.string().nullish(),
    end: z.string().nullish(),
    associatedWith: z.string().nullish(),
    cover: z.string().nullish(),
    summary: z.string(),
    body: z.string().default(''),
    pages: z.array(subPage).default([]),
    highlights: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    links: z.array(link).default([]),
  })),
  skills: z.array(z.object({ group: z.string(), items: z.array(z.string()) })),
  education: z.array(z.object({
    school: z.string(), degree: z.string().nullish(), field: z.string().nullish(),
    start: z.string().nullish(), end: z.string().nullish(), grade: z.string().nullish(),
    activities: z.string().nullish(), description: z.string().nullish(), skills: z.array(z.string()).default([]), logo: z.string().nullish(),
  })).default([]),
  // Licenses & certifications (separate from education, as on LinkedIn)
  certifications: z.array(z.object({
    name: z.string(), issuer: z.string().nullish(), status: z.enum(['earned', 'in-progress', 'planned']).default('earned'),
    issued: z.string().nullish(), expires: z.string().nullish(), credentialId: z.string().nullish(), credentialUrl: z.string().nullish(),
    skills: z.array(z.string()).default([]), note: z.string().nullish(),
  })).default([]),
  languages: z.array(z.object({ name: z.string(), proficiency: z.string().nullish() })).default([]),
  awards: z.array(z.object({ title: z.string(), issuer: z.string().nullish(), date: z.string().nullish(), description: z.string().nullish(), url: z.string().nullish() })).default([]),
  volunteering: z.array(z.object({ organization: z.string(), role: z.string(), cause: z.string().nullish(), start: z.string().nullish(), end: z.string().nullish(), description: z.string().nullish() })).default([]),
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

export const shopSchema = z.object({
  items: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().nullish(), price: z.number().int().min(0) })),
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
