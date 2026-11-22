import { getCollection } from 'astro:content';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Builds always run from apps/learn (npm workspaces set the cwd), and bundled
// code can't rely on import.meta.url, so resolve from the working directory.
const coursesDir = pathToFileURL(resolve(process.cwd(), '../../content/courses') + '/');

export type Course = { slug: string; title: string; description: string; level?: string; duration?: string; icon?: string; status: string; order?: number; tags?: string[]; prerequisites?: string[]; chapters: { slug: string; title: string }[] };

export function readCourses(): Course[] {
  return readdirSync(coursesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/course.json`, coursesDir)))
    .map((d) => ({ slug: d.name, ...JSON.parse(readFileSync(new URL(`${d.name}/course.json`, coursesDir), 'utf8')) }))
    .filter((c) => c.status === 'published')
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** Lesson ids (course/chapter/lesson) for a course, in sidebar order. */
export async function lessonIds(course: string) {
  const all = await getCollection('docs');
  const meta = readCourses().find((c) => c.slug === course);
  const chapterOrder = (id: string) => meta?.chapters.findIndex((ch) => id.split('/')[1] === ch.slug) ?? 0;
  return all
    .filter((e) => e.id.startsWith(`${course}/`) && e.id.split('/').length === 3)
    .sort((a, b) => chapterOrder(a.id) - chapterOrder(b.id) || (a.data.sidebar?.order ?? 0) - (b.data.sidebar?.order ?? 0))
    .map((e) => e.id);
}
