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
const img = (name, label, extra = {}) => ({ name, label, type: 'image', ...extra });
const doc = (name, label, extra = {}) => ({ name, label, type: 'file', ...extra });
const month = (name, label, extra = {}) => ({ name, label, type: 'month', ...extra });
const tags = (name, label, extra = {}) => ({ name, label, type: 'tags', ...extra });
const url = (name, label, extra = {}) => ({ name, label, type: 'url', ...extra });

// Suggestions shared by the profile forms (filled when profile.json loads)
export const pool = { skills: [], companies: [] };
export function fillPool(profile) {
  const skills = new Set();
  (profile.skills ?? []).forEach((g) => (g.items ?? []).forEach((x) => skills.add(x)));
  (profile.experience ?? []).forEach((j) => (j.skills ?? []).forEach((x) => skills.add(x)));
  (profile.projects ?? []).forEach((p) => (p.tags ?? []).forEach((x) => skills.add(x)));
  pool.skills = [...skills].sort((a, b) => a.localeCompare(b));
  pool.companies = (profile.experience ?? []).map((j) => j.company).filter(Boolean);
}
const skillsSuggest = () => pool.skills;
const EMPLOYMENT = ['Full-time', 'Part-time', 'Self-employed', 'Freelance', 'Contract', 'Internship', 'Apprenticeship', 'Trainee'];
const LOCATION_TYPES = ['On-site', 'Hybrid', 'Remote'];
const PROFICIENCY = ['Elementary', 'Limited working', 'Professional working', 'Full professional', 'Native or bilingual'];
const link = [s('label', 'Label'), s('url', 'URL')];
const heading = s('heading', 'Heading');

const card = [s('title', 'Title'), text('body', 'Text'), s('href', 'Link'), s('meta', 'Small line above the title'), s('badge', 'Badge'), img('image', 'Image'), s('icon', 'Icon (emoji)'), strs('tags', 'Tags'), s('cta', 'Link label')];
const subPages = list('pages', 'Detail pages', [s('slug', 'Slug', { pattern: '^[a-z0-9-]+$' }), s('title', 'Title'), text('summary', 'Summary'), md('body', 'Content')], { summary: 'title' });

export const blockTypes = {
  banner: { label: 'Banner (page header)', fields: [s('eyebrow', 'Small line above'), s('heading', 'Heading', { required: true }), text('body', 'Text'), img('image', 'Image (optional)'), strs('tags', 'Tags'), list('ctas', 'Buttons', [s('label', 'Label'), s('href', 'Link')], { summary: 'label' })] },
  glance: { label: 'At a glance', fields: [heading, list('facts', 'Facts', [s('label', 'Label'), s('value', 'Value'), s('href', 'Link (optional)')], { summary: 'label' }), strs('points', 'Key points')] },
  timeline: { label: 'Timeline', fields: [heading, text('body', 'Intro'), list('items', 'Milestones', [s('date', 'When (e.g. Jul 2025)'), s('title', 'Title'), text('body', 'Text'), s('href', 'Link (optional)'), s('tag', 'Tag (e.g. Work, Project, Learning)')], { summary: 'title' })] },
  cards: { label: 'Cards', fields: [heading, text('body', 'Intro'), num('columns', 'Columns (1–4)'), list('items', 'Cards', card, { summary: 'title' })] },
  hero: { label: 'Hero', fields: [s('heading', 'Heading', { required: true }), s('subheading', 'Subheading'), text('body', 'Intro (markdown)'), list('ctas', 'Buttons', [s('label', 'Label'), s('href', 'Link — "projects/" stays inside the theme, or a full URL')], { summary: 'label' })] },
  text: { label: 'Text', fields: [heading, md('body', 'Body', { required: true })] },
  stats: { label: 'Stats', fields: [heading, list('items', 'Numbers', [s('value', 'Value'), s('label', 'Label')], { summary: 'value' })] },
  experience: { label: 'Experience (from profile)', fields: [heading, bool('compact', 'Compact (one card per client, for the home page)')] },
  projects: { label: 'Projects (from profile)', fields: [heading, sel('filter', 'Show', ['all', 'featured']), num('limit', 'Maximum')] },
  skills: { label: 'Skills (from profile)', fields: [heading] },
  education: { label: 'Education & certifications (from profile)', fields: [heading] },
  contact: { label: 'Contact', fields: [heading, text('body', 'Text')] },
  cta: { label: 'Call to action', fields: [s('heading', 'Heading', { required: true }), text('body', 'Text'), s('label', 'Button label'), s('href', 'Button link')] },
  posts: { label: 'Blog posts', fields: [heading, num('limit', 'Maximum')] },
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
  img('cover', 'Cover image', { help: '1600×840 works best. Shown on the post, on its card, and when the link is shared.' }),
  s('coverAlt', 'Cover description (for screen readers)'),
  bool('draft', 'Draft'),
];

export const engagementFields = [
  s('title', 'Client / engagement', { help: 'e.g. "Suzuki Digital — DevSecOps & DevOps, AWS multi-account". The part before “—” is the short name.' }),
  text('summary', 'Summary'), tags('tags', 'Skills', { suggest: skillsSuggest }), img('cover', 'Cover image (optional)'),
  strs('highlights', 'What I did (one per line)'), md('body', 'Full story (shown on its page)'), subPages,
  s('slug', 'URL slug (default: from the title)', { pattern: '^[a-z0-9-]*$' }),
];

export const jobFields = [
  s('role', 'Title', { required: true, placeholder: 'DevOps Engineer' }),
  sel('employmentType', 'Employment type', EMPLOYMENT),
  s('company', 'Company or organisation', { required: true }),
  month('start', 'Start date', { help: 'When you joined the company.' }),
  month('end', 'End date', { present: 'I currently work here' }),
  s('location', 'Location', { placeholder: 'Delhi, India' }),
  sel('locationType', 'Location type', LOCATION_TYPES),
  list('positions', 'Positions at this company (promotions)', [s('title', 'Title'), month('start', 'Start date'), month('end', 'End date', { present: 'Current title' })], { summary: 'title', help: 'Newest first, like LinkedIn: e.g. DevOps Engineer → Junior DevOps Engineer → Trainee.' }),
  text('summary', 'Description', { rows: 4, help: 'What the role is about; shown on its page.' }),
  tags('skills', 'Skills', { suggest: skillsSuggest }),
  img('logo', 'Company logo (optional)'),
  list('engagements', 'Clients / engagements (each gets its own page)', engagementFields, { summary: 'title' }),
  strs('highlights', 'Key points (for roles without separate clients)'),
  s('slug', 'URL slug (default: from the company name)', { pattern: '^[a-z0-9-]*$' }),
];

export const educationFields = [
  s('school', 'School', { required: true }),
  s('degree', 'Degree', { placeholder: 'B.Tech' }),
  s('field', 'Field of study', { placeholder: 'Artificial Intelligence & Machine Learning' }),
  month('start', 'Start date'), month('end', 'End date (or expected)'),
  s('grade', 'Grade'),
  text('activities', 'Activities and societies'),
  text('description', 'Description'),
  tags('skills', 'Skills', { suggest: skillsSuggest }),
  img('logo', 'School logo (optional)'),
];

export const certificationFields = [
  s('name', 'Name', { required: true, placeholder: 'Certified Kubernetes Administrator (CKA)' }),
  s('issuer', 'Issuing organisation', { placeholder: 'The Linux Foundation' }),
  sel('status', 'Status', ['earned', 'in-progress', 'planned'], { labels: { earned: 'Earned', 'in-progress': 'In progress', planned: 'Planned' } }),
  month('issued', 'Issue date'), month('expires', 'Expiration date', { present: 'This credential does not expire' }),
  s('credentialId', 'Credential ID'),
  url('credentialUrl', 'Credential URL'),
  tags('skills', 'Skills', { suggest: skillsSuggest }),
  text('note', 'Note (optional)'),
];

export const skillGroupFields = [s('group', 'Group', { required: true, placeholder: 'Cloud' }), tags('items', 'Skills', { suggest: skillsSuggest })];
export const languageFields = [s('name', 'Language', { required: true }), sel('proficiency', 'Proficiency', PROFICIENCY)];
export const awardFields = [s('title', 'Title', { required: true }), s('issuer', 'Issuer'), month('date', 'Issue date'), text('description', 'Description'), url('url', 'Link (optional)')];
export const volunteeringFields = [s('organization', 'Organisation', { required: true }), s('role', 'Role', { required: true }), s('cause', 'Cause'), month('start', 'Start date'), month('end', 'End date', { present: 'I am currently volunteering here' }), text('description', 'Description')];

export const aboutFields = [
  s('headline', 'Headline', { help: 'A one-line summary of who you are professionally.' }),
  text('summary', 'About', { rows: 8, help: 'The short “About” used across the site. Your longer story lives on the About page.' }),
];

// Intro: the basics visitors see first (LinkedIn's intro + contact info)
export const introFields = [
  s('name', 'Full name', { required: true }), s('shortName', 'Short name (used in the terminal theme)'),
  s('role', 'Headline', { help: 'e.g. DevOps / DevSecOps Engineer' }),
  s('tagline', 'Tagline', { help: 'One sentence, used in the footer.' }),
  s('location', 'Location'),
  s('availability', 'Open to work badge (optional)', { help: 'e.g. “Open to DevOps / DevSecOps roles”. Leave empty to hide.' }),
  img('photo', 'Profile photo', { help: 'A 4:5 portrait works best. Also the preview image when the site is shared.' }),
  img('photoCutout', 'Photo without background (optional)'),
  s('photoAlt', 'Photo description (for screen readers)'),
  doc('resume', 'CV / resume (PDF)', { help: 'Shows a “Download CV” button in the hero and on the contact page.' }),
  s('email', 'Email', { help: 'Shown on the contact page.' }),
  list('socials', 'Contact info and profiles (LinkedIn, GitHub…)', [s('label', 'Label', { suggest: ['LinkedIn', 'GitHub', 'X', 'Medium', 'Dev.to', 'Stack Overflow', 'YouTube', 'Website'] }), url('url', 'URL')], { summary: 'label' }),
];

export const siteFields = [
  text('description', 'Description (search engines)'),
  s('photoPosition', 'Photo crop focus', { help: 'Which part stays in frame, e.g. "50% 25%". First number moves left/right, second up/down.' }),
  s('siteUrl', 'Site URL'), s('learnUrl', 'Learn site URL'), s('apiUrl', 'API URL'),
  s('cookieDomain', 'Cookie domain (shares progress across subdomains)'),
  sel('defaultTheme', 'Default theme', ['terminal', 'quest', 'studio']),
  obj('defaultPalettes', 'Default palettes', [s('terminal', 'Terminal'), s('quest', 'Quest'), s('studio', 'Studio')]),
  obj('game', 'Game', [
    obj('rewards', 'XP per action', ['visit', 'read', 'theme', 'palette', 'project', 'experience', 'contact', 'contactEmail', 'terminalCommand', 'flag'].map((k) => num(k, k))),
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
