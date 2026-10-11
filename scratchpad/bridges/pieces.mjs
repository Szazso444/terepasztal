// Every packed kit frame at 8x, with the exact 2:1 geometry the renderer assumes for it drawn
// over it in magenta (tile diamond / wall on the tile edge / shaft top), in the frame's own
// anchor space. Cyan cross = the anchor. Writes renders/pieces-stone.png and pieces-wood.png.
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const json = JSON.parse(readFileSync('public/assets/bridges.json', 'utf8'));
const atlas = PNG.sync.read(readFileSync('public/assets/bridges.png'));
const kit = JSON.parse(readFileSync('src/render/bridgeKit.json', 'utf8'));
const D = json.resolution,
  Z = 6, // output px per world px
  CELL = 480,
  OX = 240,
  OY = 250;
function sheet(material) {
  const names = Object.keys(kit).filter((n) => n.startsWith(material));
  const cols = 3,
    rows = Math.ceil(names.length / cols),
    out = new PNG({ width: cols * CELL, height: rows * CELL });
  const put = (x, y, r, g, b, a = 255) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
    const o = (y * out.width + x) * 4,
      k = a / 255;
    out.data[o] = out.data[o] * (1 - k) + r * k;
    out.data[o + 1] = out.data[o + 1] * (1 - k) + g * k;
    out.data[o + 2] = out.data[o + 2] * (1 - k) + b * k;
    out.data[o + 3] = 255;
  };
  for (let i = 0; i < out.width * out.height; i++) {
    const x = i % out.width,
      y = Math.floor(i / out.width),
      c = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 70 : 84;
    out.data.set([c, c, c + 6, 255], i * 4);
  }
  names.forEach((name, n) => {
    const f = json.frames['bridgekit/' + name],
      cx = (n % cols) * CELL + OX,
      cy = Math.floor(n / cols) * CELL + (/pier|post/.test(name) ? 60 : /arch|brace|truss/.test(name) ? 280 : /rail/.test(name) ? 220 : OY);
    const k = Z / D; // output px per atlas px
    for (let y = 0; y < f.h * k; y++)
      for (let x = 0; x < f.w * k; x++) {
        const sx = f.x + Math.floor(x / k),
          sy = f.y + Math.floor(y / k),
          o = (sy * atlas.width + sx) * 4;
        if (atlas.data[o + 3]) put(cx + x - f.ax * k, cy + y - f.ay * k, atlas.data[o], atlas.data[o + 1], atlas.data[o + 2], atlas.data[o + 3]);
      }
    const line = (ax, ay, bx, by, c = [255, 0, 255]) => {
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * Z);
      for (let s = 0; s <= n; s++) {
        const x = cx + (ax + ((bx - ax) * s) / n) * Z,
          y = cy + (ay + ((by - ay) * s) / n) * Z;
        put(x, y, ...c);
        put(x, y + 1, ...c);
      }
    };
    const poly = (pts, c) => pts.forEach((p, i) => line(...p, ...pts[(i + 1) % pts.length], c));
    const g = kit[name];
    if (/deck|pad/.test(name)) {
      poly([[0, -16], [32, 0], [0, 16], [-32, 0]]);
      const t = g.thickness;
      line(-32, t, 0, 16 + t);
      line(0, 16 + t, 32, t);
    } else if (/-(rail|arch|truss|brace)-/.test(name)) {
      const h = g.height,
        a = name.endsWith('-x') ? [-32, 0] : [32, 0];
      // the wall the renderer expects: on the tile edge from a side vertex to the bottom vertex
      poly([[a[0], a[1]], [0, 16], [0, 16 - h], [a[0], a[1] - h]]);
    } else {
      const s = name.includes('pier') ? 0.2 : 0.07,
        L = g.length;
      poly([[0, -16 * s], [32 * s, 0], [0, 16 * s], [-32 * s, 0]]);
      line(-32 * s, 0, -32 * s, L);
      line(32 * s, 0, 32 * s, L);
      line(-32 * s, L, 0, L + 16 * s);
      line(0, L + 16 * s, 32 * s, L);
    }
    line(-3, 0, 3, 0, [0, 255, 255]);
    line(0, -3, 0, 3, [0, 255, 255]);
  });
  writeFileSync(`scratchpad/bridges/renders/pieces-${material}.png`, PNG.sync.write(out));
}
sheet('stone');
sheet('wood');
console.log('written');
