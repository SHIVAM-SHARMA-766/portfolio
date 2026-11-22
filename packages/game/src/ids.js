// Event ids shared by the themes, the learn site and the game-data generator.
// The API only accepts ids listed in the generated catalog, so every place that
// awards an event must build its id with these helpers.

export const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export const ids = {
  visit: (pageId) => `visit:${pageId}`,
  read: (pageId) => `read:${pageId}`,
  theme: (theme) => `theme:${theme}`,
  palette: (theme, palette) => `palette:${theme}-${palette}`,
  project: (slug) => `project:${slug}`,
  experience: (title) => `exp:${slugify(title)}`,
  contact: (label) => `contact:${slugify(label)}`,
  terminal: (cmd) => `terminal:${cmd}`,
  lesson: (id) => `lesson:${id}`,
  quiz: (id) => `quiz:${id}`,
  course: (slug) => `course:${slug}`,
  secret: (id) => `secret:${id}`,
  flag: (id) => `flag:${id}`,
};

// Terminal commands that award points the first time they are run.
export const TERMINAL_COMMANDS = [
  'help', 'ls', 'cd', 'cat', 'pwd', 'tree', 'whoami', 'theme', 'palette', 'xp', 'shop', 'buy',
  'inventory', 'missions', 'achievements', 'contact', 'clear', 'date', 'echo', 'history',
  'grep', 'hack', 'login', 'status', 'uptime', 'neofetch', 'exit', 'sudo', 'rm', 'decode', 'submit',
];

export const SECRETS = ['konami', 'sudo-hire'];
