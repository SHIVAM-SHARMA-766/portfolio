// Learn site (learn.<domain>): courses → chapters → lessons, built with Starlight.
// The sidebar is generated from content/courses/*/course.json so adding a course
// or chapter in the admin panel needs no code change.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const contentDir = new URL('../../content/', import.meta.url);
const site = JSON.parse(readFileSync(new URL('site.json', contentDir), 'utf8'));
const coursesDir = new URL('courses/', contentDir);

const courses = readdirSync(coursesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/course.json`, coursesDir)))
  .map((d) => ({ slug: d.name, ...JSON.parse(readFileSync(new URL(`${d.name}/course.json`, coursesDir), 'utf8')) }))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

const published = courses.filter((c) => c.status === 'published');

const sidebar = [
  { label: 'All courses', link: '/' },
  ...published.map((c, i) => ({
    label: `${c.icon ?? ''} ${c.title}`.trim(),
    collapsed: i > 0,
    items: [
      { label: 'Course overview', slug: c.slug },
      ...c.chapters.map((ch) => ({ label: ch.title, items: [{ autogenerate: { directory: `${c.slug}/${ch.slug}` } }] })),
    ],
  })),
];

export default defineConfig({
  site: site.learnUrl,
  integrations: [
    starlight({
      title: `${site.shortName} / learn`,
      description: `Free courses by ${site.name}.`,
      social: [
        ...site.socials.filter((s) => /github/i.test(s.label)).map((s) => ({ icon: 'github', label: s.label, href: s.url })),
        { icon: 'external', label: 'Portfolio', href: site.siteUrl },
      ],
      sidebar,
      customCss: ['./src/styles/learn.css'],
      // Lessons live outside src/content/docs, so Starlight's Markdown
      // transforms (asides, heading links) must be told about the folder.
      markdown: { processedDirs: ['../../content/courses'] },
      lastUpdated: true,
      pagination: true,
      components: {
        Head: './src/components/Head.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        Footer: './src/components/Footer.astro',
      },
    }),
  ],
});
