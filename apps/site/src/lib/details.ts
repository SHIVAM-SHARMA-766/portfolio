// Detail pages generated from profile.json: one page per project (plus its
// sub-pages) and one per company and per client engagement (plus sub-pages).
// They are ordinary Page objects made of blocks, so every theme renders them
// with the same block components it uses for hand-written pages.
import { profile, rewards, ids, slugify, formatMonth, getPages } from './content';
import type { Block, Card, Page, Profile } from './schema';
import { positionsOf, range, duration } from './entries';

type Project = Profile['projects'][number];
type Job = Profile['experience'][number];
type Engagement = Job['engagements'][number];

/** Slugs of the pages that list projects and experience (the detail pages live under them). */
export async function bases() {
  const pages = (await getPages()).filter((p) => p.slug !== '');
  const find = (type: Block['type']) => pages.find((p) => p.blocks.some((b) => b.type === type))?.slug;
  return { projects: find('projects') ?? 'projects', experience: find('experience') ?? 'experience' };
}

export const jobSlug = (job: Job) => job.slug || slugify(job.company);
export const engagementSlug = (e: Engagement) => e.slug || slugify(e.title.split(/\s[—–-]\s/)[0]);
export const shortTitle = (title: string) => title.split(/\s[—–-]\s/)[0];
export const period = (job: Job) => `${formatMonth(job.start)} – ${formatMonth(job.end ?? undefined)}`;

export function projectCard(p: Project, base: string): Card {
  return {
    title: p.name, body: p.summary, href: `/${base}/${p.slug}/`,
    meta: [p.year, p.role].filter(Boolean).join(' · ') || null,
    badge: p.featured ? 'Featured' : null, image: p.cover ?? null, icon: null,
    tags: p.tags.slice(0, 4), cta: 'View project',
    xp: { id: ids.project(p.slug), points: rewards.project ?? 0, label: p.name },
  };
}

export function engagementCard(job: Job, e: Engagement, base: string): Card {
  return {
    title: shortTitle(e.title), body: e.summary ?? e.highlights[0] ?? null,
    href: `/${base}/${jobSlug(job)}/${engagementSlug(e)}/`,
    meta: `${job.role} · ${job.company}`, badge: job.end ? null : 'Current', image: e.cover ?? null, icon: null,
    tags: e.tags.slice(0, 4), cta: 'Read the story',
    xp: { id: ids.experience(e.title), points: rewards.experience ?? 0, label: 'Reading the details' },
  };
}

const subCard = (sp: { slug: string; title: string; summary?: string | null }, href: string): Card =>
  ({ title: sp.title, body: sp.summary ?? null, href, meta: null, badge: null, image: null, icon: '📄', tags: [], cta: 'Read', xp: null });

const page = (slug: string, title: string, description: string | null, blocks: Block[]): Page =>
  ({ title, slug, navLabel: null, icon: null, order: 0, inNav: false, draft: false, description, blocks });

export type Detail = { page: Page; current: string };

export async function detailPages(): Promise<Detail[]> {
  const b = await bases();
  const out: Detail[] = [];

  for (const p of profile.projects) {
    const url = `/${b.projects}/${p.slug}/`;
    const blocks: Block[] = [
      { type: 'banner', eyebrow: [p.year, p.role, p.featured ? 'Featured' : null].filter(Boolean).join(' · ') || null, heading: p.name, body: p.summary, image: p.cover ?? null, tags: p.tags, ctas: p.links.map((l) => ({ label: `${l.label} ↗`, href: l.url })), back: { label: 'All projects', href: `/${b.projects}/` } },
    ];
    blocks.push({ type: 'glance', heading: 'At a glance', facts: [
      ...(p.role ? [{ label: 'Role', value: p.role, href: null }] : []),
      ...(p.start || p.year ? [{ label: 'When', value: range(p.start, p.end) || p.year!, href: null }] : []),
      ...(p.associatedWith ? [{ label: 'Context', value: p.associatedWith, href: null }] : []),
      ...(p.tags.length ? [{ label: 'Stack', value: p.tags.join(' · '), href: null }] : []),
      ...p.links.map((l) => ({ label: l.label, value: l.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: l.url })),
    ], points: p.highlights });
    if (p.body) blocks.push({ type: 'text', heading: 'The story', body: p.body });
    if (p.pages.length) blocks.push({ type: 'cards', heading: 'More about this project', body: null, columns: null, items: p.pages.map((sp) => subCard(sp, `${url}${sp.slug}/`)) });
    const others = profile.projects.filter((o) => o.slug !== p.slug).slice(0, 3);
    if (others.length) blocks.push({ type: 'cards', heading: 'Other projects', body: null, columns: 3, items: others.map((o) => projectCard(o, b.projects)) });
    out.push({ page: page(`${b.projects}/${p.slug}`, p.name, p.summary, blocks), current: b.projects });

    for (const sp of p.pages) {
      const siblings = p.pages.filter((o) => o.slug !== sp.slug);
      const sb: Block[] = [
        { type: 'banner', eyebrow: p.name, heading: sp.title, body: sp.summary ?? null, image: null, tags: [], ctas: [], back: { label: p.name, href: url } },
        { type: 'text', heading: null, body: sp.body || '_Coming soon._' },
      ];
      if (siblings.length) sb.push({ type: 'cards', heading: `More about ${p.name}`, body: null, columns: null, items: siblings.map((o) => subCard(o, `${url}${o.slug}/`)) });
      out.push({ page: page(`${b.projects}/${p.slug}/${sp.slug}`, `${sp.title} · ${p.name}`, sp.summary ?? p.summary, sb), current: b.projects });
    }
  }

  for (const job of profile.experience) {
    const jurl = `/${b.experience}/${jobSlug(job)}/`;
    const jb: Block[] = [
      { type: 'banner', eyebrow: `${period(job)}${job.location ? ` · ${job.location}` : ''}`, heading: `${job.role} at ${job.company}`, body: job.summary ?? null, image: job.logo ?? null, tags: [], ctas: [], back: { label: 'All experience', href: `/${b.experience}/` } },
    ];
    jb.push({ type: 'glance', heading: 'At a glance', facts: [
      { label: 'Company', value: job.company, href: null },
      { label: 'Role', value: job.role, href: null },
      { label: 'Period', value: [period(job), duration(job.start, job.end)].filter(Boolean).join(' · '), href: null },
      ...(job.employmentType ? [{ label: 'Type', value: job.employmentType, href: null }] : []),
      ...([job.location, job.locationType].some(Boolean) ? [{ label: 'Location', value: [job.location, job.locationType].filter(Boolean).join(' · '), href: null }] : []),
      ...(positionsOf(job).length > 1 ? [{ label: 'Positions', value: positionsOf(job).map((x) => `${x.title}${x.when ? ` (${x.when})` : ''}`).join(' → '), href: null }] : []),
      ...(job.skills.length ? [{ label: 'Skills', value: job.skills.join(' · '), href: null }] : []),
    ], points: job.highlights });
    if (job.engagements.length) jb.push({ type: 'cards', heading: 'Clients & engagements', body: null, columns: 2, items: job.engagements.map((e) => engagementCard(job, e, b.experience)) });
    out.push({ page: page(`${b.experience}/${jobSlug(job)}`, `${job.role} at ${job.company}`, job.summary ?? `${job.role} at ${job.company}`, jb), current: b.experience });

    for (const e of job.engagements) {
      const eurl = `${jurl}${engagementSlug(e)}/`;
      const eb: Block[] = [
        { type: 'banner', eyebrow: `${job.company} · ${period(job)}`, heading: e.title, body: e.summary ?? null, image: e.cover ?? null, tags: e.tags, ctas: [], back: { label: `${job.role} at ${job.company}`, href: jurl } },
      ];
      eb.push({ type: 'glance', heading: 'What I did', facts: [
        { label: 'Client', value: shortTitle(e.title), href: null },
        { label: 'Via', value: `${job.role}, ${job.company}`, href: null },
        { label: 'Period', value: period(job), href: null },
        ...(e.tags.length ? [{ label: 'Stack', value: e.tags.join(' · '), href: null }] : []),
      ], points: e.highlights });
      if (e.body) eb.push({ type: 'text', heading: 'The story', body: e.body });
      if (e.pages.length) eb.push({ type: 'cards', heading: 'Deep dives', body: null, columns: null, items: e.pages.map((sp) => subCard(sp, `${eurl}${sp.slug}/`)) });
      const others = job.engagements.filter((o) => o !== e);
      if (others.length) eb.push({ type: 'cards', heading: `Also at ${job.company}`, body: null, columns: 2, items: others.map((o) => engagementCard(job, o, b.experience)) });
      out.push({ page: page(`${b.experience}/${jobSlug(job)}/${engagementSlug(e)}`, shortTitle(e.title), e.summary ?? e.highlights[0] ?? e.title, eb), current: b.experience });

      for (const sp of e.pages) {
        out.push({ page: page(`${b.experience}/${jobSlug(job)}/${engagementSlug(e)}/${sp.slug}`, `${sp.title} · ${shortTitle(e.title)}`, sp.summary ?? null, [
          { type: 'banner', eyebrow: shortTitle(e.title), heading: sp.title, body: sp.summary ?? null, image: null, tags: [], ctas: [], back: { label: shortTitle(e.title), href: eurl } },
          { type: 'text', heading: null, body: sp.body || '_Coming soon._' },
        ]), current: b.experience });
      }
    }
  }
  return out;
}
