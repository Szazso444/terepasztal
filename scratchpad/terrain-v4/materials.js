import { Sprite, Texture } from 'pixi.js';
import { hash2 } from '/src/engine/rng.ts';
const defs = {
  plains: ['terrain-grass.png', [106, 121, 65]],
  forest: ['terrain-forest.png', [84, 103, 58]],
  sand: ['terrain-sand.png', [185, 161, 111]],
  water: ['terrain-water.png', [64, 111, 116]],
};
const fract = (x) => x - Math.floor(x);
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
function noise(x, y, seed = 9) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    u = smooth(x - ix),
    v = smooth(y - iy);
  const a = hash2(ix, iy, seed),
    b = hash2(ix + 1, iy, seed),
    c = hash2(ix, iy + 1, seed),
    d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export async function createMaterials(g) {
  const images = {};
  for (const [name, [file]] of Object.entries(defs)) {
    const im = new Image();
    im.src = '/assets/source/base-v1/' + file;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0, 512, 512);
    images[name] = ctx.getImageData(0, 0, 512, 512).data;
  }
  function kind(x, y) {
    const k =
      Math.max(0, Math.min(g.map.h - 1, Math.round(y))) * g.map.w +
      Math.max(0, Math.min(g.map.w - 1, Math.round(x)));
    return { 0: 'plains', 1: 'forest', 3: 'water', 5: 'sand' }[g.map.terrain[k]] || 'plains';
  }
  function sample(name, x, y, detail) {
    // Offset overlapping source patches independently, preserving the actual illustrated
    // grass clusters. Macro patch boundaries are independent of gameplay tile borders.
    const sx = x * 0.72,
      sy = y * 0.72,
      ix = Math.floor(sx),
      iy = Math.floor(sy);
    const fx = fract(sx),
      fy = fract(sy),
      u = smooth(fx),
      v = smooth(fy);
    const out = [0, 0, 0],
      p = images[name];
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const a = 0.5 + (x - (ix + dx) / 0.72) * 0.2 + (hash2(ix + dx, iy + dy, 81) - 0.5) * 0.24,
          b = 0.5 + (y - (iy + dy) / 0.72) * 0.2 + (hash2(ix + dx, iy + dy, 177) - 0.5) * 0.24;
        const px = Math.round(512 * (0.5 + (a - b) * 0.19)),
          py = Math.round(512 * ((name === 'water' ? 0.5 : 0.49) + (a + b - 1) * 0.145));
        const k = (py * 512 + px) * 4,
          w = (dx ? u : 1 - u) * (dy ? v : 1 - v);
        for (let j = 0; j < 3; j++) out[j] += p[k + j] * w;
      }
    const strength = name === 'water' ? 0.8 : detail;
    return out.map((c, j) => defs[name][1][j] + (c - defs[name][1][j]) * strength);
  }
  function color(x, y, detail, edge) {
    const coastal =
      kind(x, y) === 'water' || kind(x + 0.4, y) === 'water' || kind(x - 0.4, y) === 'water';
    const width = coastal ? 0.12 : edge === 'fringe' ? 0.11 : 0.29;
    const wx = x + (noise(x * 3.1, y * 3.1, 5) - 0.5) * width * 2,
      wy = y + (noise(x * 3.1, y * 3.1, 11) - 0.5) * width * 2;
    let name = kind(wx, wy);
    if (edge === 'patches' && !coastal) {
      // Coherent tuft-sized islands select whole materials, rather than washing their
      // colours together. These offsets affect visual ownership only, never build rules.
      const q = (noise(x * 10, y * 10, 65) - 0.5) * 0.22;
      name = kind(wx + q, wy + q * 0.7);
    }
    return { rgb: sample(name, x, y, detail), name };
  }
  const canvas = document.createElement('canvas'),
    sprite = new Sprite();
  g.world.root.addChildAt(sprite, g.world.root.getChildIndex(g.world.ground));
  function draw(detail, edge) {
    sprite.visible = edge !== 'native';
    g.world.ground.visible = edge === 'native';
    if (edge === 'native') return;
    const cam = g.camera,
      rect = cam.viewRect();
    canvas.width = cam.viewW;
    canvas.height = cam.viewH;
    const ctx = canvas.getContext('2d'),
      out = ctx.createImageData(canvas.width, canvas.height);
    for (let py = 0; py < canvas.height; py++)
      for (let px = 0; px < canvas.width; px++) {
        const wx = rect.x + (px + 0.5) / cam.zoom,
          wy = rect.y + (py + 0.5) / cam.zoom;
        const x = (wx / 32 + wy / 16) / 2,
          y = (wy / 16 - wx / 32) / 2;
        const { rgb } = color(x, y, detail, edge),
          k = (py * canvas.width + px) * 4;
        out.data[k] = rgb[0];
        out.data[k + 1] = rgb[1];
        out.data[k + 2] = rgb[2];
        out.data[k + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
    // Sparse, directional illustrated tuft clusters supply readable mid-scale texture.
    // Their density changes; trees, bushes and flower assets remain identical.
    for (let y = 0; y < g.map.h; y += 0.18)
      for (let x = 0; x < g.map.w; x += 0.18) {
        const ix = Math.round(x / 0.18),
          iy = Math.round(y / 0.18),
          h = hash2(ix, iy, 238);
        if (h > detail * 0.34) continue;
        const tx = x + (hash2(ix, iy, 111) - 0.5) * 0.15,
          ty = y + (hash2(ix, iy, 114) - 0.5) * 0.15;
        const name = color(tx, ty, detail, edge).name;
        if (name !== 'plains' && name !== 'forest') continue;
        const sx = ((tx - ty) * 32 - rect.x) * cam.zoom,
          sy = ((tx + ty) * 16 - rect.y) * cam.zoom;
        if (sx < 0 || sy < 0 || sx > canvas.width || sy > canvas.height) continue;
        const z = cam.zoom;
        const height = (1.6 + hash2(ix, iy, 17) * 1.5) * z;
        ctx.fillStyle = name === 'forest' ? 'rgba(39,63,28,.38)' : 'rgba(68,88,32,.38)';
        ctx.beginPath();
        ctx.ellipse(sx, sy, 1.65 * z, 0.5 * z, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 0.65 * z;
        ctx.strokeStyle = name === 'forest' ? 'rgba(131,145,70,.65)' : 'rgba(172,175,84,.68)';
        ctx.beginPath();
        ctx.moveTo(sx - 1.2 * z, sy);
        ctx.lineTo(sx - 1.5 * z, sy - height * 0.65);
        ctx.moveTo(sx - 0.35 * z, sy);
        ctx.lineTo(sx - 0.45 * z, sy - height);
        ctx.moveTo(sx + 0.45 * z, sy);
        ctx.lineTo(sx + 0.7 * z, sy - height * 0.82);
        ctx.moveTo(sx + 1.1 * z, sy);
        ctx.lineTo(sx + 1.65 * z, sy - height * 0.5);
        ctx.stroke();
      }
    const old = sprite.texture;
    sprite.texture = Texture.from(canvas);
    sprite.texture.source.update();
    sprite.position.set(rect.x, rect.y);
    sprite.scale.set(1 / cam.zoom);
    if (old !== Texture.EMPTY && old !== sprite.texture) old.destroy(true);
  }
  return { draw };
}
