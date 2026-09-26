// Preview-only style options applied to the running review scene. No production code changes.
import { Graphics, ImageSource, Sprite, Texture } from 'pixi.js';
import { hash2 } from '/src/engine/rng.ts';


/** Bottom opaque contour of a sprite, in its parent's coordinates relative to the sprite position. */
function contour(s) {
  const t = s.texture,
    fr = t.frame,
    density = fr.width / t.orig.width;
  const c = document.createElement('canvas');
  c.width = fr.width;
  c.height = fr.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(t.source.resource, fr.x, fr.y, fr.width, fr.height, 0, 0, fr.width, fr.height);
  const p = ctx.getImageData(0, 0, fr.width, fr.height).data,
    points = [];
  for (let x = 0; x < fr.width; x += Math.max(1, Math.round(density))) {
    let y = fr.height - 1;
    while (y > fr.height * 0.6 && p[(y * fr.width + x) * 4 + 3] < 170) y--;
    if (y > fr.height * 0.6)
      points.push({
        x: (x / density - s.anchor.x * t.orig.width) * s.scale.x,
        y: (y / density - s.anchor.y * t.orig.height) * s.scale.y,
      });
  }
  return points;
}

/** Colour of the painted terrain chunk at a world position. */
function groundAt(l, x, y) {
  for (const c of l.chunks.values()) {
    const src = c.base.source?.resource,
      px = Math.floor(x - c.sprite.x),
      py = Math.floor(y - c.sprite.y);
    if (!src || px < 0 || py < 0 || px >= src.width || py >= src.height) continue;
    const d = src.getContext('2d').getImageData(px, py, 1, 1).data;
    if (d[3] > 200) return [d[0], d[1], d[2]];
  }
  return null;
}
const hex = (c, k) => c.reduce((v, x, i) => v | (Math.min(255, Math.round(x * k)) << (16 - i * 8)), 0);
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const green = (c) => c && c[1] > c[0] * 1.05 && c[1] > c[2] * 1.2;

/** Short blades in the ground's own tones, overlapping the lowest pixels of the base. */
function blades(g, points, seed, density, tall, ground) {
  points.forEach((q, j) => {
    const r = hash2(Math.round(q.x * 7) + seed, j, 311);
    if (r > density) return;
    const h = 1 + Math.round(hash2(j, seed, 17) * tall),
      x = Math.round(q.x + (hash2(j, seed, 23) - 0.5) * 1.5),
      y = Math.round(q.y) + 1;
    const tone = [0.68, 0.82, 0.95, 1.12][Math.floor(hash2(j, seed, 29) * 4)];
    g.rect(x, y - h, 1, h).fill({ color: hex(ground, tone) });
    if (r < density * 0.4) g.rect(x + 1, y - h + 1, 1, Math.max(1, h - 1)).fill({ color: hex(ground, 0.75) });
  });
}

/** Grass overlapping building bases and tree trunks, plus clumpy dirt around building bases. */
export function blend(game) {
  const w = game.world,
    l = w.landscape;
  const SOIL = [112, 90, 58];
  for (const [id, s] of w.structures) {
    const a = w.structureAnchors.get(id);
    if (!a || !s.visible) continue;
    const seed = a.x * 131 + a.y * 17,
      points = contour(s),
      ground = groundAt(l, s.x, s.y + 2);
    if (!ground || !points.length) continue;
    const soil = new Graphics();
    soil.position.copyFrom(s.position);
    points.forEach((q, j) => {
      // Patches come in clumps along the outline rather than a uniform ring.
      const clump = hash2(Math.floor(j / 6) + seed, seed, 401);
      if (clump < 0.4) return;
      const r = hash2(j, seed, 409),
        colour = hex(mix(ground, SOIL, 0.45 + r * 0.25), 1);
      soil
        .ellipse(q.x + (r - 0.5) * 2, q.y + 1.5 + r * 1.6, 2.4 + r * 3, 1.1 + r * 1.3)
        .fill({ color: colour, alpha: 0.55 + clump * 0.3 });
      if (r > 0.82)
        soil.rect(Math.round(q.x + 3 * r), Math.round(q.y + 2 + r * 2), 1, 1).fill({ color: 0xb2ad96 });
    });
    w.contactGround.addChild(soil);
    if (!green(ground)) continue;
    const grass = new Graphics();
    grass.position.copyFrom(s.position);
    grass.zIndex = s.zIndex + 0.001;
    blades(grass, points, seed, 0.6, 2, ground);
    w.objects.addChild(grass);
  }
  for (const [i, sprites] of w.propSprites)
    sprites.forEach((s, k) => {
      if (!s.visible) return;
      const ground = groundAt(l, s.x, s.y + 1);
      if (!green(ground)) return;
      const grass = new Graphics();
      grass.position.copyFrom(s.position);
      grass.zIndex = s.zIndex + 0.001;
      // Only the lowest part of the outline: the trunk base, not the crown.
      const points = contour(s),
        bottom = Math.max(...points.map((q) => q.y));
      blades(grass, points.filter((q) => q.y > bottom - 3), i * 7 + k, 0.85, 2, ground);
      w.objects.addChild(grass);
    });
  w.objects.sortChildren();
}

/** Every placed asset reduced to one texel per world pixel and drawn unfiltered, like the ground. */
const reduced = new Map();
export function pixelMatch(game) {
  const l = game.world.landscape;
  if (!l.pixelMatched) {
    const focus = l.focus.bind(l);
    l.focus = (view) => focus(view, 1);
    l.pixelMatched = true;
  }
  game.world.applyCamera(game.camera);
  for (const c of l.chunks.values()) if (c.base !== Texture.EMPTY) c.base.source.scaleMode = 'nearest';
  const visit = (o) => {
    if (o === l.root) return;
    if (o instanceof Sprite && o.texture !== Texture.EMPTY) {
      const t = o.texture;
      if (t.frame.width / t.orig.width > 1.01) {
        let r = reduced.get(t.uid);
        if (!r) {
          const c = document.createElement('canvas');
          c.width = Math.round(t.orig.width);
          c.height = Math.round(t.orig.height);
          const ctx = c.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(t.source.resource, t.frame.x, t.frame.y, t.frame.width, t.frame.height, 0, 0, c.width, c.height);
          r = new Texture({ source: new ImageSource({ resource: c, scaleMode: 'nearest' }) });
          reduced.set(t.uid, r);
          reduced.set(r.uid, r);
        }
        o.texture = r;
      }
    }
    for (const child of o.children ?? []) visit(child);
  };
  visit(game.app.stage);
}
