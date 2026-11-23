// Field definitions for every editable content file. The form engine
// (fields.jsx) renders these; the site build validates the result.
const s = (name, label, extra = {}) => ({ name, label, type: 'string', ...extra });
const text = (name, label, extra = {}) => ({ name, label, type: 'text', ...extra });
const md = (name, label, extra = {}) => ({ name, label, type: 'markdown', ...extra });
const num = (name, label, extra = {}) => ({ name, label, type: 'number', ...extra });
const bool = (name, label, extra = {}) => ({ name, label, type: 'boolean', ...extra });
const sel = (name, label, options, extra = {}) => ({ name, label, type: 'select', options, ...extra });
const list = (name, label, fields, extra = {}) => ({ name, label, type: 'list', fields, ...extra });
const strs = (name, label, extra = {}) => ({ name, label, type: 'strings', ...extra });
const obj = (name, label, fields, extra = {}) => ({ name, label, type: 'object', fields, ...extra });
const link = [s('label', 'Label'), s('url', 'URL')];
const heading = s('heading', 'Heading');

export const blockTypes = {
  hero: { label: 'Hero', fields: [s('heading', 'Heading', { required: true }), s('subheading', 'Subheading'), text('body', 'Intro (markdown)'), list('ctas', 'Buttons', [s('label', 'Label'), s('href', 'Link — "projects/" stays inside the theme, or a full URL')], { summary: 'label' })] },
  text: { label: 'Text', fields: [heading, md('body', 'Body', { required: true })] },
  stats: { label: 'Stats', fields: [heading, list('items', 'Numbers', [s('value', 'Value'), s('label', 'Label')], { summary: 'value' })] },
  experience: { label: 'Experience (from profile)', fields: [heading] },
  projects: { label: 'Projects (from profile)', fields: [heading, sel('filter', 'Show', ['all', 'featured']), num('limit', 'Maximum')] },
  skills: { label: 'Skills (from profile)', fields: [heading] },
  education: { label: 'Education & certifications (from profile)', fields: [heading] },
  contact: { label: 'Contact', fields: [heading, text('body', 'Text')] },
  cta: { label: 'Call to action', fields: [s('heading', 'Heading', { required: true }), text('body', 'Text'), s('label', 'Button label'), s('href', 'Button link')] },
  posts: { label: 'Blog posts', fields: [heading, num('limit', 'Maximum')] },
  courses: { label: 'Courses', fields: [heading] },
};

export const pageFields = [
  s('title', 'Title', { required: true }),
  s('slug', 'URL slug', { help: 'lowercase-with-dashes. Empty only for the home page.', pattern: '^[a-z0-9-]*$' }),
  s('navLabel', 'Menu label'),
  s('icon', 'Icon (emoji, shown in the Quest theme)'),
  num('order', 'Menu order'),
  bool('inNav', 'Show in menu'),
  bool('draft', 'Draft (hidden from the site)'),
  s('description', 'Description (for search engines)'),
  { name: 'blocks', label: 'Blocks', type: 'blocks', types: blockTypes },
];

export const postFields = [
  s('title', 'Title', { required: true }),
  s('description', 'Description'),
  { name: 'date', label: 'Date', type: 'date' },
  strs('tags', 'Tags'),
  bool('draft', 'Draft'),
];

export const lessonFields = [
  s('title', 'Title', { required: true }),
  s('description', 'Description'),
  obj('sidebar', 'Sidebar', [num('order', 'Order in chapter')]),
  sel('difficulty', 'Difficulty', ['', 'beginner', 'intermediate', 'advanced']),
  num('minutes', 'Reading time (minutes)'),
  s('lab', 'Browser lab URL'),
  bool('draft', 'Draft'),
  list('quiz', 'Quiz', [s('question', 'Question'), strs('options', 'Options'), num('answer', 'Correct option (0 = first)'), text('explanation', 'Explanation')], { summary: 'question' }),
];

export const overviewFields = [s('title', 'Title', { required: true }), s('description', 'Description')];

export const courseFields = [
  s('title', 'Title', { required: true }), text('description', 'Description'), s('level', 'Level'), s('duration', 'Duration'), s('icon', 'Icon (emoji)'),
  sel('status', 'Status', ['draft', 'published']), num('order', 'Order'), strs('tags', 'Tags'), strs('prerequisites', 'Prerequisites'),
  list('chapters', 'Chapters', [s('slug', 'Folder name', { pattern: '^[a-z0-9-]+$' }), s('title', 'Title')], { summary: 'title' }),
];

export const profileFields = [
  s('headline', 'Headline'), text('summary', 'Summary'),
  list('experience', 'Experience', [
    s('company', 'Company'), s('role', 'Role'), s('location', 'Location'), s('start', 'Start (YYYY-MM)'), s('end', 'End (YYYY-MM, empty = present)'), s('progression', 'Progression'),
    list('engagements', 'Clients / engagements', [s('title', 'Title'), strs('highlights', 'Highlights')], { summary: 'title' }),
    strs('highlights', 'Highlights'),
  ], { summary: 'role' }),
  list('projects', 'Projects', [
    s('slug', 'Slug', { pattern: '^[a-z0-9-]+$' }), s('name', 'Name'), s('year', 'Year'), bool('featured', 'Featured'), text('summary', 'Summary'),
    strs('highlights', 'Highlights'), strs('tags', 'Tags'), list('links', 'Links', link, { summary: 'label' }),
  ], { summary: 'name' }),
  list('skills', 'Skill groups', [s('group', 'Group'), strs('items', 'Skills')], { summary: 'group' }),
  list('education', 'Education', [s('degree', 'Degree'), s('institution', 'Institution'), s('end', 'End (YYYY-MM)')], { summary: 'degree' }),
  list('certifications', 'Certifications', [s('name', 'Name'), s('status', 'Status')], { summary: 'name' }),
];

export const siteFields = [
  s('name', 'Name'), s('shortName', 'Short name'), s('role', 'Role'), s('tagline', 'Tagline'), text('description', 'Description (search engines)'),
  s('photo', 'Photo', { help: 'Upload it under Media, then paste its path here, e.g. /uploads/me-abc.jpg. A 4:5 portrait works best.' }),
  s('photoCutout', 'Photo without background', { help: 'Optional. The same portrait as a transparent PNG/WebP (background removed). Themes use it for the animated hero and the Quest pixel sprite; without it they fall back to the photo.' }),
  s('photoAlt', 'Photo description (for screen readers)'),
  s('photoPosition', 'Photo crop focus', { help: 'Which part stays in frame, e.g. "50% 25%" keeps the face near the top. First number moves left/right, second up/down.' }),
  s('location', 'Location'), s('email', 'Email'), s('siteUrl', 'Site URL'), s('learnUrl', 'Learn site URL'), s('apiUrl', 'API URL'),
  s('cookieDomain', 'Cookie domain (shares progress across subdomains)'),
  list('socials', 'Social links', link, { summary: 'label' }),
  sel('defaultTheme', 'Default theme', ['terminal', 'quest', 'studio']),
  obj('defaultPalettes', 'Default palettes', [s('terminal', 'Terminal'), s('quest', 'Quest'), s('studio', 'Studio')]),
  obj('game', 'Game', [
    bool('enabled', 'Game enabled'),
    obj('rewards', 'XP per action', ['visit', 'read', 'theme', 'palette', 'project', 'experience', 'contact', 'contactEmail', 'terminalCommand', 'lesson', 'quiz', 'course', 'flag'].map((k) => num(k, k))),
    list('levels', 'Levels', [num('xp', 'XP needed'), s('name', 'Name')], { summary: 'name' }),
  ]),
];

export const shopFields = [list('items', 'Items', [
  s('id', 'Item id', { help: 'theme:<name> or palette:<theme>-<palette>. Never change after people have bought it.' }),
  s('label', 'Label'), text('description', 'Description'), num('price', 'Price (coins)'),
  s('requires', 'Requires (optional)', { help: 'Item that must be owned first. Palettes of a paid theme already require that theme.' }),
], { summary: 'label' })];

export const missionFields = [list('missions', 'Missions', [
  s('id', 'Id (never change after publishing)'),
  sel('kind', 'Where the flag lives', ['hidden-file', 'base64', 'grep', 'port-scan', 'page-source']),
  s('title', 'Title'), text('brief', 'Brief'), s('hint', 'Hint'), num('reward', 'XP reward'), s('flag', 'Flag', { help: 'Format FLAG{...}' }),
], { summary: 'title' })];

export const achievementFields = [list('achievements', 'Achievements', [
  s('id', 'Id (never change after publishing)'), s('title', 'Title'), s('description', 'Description'), s('icon', 'Icon (emoji)'),
  num('bonus', 'Bonus XP'), bool('hidden', 'Secret until unlocked'),
  obj('rule', 'Unlock rule', [
    sel('type', 'Type', ['xp', 'event', 'events', 'all-of', 'all-pages']),
    num('min', 'Minimum (xp / events)'), s('id', 'Event id (event)'), s('prefix', 'Event prefix (events), e.g. project: lesson: flag:'), strs('ids', 'Event ids (all-of)'),
  ]),
], { summary: 'title' })];
