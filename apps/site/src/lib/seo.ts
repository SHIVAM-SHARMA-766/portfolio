// Structured data (JSON-LD) for search engines and link previews: the person
// behind the site on the home and about pages, a BlogPosting for posts, a
// CreativeWork for projects, and breadcrumbs for every page below the top level.
import { site, profile, photo, getPages, getPosts, slugify } from './content';
import { ogVariant } from './images';

const abs = (path: string) => new URL(path, site.siteUrl).href;
const personId = abs('/#person');

function person() {
  const current = profile.experience.find((j) => !j.end);
  const skills = (profile.skills ?? []).flatMap((g: { items: string[] }) => g.items).slice(0, 20);
  return {
    '@type': 'Person',
    '@id': personId,
    name: site.name,
    jobTitle: site.role,
    description: profile.headline ?? site.description,
    url: abs('/'),
    ...(photo ? { image: abs(photo.src) } : {}),
    ...(site.location ? { address: { '@type': 'PostalAddress', addressLocality: site.location } } : {}),
    ...(current ? { worksFor: { '@type': 'Organization', name: current.company } } : {}),
    ...(profile.education?.length ? { alumniOf: profile.education.map((e: { school: string }) => ({ '@type': 'EducationalOrganization', name: e.school })) } : {}),
    ...(skills.length ? { knowsAbout: skills } : {}),
    sameAs: site.socials.map((s) => s.url),
  };
}

async function breadcrumbs(slug: string, title: string) {
  const parts = slug.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const pages = await getPages();
  const items = [{ name: 'Home', url: abs('/') }];
  parts.forEach((_, i) => {
    const sub = parts.slice(0, i + 1).join('/');
    const last = i === parts.length - 1;
    const job = profile.experience.find((j) => (j.slug || slugify(j.company)) === parts[i]);
    const name = last ? title : pages.find((p) => p.slug === sub)?.title ?? job?.company ?? parts[i].replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    items.push({ name, url: abs(`/${sub}/`) });
  });
  return { '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })) };
}

export type Seo = { ld: object[]; article?: { published: string; tags: string[] } };

export async function seoFor(slug: string, title: string, description: string, image: string | null, canonical: string): Promise<Seo> {
  const graph: object[] = [];
  let article: Seo['article'];
  if (slug === '' || slug === 'about') {
    graph.push({ '@type': 'ProfilePage', url: canonical, name: title, mainEntity: person() });
    if (slug === '') graph.push({ '@type': 'WebSite', url: abs('/'), name: site.name, author: { '@id': personId } });
  } else if (slug.startsWith('blog/')) {
    const post = (await getPosts()).find((p) => `blog/${p.id}` === slug);
    if (post) {
      article = { published: post.data.date.toISOString(), tags: post.data.tags ?? [] };
      graph.push({
        '@type': 'BlogPosting', headline: post.data.title, description, url: canonical, mainEntityOfPage: canonical,
        datePublished: article.published, ...(image ? { image: abs(ogVariant(image)) } : {}), keywords: article.tags.join(', '),
        author: { '@type': 'Person', '@id': personId, name: site.name, url: abs('/') },
      });
    }
  } else {
    const project = profile.projects.find((p) => slug.endsWith(`/${p.slug}`) && slug.split('/').length === 2);
    if (project) {
      const repo = project.links.find((l) => /github\.com|gitlab\.com/.test(l.url));
      graph.push({
        '@type': repo ? 'SoftwareSourceCode' : 'CreativeWork', name: project.name, description: project.summary, url: canonical,
        ...(image ? { image: abs(ogVariant(image)) } : {}), keywords: project.tags.join(', '),
        ...(repo ? { codeRepository: repo.url } : {}),
        ...(project.start ? { dateCreated: project.start } : {}),
        author: { '@type': 'Person', '@id': personId, name: site.name, url: abs('/') },
      });
    }
  }
  const crumbs = await breadcrumbs(slug, title);
  if (crumbs) graph.push(crumbs);
  return { ld: graph.length ? [{ '@context': 'https://schema.org', '@graph': graph }] : [], article };
}

/** JSON for a <script> tag: "<" escaped so content can never close the tag. */
export const ldJson = (x: object) => JSON.stringify(x).replace(/</g, '\\u003c');
