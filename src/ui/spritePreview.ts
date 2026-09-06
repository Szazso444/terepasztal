import type { AtlasRegistry } from '../engine/atlas';
import { itemKind, locoDef, wagonDef } from '../gacha/items';
import { el } from './dom';

const cache = new Map<string, string>();

/** Crop one atlas frame into a data URL, scaled with nearest-neighbour. Cached per frame+scale. */
export function spriteDataUrl(atlas: AtlasRegistry, frame: string, scale = 2): string | null {
  const key = `${frame}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!atlas.has(frame)) return null;
  const f = atlas.get(frame);
  const rect = f.texture.frame;
  const src = atlas.images.get(frame.split('/')[0]);
  if (!src) return null;
  const c = document.createElement('canvas');
  c.width = Math.round(rect.width * scale);
  c.height = Math.round(rect.height * scale);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, rect.x, rect.y, rect.width, rect.height, 0, 0, c.width, c.height);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

/** Atlas frame that best represents an inventory item (loco or wagon), facing down-right. */
export function frameForItem(defId: string, facing = 0): string {
  if (itemKind(defId) === 'loco') {
    const d = locoDef(defId);
    return `rolling/loco_${d.body}_${d.paint}_f${facing}`;
  }
  const d = wagonDef(defId);
  return `rolling/wagon_${d.body}_${d.paint}_f${facing}`;
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
  img.draggable = false;
  return img;
}
