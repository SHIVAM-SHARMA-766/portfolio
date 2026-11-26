// After the site build: smaller WebP copies of every upload, for srcset
// (see apps/site/src/lib/images.ts, which must use the same widths and paths),
// plus a JPEG of each (max 1200px) in _og/ for link previews.
import sharp from 'sharp';
import { readdir, mkdir, stat } from 'node:fs/promises';
import { join, dirname, relative, resolve } from 'node:path';

const WIDTHS = [480, 960];
const dist = resolve(import.meta.dirname, '../apps/site/dist/uploads');

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!/^(_w\d+|_og)$/.test(e.name)) yield* walk(join(dir, e.name)); }
    else if (/\.(webp|png|jpe?g)$/i.test(e.name)) yield join(dir, e.name);
  }
}

let made = 0;
try { await stat(dist); } catch { console.log('responsive-images: no uploads'); process.exit(0); }
for await (const file of walk(dist)) {
  const { width = 0 } = await sharp(file).metadata();
  for (const w of WIDTHS.filter((x) => x < width)) {
    const out = join(dist, `_w${w}`, relative(dist, file)).replace(/\.(png|jpe?g|webp)$/i, '.webp');
    await mkdir(dirname(out), { recursive: true });
    await sharp(file).resize({ width: w }).webp({ quality: 78 }).toFile(out);
    made++;
  }
  if (!/\.jpe?g$/i.test(file)) {
    const og = join(dist, '_og', relative(dist, file)).replace(/\.(png|webp)$/i, '.jpg');
    await mkdir(dirname(og), { recursive: true });
    await sharp(file).resize({ width: Math.min(width, 1200) }).flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toFile(og);
    made++;
  }
}
console.log(`responsive-images: ${made} variants`);
