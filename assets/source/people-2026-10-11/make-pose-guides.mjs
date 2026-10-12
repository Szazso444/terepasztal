import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const strips = [
  'pump-hand-back-walk',
  'pump-hand-front-carry',
  'pump-hand-back-carry',
  'lumberjack-back-walk',
  'lumberjack-back-carry',
  'stone-mason-back-walk',
  'stone-mason-back-carry',
  'farmer-back-walk',
  'farmer-back-carry',
];
export const read = (p) => PNG.sync.read(fs.readFileSync(path.join(root, p)));
export const write = (p, img) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), PNG.sync.write(img));
};
function crop(img, left, width) {
  const out = new PNG({ width, height: img.height });
  for (let y = 0; y < img.height; y++)
    img.data.copy(
      out.data,
      y * width * 4,
      (y * img.width + left) * 4,
      (y * img.width + left + width) * 4,
    );
  return out;
}
function bounds(img) {
  let x0 = img.width,
    y0 = img.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3] > 128) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
// Visual joint traces in each 192px source column. Near limbs are the right limbs.
// Source f1/f3 are the planted/lifted passing silhouettes; boots preserve their sole directions.
const back = [
  {
    hips: [100, 304],
    neck: [99, 183],
    head: [102, 158],
    shoulderFar: [70, 207],
    shoulderNear: [119, 209],
    elbowFar: [48, 263],
    handFar: [43, 310],
    elbowNear: [143, 263],
    handNear: [157, 278],
    hipFar: [89, 306],
    kneeFar: [112, 369],
    ankleFar: [133, 399],
    toeFar: [144, 414],
    hipNear: [108, 306],
    kneeNear: [83, 384],
    ankleNear: [54, 453],
    toeNear: [72, 480],
  },
  {
    hips: [97, 304],
    neck: [97, 183],
    head: [100, 158],
    shoulderFar: [70, 207],
    shoulderNear: [117, 208],
    elbowFar: [62, 266],
    handFar: [59, 311],
    elbowNear: [136, 264],
    handNear: [143, 297],
    hipFar: [88, 307],
    kneeFar: [85, 377],
    ankleFar: [64, 430],
    toeFar: [69, 446],
    hipNear: [105, 306],
    kneeNear: [111, 382],
    ankleNear: [110, 453],
    toeNear: [135, 480],
  },
  {
    hips: [98, 305],
    neck: [98, 183],
    head: [101, 158],
    shoulderFar: [72, 207],
    shoulderNear: [118, 208],
    elbowFar: [56, 256],
    handFar: [54, 303],
    elbowNear: [136, 230],
    handNear: [156, 210],
    hipFar: [89, 307],
    kneeFar: [72, 365],
    ankleFar: [59, 399],
    toeFar: [80, 417],
    hipNear: [107, 306],
    kneeNear: [118, 383],
    ankleNear: [137, 454],
    toeNear: [157, 480],
  },
  {
    hips: [99, 305],
    neck: [99, 183],
    head: [102, 158],
    shoulderFar: [70, 207],
    shoulderNear: [120, 208],
    elbowFar: [61, 263],
    handFar: [59, 309],
    elbowNear: [141, 266],
    handNear: [153, 293],
    hipFar: [90, 306],
    kneeFar: [80, 385],
    ankleFar: [77, 451],
    toeFar: [99, 480],
    hipNear: [108, 306],
    kneeNear: [127, 364],
    ankleNear: [151, 421],
    toeNear: [150, 442],
  },
];
const front = [
  {
    hips: [100, 310],
    neck: [99, 182],
    head: [104, 159],
    shoulderFar: [73, 206],
    shoulderNear: [124, 210],
    elbowFar: [52, 264],
    handFar: [43, 321],
    elbowNear: [142, 276],
    handNear: [155, 309],
    hipFar: [88, 312],
    kneeFar: [67, 386],
    ankleFar: [54, 430],
    toeFar: [75, 449],
    hipNear: [109, 311],
    kneeNear: [107, 392],
    ankleNear: [132, 456],
    toeNear: [159, 480],
  },
  {
    hips: [101, 310],
    neck: [100, 182],
    head: [105, 159],
    shoulderFar: [74, 206],
    shoulderNear: [125, 210],
    elbowFar: [62, 264],
    handFar: [56, 317],
    elbowNear: [137, 276],
    handNear: [143, 311],
    hipFar: [89, 312],
    kneeFar: [76, 384],
    ankleFar: [67, 419],
    toeFar: [88, 434],
    hipNear: [110, 311],
    kneeNear: [109, 390],
    ankleNear: [115, 457],
    toeNear: [144, 480],
  },
  {
    hips: [100, 310],
    neck: [99, 182],
    head: [104, 159],
    shoulderFar: [72, 206],
    shoulderNear: [124, 210],
    elbowFar: [71, 267],
    handFar: [96, 304],
    elbowNear: [145, 267],
    handNear: [150, 317],
    hipFar: [111, 312],
    kneeFar: [129, 386],
    ankleFar: [141, 457],
    toeFar: [167, 480],
    hipNear: [90, 311],
    kneeNear: [71, 386],
    ankleNear: [58, 432],
    toeNear: [79, 450],
  },
  {
    hips: [100, 310],
    neck: [99, 182],
    head: [104, 159],
    shoulderFar: [73, 206],
    shoulderNear: [124, 210],
    elbowFar: [61, 263],
    handFar: [55, 316],
    elbowNear: [137, 272],
    handNear: [143, 309],
    hipFar: [108, 312],
    kneeFar: [104, 392],
    ankleFar: [107, 457],
    toeFar: [135, 480],
    hipNear: [89, 311],
    kneeNear: [117, 374],
    ankleNear: [135, 419],
    toeNear: [157, 438],
  },
];
// In the front-right view the anatomical right shoulder/hip is on screen-left.
// Keep the traced boot paths but identify the near limb consistently across phases.
for (const phase of front) {
  for (const prefix of ['shoulder', 'elbow', 'hand']) {
    [phase[prefix + 'Near'], phase[prefix + 'Far']] = [
      phase[prefix + 'Far'],
      phase[prefix + 'Near'],
    ];
  }
  const hipXs = [phase.hipNear[0], phase.hipFar[0]].sort((a, b) => a - b);
  phase.hipNear[0] = hipXs[0];
  phase.hipFar[0] = hipXs[1];
}
const geometry = {
  contract: {
    canvas: [1024, 1536],
    hatTop: 192,
    soleLine: 1344,
    hipsX: 512,
    figureHeight: 1152,
    sourceFigureHeight: 360,
    traceScale: 3.2,
    headBobMax: 23.04,
    stripHeight: 512,
    stripFigureHeight: 360,
    stripBaseline: 480,
    walkColumnWidth: 192,
    carryColumnWidth: 256,
    walkReachLimit: 88,
    wideReachLimit: 120,
  },
  traces: {
    back: {
      file: 'passenger-back-walk.png',
      method: 'manual visual tracing of joint centres, frame-local pixels',
      frames: back,
    },
    front: {
      file: 'pump-hand-front-walk.png',
      method: 'manual visual tracing of joint centres, frame-local pixels',
      frames: front,
    },
  },
  strips: {},
};
function raster(img, box, hit, grey) {
  const [x0, y0, x1, y1] = box;
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(img.height - 1, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(img.width - 1, Math.ceil(x1)); x++)
      if (hit(x + 0.5, y + 0.5)) {
        let p = (y * img.width + x) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = grey;
        img.data[p + 3] = 255;
      }
}
function ellipse(img, c, rx, ry, g) {
  raster(
    img,
    [c[0] - rx, c[1] - ry, c[0] + rx, c[1] + ry],
    (x, y) => ((x - c[0]) / rx) ** 2 + ((y - c[1]) / ry) ** 2 <= 1,
    g,
  );
}
function polygon(img, pts, g) {
  raster(
    img,
    [
      Math.min(...pts.map((p) => p[0])),
      Math.min(...pts.map((p) => p[1])),
      Math.max(...pts.map((p) => p[0])),
      Math.max(...pts.map((p) => p[1])),
    ],
    (x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [a, b] = pts[i],
          [c, d] = pts[j];
        if (b > y != d > y && x < ((c - a) * (y - b)) / (d - b) + a) inside = !inside;
      }
      return inside;
    },
    g,
  );
}
function limb(img, a, b, r, g) {
  raster(
    img,
    [
      Math.min(a[0], b[0]) - r,
      Math.min(a[1], b[1]) - r,
      Math.max(a[0], b[0]) + r,
      Math.max(a[1], b[1]) + r,
    ],
    (x, y) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        t = Math.max(
          0,
          Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)),
        );
      return (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2 <= r * r;
    },
    g,
  );
}
function rect(img, b, g) {
  polygon(
    img,
    [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x + b.width, b.y + b.height],
      [b.x, b.y + b.height],
    ],
    g,
  );
}
for (const profession of ['pump-hand', 'lumberjack', 'stone-mason', 'farmer']) {
  write(
    'refs/' + profession + '-front-walk.png',
    crop(read(profession + '-front-walk.png'), 0, 192),
  );
  if (profession !== 'pump-hand')
    write(
      'refs/' + profession + '-front-carry.png',
      crop(read('inputs/variations/' + profession + '-front-carry.png'), 0, 192),
    );
}
for (const strip of strips) {
  const profession = strip.replace(/-(front|back)-(walk|carry)$/, ''),
    view = strip.includes('-front-') ? 'front' : 'back',
    carry = strip.endsWith('-carry');
  if (view === 'back')
    write(
      'refs/' + strip + '-back.png',
      crop(read(carry ? 'inputs/variations/' + strip + '.png' : strip + '.png'), 0, 192),
    );
  geometry.strips[strip] = { profession, view, carry, frames: [] };
  for (let k = 0; k < 4; k++) {
    const trace = (view === 'back' ? back : front)[k],
      joints = {};
    for (const [key, p] of Object.entries(trace))
      joints[key] = [512 + (p[0] - trace.hips[0]) * 3.2, 1344 + (p[1] - 480) * 3.2];
    const j = joints,
      img = new PNG({ width: 1024, height: 1536 }),
      loadBoxes = [],
      loads = [];
    const stock = profession === 'lumberjack' ? 1.13 : 1;
    if (carry) {
      if (profession === 'pump-hand') {
        loads.push({
          kind: 'yoke',
          points: [
            [215, 475],
            [795, 425],
            [804, 477],
            [223, 527],
          ],
        });
        loadBoxes.push(
          { name: 'left bucket', x: 150, y: 650, width: 190, height: 220 },
          { name: 'right bucket', x: 715, y: 605, width: 185, height: 220 },
        );
        const steadyingSide = view === 'front' ? 'Far' : 'Near';
        j['hand' + steadyingSide] = [735, 443];
        j['elbow' + steadyingSide] = [675, 570];
      } else if (profession === 'lumberjack') {
        loads.push({
          kind: 'log',
          points: [
            [165, 315],
            [620, 455],
            [625, 565],
            [175, 435],
          ],
        });
        loadBoxes.push({ name: 'log end', x: 555, y: 433, width: 122, height: 137 });
        j.handNear = [640, 540];
        j.elbowNear = [674, 664];
      } else if (profession === 'farmer') {
        loads.push({
          kind: 'wheat',
          points: [
            [160, 270],
            [350, 244],
            [566, 504],
            [462, 590],
            [232, 428],
          ],
        });
        j.handNear = [563, 578];
        j.elbowNear = [675, 710];
      } else {
        loadBoxes.push({
          name: 'stone block showing both ends',
          x: 195,
          y: 500,
          width: 630,
          height: 232,
        });
        j.handFar = [245, 692];
        j.elbowFar = [335, 755];
        j.handNear = [772, 672];
        j.elbowNear = [695, 755];
      }
    } else if (profession === 'lumberjack') {
      loads.push({
        kind: 'axe handle',
        points: [
          [325, 392],
          [682, 579],
          [667, 608],
          [310, 421],
        ],
      });
      loadBoxes.push({ name: 'axe head', x: 247, y: 317, width: 154, height: 154 });
      j.handNear = [664, 561];
      j.elbowNear = [674, 696];
    } else if (profession === 'stone-mason') {
      loadBoxes.push({ name: 'hammer head', x: 727, y: 806, width: 132, height: 120 });
      j.handNear = [715, 841];
      j.elbowNear = [685, 699];
      loads.push({
        kind: 'hammer handle',
        points: [
          [700, 835],
          [803, 851],
          [798, 889],
          [695, 872],
        ],
      });
    } else if (profession === 'farmer') {
      loads.push({
        kind: 'fork handle',
        points: [
          [670, 278],
          [696, 278],
          [730, 817],
          [702, 817],
        ],
      });
      for (let n = 0; n < 3; n++)
        loadBoxes.push({ name: 'fork tine ' + n, x: 648 + n * 36, y: 192, width: 24, height: 130 });
      loads.push({
        kind: 'fork bridge',
        points: [
          [648, 306],
          [744, 302],
          [744, 330],
          [648, 334],
        ],
      });
      j.handNear = [714, 730];
      j.elbowNear = [689, 641];
    }
    // All loads drawn behind the figure; the mason block deliberately extends past both arms.
    for (const b of loadBoxes) rect(img, b, 190);
    for (const l of loads) polygon(img, l.points, 185);
    if (carry && profession === 'pump-hand') {
      limb(img, [242, 510], [242, 664], 16, 178);
      limb(img, [808, 462], [808, 616], 16, 178);
    }
    const limbR = 39 * stock;
    for (const side of ['Far', 'Near']) {
      const g = side === 'Near' ? 78 : 127;
      limb(img, j['hip' + side], j['knee' + side], limbR, g);
      limb(img, j['knee' + side], j['ankle' + side], limbR * 0.85, g);
      const a = j['ankle' + side],
        t = j['toe' + side],
        lifted = (k === 1 && side === 'Far') || (k === 3 && side === 'Near');
      if (lifted && view === 'back') ellipse(img, [t[0], t[1] - 22], 42, 75, g - 16);
      else
        polygon(
          img,
          [
            [a[0] - 37, a[1] - 27],
            [a[0] + 30, a[1] - 20],
            [t[0] + 26, t[1] - 13],
            [t[0] + 26, t[1]],
            [t[0] - 54, t[1]],
            [a[0] - 40, a[1] + 21],
          ],
          g - 12,
        );
    }
    const hips = j.hips;
    polygon(
      img,
      [
        [j.shoulderFar[0] - 22, j.shoulderFar[1] - 13],
        [j.shoulderNear[0] + 28, j.shoulderNear[1] - 13],
        [hips[0] + 73 * stock, hips[1] - 22],
        [hips[0] + 54 * stock, hips[1] + 37],
        [hips[0] - 71 * stock, hips[1] + 37],
        [hips[0] - 95 * stock, hips[1] - 44],
      ],
      148,
    );
    for (const side of ['Far', 'Near']) {
      const g = side === 'Near' ? 108 : 166;
      limb(img, j['shoulder' + side], j['elbow' + side], 32 * stock, g);
      limb(img, j['elbow' + side], j['hand' + side], 28 * stock, g);
      ellipse(img, j['hand' + side], 29, 36, g);
    }
    ellipse(img, j.neck, 38, 65, 150);
    ellipse(img, j.head, 72 * stock, 84, 169);
    // Cap top is exact y192; the head and torso follow their traced centres.
    ellipse(img, [j.head[0], 234], profession === 'farmer' ? 128 : 94 * stock, 42, 123);
    const b = bounds(img);
    geometry.strips[strip].frames.push({
      frame: k,
      phase: [
        'right forward',
        'right support / left lifted',
        'left forward',
        'left support / right lifted',
      ][k],
      sourceTrace: trace,
      joints,
      loadBoxes,
      loadPolygons: loads,
      box: b,
      guide: 'guides/' + strip + '-f' + k + '.png',
      bodyAnchor: [512, 1344],
    });
    write('guides/' + strip + '-f' + k + '.png', img);
  }
}
fs.writeFileSync(path.join(root, 'pose-geometry.json'), JSON.stringify(geometry, null, 2) + '\n');
console.log('Wrote36 guides, identity crops and pose-geometry.json.');
