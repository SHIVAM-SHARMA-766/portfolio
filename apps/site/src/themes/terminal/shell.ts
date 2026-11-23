// The interactive terminal: a small shell over a virtual filesystem built from
// content (see fs.ts), with CTF-style missions, a port-scan mini-game, and the
// coin shop. Every command's first use awards XP; flags award more.
import { ids, TERMINAL_COMMANDS } from '@portfolio/game/ids';

type Node =
  | { type: 'dir'; children: Record<string, Node> }
  | { type: 'file'; content: string; href?: string; exec?: boolean }
  | { type: 'link'; href: string };
type Mission = { id: string; kind: string; title: string; brief: string; hint: string; reward: number; hash: string };
type Data = {
  fs: Node; pages: { name: string; title: string; url: string }[]; missions: Mission[]; portscanFlag: string;
  themes: string[]; palettes: string[]; name: string; role: string; email: string; learnUrl: string; theme: string;
};

const g = () => (window as any).game;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Renders an image as ASCII art (bright pixels become dense characters on the dark terminal). */
async function asciiArt(src: string) {
  const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  const cols = innerWidth < 600 ? 38 : 64;
  const rows = Math.round(cols * (img.height / img.width) * 0.5);
  const c = document.createElement('canvas');
  c.width = cols; c.height = rows;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, cols, rows);
  const px = ctx.getImageData(0, 0, cols, rows).data;
  const ramp = ' .,:;irsXA253hMHGS#9B&@';
  let out = '';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      // Transparent pixels (a cut-out's background) are blank; opaque dark
      // ones get a faint floor so the silhouette (hair, suit) still shows.
      const a = px[i + 3] / 255;
      const raw = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      const lum = a < 0.5 ? 0 : 0.14 + 0.86 * raw;
      out += ramp[Math.min(ramp.length - 1, Math.floor(lum * ramp.length))];
    }
    out += '\n';
  }
  return out;
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function startShell() {
  const data: Data = JSON.parse(document.getElementById('shell-data')!.textContent!);
  const out = document.getElementById('shell-out')!;
  const form = document.getElementById('shell-form') as HTMLFormElement;
  const input = document.getElementById('shell-in') as HTMLInputElement;
  const promptEl = document.getElementById('shell-cwd')!;
  const history: string[] = [];
  let hIdx = 0;
  let cwd: string[] = [];
  let mode: null | { kind: 'scan'; port: number; tries: number } = null;
  const started = Date.now();
  let follow = false;

  const print = (html: string, cls = '') => {
    const p = document.createElement('div');
    if (cls) p.className = cls;
    p.innerHTML = html;
    out.appendChild(p);
    // Follow the output only once the visitor is using the shell; the boot
    // lines must not drag the page away from the top on load.
    if (follow) p.scrollIntoView({ block: 'nearest' });
  };
  const printPre = (text: string, cls = '') => print(esc(text), `t-pre ${cls}`);
  const pathStr = (parts: string[]) => (parts.length ? `~/${parts.join('/')}` : '~');
  const setPrompt = () => (promptEl.textContent = `:${pathStr(cwd)}$`);
  const go = (url: string) => { print(`<span class="t-dim">opening ${esc(url)}…</span>`); setTimeout(() => (location.href = url), 250); };

  function resolve(path = ''): { node: Node | null; parts: string[] } {
    let parts = path.startsWith('~') || path.startsWith('/') ? [] : [...cwd];
    for (const seg of path.replace(/^~\/?|^\//, '').split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    let node: Node | null = data.fs;
    for (const seg of parts) {
      node = node?.type === 'dir' ? node.children[seg] ?? null : null;
      if (!node) break;
    }
    return { node, parts };
  }

  const missionDone = (m: Mission) => !!g()?.has(ids.flag(m.id));

  async function submit(flag: string) {
    if (!flag) return print('usage: submit FLAG{...}');
    const h = await sha256(flag.trim());
    const m = data.missions.find((x) => x.hash === h);
    if (!m) return print('✗ that flag is not valid. keep digging.', 't-err');
    if (missionDone(m)) return print(`✓ already captured: ${esc(m.title)}`);
    g()?.award(ids.flag(m.id), m.reward, { label: `Flag captured: ${m.title}` });
    print(`🚩 <b>${esc(m.title)}</b> captured! +${m.reward} XP`, 't-acc');
    const left = data.missions.filter((x) => !missionDone(x)).length;
    print(left ? `<span class="t-dim">${left} mission(s) left. type <span class="t-acc">missions</span></span>` : '🏆 every flag captured. respect.');
  }

  const listing = (node: Node & { type: 'dir' }, all: boolean) =>
    Object.entries(node.children)
      .filter(([n]) => all || !n.startsWith('.'))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([n, c]) => (c.type === 'dir' ? `<span class="t-acc-2">${esc(n)}/</span>` : c.type === 'link' ? `<span class="t-acc">${esc(n)}@</span>` : c.exec ? `<span class="t-acc">${esc(n)}*</span>` : esc(n)));

  function tree(node: Node, prefix = '', all = false): string[] {
    if (node.type !== 'dir') return [];
    const entries = Object.entries(node.children).filter(([n]) => all || !n.startsWith('.'));
    return entries.flatMap(([n, c], i) => {
      const last = i === entries.length - 1;
      const line = `${prefix}${last ? '└── ' : '├── '}${n}${c.type === 'dir' ? '/' : ''}`;
      return [line, ...tree(c, prefix + (last ? '    ' : '│   '), all)];
    });
  }

  function grep(pattern: string, start: string[], node: Node, recursive: boolean, ignoreCase: boolean, outLines: string[]) {
    if (node.type === 'file') {
      const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ignoreCase ? 'i' : '');
      for (const line of node.content.split('\n')) if (re.test(line)) outLines.push(`${pathStr(start)}: ${line}`);
    } else if (node.type === 'dir' && recursive) {
      for (const [n, c] of Object.entries(node.children)) grep(pattern, [...start, n], c, true, ignoreCase, outLines);
    }
  }

  const shopLine = (it: any) => {
    const a = g()?.account;
    const can = a?.canBuy(it.id) ?? { reason: 'login' };
    const tag = a?.owns(it.id) ? '<span class="t-acc">✓ owned </span>' : can.reason === 'requires' ? '<span class="t-dim">🔒 locked</span>' : `<span class="t-acc-2">🪙 ${String(it.price).padStart(4)}</span>`;
    const note = can.reason === 'requires' ? ` <span class="t-dim">(needs ${esc(it.requires)})</span>` : '';
    return `${tag}  ${esc(it.id.padEnd(28))} ${esc(it.label)}${note}`;
  };

  type Cmd = { help: string; run: (args: string[], raw: string) => void | Promise<void>; hidden?: boolean };
  const commands: Record<string, Cmd> = {
    help: { help: 'list commands', run: () => {
      printPre(Object.entries(commands).filter(([, c]) => !c.hidden).map(([k, c]) => `${k.padEnd(13)} ${c.help}`).join('\n'));
      print('<span class="t-dim">tip: Tab completes commands and paths, ↑/↓ walk history. Start with <span class="t-acc">missions</span>.</span>');
    } },
    ls: { help: 'ls [-a] [path] — list files', run: (a) => {
      const all = a.some((x) => x.startsWith('-') && x.includes('a'));
      const target = a.find((x) => !x.startsWith('-')) ?? '';
      const { node } = resolve(target);
      if (!node) return print(`ls: ${esc(target)}: No such file or directory`, 't-err');
      if (node.type !== 'dir') return print(esc(target));
      print(listing(node, all).join('  ') || '<span class="t-dim">(empty)</span>');
    } },
    cd: { help: 'cd <dir> — change directory', run: ([p = '~']) => {
      const { node, parts } = resolve(p);
      if (node?.type === 'link') return go(node.href);
      if (!node) return print(`cd: ${esc(p)}: No such file or directory`, 't-err');
      if (node.type !== 'dir') return print(`cd: ${esc(p)}: Not a directory`, 't-err');
      cwd = parts;
      setPrompt();
    } },
    pwd: { help: 'print working directory', run: () => print(esc(pathStr(cwd).replace('~', `/home/${data.name.split(' ')[0].toLowerCase()}`))) },
    cat: { help: 'cat <file> — show a file', run: async ([p]) => {
      if (!p) return print('usage: cat <file>');
      const { node } = resolve(p);
      if (!node) return print(`cat: ${esc(p)}: No such file or directory`, 't-err');
      if (node.type === 'dir') return print(`cat: ${esc(p)}: Is a directory`, 't-err');
      if (node.type === 'link') return print(`→ <a href="${esc(node.href)}">${esc(node.href)}</a>`);
      if (/\.(jpe?g|png|webp)$/i.test(p) && node.href) {
        try { printPre(await asciiArt(node.href), 't-ascii'); } catch { print('cat: cannot read image', 't-err'); }
        return;
      }
      printPre(node.content);
      if (node.href) print(`<span class="t-dim">→ <a href="${esc(node.href)}">open the full page</a> or type <span class="t-acc">open ${esc(p)}</span></span>`);
    } },
    tree: { help: 'tree [-a] — show the directory tree', run: (a) => {
      const all = a.includes('-a');
      printPre([pathStr(cwd), ...tree(resolve('').node!, '', all)].join('\n'));
    } },
    open: { help: 'open <page|file> — go to a page', run: ([p]) => {
      if (!p) return print(`pages: ${data.pages.map((x) => x.name).join(', ')}`);
      const page = data.pages.find((x) => x.name === p.replace(/\/$/, ''));
      if (page) return go(page.url);
      const { node } = resolve(p);
      if (node?.type === 'file' && node.href) return go(node.href);
      if (node?.type === 'link') return go(node.href);
      print(`open: ${esc(p)}: nothing to open`, 't-err');
    } },
    grep: { help: 'grep [-r] [-i] <text> [path] — search files', run: (a) => {
      const flags = a.filter((x) => x.startsWith('-')).join('');
      const [pattern, path = ''] = a.filter((x) => !x.startsWith('-'));
      if (!pattern) return print('usage: grep [-r] [-i] <text> [path]');
      const { node, parts } = resolve(path);
      if (!node) return print(`grep: ${esc(path)}: No such file or directory`, 't-err');
      if (node.type === 'dir' && !flags.includes('r')) return print(`grep: ${esc(path || '.')}: Is a directory (use -r)`, 't-err');
      const lines: string[] = [];
      grep(pattern, parts, node, flags.includes('r'), flags.includes('i'), lines);
      printPre(lines.length ? lines.slice(0, 60).join('\n') : '(no matches)');
    } },
    decode: { help: 'decode <base64> — decode base64 text', run: ([s]) => {
      try { printPre(atob(s ?? '')); } catch { print('decode: not valid base64', 't-err'); }
    } },
    missions: { help: 'missions [id] — your CTF missions', run: ([id]) => {
      if (id) {
        const m = data.missions.find((x) => x.id === id);
        return m ? print(`<b>${esc(m.title)}</b> — ${esc(m.brief)}<br><span class="t-dim">hint: ${esc(m.hint)}</span>`) : print(`missions: no mission "${esc(id)}"`, 't-err');
      }
      print(data.missions.map((m) => `${missionDone(m) ? '<span class="t-acc">[✓]</span>' : '[ ]'} <span class="t-acc-2">${esc(m.id.padEnd(9))}</span> ${esc(m.title)} — ${esc(m.brief)} <span class="t-dim">(+${m.reward} XP)</span>`).join('<br>'));
      print('<span class="t-dim">found a flag? <span class="t-acc">submit FLAG{...}</span> · stuck? <span class="t-acc">missions &lt;id&gt;</span> for a hint</span>');
    } },
    submit: { help: 'submit <FLAG{...}> — capture a flag', run: (_a, raw) => submit(raw) },
    hack: { help: 'hack — port-scan mini-game', run: () => {
      if (!data.portscanFlag) return print('hack: no target configured');
      mode = { kind: 'scan', port: 1 + Math.floor(Math.random() * 1024), tries: 11 };
      print('🎯 target <b>10.13.37.42</b> has one open port between 1 and 1024.');
      print('<span class="t-dim">type a port number to probe it. 11 probes — enough for a perfect binary search. type <span class="t-acc">quit</span> to give up.</span>');
      setPrompt();
      promptEl.textContent = ':scan>';
    } },
    shop: { help: 'list items you can unlock with coins', run: () => {
      const a = g()?.account;
      print(`🪙 <b>${a?.coins() ?? 0}</b> coins${a?.user ? '' : ' <span class="t-dim">(sign in to buy: <span class="t-acc">login</span>)</span>'}`);
      print((a?.shop ?? []).map(shopLine).join('<br>') || 'shop is empty');
      print('<span class="t-dim">buy with <span class="t-acc">buy &lt;item&gt;</span>, e.g. buy theme:quest</span>');
    } },
    buy: { help: 'buy <item> — unlock a theme or palette', run: async ([id]) => {
      if (!id) return print('usage: buy <item>   (see: shop)');
      const a = g()?.account;
      const it = a?.item(id);
      if (!it) return print(`buy: no item "${esc(id)}". see: shop`, 't-err');
      const can = a.canBuy(id);
      if (can.reason === 'owned') return print(`you already own ${esc(it.label)}`);
      if (can.reason === 'requires') return print(`🔒 unlock ${esc(can.requires?.label ?? 'its theme')} first: buy ${esc(it.requires)}`, 't-err');
      if (can.reason === 'login') return print('sign in first: <span class="t-acc">login</span>');
      if (can.reason === 'coins') return print(`not enough coins: need ${can.short} more. explore, run missions, capture flags.`, 't-err');
      const r = await a.buy(id);
      if (!r.ok) return print(`buy: ${esc(r.message ?? 'failed')}`, 't-err');
      print(`✓ unlocked <b>${esc(it.label)}</b> · 🪙 ${a.coins()} left`, 't-acc');
      if (it.kind === 'palette' && it.theme === data.theme) { g()?.applyPalette(it.palette); print(`<span class="t-dim">applied.</span>`); }
    } },
    inventory: { help: 'what you own', run: () => {
      const a = g()?.account;
      const owned = (a?.shop ?? []).filter((it: any) => a.owns(it.id));
      print(`🪙 ${a?.coins() ?? 0} coins · themes: terminal, studio${owned.length ? ' · ' + owned.map((i: any) => esc(i.label)).join(', ') : ''}`);
    } },
    status: { help: 'level, XP, coins, flags', run: () => {
      const s = g()?.snapshot();
      if (!s) return print('game is not running');
      const a = g()?.account;
      const flags = data.missions.filter(missionDone).length;
      print(`level ${s.level.number} <b>${esc(s.level.name)}</b> · ${s.xp} XP · 🪙 ${a?.coins() ?? s.xp} · 🚩 ${flags}/${data.missions.length} flags · ${s.achievements.filter((x: any) => x.unlocked).length}/${s.achievements.length} achievements`);
      print(a?.user ? `<span class="t-dim">signed in as ${esc(a.user.email || a.user.name)} — progress is saved</span>` : '<span class="t-dim">guest — progress lives in this browser. <span class="t-acc">login</span> to save it.</span>');
    } },
    login: { help: 'sign in to save progress', run: () => {
      const a = g()?.account;
      if (a?.user) return print(`already signed in as ${esc(a.user.email || a.user.name)}. <span class="t-dim">(logout to sign out)</span>`);
      g()?.openDialog('login-dialog');
      print('<span class="t-dim">opened the sign-in window.</span>');
    } },
    logout: { help: 'sign out', hidden: true, run: async () => { await g()?.account?.logout(); print('signed out.'); } },
    achievements: { help: 'open the achievements panel', run: () => (document.getElementById('ach-dialog') as HTMLDialogElement).showModal() },
    theme: { help: 'theme <name> — switch theme', run: ([t]) => {
      if (!t || !data.themes.includes(t)) return print(`themes: ${data.themes.join(', ')}`);
      go(`${location.pathname}?theme=${t}`);
    } },
    palette: { help: 'palette <name> — switch colours', run: ([p]) => {
      const btn = document.querySelector<HTMLElement>(`[data-palette-btn="${CSS.escape(p ?? '')}"]`);
      if (!btn) return print(`palettes: ${data.palettes.join(', ')}`);
      btn.click();
      print(btn.hasAttribute('data-locked') ? '<span class="t-dim">that palette is locked — see shop</span>' : `palette set to ${esc(p!)}`);
    } },
    whoami: { help: 'who is this', run: () => print(`<b>${esc(data.name)}</b> — ${esc(data.role)}`) },
    neofetch: { help: 'system info', run: () => {
      const s = g()?.snapshot();
      printPre([
        `   ▄▄▄▄▄     ${data.name.toLowerCase().replace(' ', '@')}`,
        '  █ >_  █    ------------------',
        `  █▄▄▄▄▄█    role:   ${data.role}`,
        `             theme:  ${data.theme}`,
        `             level:  ${s ? `${s.level.number} (${s.level.name})` : '?'}`,
        `             xp:     ${s?.xp ?? 0}`,
        `             flags:  ${data.missions.filter(missionDone).length}/${data.missions.length}`,
        `             uptime: ${Math.round((Date.now() - started) / 1000)}s on this page`,
      ].join('\n'));
    } },
    uptime: { help: 'how long you have been here', run: () => print(`up ${Math.round((Date.now() - started) / 1000)} seconds, ${document.querySelector('[data-live]')?.textContent ?? '1 user'}`) },
    contact: { help: 'how to reach me', run: () => print(data.email ? `<a href="mailto:${esc(data.email)}">${esc(data.email)}</a>` : 'see the contact page') },
    history: { help: 'command history', run: () => printPre(history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n')) },
    clear: { help: 'clear the screen', run: () => (out.innerHTML = '') },
    date: { help: 'current date', run: () => print(new Date().toString()) },
    echo: { help: 'echo <text>', run: (_a, raw) => print(esc(raw)) },
    exit: { help: 'leave', run: () => print('there is no exit. try <span class="t-acc">theme studio</span> for the quiet version.') },
    sudo: { help: '', hidden: true, run: (a) => {
      if (a.join(' ').toLowerCase() === 'hire shivam') {
        g()?.award(ids.secret('sudo-hire'), 0, { label: 'Secret found' });
        print('[sudo] permission granted. excellent decision. 🎉', 't-acc');
        if (data.email) print(`→ <a href="mailto:${esc(data.email)}?subject=Let's%20work%20together">${esc(data.email)}</a>`);
      } else print('nice try. this incident will be reported. (hint: sudo hire …)', 't-err');
    } },
    rm: { help: '', hidden: true, run: () => print("rm: permission denied. everything here is in Git anyway.", 't-err') },
    './contact.sh': { help: '', hidden: true, run: () => {
      const n = resolve('~/contact.sh').node;
      if (n?.type === 'file') printPre(n.content.split('\n').filter((l) => l.startsWith('echo')).map((l) => l.replace(/^echo "|"$/g, '')).join('\n'));
      g()?.award(ids.contact('email'), g().rewards.contactEmail ?? 10, { label: 'Saying hello' });
    } },
  };

  function scanProbe(line: string) {
    if (!mode) return;
    if (/^(quit|exit|q)$/i.test(line)) { mode = null; setPrompt(); return print('scan aborted.'); }
    const n = Number(line);
    if (!Number.isInteger(n) || n < 1 || n > 1024) return print('enter a port between 1 and 1024 (or quit)', 't-err');
    mode.tries--;
    if (n === mode.port) {
      mode = null;
      setPrompt();
      print(`<span class="t-acc">PORT ${n}/tcp OPEN</span> — banner: ${esc(atob(data.portscanFlag))}`);
      return print('<span class="t-dim">now <span class="t-acc">submit</span> it.</span>');
    }
    if (mode.tries <= 0) { const p = mode.port; mode = null; setPrompt(); return print(`out of probes. it was ${p}. run <span class="t-acc">hack</span> to try again.`, 't-err'); }
    print(`${n}/tcp closed — the open port is <b>${n < mode.port ? 'higher' : 'lower'}</b>. ${mode.tries} probe(s) left.`);
  }

  function runLine(line: string) {
    print(`<span class="t-ps1">shivam@portfolio</span><span class="t-dim">${esc(promptEl.textContent ?? '')}</span> ${esc(line)}`);
    if (mode) return scanProbe(line);
    const [name, ...args] = line.split(/\s+/);
    const raw = line.slice(name.length).trim();
    const cmd = commands[name] ?? commands[name.toLowerCase()];
    if (!cmd) return print(`${esc(name)}: command not found. type <span class="t-acc">help</span>`, 't-err');
    const key = name.toLowerCase().replace(/^\.\//, '');
    if (TERMINAL_COMMANDS.includes(key)) g()?.award(ids.terminal(key), g().rewards.terminalCommand ?? 3, { label: `ran ${key}` });
    Promise.resolve(cmd.run(args, raw)).catch((e) => print(esc(String(e)), 't-err'));
  }

  form.addEventListener('submit', (e) => {
    follow = true;
    e.preventDefault();
    const line = input.value.trim();
    input.value = '';
    if (!line) return;
    history.push(line);
    hIdx = history.length;
    runLine(line);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && hIdx > 0) { input.value = history[--hIdx]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { hIdx = Math.min(history.length, hIdx + 1); input.value = history[hIdx] ?? ''; }
    if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); out.innerHTML = ''; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const parts = input.value.split(/\s+/);
      const last = parts[parts.length - 1] ?? '';
      if (parts.length === 1) {
        const m = Object.keys(commands).filter((k) => k.startsWith(last) && !commands[k].hidden);
        if (m.length === 1) input.value = m[0] + ' ';
        else if (m.length > 1) print(m.join('  '), 't-dim');
        return;
      }
      if (parts[0] === 'theme') { const m = data.themes.find((t) => t.startsWith(last)); if (m) parts[parts.length - 1] = m; input.value = parts.join(' '); return; }
      if (parts[0] === 'buy') { const m = (g()?.account?.shop ?? []).map((i: any) => i.id).filter((i: string) => i.startsWith(last)); if (m.length === 1) parts[parts.length - 1] = m[0]; input.value = parts.join(' '); return; }
      const slash = last.lastIndexOf('/');
      const base = slash >= 0 ? last.slice(0, slash + 1) : '';
      const { node } = resolve(base || '.');
      if (node?.type !== 'dir') return;
      const m = Object.entries(node.children).filter(([n]) => n.startsWith(last.slice(slash + 1)) && (last.slice(slash + 1).startsWith('.') || !n.startsWith('.')));
      if (m.length === 1) parts[parts.length - 1] = base + m[0][0] + (m[0][1].type === 'dir' ? '/' : '');
      else if (m.length > 1) print(m.map(([n]) => n).join('  '), 't-dim');
      input.value = parts.join(' ');
    }
  });

  // Typing anywhere on the page focuses the prompt.
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !t.closest('input,textarea,dialog,select,button,a')) input.focus();
  });

  setPrompt();
  // A short boot sequence the first time per session.
  let booted = false;
  try { booted = sessionStorage.getItem('pf.booted') === '1'; sessionStorage.setItem('pf.booted', '1'); } catch { booted = true; }
  const welcome = () => print(`welcome to <b>${esc(data.name.toLowerCase().split(' ')[0])}-os</b>. ${data.missions.length} missions are waiting. type <span class="t-acc">help</span> or <span class="t-acc">missions</span>.`);
  if (booted || reduced) return welcome();
  const lines = ['[ OK ] mounted ~/projects', '[ OK ] loaded experience logs', '[ OK ] started game engine', `[ OK ] ${data.missions.length} flags hidden on this box`];
  lines.forEach((l, i) => setTimeout(() => { print(esc(l), 't-dim'); if (i === lines.length - 1) welcome(); }, 120 * (i + 1)));
}
