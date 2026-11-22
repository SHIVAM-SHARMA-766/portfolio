// End-to-end smoke test against the built sites, using a system Chromium.
//   npm run build && npm run test:e2e
// CHROME_PATH selects the browser (default: /usr/bin/chromium).
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'application/xml', '.yml': 'application/yaml' };

function serve(dir, port) {
  return new Promise((ok) => {
    const srv = createServer(async (req, res) => {
      let p = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      try {
        if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
        res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream' });
        res.end(await readFile(p));
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(await readFile(join(dir, '404.html')).catch(() => 'not found'));
      }
    });
    srv.listen(port, () => ok(srv));
  });
}

const root = resolve(import.meta.dirname, '..');
const site = await serve(join(root, 'apps/site/dist'), 4501);
const learn = await serve(join(root, 'apps/learn/dist'), 4502);
// Fonts come from Google; block them so the test never depends on the network.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['✓', name]); } catch (e) { results.push(['✗', name, e.message]); }
};

try {
  const ctx = await browser.newContext();
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const xp = () => page.evaluate(() => window.game.snapshot().xp);

  await step('root redirects to the default theme', async () => {
    await page.goto('http://localhost:4501/');
    await page.waitForURL(/\/terminal\/$/);
  });

  await step('visit + theme discovery award XP', async () => {
    await page.waitForFunction(() => window.game);
    assert.equal(await xp(), 15);
  });

  await step('opening a project awards XP once', async () => {
    await page.goto('http://localhost:4501/terminal/projects/');
    await page.waitForFunction(() => window.game);
    const before = await xp();
    const summary = page.locator('.t-project summary').first();
    await summary.click();
    await summary.click();
    await summary.click();
    assert.equal(await xp(), before + 15);
  });

  await step('terminal commands work and award XP', async () => {
    const before = await xp();
    for (const c of ['help', 'ls', 'whoami', 'xp', 'date']) {
      await page.fill('#shell-in', c);
      await page.press('#shell-in', 'Enter');
    }
    assert.match(await page.locator('#shell-out').innerText(), /command|about/);
    const s = await page.evaluate(() => window.game.snapshot());
    assert.ok(s.achievements.find((a) => a.id === 'hacker').unlocked, 'hacker achievement');
    assert.equal(s.xp, before + 5 * 3 + 15);
  });

  await step('secret sudo command unlocks a hidden achievement', async () => {
    await page.fill('#shell-in', 'sudo hire shivam');
    await page.press('#shell-in', 'Enter');
    const s = await page.evaluate(() => window.game.snapshot());
    assert.ok(s.achievements.find((a) => a.id === 'sudo').unlocked);
  });

  await step('palettes switch, persist, and locked ones stay locked', async () => {
    await page.click('[data-palette-btn="amber"]');
    assert.equal(await page.getAttribute('html', 'data-palette'), 'amber');
    await page.reload();
    assert.equal(await page.getAttribute('html', 'data-palette'), 'amber');
    const total = await page.evaluate(() => window.game.snapshot().xp);
    if (total < 150) {
      await page.click('[data-palette-btn="solarized"]');
      assert.equal(await page.getAttribute('html', 'data-palette'), 'amber');
    }
  });

  await step('same content renders in quest and studio themes', async () => {
    for (const t of ['quest', 'studio']) {
      await page.goto(`http://localhost:4501/${t}/projects/`);
      assert.ok(await page.getByText('Dohra — local class recorder').first().isVisible());
      assert.equal(await page.getAttribute('html', 'data-theme'), t);
    }
    const s = await page.evaluate(() => window.game.snapshot());
    assert.ok(s.achievements.find((a) => a.id === 'shapeshifter').unlocked);
  });

  await step('skip game hides the game UI', async () => {
    await page.click('.s-footer [data-game-toggle]');
    assert.equal(await page.getAttribute('html', 'data-game'), 'off');
    assert.equal(await page.locator('.s-pill').isVisible(), false);
    await page.click('.s-footer [data-game-toggle]');
    assert.equal(await page.getAttribute('html', 'data-game'), 'on');
  });

  await step('admin config is generated', async () => {
    const res = await page.request.get('http://localhost:4501/admin/config.yml');
    const cfg = JSON.parse(await res.text());
    assert.ok(cfg.collections.some((c) => c.name === 'lessons-docker-introduction'));
    // Sveltia refuses to start unless these are absolute URLs
    assert.match(cfg.site_url, /^https?:\/\//);
    assert.match(cfg.display_url, /^https?:\/\//);
  });

  await step('learn: passing a quiz completes the lesson', async () => {
    await page.goto('http://localhost:4502/docker/introduction/what-is-docker/');
    await page.waitForFunction(() => window.game);
    const qs = page.locator('.quiz-q');
    const n = await qs.count();
    for (let i = 0; i < n; i++) {
      const answer = await qs.nth(i).getAttribute('data-answer');
      await qs.nth(i).locator(`input[value="${answer}"]`).check();
    }
    await page.click('.quiz button[type=submit]');
    await page.waitForSelector('[data-complete][disabled]');
    const s = await page.evaluate(() => window.game.snapshot());
    assert.ok('quiz:docker/introduction/what-is-docker' in s.events);
    assert.ok(await page.locator('#starlight__sidebar a.lesson-done').count() >= 1);
  });

  await step('learn: course overview shows progress', async () => {
    await page.goto('http://localhost:4502/docker/');
    await page.waitForFunction(() => document.querySelector('.cp-text')?.textContent.includes('of'));
    assert.match(await page.locator('.cp-text').innerText(), /^1 of 6/);
  });

  await step('no JavaScript errors', async () => assert.deepEqual(errors, []));

  await step('pages fit a 375px phone without horizontal scroll', async () => {
    const m = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await m.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    for (const url of ['/terminal/', '/quest/', '/studio/', '/terminal/experience/', '/quest/projects/', '/studio/blog/hello-world/']) {
      await m.goto(`http://localhost:4501${url}`);
      const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `${url} overflows by ${over}px`);
    }
    await m.close();
  });
} finally {
  await browser.close();
  site.close();
  learn.close();
}

for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === '✗').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
