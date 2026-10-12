import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = dirname(fileURLToPath(import.meta.url));
const size = 1024;
const scale = 8;
const level = 9.8;
const step = level * scale;
const edges = {
  SW: { facing: '+y', light: 'lit', visible: true },
  SE: { facing: '+x', light: 'shade', visible: true },
  NE: { facing: '-y', visible: false },
  NW: { facing: '-x', visible: false },
};
const project = (x, y, z = 0, cy = 512) => [512 + 256 * (x - y), cy + 128 * (x + y) - scale * z];
const foam = {
  sw: {
    axis: 'y',
    range: [0, 0.25],
    along: 'x',
    alongRange: [-1.5, 1.5],
    vertices: [
      [128, 320],
      [896, 704],
      [832, 736],
      [64, 352],
    ],
  },
  se: {
    axis: 'x',
    range: [0, 0.25],
    along: 'y',
    alongRange: [-1.5, 1.5],
    vertices: [
      [896, 320],
      [128, 704],
      [192, 736],
      [960, 352],
    ],
  },
};
const faces = { sw: {}, se: {} };
const plungeFoamSwCentred = {
  projection: {
    origin: [544, 496],
    xVector: [256, 128],
    yVector: [-256, 128],
    formula: '(544 + 256*(x-y), 496 + 128*(x+y))',
  },
  along: 'x',
  alongRange: [-1.375, 1.375],
  axis: 'y',
  range: [0, 0.25],
  denseRange: [0, 0.1],
  breakupRange: [0.1, 0.25],
  foot: [
    [192, 320],
    [896, 672],
  ],
  denseEdge: [
    [166.4, 332.8],
    [870.4, 684.8],
  ],
  outerEdge: [
    [128, 352],
    [832, 704],
  ],
  vertices: [
    [192, 320],
    [896, 672],
    [832, 704],
    [128, 352],
  ],
  box: [128, 320, 896, 704],
  centre: [512, 512],
  size: [768, 384],
  greys: { dense: 230, breakup: 170, foot: 65 },
};
for (let d = 1; d <= 4; d++) {
  faces.sw[d] = [
    [256, 832 - step * d],
    [512, 960 - step * d],
    [512, 960],
    [256, 832],
  ];
  faces.se[d] = [
    [768, 832 - step * d],
    [512, 960 - step * d],
    [512, 960],
    [768, 832],
  ];
}
const geometry = {
  projection: '2:1 orthographic isometric',
  tileGamePx: [64, 32],
  canvasPx: [size, size],
  scale,
  levelGamePx: level,
  levelCanvasPx: step,
  dropLevels: [1, 2, 3, 4],
  fullFaceLevels: 4,
  levelFractionOfTileSide: 0.25,
  fourLevelHeightGamePx: 39.2,
  faceMaterialPx: [1024, 1024],
  faceLevelMaterialPx: 256,
  faceReviewPx: [36, 39],
  foamReviewWidthPx: 128,
  tileAxes: { x: 'NW to SE', y: 'NE to SW' },
  edgeNames: { NE: 'upper-right', SE: 'lower-right', SW: 'lower-left', NW: 'upper-left' },
  edges,
  riverEdge: { absoluteU: 0.38, fractions: [0.12, 0.88], percent: [12, 88], rockOutside: true },
  finalProjection: {
    centre: [512, 832],
    xVector: [256, 128],
    yVector: [-256, 128],
    zVector: [0, -8],
    formula: '(512 + 256*(x-y), 832 + 128*(x+y) - 8*z)',
  },
  foamProjection: {
    centre: [512, 512],
    xVector: [256, 128],
    yVector: [-256, 128],
    formula: '(512 + 256*(x-y), 512 + 128*(x+y))',
  },
  faces,
  foam,
  plungeFoamSwCentred,
  animation: {
    frames: 4,
    scrollFractionPerFrame: 0.25,
    secondsPerFrame: 0.28,
    brightnessPulse: false,
  },
  palette: {
    water: ['#487C84', '#548A92', '#3E6E78', '#649EA2'],
    rock: ['#BCA98B', '#626B6C', '#9A968C', '#8C887E', '#78746A'],
    whiteMaximum: '#E0DDD2',
    cursorWhite: '#ECE4D0',
  },
  finishing: {
    face: 'Stretch whole source onto exact face; repeat cross-fade; scroll water; darken foot.',
    foam: 'Square returns use w/1024; non-square returns use measured painted edges; geometry sets alpha.',
  },
};

function canvas() {
  return new PNG({ width: size, height: size });
}
function pixel(png, x, y, rgba) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  png.data.set(rgba, (y * size + x) * 4);
}
function inside(x, y, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}
function polygon(png, points, rgba) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inside(x + 0.5, y + 0.5, points)) pixel(png, x, y, rgba);
    }
  }
}
function line(png, a, b, rgba) {
  const count = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])));
  for (let i = 0; i <= count; i++) {
    pixel(
      png,
      Math.round(a[0] + ((b[0] - a[0]) * i) / count),
      Math.round(a[1] + ((b[1] - a[1]) * i) / count),
      rgba,
    );
  }
}
function save(name, png) {
  writeFileSync(join(root, 'guides', name), PNG.sync.write(png));
}
mkdirSync(join(root, 'guides'), { recursive: true });
const face = canvas();
face.data.fill(255);
polygon(
  face,
  [
    [0, 0],
    [1024, 0],
    [1024, 1024],
    [0, 1024],
  ],
  [180, 180, 180, 255],
);
for (const y of [256, 512, 768]) line(face, [0, y], [1023, y], [120, 120, 120, 255]);
for (const x of [Math.round(size * 0.12), Math.round(size * 0.88)])
  line(face, [x, 0], [x, 1023], [120, 120, 120, 255]);
save('face.png', face);
for (const edge of ['sw', 'se']) {
  const guide = canvas();
  polygon(guide, foam[edge].vertices, [195, 195, 195, 255]);
  save(`plunge-foam-${edge}.png`, guide);
  for (let d = 1; d <= 4; d++) {
    const guideFace = canvas();
    polygon(guideFace, faces[edge][d], [160, 160, 160, 255]);
    const p = faces[edge][d];
    const interpolate = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    polygon(
      guideFace,
      [
        interpolate(p[0], p[1], 0.12),
        interpolate(p[0], p[1], 0.88),
        interpolate(p[3], p[2], 0.88),
        interpolate(p[3], p[2], 0.12),
      ],
      [205, 205, 205, 255],
    );
    save(`final-fall-${edge}-${d}.png`, guideFace);
  }
}
// Sanity-check the supplied coordinate convention rather than deriving from a different iso basis.
const centred = canvas();
polygon(centred, plungeFoamSwCentred.vertices, [170, 170, 170, 255]);
polygon(
  centred,
  [...plungeFoamSwCentred.foot, plungeFoamSwCentred.denseEdge[1], plungeFoamSwCentred.denseEdge[0]],
  [230, 230, 230, 255],
);
line(centred, ...plungeFoamSwCentred.foot, [65, 65, 65, 255]);
save('plunge-foam-sw-centred.png', centred);
if (JSON.stringify(project(-1.5, 0)) !== JSON.stringify(foam.sw.vertices[0]))
  throw new Error('Projection mismatch');
writeFileSync(join(root, 'fall-geometry.json'), `${JSON.stringify(geometry, null, 2)}\n`);
console.log('Wrote 12 guides and fall-geometry.json.');
