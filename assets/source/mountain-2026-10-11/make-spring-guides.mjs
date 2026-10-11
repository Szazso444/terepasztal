import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../../..');
for (const sub of ['guides', 'refs']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
const geometry = {
  projection: '2:1 orthographic isometric',
  gameTile: [64, 32],
  footprint: 'FOOTPRINTS.t1',
  canvas: [1024, 1024],
  scale: 8,
  centre: [512, 832],
  anchor: [512, 832],
  packedAnchor: [32, 16],
  axes: { x: 'NW to SE', y: 'NE to SW' },
  tileOffsetRange: [-0.5, 0.5],
  projectionFormula: ['512 + 256*(x-y)', '832 + 128*(x+y)'],
  corners: { top: [512, 704], right: [768, 832], bottom: [512, 960], left: [256, 832] },
  edgeMidpoints: { ne: [640, 768], se: [640, 896], sw: [384, 896], nw: [384, 768] },
  edgeNames: { ne: 'upper-right', se: 'lower-right', sw: 'lower-left', nw: 'upper-left' },
  waterCrossSection: [-0.38, 0.38],
  bankAbsCrossSection: [0.38, 0.5],
  roundEnd: { centre: [512, 832], waterHalfAxes: [138, 69], bankHalfAxes: [181, 90.5] },
  pool: { centre: [512, 832], acrossTiles: 0.3, halfAxes: [54, 27] },
  stones: {
    radialRange: [0.38, 0.5],
    largestAcrossTiles: 0.1,
    side: 'upstream half, away from exit',
  },
  retainedSpring: { radius: 0.5, side: 'upstream half, away from exit' },
  animationFrames: 4,
  reviewCanvas: [128, 128],
  reviewTileWidth: 64,
  waterReferenceCrop: { x: [0.25, 0.75], y: [0.3, 0.7] },
};
fs.writeFileSync(path.join(dir, 'spring-geometry.json'), JSON.stringify(geometry, null, 2) + '\n');
const directions = { ne: [0, -1], se: [1, 0], sw: [0, 1], nw: [-1, 0] };
for (const [edge, [dx, dy]] of Object.entries(directions)) {
  const png = new PNG({ width: 1024, height: 1024 });
  for (let py = 0; py < 1024; py++)
    for (let px = 0; px < 1024; px++) {
      const sx = px + 0.5 - 512,
        sy = py + 0.5 - 832;
      const x = (sx / 256 + sy / 128) / 2,
        y = (sy / 128 - sx / 256) / 2;
      if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) continue;
      const t = x * dx + y * dy,
        u = -x * dy + y * dx;
      const bankRound = (sx / 181) ** 2 + (sy / 90.5) ** 2;
      const waterRound = (sx / 138) ** 2 + (sy / 69) ** 2;
      const bank = bankRound <= 1 || (t >= 0 && t <= 0.5 && Math.abs(u) <= 0.5);
      const water = waterRound <= 1 || (t >= 0 && t <= 0.5 && Math.abs(u) <= 0.38);
      const poolR = Math.sqrt((sx / 54) ** 2 + (sy / 27) ** 2);
      const diamondEdge = Math.min(0.5 - Math.abs(x), 0.5 - Math.abs(y)) < 0.004;
      let value = water ? 210 : bank ? 130 : 0;
      let alpha = bank ? 255 : 0;
      if (Math.abs(poolR - 1) < 0.045) {
        value = 75;
        alpha = 255;
      }
      if (diamondEdge) {
        value = 80;
        alpha = 255;
      }
      const i = (py * 1024 + px) * 4;
      png.data.set([value, value, value, alpha], i);
    }
  fs.writeFileSync(path.join(dir, 'guides', `spring-${edge}.png`), PNG.sync.write(png));
}
const src = PNG.sync.read(
  fs.readFileSync(path.join(root, 'assets/source/base-v1/terrain-water.png')),
);
const left = Math.floor(src.width * 0.25),
  top = Math.floor(src.height * 0.3);
const crop = new PNG({
  width: Math.floor(src.width * 0.75) - left,
  height: Math.floor(src.height * 0.7) - top,
});
PNG.bitblt(src, crop, left, top, crop.width, crop.height, 0, 0);
fs.writeFileSync(path.join(dir, 'refs/ref-water.png'), PNG.sync.write(crop));
console.log('Wrote four guides, geometry manifest and water hue crop.');
