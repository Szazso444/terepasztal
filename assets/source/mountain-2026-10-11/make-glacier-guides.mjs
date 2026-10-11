import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'guides');
mkdirSync(out, { recursive: true });
const geometry = {
  projection: '2:1 orthographic isometric',
  canvas: [1024, 1024],
  tileGame: [64, 32],
  levelGame: 9.8,
  levelsPerFace: 4,
  levelFractionOfTileSide: 0.25,
  scale: 8,
  tileCanvas: [512, 256],
  levelCanvas: 78.4,
  stripCentre: [512, 512],
  transform: { origin: [512, 512], x: [256, 128], y: [-256, 128] },
  axes: { x: 'NW to SE', y: 'NE to SW' },
  edges: { NE: 'upper-right', SE: 'lower-right', SW: 'lower-left', NW: 'upper-left' },
  channel: { widthTiles: 1, rareWidthTiles: 2, lengthTiles: [1, 5] },
  crossSection: { iceAbsU: [0, 0.4], moraineAbsU: [0.4, 0.5], outsideAbsU: 0.5 },
  strips: {
    x: {
      axisRange: [-1.5, 1.5],
      corners: [
        [256, 256],
        [1024, 640],
        [768, 768],
        [0, 384],
      ],
      centreLine: [
        [128, 320],
        [896, 704],
      ],
      iceEdges: [
        [
          [230, 269],
          [998, 653],
        ],
        [
          [26, 371],
          [794, 755],
        ],
      ],
    },
    y: {
      axisRange: [-1.5, 1.5],
      corners: [
        [768, 256],
        [1024, 384],
        [256, 768],
        [0, 640],
      ],
      centreLine: [
        [896, 320],
        [128, 704],
      ],
      iceEdges: [
        [
          [794, 269],
          [26, 653],
        ],
        [
          [998, 371],
          [230, 755],
        ],
      ],
    },
  },
  lobe: {
    centre: [512, 512],
    iceRadii: [145, 72],
    rimRadii: [181, 90.5],
    iceRadiusTiles: 0.4,
    rimRadiusTiles: 0.5,
  },
  face: {
    projection: 'square-on, no projection',
    size: [1024, 1024],
    widthTileEdges: 1,
    heightLevels: 4,
    levelPixels: 256,
  },
  tongue: {
    centre: [512, 832],
    scale: 8,
    heightLevels: 1,
    heightCanvas: 78.4,
    SW: {
      edge: [
        [256, 832],
        [512, 960],
      ],
      caveFoot: [384, 896],
      facing: 'lower-left',
      light: 'lit',
    },
    SE: {
      edge: [
        [768, 832],
        [512, 960],
      ],
      caveFoot: [640, 896],
      facing: 'lower-right',
      light: 'shade',
    },
    NE: { facing: 'away', top: 'half lobe' },
    NW: { facing: 'away', top: 'half lobe' },
  },
  portal: {
    openingFraction: [0.25, 0.125],
    openingPixels: [256, 128],
    patchFraction: [0.5, 0.25],
    patchPixels: [512, 256],
    centreAtBottom: [512, 1024],
    openingTileEdges: 0.25,
    openingLevels: 0.5,
  },
  review: { strip: [128, 128], face: [36, 39] },
};
writeFileSync(join(root, 'glacier-geometry.json'), JSON.stringify(geometry, null, 2) + '\n');

const ice = [210, 210, 210, 255],
  rubble = [135, 135, 135, 255],
  dark = [60, 60, 60, 255];
function canvas() {
  return new PNG({ width: 1024, height: 1024 });
}
function set(p, x, y, c) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
  const i = (y * p.width + x) * 4;
  for (let j = 0; j < 4; j++) p.data[i + j] = c[j];
}
function line(p, a, b, c = dark, clip = false) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2);
  for (let k = 0; k <= n; k++) {
    const x = Math.round(a[0] + ((b[0] - a[0]) * k) / n);
    const y = Math.round(a[1] + ((b[1] - a[1]) * k) / n);
    if (!clip || (x >= 0 && y >= 0 && x < 1024 && y < 1024 && p.data[(y * 1024 + x) * 4 + 3]))
      set(p, x, y, c);
  }
}
function iso(x, y, cy = 512) {
  return [512 + 256 * (x - y), cy + 128 * (x + y)];
}
function save(name, p) {
  writeFileSync(join(out, name + '.png'), PNG.sync.write(p));
}
for (const axis of ['x', 'y']) {
  const p = canvas();
  for (let py = 0; py < 1024; py++)
    for (let px = 0; px < 1024; px++) {
      const a = (px + 0.5 - 512) / 256,
        b = (py + 0.5 - 512) / 128;
      const tx = (a + b) / 2,
        ty = (b - a) / 2;
      const along = axis === 'x' ? tx : ty,
        u = axis === 'x' ? ty : tx;
      if (Math.abs(along) <= 1.5 && Math.abs(u) <= 0.5)
        set(p, px, py, Math.abs(u) <= 0.4 ? ice : rubble);
    }
  for (let k = -1; k <= 1; k++) {
    const cx = axis === 'x' ? k : 0,
      cy = axis === 'y' ? k : 0;
    const pts = [
      iso(cx - 0.5, cy - 0.5),
      iso(cx + 0.5, cy - 0.5),
      iso(cx + 0.5, cy + 0.5),
      iso(cx - 0.5, cy + 0.5),
    ];
    for (let j = 0; j < 4; j++) line(p, pts[j], pts[(j + 1) % 4], dark, true);
  }
  save('glacier-strip-' + axis, p);
}
const lobe = canvas();
for (let y = 0; y < 1024; y++)
  for (let x = 0; x < 1024; x++) {
    const dx = x + 0.5 - 512,
      dy = y + 0.5 - 512;
    if ((dx / 181) ** 2 + (dy / 90.5) ** 2 <= 1)
      set(lobe, x, y, (dx / 145) ** 2 + (dy / 72) ** 2 <= 1 ? ice : rubble);
  }
save('glacier-lobe', lobe);
const face = canvas();
for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) set(face, x, y, ice);
for (const y of [0, 256, 512, 768, 1023]) line(face, [0, y], [1023, y]);
line(face, [0, 0], [0, 1023]);
line(face, [1023, 0], [1023, 1023]);
save('face', face);
function polygon(p, pts, c) {
  for (let y = 0; y < 1024; y++)
    for (let x = 0; x < 1024; x++) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i],
          [xj, yj] = pts[j];
        if (
          yi > y + 0.5 !== yj > y + 0.5 &&
          x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi
        )
          inside = !inside;
      }
      if (inside) set(p, x, y, c);
    }
}
for (const side of ['SW', 'SE']) {
  const p = canvas(),
    {
      edge: [a, b],
      caveFoot: [cx, cy],
    } = geometry.tongue[side];
  // Reference layout only: the supplied edge is the foot; the front rises 78.4 px.
  polygon(p, [a, b, [b[0], b[1] - 78.4], [a[0], a[1] - 78.4]], side === 'SW' ? ice : rubble);
  line(p, a, b);
  line(p, [a[0], a[1] - 78.4], [b[0], b[1] - 78.4]);
  const tangent = side === 'SW' ? [0.894427191, 0.4472135955] : [-0.894427191, 0.4472135955];
  for (let u = -35.777; u <= 35.777; u += 0.25) {
    const h = 39.2 * Math.sqrt(Math.max(0, 1 - (u / 35.777) ** 2));
    for (let v = 0; v <= h; v++) set(p, cx + tangent[0] * u, cy + tangent[1] * u - v, dark);
  }
  save('final-tongue-' + side.toLowerCase(), p);
}
console.log('Wrote six guides and glacier-geometry.json; reference tongues are not finished art.');
