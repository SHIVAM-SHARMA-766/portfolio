// LinkedIn-style profile sections (education, licenses & certifications,
// languages, honors & awards, volunteering) as one simple list shape, so every
// theme renders them with a single component. Also date ranges and durations.
import { profile, formatMonth } from './content';

export type Entry = { title: string; subtitle?: string | null; meta?: string | null; body?: string | null; href?: string | null; badge?: string | null; tags?: string[] };

/** "Jul 2025 – Present", "2025", or "" when nothing is known. */
export function range(start?: string | null, end?: string | null, present = true) {
  if (!start && !end) return '';
  const a = start ? formatMonth(start) : '';
  const b = end ? formatMonth(end) : present ? 'Present' : '';
  return a && b ? `${a} – ${b}` : a || b;
}

/** "1 yr 5 mos" between two YYYY-MM dates (end missing = now), like LinkedIn. */
export function duration(start?: string | null, end?: string | null) {
  if (!start) return '';
  const [y1, m1] = start.split('-').map(Number);
  const e = end ? end.split('-').map(Number) : [new Date().getUTCFullYear(), new Date().getUTCMonth() + 1];
  const months = (e[0] - y1) * 12 + (e[1] - (m1 || 1)) + 1;
  if (months <= 0) return '';
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ');
}

const STATUS: Record<string, string> = { earned: '', 'in-progress': 'In progress', planned: 'Planned' };

export function entriesFor(kind: 'education' | 'certifications' | 'languages' | 'awards' | 'volunteering'): Entry[] {
  switch (kind) {
    case 'education':
      return profile.education.map((e) => ({
        title: e.school,
        subtitle: [e.degree, e.field].filter(Boolean).join(', ') || null,
        meta: [range(e.start, e.end, false), e.grade ? `Grade: ${e.grade}` : ''].filter(Boolean).join(' · ') || null,
        body: [e.activities ? `Activities and societies: ${e.activities}` : '', e.description ?? ''].filter(Boolean).join('\n\n') || null,
        tags: e.skills,
      }));
    case 'certifications':
      return profile.certifications.map((c) => ({
        title: c.name,
        subtitle: c.issuer ?? null,
        meta: [c.issued ? `Issued ${formatMonth(c.issued)}` : '', c.expires ? `Expires ${formatMonth(c.expires)}` : '', c.credentialId ? `Credential ID ${c.credentialId}` : ''].filter(Boolean).join(' · ') || null,
        body: c.note ?? null,
        href: c.credentialUrl ?? null,
        badge: STATUS[c.status] || null,
        tags: c.skills,
      }));
    case 'languages':
      return profile.languages.map((l) => ({ title: l.name, subtitle: l.proficiency ?? null }));
    case 'awards':
      return profile.awards.map((a) => ({ title: a.title, subtitle: a.issuer ?? null, meta: a.date ? formatMonth(a.date) : null, body: a.description ?? null, href: a.url ?? null }));
    case 'volunteering':
      return profile.volunteering.map((v) => ({ title: v.role, subtitle: v.organization, meta: [range(v.start, v.end), v.cause ?? ''].filter(Boolean).join(' · ') || null, body: v.description ?? null }));
  }
}

type Job = (typeof profile.experience)[number];
/** The titles held at one company, with dates and durations (newest first). */
export function positionsOf(job: Job) {
  const list = job.positions.length ? job.positions : [{ title: job.role, start: job.start, end: job.end ?? null }];
  return list.map((p) => ({ title: p.title, when: range(p.start, p.end), length: duration(p.start, p.end) }));
}
/** "Full-time · Hybrid · Delhi" */
export const jobMeta = (job: Job) => [job.employmentType, job.locationType, job.location].filter(Boolean).join(' · ');
