// Builds the terminal's virtual filesystem from content at build time, and
// plants each mission's flag where its `kind` says it belongs.
import { createHash } from 'node:crypto';
import { profile, site, getPosts, getNav, getCourses, slugify, formatMonth } from '../../lib/content';
import missionsRaw from '../../../../../content/missions.json';

export type FsNode =
  | { type: 'dir'; children: Record<string, FsNode> }
  | { type: 'file'; content: string; href?: string; exec?: boolean }
  | { type: 'link'; href: string };

export type Mission = { id: string; kind: string; title: string; brief: string; hint: string; reward: number; flag: string };
export const missions = missionsRaw.missions as Mission[];

const dir = (children: Record<string, FsNode>): FsNode => ({ type: 'dir', children });
const file = (content: string, extra: Partial<{ href: string; exec: boolean }> = {}): FsNode => ({ type: 'file', content, ...extra });
const flagOf = (kind: string) => missions.find((m) => m.kind === kind)?.flag;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function buildFs(theme: string) {
  const posts = await getPosts();
  const nav = await getNav();

  // experience/*.log — the grep mission's flag goes into the first log
  const experience: Record<string, FsNode> = {};
  let grepPlanted = false;
  for (const job of profile.experience) {
    const entries = job.engagements.length ? job.engagements : [{ title: job.company, highlights: job.highlights }];
    for (const e of entries) {
      const name = `${slugify(e.title).split('-').slice(0, 3).join('-')}.log`;
      const lines = [
        `# ${job.role} @ ${job.company} — ${e.title}`,
        `# ${formatMonth(job.start)} – ${formatMonth(job.end ?? undefined)}${job.location ? ` · ${job.location}` : ''}`,
        '',
        ...e.highlights.map((h, i) => `[${String(i + 1).padStart(2, '0')}] ${h}`),
      ];
      if (!grepPlanted && flagOf('grep')) {
        lines.splice(4, 0, `[!!] 03:12 UTC pager fired, root-caused and closed before breakfast — ${flagOf('grep')}`);
        grepPlanted = true;
      }
      experience[name] = file(lines.join('\n'));
    }
  }

  // projects/<slug>/README.md — the decoder mission hides base64 in one README
  const projects: Record<string, FsNode> = {};
  const decoderHost = profile.projects.find((p) => p.slug === 'portfolio') ?? profile.projects[0];
  for (const p of profile.projects) {
    const lines = [`# ${p.name}${p.year ? ` (${p.year})` : ''}`, '', p.summary, ''];
    for (const h of p.highlights) lines.push(`- ${h}`);
    if (p.tags.length) lines.push('', `tags: ${p.tags.join(', ')}`);
    for (const l of p.links) lines.push(`${l.label.toLowerCase()}: ${l.url}`);
    if (p === decoderHost && flagOf('base64')) lines.push('', `build-note: ${Buffer.from(flagOf('base64')!).toString('base64')}`);
    projects[p.slug] = dir({ 'README.md': file(lines.join('\n'), { href: `/${theme}/projects/` }) });
  }

  const blog: Record<string, FsNode> = {};
  for (const p of posts) {
    blog[`${p.id}.md`] = file(`# ${p.data.title}\n${p.data.date.toISOString().slice(0, 10)}\n\n${p.data.description ?? ''}\n\nRead it: open blog/${p.id}.md`, { href: `/${theme}/blog/${p.id}/` });
  }

  const learn: Record<string, FsNode> = {};
  for (const c of getCourses()) learn[c.slug] = { type: 'link', href: c.url };

  const contactLines = ['#!/bin/sh', '# ./contact.sh — ways to reach me', ''];
  if (site.email) contactLines.push(`echo "email:  ${site.email}"`);
  for (const s of site.socials) contactLines.push(`echo "${s.label.toLowerCase()}: ${s.url}"`);

  const secrets: Record<string, FsNode> = {
    'todo.txt': file(['- finish CKA prep', '- write more lessons', '- there are 5 flags on this box. `missions` lists them.'].join('\n')),
  };
  if (flagOf('hidden-file')) secrets['recon.txt'] = file(`Nice recon. Hidden files start with a dot.\n${flagOf('hidden-file')}\n\nSubmit it with: submit <flag>`);

  const root = dir({
    'about.md': file(`# ${site.name}\n${site.role} · ${site.location ?? ''}\n\n${profile.summary}`, { href: `/${theme}/about/` }),
    'skills.txt': file(profile.skills.map((g) => `${g.group}: ${g.items.join(', ')}`).join('\n')),
    'education.txt': file([...profile.education.map((e) => `${e.degree} — ${e.institution} (${formatMonth(e.end ?? undefined)})`), ...profile.certifications.map((c) => `${c.name}${c.status ? ` — ${c.status}` : ''}`)].join('\n')),
    'contact.sh': file(contactLines.join('\n'), { exec: true }),
    experience: dir(experience),
    projects: dir(projects),
    blog: dir(blog),
    learn: dir(learn),
    '.secrets': dir(secrets),
    '.bash_history': file(['ls -a', 'cat .secrets/todo.txt', 'grep -r incident experience', 'hack', 'shop', 'sudo hire shivam'].join('\n')),
  });

  return {
    fs: root,
    pages: nav.map((p) => ({ name: p.slug || 'home', title: p.title, url: `/${theme}/${p.slug ? `${p.slug}/` : ''}` })),
    // Flags are checked by hash, so the answers are not sitting in the page.
    missions: missions.map(({ flag, ...m }) => ({ ...m, hash: sha256(flag) })),
    portscanFlag: flagOf('port-scan') ? Buffer.from(flagOf('port-scan')!).toString('base64') : '',
  };
}
