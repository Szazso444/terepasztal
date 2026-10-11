import { Sprite, Texture } from 'pixi.js';
import { hash2 } from '/src/engine/rng.ts';
const definitions = {
  plains: ['terrain-grass.png', [106, 121, 65]],
  forest: ['terrain-forest.png', [84, 103, 58]],
  desert: ['terrain-desert.png', [185, 158, 102]],
  taiga: ['terrain-taiga.png', [103, 124, 103]],
  swamp: ['terrain-swamp.png', [92, 111, 75]],
  water: ['terrain-water.png', [64, 111, 116]],
  sand: ['terrain-sand.png', [185, 161, 111]],
  rock: ['terrain-rock.png', [125, 128, 116]],
  dirt: ['people-path-dirt.png', [143, 120, 80]],
  stone: ['people-road-stone.png', [154, 147, 123]],
};
const fract = (x) => x - Math.floor(x),
  mirror = (x) => 1 - Math.abs(fract(x / 2) * 2 - 1);
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export async function createMaterials(g, lots) {
  const images = {};
  for (const [name, [file]] of Object.entries(definitions)) {
    const im = new Image();
    im.src = '/assets/source/base-v1/' + file;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0, 512, 512);
    images[name] = ctx.getImageData(0, 0, 512, 512);
  }
  function sample(name, x, y) {
    const p = images[name],
      u = name === 'stone' ? fract(x * 1.1) : mirror(x * 2.1 + y * 0.13),
      v = name === 'stone' ? fract(y * 1.1) : mirror(y * 1.9 - x * 0.09);
    const px = Math.round(512 * (0.5 + (u - v) * 0.19)),
      py = Math.round(512 * ((name === 'water' ? 0.5 : 0.49) + (u + v - 1) * 0.145)),
      i = (py * 512 + px) * 4;
    return mix(
      definitions[name][1],
      [p.data[i], p.data[i + 1], p.data[i + 2]],
      name === 'water' ? 0.65 : 0.42,
    );
  }
  function kind(x, y) {
    x = Math.max(0, Math.min(g.map.w - 1, x));
    y = Math.max(0, Math.min(g.map.h - 1, y));
    const k = y * g.map.w + x,
      t = g.map.terrain[k];
    if (t === 3) return 'water';
    if (t === 5) return 'sand';
    if (t === 4 || t === 6) return 'rock';
    if (t === 2) return 'dirt';
    if (t === 1) return g.map.biome[k] === 4 ? 'swamp' : 'forest';
    return ['plains', 'forest', 'desert', 'taiga', 'swamp', 'water'][g.map.biome[k]];
  }
  function color(x, y) {
    // Only a narrow strip blends at generated tile boundaries. Terrain membership
    // still comes from the unchanged map, including real rivers and biome borders.
    const ix = Math.floor(x + 0.5),
      iy = Math.floor(y + 0.5),
      fx = x - ix,
      fy = y - iy;
    const sx = fx < 0 ? -1 : 1,
      sy = fy < 0 ? -1 : 1;
    const ax = 0.5 * smooth((Math.abs(fx) - 0.32) / 0.18),
      ay = 0.5 * smooth((Math.abs(fy) - 0.32) / 0.18);
    const a = kind(ix, iy);
    let c = sample(a, x, y);
    if (ax) {
      const b = kind(ix + sx, iy);
      if (b !== a) c = mix(c, sample(b, x, y), ax);
    }
    if (ay) {
      const b = kind(ix, iy + sy);
      if (b !== a) c = mix(c, sample(b, x, y), ay);
    }
    return c;
  }
  // 2–3 small seeded scuffs near the ground anchor; never a rectangular lot.
  const patches = lots.flatMap((l) =>
    Array.from({ length: 2 + Math.floor(hash2(l.x, l.y, 771) * 2) }, (_, i) => {
      const h = hash2(l.x + i, l.y, 513),
        j = hash2(l.x, l.y + i, 918);
      return {
        owner: { x: l.x, y: l.y, id: l.id },
        x: l.x + (h - 0.5) * 0.75,
        y: l.y + 0.2 + j * 0.28,
        rx: 0.16 + h * 0.12,
        ry: 0.11 + j * 0.12,
        seed: h * 30,
        material: ['town', 'townhouse', 'station'].includes(l.id) ? 'stone' : 'dirt',
      };
    }),
  );
  const canvas = document.createElement('canvas'),
    sprite = new Sprite();
  g.world.root.addChildAt(sprite, g.world.root.getChildIndex(g.world.ground));
  for (let i = 0; i < g.world.groundSprites.length; i++) {
    const s = g.world.groundSprites[i];
    if (s)
      s.visible = (g.map.terrain[i] === 2 || g.map.terrain[i] === 6) && !g.world.flattened.has(i);
  }
  function draw() {
    const camera = g.camera,
      rect = camera.viewRect();
    canvas.width = camera.viewW;
    canvas.height = camera.viewH;
    const ctx = canvas.getContext('2d'),
      out = ctx.createImageData(canvas.width, canvas.height);
    const visible = patches.filter((p) => {
      const wx = (p.x - p.y) * 32,
        wy = (p.x + p.y) * 16;
      return (
        wx > rect.x - 80 &&
        wx < rect.x + rect.w + 80 &&
        wy > rect.y - 80 &&
        wy < rect.y + rect.h + 80
      );
    });
    for (let py = 0; py < canvas.height; py++)
      for (let px = 0; px < canvas.width; px++) {
        const wx = rect.x + (px + 0.5) / camera.zoom,
          wy = rect.y + (py + 0.5) / camera.zoom,
          x = (wx / 32 + wy / 16) / 2,
          y = (wy / 16 - wx / 32) / 2;
        if (x < -0.5 || y < -0.5 || x > g.map.w - 0.5 || y > g.map.h - 0.5) continue;
        let c = color(x, y);
        if (kind(Math.round(x), Math.round(y)) !== 'water')
          for (const p of visible) {
            if (Math.abs(x - p.x) > 0.4 || Math.abs(y - p.y) > 0.4) continue;
            const dx = (x - p.x) / p.rx,
              dy = (y - p.y) / p.ry,
              d = Math.hypot(dx, dy);
            const edge =
              1 +
              0.09 * Math.sin(Math.atan2(dy, dx) * 5 + p.seed) +
              0.06 * Math.sin(x * 43 + y * 21);
            const a = 0.5 * smooth((edge - d) / 0.45);
            if (a > 0) c = mix(c, sample(p.material, x, y), a);
          }
        const k = (py * canvas.width + px) * 4;
        out.data[k] = c[0];
        out.data[k + 1] = c[1];
        out.data[k + 2] = c[2];
        out.data[k + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
    const old = sprite.texture;
    sprite.texture = Texture.from(canvas);
    sprite.texture.source.update();
    sprite.position.set(rect.x, rect.y);
    sprite.scale.set(1 / camera.zoom);
    if (old !== Texture.EMPTY && old !== sprite.texture) old.destroy(true);
  }
  return { sample, color, kind, draw, patches, patchMaxRadius: 0.28 };
}
