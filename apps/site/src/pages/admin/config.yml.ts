// Admin panel (Sveltia CMS) configuration, generated at build time.
//
// It is generated rather than hand-written so that every course chapter gets
// its own "Lessons" section automatically: add a chapter to a course in the
// admin, and after the next deploy that chapter can hold lessons.
//
// The output is JSON, which is valid YAML.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = 'SHIVAM-SHARMA-766/portfolio';
const BRANCH = 'main';

const str = (name: string, label: string, extra: object = {}) => ({ name, label, widget: 'string', ...extra });
const opt = (f: object) => ({ ...f, required: false });
const text = (name: string, label: string, extra: object = {}) => ({ name, label, widget: 'text', ...extra });
const md = (name: string, label: string, extra: object = {}) => ({ name, label, widget: 'markdown', ...extra });
const num = (name: string, label: string, extra: object = {}) => ({ name, label, widget: 'number', value_type: 'int', ...extra });
const bool = (name: string, label: string, def = false) => ({ name, label, widget: 'boolean', default: def });
const list = (name: string, label: string, fields: object[], extra: object = {}) => ({ name, label, widget: 'list', fields, ...extra });
const strList = (name: string, label: string, extra: object = {}) => ({ name, label, widget: 'list', ...extra });
const obj = (name: string, label: string, fields: object[], extra: object = {}) => ({ name, label, widget: 'object', fields, ...extra });
const link = [str('label', 'Label'), str('url', 'URL')];

const heading = opt(str('heading', 'Heading'));
const blockTypes = [
  { name: 'hero', label: 'Hero', widget: 'object', summary: '{{heading}}', fields: [str('heading', 'Heading'), opt(str('subheading', 'Subheading')), opt(text('body', 'Intro (markdown)')), list('ctas', 'Buttons', [str('label', 'Label'), str('href', 'Link (relative like "projects/" or full URL)')], { required: false })] },
  { name: 'text', label: 'Text', widget: 'object', summary: '{{heading}}', fields: [heading, md('body', 'Body')] },
  { name: 'stats', label: 'Stats', widget: 'object', summary: '{{heading}}', fields: [heading, list('items', 'Items', [str('value', 'Value'), str('label', 'Label')])] },
  { name: 'experience', label: 'Experience (from profile)', widget: 'object', fields: [heading] },
  { name: 'projects', label: 'Projects (from profile)', widget: 'object', fields: [heading, { name: 'filter', label: 'Show', widget: 'select', options: ['all', 'featured'], default: 'all' }, opt(num('limit', 'Max projects'))] },
  { name: 'skills', label: 'Skills (from profile)', widget: 'object', fields: [heading] },
  { name: 'education', label: 'Education & certifications (from profile)', widget: 'object', fields: [heading] },
  { name: 'contact', label: 'Contact', widget: 'object', fields: [heading, opt(text('body', 'Text'))] },
  { name: 'cta', label: 'Call to action', widget: 'object', summary: '{{heading}}', fields: [str('heading', 'Heading'), opt(text('body', 'Text')), str('label', 'Button label'), str('href', 'Button link')] },
  { name: 'posts', label: 'Blog posts list', widget: 'object', fields: [heading, opt(num('limit', 'Max posts'))] },
  { name: 'courses', label: 'Courses list', widget: 'object', fields: [heading] },
];

const quizFields = [
  str('question', 'Question'),
  strList('options', 'Options', { min: 2 }),
  num('answer', 'Correct option (0 = first)', { min: 0 }),
  opt(text('explanation', 'Explanation')),
];

const lessonFields = [
  str('title', 'Title'),
  opt(str('description', 'Description')),
  obj('sidebar', 'Sidebar', [num('order', 'Order in chapter', { default: 1 })]),
  { ...opt({ name: 'difficulty', label: 'Difficulty', widget: 'select', options: ['beginner', 'intermediate', 'advanced'] }) },
  opt(num('minutes', 'Reading time (minutes)')),
  opt(str('lab', 'Browser lab URL')),
  opt(list('quiz', 'Quiz', quizFields)),
  bool('draft', 'Draft (hidden in production)'),
  md('body', 'Lesson'),
];

function courses() {
  const dir = resolve(process.cwd(), '../../content/courses');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(dir, d.name, 'course.json')))
    .map((d) => ({ slug: d.name, ...JSON.parse(readFileSync(resolve(dir, d.name, 'course.json'), 'utf8')) }));
}

export function GET() {
  const lessonCollections = courses().flatMap((c) =>
    (c.chapters as { slug: string; title: string }[]).map((ch) => ({
      name: `lessons-${c.slug}-${ch.slug}`,
      label: `${c.title} › ${ch.title}`,
      label_singular: 'Lesson',
      folder: `content/courses/${c.slug}/${ch.slug}`,
      extension: 'md',
      format: 'frontmatter',
      create: true,
      delete: true,
      slug: '{{slug}}',
      sortable_fields: ['sidebar.order', 'title'],
      summary: '{{sidebar.order}}. {{title}}',
      fields: lessonFields,
    })),
  );

  const config = {
    backend: { name: 'github', repo: REPO, branch: BRANCH, commit_messages: { create: 'Create {{collection}} “{{slug}}”', update: 'Update {{collection}} “{{slug}}”', delete: 'Delete {{collection}} “{{slug}}”' } },
    site_url: '/',
    display_url: '/',
    media_folder: 'apps/site/public/uploads',
    public_folder: '/uploads',
    collections: [
      {
        name: 'pages',
        label: 'Pages',
        label_singular: 'Page',
        description: 'Each page is a list of blocks. Every theme renders the same blocks in its own style.',
        folder: 'content/pages',
        extension: 'json',
        format: 'json',
        create: true,
        delete: true,
        slug: '{{fields.slug}}',
        identifier_field: 'title',
        sortable_fields: ['order', 'title'],
        summary: '{{order}} · {{title}}',
        fields: [
          str('title', 'Title'),
          str('slug', 'URL slug (empty only for the home page)', { required: false, pattern: ['^[a-z0-9-]*$', 'lowercase letters, digits and dashes'] }),
          opt(str('navLabel', 'Menu label')),
          opt(str('icon', 'Icon (emoji, used by the Quest theme)')),
          num('order', 'Menu order', { default: 10 }),
          bool('inNav', 'Show in menu', true),
          bool('draft', 'Draft (hidden)'),
          opt(str('description', 'Description (SEO)')),
          { name: 'blocks', label: 'Blocks', widget: 'list', types: blockTypes, typeKey: 'type' },
        ],
      },
      {
        name: 'blog',
        label: 'Blog',
        label_singular: 'Post',
        folder: 'content/blog',
        extension: 'md',
        format: 'frontmatter',
        create: true,
        delete: true,
        slug: '{{slug}}',
        sortable_fields: ['date', 'title'],
        fields: [str('title', 'Title'), opt(str('description', 'Description')), { name: 'date', label: 'Date', widget: 'datetime', time_format: false, format: 'YYYY-MM-DD' }, opt(strList('tags', 'Tags')), bool('draft', 'Draft'), md('body', 'Body')],
      },
      {
        name: 'courses',
        label: 'Courses',
        label_singular: 'Course',
        description: 'Course details and chapters. After adding a chapter, its lessons section appears in the admin after the next deploy.',
        folder: 'content/courses',
        path: '{{slug}}/course',
        extension: 'json',
        format: 'json',
        create: true,
        delete: false,
        fields: [
          str('title', 'Title'), text('description', 'Description'), opt(str('level', 'Level')), opt(str('duration', 'Duration')), opt(str('icon', 'Icon (emoji)')),
          { name: 'status', label: 'Status', widget: 'select', options: ['draft', 'published'], default: 'draft' },
          num('order', 'Order', { default: 10 }), opt(strList('tags', 'Tags')), opt(strList('prerequisites', 'Prerequisites')),
          list('chapters', 'Chapters', [str('slug', 'Folder name (lowercase, dashes)', { pattern: ['^[a-z0-9-]+$', 'lowercase letters, digits and dashes'] }), str('title', 'Title')]),
        ],
      },
      {
        name: 'course-overviews',
        label: 'Course overview pages',
        label_singular: 'Overview',
        folder: 'content/courses',
        path: '{{slug}}/index',
        extension: 'md',
        format: 'frontmatter',
        create: true,
        delete: false,
        fields: [str('title', 'Title'), opt(str('description', 'Description')), md('body', 'Body')],
      },
      ...lessonCollections,
      {
        name: 'settings',
        label: 'Settings',
        files: [
          {
            name: 'site', label: 'Site & game', file: 'content/site.json', format: 'json',
            fields: [
              str('name', 'Name'), str('shortName', 'Short name'), str('role', 'Role'), str('tagline', 'Tagline'), text('description', 'Description (SEO)'),
              opt(str('location', 'Location')), opt(str('email', 'Email')), str('siteUrl', 'Site URL'), opt(str('learnUrl', 'Learn site URL')),
              opt(str('cookieDomain', 'Cookie domain for shared XP (e.g. .example.com)')),
              list('socials', 'Social links', link),
              { name: 'defaultTheme', label: 'Default theme', widget: 'select', options: ['terminal', 'quest', 'studio'] },
              obj('defaultPalettes', 'Default palettes', [str('terminal', 'Terminal'), str('quest', 'Quest'), str('studio', 'Studio')]),
              obj('game', 'Game', [
                bool('enabled', 'Game enabled', true),
                obj('rewards', 'XP rewards', ['visit', 'read', 'theme', 'palette', 'terminalCommand', 'lesson', 'quiz'].map((k) => num(k, k))),
                list('levels', 'Levels', [num('xp', 'XP needed'), str('name', 'Name')]),
              ]),
            ],
          },
          {
            name: 'profile', label: 'Profile (resume)', file: 'content/profile.json', format: 'json',
            fields: [
              str('headline', 'Headline'), text('summary', 'Summary'),
              list('experience', 'Experience', [
                str('company', 'Company'), str('role', 'Role'), opt(str('location', 'Location')),
                str('start', 'Start (YYYY-MM)'), opt(str('end', 'End (YYYY-MM, empty = present)')), opt(str('progression', 'Progression')),
                opt(list('engagements', 'Engagements / clients', [str('title', 'Title'), strList('highlights', 'Highlights')])),
                opt(strList('highlights', 'Highlights')),
              ], { summary: '{{role}} @ {{company}}' }),
              list('projects', 'Projects', [
                str('slug', 'Slug'), str('name', 'Name'), opt(str('year', 'Year')), bool('featured', 'Featured'), text('summary', 'Summary'),
                opt(strList('highlights', 'Highlights')), opt(strList('tags', 'Tags')), opt(list('links', 'Links', link)),
              ], { summary: '{{name}}' }),
              list('skills', 'Skill groups', [str('group', 'Group'), strList('items', 'Skills')], { summary: '{{group}}' }),
              list('education', 'Education', [str('degree', 'Degree'), str('institution', 'Institution'), opt(str('end', 'End (YYYY-MM)'))]),
              list('certifications', 'Certifications', [str('name', 'Name'), opt(str('status', 'Status'))]),
            ],
          },
          {
            name: 'achievements', label: 'Achievements', file: 'content/achievements.json', format: 'json',
            fields: [
              list('achievements', 'Achievements', [
                str('id', 'ID (never change after publishing)'), str('title', 'Title'), str('description', 'Description'), opt(str('icon', 'Icon (emoji)')),
                num('bonus', 'Bonus XP', { default: 0 }), bool('hidden', 'Secret (hidden until unlocked)'),
                obj('rule', 'Unlock rule', [
                  { name: 'type', label: 'Type', widget: 'select', options: ['xp', 'event', 'events', 'all-of', 'all-pages'] },
                  opt(num('min', 'Minimum (for xp / events)')),
                  opt(str('id', 'Event id (for event)')),
                  opt(str('prefix', 'Event prefix (for events), e.g. project: lesson: quiz:')),
                  opt(strList('ids', 'Event ids (for all-of)')),
                ]),
              ], { summary: '{{icon}} {{title}}' }),
            ],
          },
        ],
      },
    ],
  };

  return new Response(JSON.stringify(config, null, 2), { headers: { 'Content-Type': 'application/yaml; charset=utf-8' } });
}
