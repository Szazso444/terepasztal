// Preview-only style options applied to the running review scene. No production code changes.
import { ImageSource, Sprite, Texture } from 'pixi.js';
import { smoothPixelArt, snapToGrid } from './pixelfilters.js';

function pixels(t) {
  const fr = t.frame,
    c = document.createElement('canvas');
  c.width = fr.width;
  c.height = fr.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(t.source.resource, fr.x, fr.y, fr.width, fr.height, 0, 0, fr.width, fr.height);
  return ctx.getImageData(0, 0, fr.width, fr.height).data;
}
function texture(data, w, h, logicalWidth, scaleMode) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  return new Texture({
    source: new ImageSource({ resource: c, scaleMode, resolution: w / logicalWidth }),
  });
}
/** Every sprite in the stage except terrain chunks and night-window masks. */
function sprites(game, visit) {
  const chunks = game.world.landscape.root;
  const walk = (o) => {
    if (o === chunks) return;
    if (o instanceof Sprite && o.texture !== Texture.EMPTY && o.label !== 'emissive') visit(o);
    for (const child of o.children ?? []) walk(child);
  };
  walk(game.app.stage);
}

/**
 * Both sharp: every asset snapped to the ground's grid of one art pixel per world pixel, each cell
 * its dominant colour, hard alpha, drawn unfiltered. The ground is drawn unfiltered at that grid.
 */
const snapped = new Map();
export function sharp(game) {
  const l = game.world.landscape,
    // Unfiltered at 1x and closer; zoomed out, pixel styles are reduced with filtering.
    mode = game.camera.zoom >= 1 ? 'nearest' : 'linear';
  // Ground: the double-resolution chunks snapped to one cell per world pixel, like the assets.
  // Zoomed out, the one-pixel-per-world-pixel base cache is already on that grid.
  for (const c of l.chunks.values()) {
    c.details.visible = false;
    if (!c.sharp || c.sprite.texture === c.base) {
      if (c.base !== Texture.EMPTY) c.base.source.scaleMode = mode;
      continue;
    }
    let r = snapped.get(c.sharp.uid);
    if (!r) {
      const t = c.sharp,
        g = snapToGrid(pixels(t), t.frame.width, t.frame.height, 2);
      r = texture(g.data, g.w, g.h, g.w, 'nearest');
      snapped.set(c.sharp.uid, r);
    }
    r.source.scaleMode = mode;
    c.sprite.texture = r;
    c.sprite.scale.set(1);
  }
  const summits = new Set(game.world.summitSprites.values());
  sprites(game, (s) => {
    const t = s.texture;
    if (snapped.has(t.uid) && snapped.get(t.uid) === t) return;
    const key = t.uid + ':' + Math.abs(s.scale.x).toFixed(3);
    let r = snapped.get(key);
    if (!r) {
      const cell = t.frame.width / t.orig.width / Math.abs(s.scale.x),
        // Summit caps fade into the ground; keep that fade instead of cutting it.
        g = snapToGrid(pixels(t), t.frame.width, t.frame.height, cell, summits.has(s) ? 16 : 128);
      r = texture(g.data, g.w, g.h, t.orig.width, 'nearest');
      snapped.set(key, r);
      snapped.set(r.uid, r);
    }
    r.source.scaleMode = mode;
    s.texture = r;
  });
}

/**
 * Both smooth: the nature sprites (trees, bushes, rocks) have their pixel steps rounded into
 * painted contours. Summit caps are already painted. The smoothed ground comes from
 * terrain-surfaces-smooth.png.
 */
const smoothed = new Map();
export function smooth(game) {
  const w = game.world,
    nature = [...w.propSprites.values()].flat();
  for (const s of nature) {
    const t = s.texture;
    if (smoothed.get(t.uid) === t) continue;
    let r = smoothed.get(t.uid);
    if (!r) {
      r = texture(
        smoothPixelArt(pixels(t), t.frame.width, t.frame.height, 2),
        t.frame.width,
        t.frame.height,
        t.orig.width,
        'linear',
      );
      smoothed.set(t.uid, r);
      smoothed.set(r.uid, r);
    }
    s.texture = r;
  }
}
