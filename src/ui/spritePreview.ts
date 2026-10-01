import type { AtlasRegistry } from '../engine/atlas';
import { previewLayers } from './previewLayers';
import { el } from './dom';

const caches = new WeakMap<AtlasRegistry, Map<string, string>>();

/** Crop a frame at its logical size; preserve smooth sampling for illustrated textures. */
export function spriteDataUrl(atlas: AtlasRegistry, frame: string, scale = 2): string | null {
  let cache = caches.get(atlas);
  if (!cache) {
    cache = new Map();
    caches.set(atlas, cache);
  }
  const key = `${frame}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (frame.startsWith('vehicle/')) {
    const match = /^vehicle\/(.+)_f(\d+)$/.exec(frame);
    if (!match) return null;
    const url = vehiclePreview(atlas, match[1], Number(match[2]), scale);
    cache.set(key, url);
    return url;
  }
  if (!atlas.has(frame)) return null;
  const f = atlas.get(frame);
  const rect = f.texture.frame;
  const src = f.image;
  if (!src) return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(f.w * scale));
  c.height = Math.max(1, Math.round(f.h * scale));
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = rect.width > f.w;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, rect.x, rect.y, rect.width, rect.height, 0, 0, c.width, c.height);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

/** Atlas frame that best represents an inventory item (loco or wagon), facing down-right. */
export function frameForItem(defId: string, facing = 0): string {
  return `vehicle/${defId}_f${facing}`;
}

/** Compose the entire vehicle, including articulated parts and separate wheel groups. */
export function vehiclePreview(atlas: AtlasRegistry, id: string, facing = 0, scale = 2): string {
  const layers = previewLayers(atlas, id, facing);
  const c = document.createElement('canvas');
  c.width = 240 * scale;
  c.height = 150 * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  ctx.translate(120, 100);
  for (const l of layers) {
    if (!atlas.has(l.key)) continue;
    const f = atlas.get(l.key),
      r = f.texture.frame;
    ctx.imageSmoothingEnabled = r.width > f.w;
    ctx.save();
    ctx.translate(l.x, l.y);
    if (l.flip) ctx.scale(-1, 1);
    ctx.drawImage(
      f.image,
      r.x,
      r.y,
      r.width,
      r.height,
      -f.anchorX * f.w,
      -f.anchorY * f.h,
      f.w,
      f.h,
    );
    ctx.restore();
  }
  const pixels = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = c.width,
    y0 = c.height,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (pixels.data[(y * c.width + x) * 4 + 3]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
  const out = document.createElement('canvas');
  out.width = Math.max(1, x1 - x0 + 8);
  out.height = Math.max(1, y1 - y0 + 8);
  out
    .getContext('2d')!
    .drawImage(
      c,
      x0,
      y0,
      Math.max(1, x1 - x0),
      Math.max(1, y1 - y0),
      4,
      4,
      Math.max(1, x1 - x0),
      Math.max(1, y1 - y0),
    );
  return out.toDataURL();
}

/** <img> element for a frame; empty span when the frame is unavailable. */
export function spriteImg(
  atlas: AtlasRegistry,
  frame: string,
  scale = 2,
  cls = 'sprite-preview',
): HTMLElement {
  const url = spriteDataUrl(atlas, frame, scale);
  if (!url) return el('span', { class: cls });
  const img = el('img', { class: cls, src: url, alt: '' });
  if (atlas.has(frame) && atlas.get(frame).texture.frame.width > atlas.get(frame).w) {
    img.style.imageRendering = 'auto';
  }
  img.draggable = false;
  return img;
}
