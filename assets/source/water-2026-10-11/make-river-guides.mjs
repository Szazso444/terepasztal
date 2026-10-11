import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const geometry = {
  projection: '2:1 orthographic isometric',
  gameTile: [64, 32],
  canvas: [1024, 1024],
  scale: 8,
  tileCanvas: [512, 256],
  centre: [512, 512],
  axes: { x: 'NW to SE', y: 'NE to SW' },
  edgeNames: { ne: 'upper-right', se: 'lower-right', sw: 'lower-left', nw: 'upper-left' },
  transform: { origin: [512, 512], x: [256, 128], y: [-256, 128] },
  middle: [
    [512, 384],
    [768, 512],
    [512, 640],
    [256, 512],
  ],
  midpoints: { ne: [640, 448], se: [640, 576], sw: [384, 576], nw: [384, 448] },
  neighbours: { ne: [768, 384], se: [768, 640], sw: [256, 640], nw: [256, 384] },
  crossSection: { water: 0.38, bankInner: 0.38, bankOuter: 0.5 },
  strips: {
    x: {
      range: [-1.5, 1.5],
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
      waterEdges: [
        [
          [225, 271],
          [993, 655],
        ],
        [
          [31, 369],
          [799, 753],
        ],
      ],
    },
    y: {
      range: [-1.5, 1.5],
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
      waterEdges: [
        [
          [799, 271],
          [31, 655],
        ],
        [
          [993, 369],
          [225, 753],
        ],
      ],
    },
  },
  pool: {
    overhang: 0.1,
    corners: [
      [512, 358],
      [819, 512],
      [512, 666],
      [205, 512],
    ],
  },
  end: {
    centre: [512, 512],
    waterHalfAxes: [138, 69],
    bankHalfAxes: [181, 90.5],
    waterRadius: 0.38,
    bankRadius: 0.5,
  },
  mouths: {
    flareLastTiles: 0.25,
    siltFanTiles: 0.3,
    range: [-0.5, 1.5],
    seExample: {
      entry: [384, 448],
      opening: [
        [768, 512],
        [512, 640],
      ],
      neighbour: [
        [768, 512],
        [1024, 640],
        [768, 768],
        [512, 640],
      ],
    },
  },
};
fs.mkdirSync(path.join(root, 'guides'), { recursive: true });
fs.mkdirSync(path.join(root, 'refs'), { recursive: true });
fs.writeFileSync(path.join(root, 'river-geometry.json'), JSON.stringify(geometry, null, 2) + '\n');
const iso = (x, y) => [512 + 256 * (x - y), 512 + 128 * (x + y)];
function polygonContains(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i],
      [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const names = [
  'river-strip-x',
  'river-strip-y',
  'river-pool',
  'river-end',
  ...['ne', 'se', 'sw', 'nw'].map((e) => `river-mouth-${e}`),
];
for (const name of names) {
  const png = new PNG({ width: 1024, height: 1024 });
  const tiles = name.includes('strip')
    ? name.endsWith('x')
      ? [
          [-1, 0],
          [0, 0],
          [1, 0],
        ]
      : [
          [0, -1],
          [0, 0],
          [0, 1],
        ]
    : [[0, 0]];
  if (name.includes('mouth'))
    tiles.push({ ne: [0, -1], se: [1, 0], sw: [0, 1], nw: [-1, 0] }[name.split('-').at(-1)]);
  const segments = tiles.flatMap(([x, y]) => {
    const p = [
      iso(x - 0.5, y - 0.5),
      iso(x + 0.5, y - 0.5),
      iso(x + 0.5, y + 0.5),
      iso(x - 0.5, y + 0.5),
    ];
    return p.map((a, i) => [a, p[(i + 1) % 4]]);
  });
  for (let py = 0; py < 1024; py++)
    for (let px = 0; px < 1024; px++) {
      const sx = px + 0.5,
        sy = py + 0.5,
        x = ((sx - 512) / 256 + (sy - 512) / 128) / 2,
        y = ((sy - 512) / 128 - (sx - 512) / 256) / 2;
      let material = 0;
      if (name.includes('strip')) {
        const t = name.endsWith('x') ? x : y,
          u = name.endsWith('x') ? y : x;
        if (Math.abs(t) <= 1.5 && Math.abs(u) <= 0.5) material = Math.abs(u) <= 0.38 ? 1 : 2;
      } else if (name === 'river-pool') {
        if (polygonContains(sx, sy, geometry.pool.corners)) material = 1;
      } else if (name === 'river-end') {
        if (((sx - 512) / 181) ** 2 + ((sy - 512) / 90.5) ** 2 <= 1) material = 2;
        if (((sx - 512) / 138) ** 2 + ((sy - 512) / 69) ** 2 <= 1) material = 1;
      } else {
        const e = name.split('-').at(-1),
          t = { ne: -y, se: x, sw: y, nw: -x }[e],
          u = e === 'ne' || e === 'sw' ? x : y;
        if (t >= -0.5 && t <= 1.5 && Math.abs(u) <= 0.5) {
          const width = 0.38 + 0.12 * Math.max(0, Math.min(1, (t - 0.25) / 0.25));
          material = Math.abs(u) <= width ? 1 : 2;
        }
      }
      if (!material) continue;
      let c = material === 1 ? 210 : 130;
      for (const [a, b] of segments) {
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          t = Math.max(0, Math.min(1, ((sx - a[0]) * dx + (sy - a[1]) * dy) / (dx * dx + dy * dy)));
        if (Math.hypot(sx - a[0] - t * dx, sy - a[1] - t * dy) < 0.65) {
          c = 65;
          break;
        }
      }
      const i = (py * 1024 + px) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = c;
      png.data[i + 3] = 255;
    }
  fs.writeFileSync(path.join(root, 'guides', `${name}.png`), PNG.sync.write(png));
}
const ref = path.join(root, 'refs', 'ref-water.png');
if (!fs.existsSync(ref)) {
  const source = PNG.sync.read(
    fs.readFileSync(path.join(root, '..', 'base-v1', 'terrain-water.png')),
  );
  const left = Math.floor(source.width * 0.25),
    top = Math.floor(source.height * 0.3),
    right = Math.floor(source.width * 0.75),
    bottom = Math.floor(source.height * 0.7);
  const crop = new PNG({ width: right - left, height: bottom - top });
  PNG.bitblt(source, crop, left, top, crop.width, crop.height, 0, 0);
  fs.writeFileSync(ref, PNG.sync.write(crop));
}
console.log('Wrote eight guides, geometry and hue reference.');
