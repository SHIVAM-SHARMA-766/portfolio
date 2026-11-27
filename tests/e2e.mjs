// End-to-end test of both built sites and the API, in a real browser.
//   npm run build && npm run test:e2e
// CHROME_PATH selects the browser (default /usr/bin/chromium). The API is built
// from apps/api unless API_BIN points at a binary. It runs in DEV mode on a
// throwaway database; the static server proxies /api (and the WebSocket) to it
// and rewrites the production API URL in the HTML to the local one.
import { chromium } from 'playwright-core';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { routeTheme, themeCookie } from '../scripts/theme-routing.mjs';

const root = resolve(import.meta.dirname, '..');
const site = JSON.parse(await readFile(join(root, 'content/site.json'), 'utf8'));
const API_PORT = 4599;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'application/xml', '.yml': 'application/yaml' };

// --- API --------------------------------------------------------------------
const tmp = await mkdtemp(join(tmpdir(), 'pf-e2e-'));
let apiBin = process.env.API_BIN;
if (!apiBin) {
  apiBin = join(tmp, 'portfolio-api');
  execFileSync('go', ['build', '-o', apiBin, '.'], { cwd: join(root, 'apps/api'), stdio: 'inherit' });
}
const api = spawn(apiBin, [], {
  env: { ...process.env, DEV: '1', LISTEN: `127.0.0.1:${API_PORT}`, DB_PATH: join(tmp, 'e2e.db'), SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0000', ADMIN_USER: 'admin', ADMIN_PASS_HASH: '$2a$14$mrA8qWH7awOLViqiXwrCVOFtYL6FUfV8Qwq1QgVnI.eLXRQNNFK2S' /* e2e-admin-password */ },
  stdio: ['ignore', 'inherit', 'inherit'],
});
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`http://127.0.0.1:${API_PORT}/api/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

// --- static servers with /api proxy ------------------------------------------
function serve(dir, port) {
  const local = `http://localhost:${port}`;
  return new Promise((ok) => {
    const srv = createServer(async (req, res) => {
      if (req.url.startsWith('/api/')) {
        const p = httpRequest({ host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
        p.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
        req.pipe(p);
        return;
      }
      let reqUrl = req.url;
      if (port === 4501) { // same clean-URL theme routing as Caddy
        const r = routeTheme(req.url, req.headers.cookie ?? '', site.defaultTheme);
        if (r.redirect) { res.writeHead(r.status, { Location: r.redirect, 'Set-Cookie': themeCookie(r.setCookie) }); return res.end(); }
        if (r.rewrite) reqUrl = r.rewrite;
      }
      let pathname = decodeURIComponent(new URL(reqUrl, 'http://x').pathname);
      let base = dir;
      if (port === 4501 && pathname.startsWith('/admin')) {
        base = join(root, 'apps/admin/dist');
        pathname = pathname.replace(/^\/admin/, '') || '/';
      }
      let p = join(base, pathname);
      try {
        if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
        let body = await readFile(p);
        if (p.endsWith('.html')) body = body.toString().replaceAll(site.apiUrl, 'http://localhost:4501/api');
        res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(await readFile(join(dir, '404.html')).catch(() => 'not found'));
      }
    });
    srv.on('upgrade', (req, sock, head) => { // WebSocket → API
      // Browsers drop sockets abruptly when pages close; never let that crash the test.
      sock.on('error', () => up.destroy());
      const up = connect(API_PORT, '127.0.0.1', () => {
        up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        up.write(head);
        sock.pipe(up).pipe(sock);
      });
      up.on('error', () => sock.destroy());
      sock.on('close', () => up.destroy());
    });
    srv.listen(port, () => ok({ srv, local }));
  });
}

const siteSrv = await serve(join(root, 'apps/site/dist'), 4501);
const S = siteSrv.local;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const SHOTS = process.env.E2E_SHOTS; // optional folder for screenshots
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['✓', name]); } catch (e) { results.push(['✗', name, e.message.split('\n')[0]]); }
};
const blockFonts = (ctx) => ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

try {
  const ctx = await browser.newContext();
  await blockFonts(ctx);
  await ctx.addInitScript(() => { try { sessionStorage.setItem('pf.preview.theme:terminal', String(Date.now())); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  // XP gained from an action, ignoring the point every click earns
  const gainedWithoutClicks = (before, after) => Object.entries(after.events).filter(([id]) => !(id in before.events) && !id.startsWith('click:')).reduce((a, [, p]) => a + p, 0);
  page.on('pageerror', (e) => errors.push(e.message));
  const snap = () => page.evaluate(() => window.game.snapshot());
  const term = async (cmd) => { await page.fill('#shell-in', cmd); await page.press('#shell-in', 'Enter'); await page.waitForTimeout(60); };
  const lastOut = () => page.locator('#shell-out > div').last().innerText();

  await step('the home page is Studio, at a clean URL', async () => {
    await page.goto(`${S}/`);
    await page.waitForFunction(() => window.game?.account?.ready);
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'studio');
    assert.equal((await snap()).xp, 15);
    const hrefs = await page.locator('a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    assert.ok(hrefs.every((h) => !/^\/(terminal|quest|studio)\//.test(h)), 'no theme in any link');
  });

  await step('the portrait renders in every theme', async () => {
    assert.ok(await page.locator('.s-portrait img').evaluate((i) => i.complete && i.naturalWidth > 0), 'studio photo');
    const p = await browser.newPage();
    await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await p.addInitScript(() => { try { sessionStorage.setItem('pf.preview.theme:terminal', String(Date.now())); sessionStorage.setItem('pf.preview.theme:quest', String(Date.now())); localStorage.setItem('pf.prefs.v1', '{"welcomed":true}'); } catch {} });
    await p.goto(`${S}/?theme=terminal`);
    assert.ok(await p.locator('.t-portrait img').evaluate((i) => i.complete && i.naturalWidth > 0), 'terminal photo');
    await p.fill('#shell-in', 'cat portrait.jpg');
    await p.press('#shell-in', 'Enter');
    await p.waitForSelector('.t-ascii');
    assert.ok((await p.locator('.t-ascii').innerText()).length > 500, 'ASCII portrait');
    await shot(p, 'terminal-photo');
    await p.goto(`${S}/?theme=quest`);
    assert.ok(await p.locator('.q-photo').evaluate((i) => i.complete && i.naturalWidth > 0), 'quest photo');
    await shot(p, 'quest-photo');
    await p.close();
  });

  await step('first visit shows a welcome card, once', async () => {
    // Not on arrival: the card waits for the first scroll (or 8 s)
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.g-welcome').count(), 0, 'no welcome card on arrival');
    await page.mouse.wheel(0, 700);
    await page.waitForSelector('.g-welcome', { timeout: 5000 });
    await shot(page, 'welcome');
    await page.evaluate(() => scrollTo(0, 0));
    await page.click('[data-welcome="play"]');
    await page.reload();
    await page.waitForTimeout(1800);
    assert.equal(await page.locator('.g-welcome').count(), 0);
  });

  await step('clicking earns a point with a ripple', async () => {
    const before = await page.evaluate(() => window.game.countPrefix('click:'));
    await page.mouse.click(300, 400);
    await page.waitForSelector('.g-ripple', { state: 'attached', timeout: 2000 });
    await page.waitForSelector('.g-plus', { state: 'attached', timeout: 2000 });
    assert.equal(await page.evaluate(() => window.game.countPrefix('click:')), before + 1);
  });

  await step('?theme= switches theme, remembers it, keeps the URL clean', async () => {
    await page.goto(`${S}/about/?theme=terminal`);
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, '/about/');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'terminal');
    await page.goto(`${S}/projects/`);
    assert.equal(await page.getAttribute('html', 'data-theme'), 'terminal', 'cookie remembered');
    await page.goto(`${S}/quest/contact/`);
    assert.equal(new URL(page.url()).pathname, '/contact/', 'old theme URLs redirect');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'quest');
  });

  await step('terminal is locked by default (free preview)', async () => {
    await page.goto(`${S}/projects/?theme=terminal`);
    await page.waitForFunction(() => window.game?.account?.ready);
    assert.equal(await page.locator('[data-preview-bar="theme:terminal"]').isVisible(), true);
  });

  await step('opening a project awards XP once', async () => {
    const before = await snap();
    const home = page.url();
    // Project cards open the project's own page; the first open awards XP, later ones don't
    for (let i = 0; i < 2; i++) {
      await page.locator('.t-entry[data-xp-id^="project:"]').first().click();
      await page.waitForURL(/\/projects\/[a-z0-9-]+\/$/);
      assert.ok((await page.locator('.t-banner-title').innerText()).length > 3, 'project page has a banner');
      await page.goto(home);
    }
    assert.equal(gainedWithoutClicks(before, await snap()), site.game.rewards.project);
  });

  await step('terminal: filesystem, hidden files and a flag', async () => {
    await term('ls');
    assert.match(await lastOut(), /projects\//);
    assert.doesNotMatch(await lastOut(), /\.secrets/);
    await term('ls -a');
    assert.match(await lastOut(), /\.secrets/);
    await term('cat .secrets/recon.txt');
    const flag = (await page.locator('#shell-out').innerText()).match(/FLAG\{[^}]+\}/)[0];
    const before = (await snap()).xp;
    await term(`submit ${flag}`);
    await page.waitForFunction(() => window.game.has('flag:recon'));
    assert.ok((await snap()).xp > before);
    await term(`submit FLAG{nope}`);
    assert.match(await lastOut(), /not valid/);
  });

  await step('terminal: grep, decode and port-scan missions', async () => {
    await term('grep -r FLAG experience');
    const grepFlag = (await lastOut()).match(/FLAG\{[^}]+\}/)[0];
    await term(`submit ${grepFlag}`);
    await term('cat projects/portfolio/README.md');
    const b64 = (await page.locator('#shell-out').innerText()).match(/build-note: (\S+)/)[1];
    await term(`decode ${b64}`);
    await term(`submit ${(await lastOut()).trim()}`);
    await term('hack');
    let lo = 1, hi = 1024, flag = null;
    for (let i = 0; i < 12 && !flag; i++) {
      const mid = Math.floor((lo + hi) / 2);
      await term(String(mid));
      const t = (await page.locator('#shell-out > div').evaluateAll((els) => els.slice(-2).map((e) => e.textContent).join('\n')));
      if (/OPEN/.test(t)) flag = t.match(/FLAG\{[^}]+\}/)[0];
      else if (/higher/.test(t)) lo = mid + 1;
      else hi = mid - 1;
    }
    assert.ok(flag, 'binary search should find the port in 11 probes; output: ' + (await page.locator('#shell-out').innerText()).split('\n').slice(-8).join(' | '));
    await term(`submit ${flag}`);
    const s = await snap();
    for (const m of ['grep', 'decoder', 'portscan']) assert.ok(`flag:${m}` in s.events, m);
  });

  await step('page-source flag and terminal commands unlock achievements', async () => {
    const html = await (await page.request.get(`${S}/`)).text();
    await term(`submit ${html.match(/FLAG\{[^}]+\}/)[0]}`);
    for (const c of ['whoami', 'pwd', 'tree', 'status', 'neofetch']) await term(c);
    const s = await snap();
    const has = (id) => s.achievements.find((a) => a.id === id).unlocked;
    assert.ok(has('hacker') && has('first-blood') && has('ctf-champion'));
  });

  await step('a locked palette opens the shop at that palette', async () => {
    const btn = page.locator('[data-palette-btn="solarized"]');
    assert.equal(await btn.getAttribute('data-locked'), '');
    await btn.click();
    await page.waitForSelector('#shop-dialog[open]');
    const entry = page.locator('#shop-dialog [data-shop-entry="palette:terminal-solarized"]');
    assert.match(await entry.getAttribute('class'), /is-focus/);
    assert.equal(await page.locator('#shop-dialog .g-shop-note').isVisible(), true, 'guest is told to sign in');
    assert.notEqual(await page.getAttribute('html', 'data-palette'), 'solarized');
    await shot(page, 'shop-guest');
    await page.keyboard.press('Escape');
  });

  await step('a locked theme gets a free preview, then the unlock screen', async () => {
    await page.goto(`${S}/?theme=quest`);
    await page.waitForFunction(() => window.game?.account?.ready);
    assert.equal(await page.locator('[data-preview-bar]').isVisible(), true);
    assert.equal(await page.locator('[data-theme-lock]').isVisible(), false);
    await shot(page, 'quest-preview');
    await page.evaluate(() => sessionStorage.setItem('pf.preview.theme:quest', String(Date.now() - 600000)));
    // Someone reading is never locked out mid-page…
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-theme-lock]').isVisible(), false, 'no lock mid-page');
    // …the next page shows the unlock screen
    await page.reload();
    await page.waitForFunction(() => window.game?.account?.ready);
    assert.equal(await page.locator('[data-theme-lock]').isVisible(), true);
    assert.equal(await page.locator('[data-preview-bar]').isVisible(), false);
    await shot(page, 'quest-locked');
  });

  await step('sign-in merges guest progress into the account', async () => {
    const guestXp = (await snap()).xp;
    const r = await page.request.post(`${S}/api/dev/login`, { headers: { Origin: S } });
    assert.ok(r.ok());
    await page.goto(`${S}/?theme=terminal`);
    await page.waitForFunction(() => window.game?.account?.user);
    await page.waitForTimeout(1500);
    const me = await (await page.request.get(`${S}/api/me`)).json();
    assert.ok(me.state.xp >= guestXp, `server ${me.state.xp} < guest ${guestXp}`);
    assert.equal(await page.locator('.acct-user').isVisible(), true);
  });

  await step('a theme\'s palettes cannot be bought before the theme', async () => {
    await page.goto(`${S}/?theme=terminal`);
    await page.waitForFunction(() => window.game?.account?.user);
    await page.evaluate(() => window.game.openShop('palette:quest-dungeon'));
    const entry = page.locator('#shop-dialog [data-shop-entry="palette:quest-dungeon"]');
    assert.match(await entry.innerText(), /needs Quest/);
    assert.equal(await entry.locator('[data-buy]').count(), 0, 'no buy button before the theme');
    await shot(page, 'shop-signed-in');
    await page.keyboard.press('Escape');
    await term('buy palette:quest-dungeon');
    assert.match(await lastOut(), /unlock .*Quest.* first/i);
    const r = await page.request.post(`${S}/api/shop/buy`, { headers: { Origin: S }, data: { item: 'palette:quest-dungeon' } });
    assert.equal(r.status(), 409, 'API refuses too');
  });

  await step('buying the quest theme with coins unlocks it (with confirmation)', async () => {
    await page.goto(`${S}/?theme=quest`);
    await page.waitForFunction(() => window.game?.account?.ready);
    const coins = await page.evaluate(() => window.game.account.coins());
    const slot = page.locator('[data-theme-lock]:not([hidden]) [data-buy], [data-preview-bar]:not([hidden]) [data-buy]').first();
    await slot.click();
    await page.waitForTimeout(300);
    const confirmBtn = page.locator('.g-btn--confirm:visible').first();
    await confirmBtn.waitFor();
    assert.equal(await page.evaluate(() => window.game.account.owns('theme:quest')), false, 'first click only asks to confirm');
    await confirmBtn.click();
    await page.waitForFunction(() => window.game.account.owns('theme:quest'));
    assert.equal(await page.locator('[data-theme-lock]').isVisible(), false);
    const after = await page.evaluate(() => window.game.account.coins());
    const price = JSON.parse(await readFile(join(root, 'content/shop.json'), 'utf8')).items.find((i) => i.id === 'theme:quest').price;
    // The two button clicks may each earn a click point (throttled), so 0–2 coins come back.
    assert.ok(coins - after <= price && coins - after >= price - 2, `spent ${coins - after}, price ${price}`);
    const me = await (await page.request.get(`${S}/api/me`)).json();
    assert.ok('theme:quest' in me.state.purchases, 'purchase stored on the server');
  });

  await step('after the theme, its palette can be bought and is applied', async () => {
    await page.evaluate(() => window.game.openShop('palette:quest-dungeon'));
    const entry = page.locator('#shop-dialog [data-shop-entry="palette:quest-dungeon"]');
    await entry.locator('[data-buy]').click();
    await entry.locator('.g-btn--confirm').click();
    await page.waitForFunction(() => document.documentElement.dataset.palette === 'dungeon');
    await shot(page, 'quest-dungeon');
    await page.keyboard.press('Escape');
  });

  await step('live count and anonymous cursors between two visitors', async () => {
    const other = await browser.newContext();
    await blockFonts(other);
    const p2 = await other.newPage();
    await page.goto(`${S}/?theme=studio`);
    await p2.goto(`${S}/`);
    await page.waitForFunction(() => (() => { const el = document.querySelector('[data-live]'); return el?.textContent === '2 online' && /2 on this page/.test(el.title); })(), null, { timeout: 8000 });
    for (let i = 0; i < 5; i++) { await p2.mouse.move(400 + i * 20, 300); await p2.waitForTimeout(80); }
    await page.waitForSelector('.g-cursor', { timeout: 5000 });
    assert.equal(await page.locator('.g-cursor').count(), 1);
    await other.close();
  });

  await step('admin: sign in, dashboard, contacts and the CRM', async () => {
    const a = await ctx.newPage();
    a.on('pageerror', (e) => errors.push('admin: ' + e.message));
    await a.setViewportSize({ width: 1440, height: 900 });
    a.on('console', (m) => process.env.E2E_DEBUG && console.log('ADMIN', m.type(), m.text()));
    a.on('response', (r) => process.env.E2E_DEBUG && r.status() >= 400 && console.log('HTTP', r.status(), r.url()));
    await a.goto(`${S}/admin/`);
    await a.fill('input[autocomplete=username]', 'admin');
    await a.fill('input[type=password]', 'wrong-password');
    await a.click('button.primary');
    await a.waitForSelector('.error');
    await a.fill('input[type=password]', 'e2e-admin-password');
    await a.click('button.primary');
    await a.waitForSelector('.kpis');
    await a.waitForSelector('.chart-bars');
    await shot(a, 'admin-dashboard');
    // Contacts table
    await a.click('.side >> text=Contacts');
    await a.waitForSelector('.table--crm');
    assert.match(await a.locator('.table--crm').innerText(), /tester@example\.com/);
    await shot(a, 'admin-contacts');
    // One contact: stage, tag, note — all saved on the server
    await a.click('.table--crm tbody tr >> nth=0');
    await a.waitForSelector('.contact-head');
    await a.selectOption('.contact-head .stage-select', 'contacted');
    await a.fill('.tags-edit input', 'recruiter');
    await a.press('.tags-edit input', 'Enter');
    await a.fill('.note-form textarea', 'Emailed about a DevOps role');
    await a.click('.note-form button.primary');
    await a.waitForSelector('.notes li');
    await a.waitForSelector('.timeline');
    await shot(a, 'admin-contact');
    await a.reload();
    await a.waitForSelector('.notes li');
    assert.match(await a.locator('.notes').innerText(), /DevOps role/);
    assert.match(await a.locator('.tags-edit').innerText(), /recruiter/);
    assert.equal(await a.locator('.contact-head .stage-select').inputValue(), 'contacted');
    // Command palette
    await a.keyboard.press('Control+k');
    await a.waitForSelector('.cmdk-box');
    await a.keyboard.type('blog');
    await a.waitForSelector('.cmdk-item');
    await a.keyboard.press('Escape');
    const csv = await (await a.request.get(`${S}/api/admin/visitors.csv`)).text();
    assert.match(csv, /tester@example\.com.*contacted/);
    await a.close();
  });

  await step('contact form: a message lands in the admin inbox', async () => {
    const c = await ctx.newPage();
    c.on('pageerror', (e) => errors.push('contact: ' + e.message));
    await c.goto(`${S}/contact/`);
    await c.waitForSelector('[data-contact-form]');
    await c.click('[data-contact-form] button[type=submit]'); // empty: checked in the browser
    assert.match(await c.locator('.cf-status').innerText(), /check: name, email, message/);
    await c.fill('[name=name]', 'Asha Recruiter');
    await c.fill('[name=email]', 'asha@example.com');
    await c.selectOption('[name=topic]', 'job');
    await c.fill('[name=message]', 'Hi Shivam, we have a DevSecOps role that fits your profile.');
    await c.waitForTimeout(3100); // the server refuses forms sent within 3 seconds
    await c.click('[data-contact-form] button[type=submit]');
    await c.waitForSelector('.cf.is-sent');
    assert.match(await c.locator('.cf-status').innerText(), /Thanks/);
    await shot(c, 'contact-sent');
    // The admin sees it: badge, inbox, and on the contact page
    await c.goto(`${S}/admin/#/inbox`);
    await c.waitForSelector('.conv.is-unread');
    assert.equal(await c.locator('.side .nav-badge').innerText(), '1');
    await c.click('.conv');
    await c.waitForSelector('.conv-view');
    assert.match(await c.locator('.bubbles').innerText(), /DevSecOps role/);
    assert.match(await c.locator('.conv-note').innerText(), /Not signed in/); // a form sender has no login yet
    await c.waitForFunction(() => !document.querySelector('.side .nav-badge'));
    await shot(c, 'admin-inbox');
    await c.click('.conv-head >> text=Contact');
    await c.waitForSelector('.contact-head');
    assert.match(await c.locator('.contact-main').innerText(), /Messages\s*1[\s\S]*DevSecOps role/);
    assert.match(await c.locator('.tags-edit').innerText(), /contact-form/);
    await c.close();
  });

  await step('message bubble: visitor writes, admin replies, visitor reads the reply on the site', async () => {
    // `page` is signed in as the test visitor
    await page.goto(`${S}/projects/`);
    await page.waitForFunction(() => window.game?.account?.user);
    await page.click('.mb-fab');
    await page.waitForSelector('.mb-panel:not([hidden])');
    await page.waitForSelector('.mb[data-signed-in]');
    assert.equal(await page.locator('.mb [name=email]').isVisible(), false, 'signed in: no email needed');
    await page.fill('.mb textarea', 'Quick hello from the bubble!');
    await page.click('.mb-send');
    await page.waitForSelector('.mb-msg--me');
    // The admin answers in the Inbox
    const a = await ctx.newPage();
    await a.setViewportSize({ width: 1440, height: 900 });
    await a.goto(`${S}/admin/#/inbox`);
    await a.click('.conv >> text=Quick hello from the bubble!');
    await a.waitForSelector('.conv-view');
    assert.equal(await a.locator('.conv-note').count(), 0, 'signed-in visitor: no "not signed in" note');
    await a.fill('.conv-reply textarea', 'Thanks for stopping by!');
    await a.click('.conv-reply button.primary');
    await a.waitForSelector('.bubble--me');
    await shot(a, 'admin-conversation');
    await a.close();
    // The visitor sees a badge on the next page, and the reply in the bubble
    await page.goto(`${S}/about/`);
    await page.waitForSelector('.mb-badge:not([hidden])');
    assert.equal(await page.locator('.mb-badge').innerText(), '1');
    await page.click('.mb-fab');
    await page.waitForSelector('.mb-msg--them');
    assert.match(await page.locator('.mb-thread').innerText(), /Thanks for stopping by!/);
    assert.equal(await page.locator('.mb-badge').isHidden(), true);
    await shot(page, 'bubble-reply');
    await page.click('.mb-close');
    // A visitor who isn't signed in sends a note with an email
    const v = await browser.newContext();
    await blockFonts(v);
    const g = await v.newPage();
    g.on('pageerror', (e) => errors.push('bubble: ' + e.message));
    await g.goto(`${S}/`);
    await g.click('.mb-fab');
    await g.fill('.mb textarea', 'Hi, nice portfolio');
    await g.click('.mb-send');
    assert.match(await g.locator('.mb-status').innerText(), /email/i); // asks for the email first
    await g.fill('.mb [name=email]', 'guest@example.com');
    await g.waitForTimeout(3100 - 0); // the server refuses notes sent within 3 s of loading
    await g.click('.mb-send');
    await g.waitForSelector('.mb-status.is-ok');
    await v.close();
  });

  await step('analytics: cookie-free page views, sources and goals reach the admin', async () => {
    // Headless Chrome is filtered out as a bot, so look like a normal browser.
    const v = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
    await blockFonts(v);
    const pg = await v.newPage();
    pg.on('pageerror', (e) => errors.push('analytics: ' + e.message));
    await pg.goto(`${S}/projects/?utm_source=LinkedIn&utm_campaign=e2e`);
    await pg.waitForTimeout(300);
    await pg.goto(`${S}/contact/`);
    await pg.locator('a[href^="mailto:"]').first().dispatchEvent('click'); // counted without opening a mail app
    await pg.waitForTimeout(500);
    assert.deepEqual(await v.cookies(), [], 'no cookies set by analytics');
    await v.close();
    const a = await (await ctx.request.get(`${S}/api/admin/analytics?days=7`)).json();
    assert.ok(a.totals.visitors >= 1 && a.totals.views >= 2, JSON.stringify(a.totals));
    assert.ok(a.sources.some((x) => x.key === 'linkedin'), JSON.stringify(a.sources));
    assert.ok(a.campaigns.some((x) => x.key === 'e2e'));
    assert.ok(a.events.some((x) => x.key === 'email' && x.n === 1), JSON.stringify(a.events));
    assert.ok(a.pages.some((x) => x.key === '/projects/'));
    const ad = await ctx.newPage();
    await ad.setViewportSize({ width: 1440, height: 900 });
    await ad.goto(`${S}/admin/#/analytics`);
    await ad.waitForSelector('.goals');
    assert.match(await ad.locator('.content').innerText(), /linkedin/);
    assert.match(await ad.locator('.goals').innerText(), /1\s*Email link clicks/);
    await shot(ad, 'admin-analytics');
    await ad.close();
  });

  await step('SEO: structured data, share cards and responsive images', async () => {
    const pg = await browser.newPage();
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const ld = async (url) => {
      await pg.goto(`${S}${url}`);
      const blocks = await pg.locator('script[type="application/ld+json"]').allTextContents();
      return blocks.flatMap((b) => JSON.parse(b)['@graph']);
    };
    const types = (g) => g.map((x) => x['@type']);
    assert.deepEqual(types(await ld('/')), ['ProfilePage', 'WebSite']);
    const post = await ld('/blog/hello-world/');
    assert.deepEqual(types(post), ['BlogPosting', 'BreadcrumbList']);
    assert.ok(post[0].datePublished && post[0].author.name);
    assert.equal(await pg.getAttribute('meta[property="og:type"]', 'content'), 'article');
    const project = await ld('/projects/vault/');
    assert.ok(['SoftwareSourceCode', 'CreativeWork'].includes(project[0]['@type']));
    assert.deepEqual(project[1].itemListElement.map((i) => i.position), [1, 2, 3]);
    // Self-hosted fonts are served from the root whatever the theme (not rewritten into it)
    for (const theme of ['quest', 'studio']) {
      const r = await pg.request.get(`${S}/fonts/pixelify-sans-latin.woff2`, { headers: { Cookie: `pf_theme=${theme}` } });
      assert.equal(r.status(), 200, `font with pf_theme=${theme}`);
    }
    // The share image and every srcset candidate exist
    const og = new URL(await pg.getAttribute('meta[property="og:image"]', 'content'));
    assert.match(og.pathname, /\.jpg$/);
    assert.equal((await pg.request.get(`${S}${og.pathname}`)).status(), 200, og.pathname);
    await pg.goto(`${S}/projects/`);
    const sets = await pg.locator('img[srcset]').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('srcset')));
    assert.ok(sets.length > 0, 'cards use srcset');
    for (const url of new Set(sets.flatMap((x) => x.split(',').map((c) => c.trim().split(' ')[0])))) {
      assert.equal((await pg.request.get(`${S}${url}`)).status(), 200, url);
    }
    // A phone picks a small variant
    const m = await browser.newPage({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 1 });
    await m.goto(`${S}/projects/`);
    const src = await m.locator('img[srcset]').first().evaluate(async (i) => { i.loading = 'eager'; await i.decode().catch(() => {}); return i.currentSrc; });
    assert.match(src, /_w480\//, src);
    await m.close();
    await pg.close();
  });

  await step('no JavaScript errors', async () => assert.deepEqual(errors, []));

  await step('pages fit a 375px phone without horizontal scroll', async () => {
    const m = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await m.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    for (const url of ['/?theme=terminal', '/?theme=quest', '/?theme=studio', '/experience/?theme=terminal', '/projects/?theme=quest', '/blog/hello-world/?theme=studio', '/projects/dohra/?theme=studio', '/projects/dohra/?theme=quest', '/experience/va2pt/suzuki-digital/?theme=terminal']) {
      await m.goto(`${S}${url}`);
      const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `${url} overflows by ${over}px`);
    }
    await m.close();
  });
} finally {
  await browser.close();
  siteSrv.srv.close();
  api.kill();
}

for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === '✗').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
