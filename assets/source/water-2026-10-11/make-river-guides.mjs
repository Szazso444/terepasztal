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
geometry.mouthsCentred = {
  projection: '2:1 orthographic isometric',
  gameTile: [64, 32],
  canvas: [1024, 1024],
  scale: 8,
  tileCanvas: [512, 256],
  edgeCentre: [512, 512],
  areaBox: [128, 320, 896, 704],
  areaSize: [768, 384],
  canvasWidthFraction: 0.75,
  transform: { x: [256, 128], y: [-256, 128] },
  crossSection: { waterHalfWidth: 0.38, waterWidth: 0.76, bankInner: 0.38, bankOuter: 0.5 },
  longitudinalRange: [-0.5, 1.5],
  flareStart: 0.25,
  flareLastTiles: 0.25,
  siltFanTiles: 0.3,
  ne: {
    middleCentre: [384, 576],
    entry: [256, 640],
    opening: [
      [384, 448],
      [640, 576],
    ],
    neighbourCentre: [640, 448],
    areaCorners: [
      [128, 576],
      [640, 320],
      [896, 448],
      [384, 704],
    ],
    waterEdges: [
      [
        [158.7, 591.4],
        [350.7, 495.4],
        [384, 448],
      ],
      [
        [353.3, 688.6],
        [545.3, 592.6],
        [640, 576],
      ],
    ],
    flareLine: [
      [320, 480],
      [576, 608],
    ],
    siltEndLine: [
      [460.8, 409.6],
      [716.8, 537.6],
    ],
    guideOffset: [-128, 64],
  },
  se: {
    middleCentre: [384, 448],
    entry: [256, 384],
    opening: [
      [640, 448],
      [384, 576],
    ],
    neighbourCentre: [640, 576],
    areaCorners: [
      [384, 320],
      [896, 576],
      [640, 704],
      [128, 448],
    ],
    waterEdges: [
      [
        [353.3, 335.4],
        [545.3, 431.4],
        [640, 448],
      ],
      [
        [158.7, 432.6],
        [350.7, 528.6],
        [384, 576],
      ],
    ],
    flareLine: [
      [576, 416],
      [320, 544],
    ],
    siltEndLine: [
      [716.8, 486.4],
      [460.8, 614.4],
    ],
    guideOffset: [-128, -64],
  },
  sw: {
    middleCentre: [640, 448],
    entry: [768, 384],
    opening: [
      [640, 576],
      [384, 448],
    ],
    neighbourCentre: [384, 576],
    areaCorners: [
      [640, 320],
      [896, 448],
      [384, 704],
      [128, 576],
    ],
    waterEdges: [
      [
        [670.7, 335.4],
        [478.7, 431.4],
        [384, 448],
      ],
      [
        [865.3, 432.6],
        [673.3, 528.6],
        [640, 576],
      ],
    ],
    flareLine: [
      [448, 416],
      [704, 544],
    ],
    siltEndLine: [
      [307.2, 486.4],
      [563.2, 614.4],
    ],
    guideOffset: [128, -64],
  },
  nw: {
    middleCentre: [640, 576],
    entry: [768, 640],
    opening: [
      [384, 576],
      [640, 448],
    ],
    neighbourCentre: [384, 448],
    areaCorners: [
      [896, 576],
      [384, 320],
      [128, 448],
      [640, 704],
    ],
    waterEdges: [
      [
        [865.3, 591.4],
        [673.3, 495.4],
        [640, 448],
      ],
      [
        [670.7, 688.6],
        [478.7, 592.6],
        [384, 576],
      ],
    ],
    flareLine: [
      [704, 480],
      [448, 608],
    ],
    siltEndLine: [
      [563.2, 409.6],
      [307.2, 537.6],
    ],
    guideOffset: [128, 64],
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
for (const edge of ['ne', 'se', 'sw', 'nw']) {
  const [cx, cy] = geometry.mouthsCentred[edge].middleCentre;
  const project = (x, y) => [cx + 256 * (x - y), cy + 128 * (x + y)];
  const adjacent = { ne: [0, -1], se: [1, 0], sw: [0, 1], nw: [-1, 0] }[edge];
  const segments = [[0, 0], adjacent].flatMap(([x, y]) => {
    const corners = [
      project(x - 0.5, y - 0.5),
      project(x + 0.5, y - 0.5),
      project(x + 0.5, y + 0.5),
      project(x - 0.5, y + 0.5),
    ];
    return corners.map((a, i) => [a, corners[(i + 1) % 4]]);
  });
  const png = new PNG({ width: 1024, height: 1024 });
  for (let py = 0; py < 1024; py++)
    for (let px = 0; px < 1024; px++) {
      const sx = px + 0.5,
        sy = py + 0.5,
        x = ((sx - cx) / 256 + (sy - cy) / 128) / 2,
        y = ((sy - cy) / 128 - (sx - cx) / 256) / 2;
      const t = { ne: -y, se: x, sw: y, nw: -x }[edge],
        u = edge === 'ne' || edge === 'sw' ? x : y;
      if (t < -0.5 || t > 1.5 || Math.abs(u) > 0.5) continue;
      const width = 0.38 + 0.12 * Math.max(0, Math.min(1, (t - 0.25) / 0.25));
      let c = Math.abs(u) <= width ? 210 : 130;
      for (const [a, b] of segments) {
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          q = Math.max(0, Math.min(1, ((sx - a[0]) * dx + (sy - a[1]) * dy) / (dx * dx + dy * dy)));
        if (Math.hypot(sx - a[0] - q * dx, sy - a[1] - q * dy) < 0.65) {
          c = 65;
          break;
        }
      }
      const i = (py * 1024 + px) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = c;
      png.data[i + 3] = 255;
    }
  fs.writeFileSync(
    path.join(root, 'guides', `river-mouth-${edge}-centred.png`),
    PNG.sync.write(png),
  );
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
