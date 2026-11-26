// Renders brand/og-card.html to apps/site/public/images/og-default.jpg, the
// share-card image used when a page has no image of its own. Edit the HTML
// (name, role, skills) and run:  node scripts/og-card.mjs
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`file://${root}/brand/og-card.html`, { waitUntil: 'networkidle' });
const png = await page.screenshot();
await browser.close();
const out = `${root}/apps/site/public/images/og-default.jpg`;
const info = await sharp(png).jpeg({ quality: 86, mozjpeg: true }).toFile(out);
console.log(`wrote ${out} (${Math.round(info.size / 1024)} KB)`);
