// Responsive images for uploads. scripts/responsive-images.mjs writes smaller
// WebP copies after the build (/uploads/_w480/…, /uploads/_w960/…) for every
// upload wider than that size; srcsetFor() names the same files, so a phone
// downloads a 480px card image instead of the 1600px original.
import sharp from 'sharp';
import { join } from 'node:path';

export const WIDTHS = [480, 960];
const PUBLIC = join(process.cwd(), 'public');
const RASTER = /^\/uploads\/(?!_w\d+\/).+\.(webp|png|jpe?g)$/i;
const cache = new Map<string, Promise<number>>();

/** Width of an upload in pixels (0 when it can't be read). */
function widthOf(src: string): Promise<number> {
  if (!cache.has(src)) cache.set(src, sharp(join(PUBLIC, src)).metadata().then((m) => m.width ?? 0).catch(() => 0));
  return cache.get(src)!;
}

/** The variant path for one width; always WebP. */
export const variant = (src: string, w: number) => src.replace(/^\/uploads\//, `/uploads/_w${w}/`).replace(/\.(png|jpe?g|webp)$/i, '.webp');

/** A JPEG copy for share cards (LinkedIn and others are unreliable with WebP). */
export const ogVariant = (src: string) => (RASTER.test(src) && !/\.jpe?g$/i.test(src) ? src.replace(/^\/uploads\//, '/uploads/_og/').replace(/\.(png|webp)$/i, '.jpg') : src);

/** srcset for an upload, or undefined for anything else (external, SVG, missing). */
export async function srcsetFor(src: string | null | undefined): Promise<string | undefined> {
  if (!src || !RASTER.test(src)) return undefined;
  const full = await widthOf(src);
  const smaller = WIDTHS.filter((w) => w < full);
  if (!smaller.length) return undefined;
  return [...smaller.map((w) => `${variant(src, w)} ${w}w`), `${src} ${full}w`].join(', ');
}
