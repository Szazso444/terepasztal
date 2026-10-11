import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const folder = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(folder, '../../..');
const geometry = {
  projection: '2:1 orthographic isometric',
  gameTile: [64, 32],
  canvas: [1024, 1024],
  canvasPixelsPerGamePixel: 8,
  canvasTile: [512, 256],
  center: [512, 512],
  tileOffsetProjection: { x: '512 + 256*(x-y)', y: '512 + 128*(x+y)' },
  ellipseHalfAxesPerRadiusTile: [362, 181],
  middleTileOutline: [
    [512, 384],
    [768, 512],
    [512, 640],
    [256, 512],
  ],
  lake: {
    openWater: { radius: [0, 0.85], outerHalfAxes: [308, 154] },
    shallow: { radius: [0.85, 1.0], outerHalfAxes: [362, 181] },
    waterline: {
      radius: 1.0,
      halfAxes: [362, 181],
      points: [
        [874, 512],
        [512, 693],
        [150, 512],
        [512, 331],
      ],
    },
    dampMargin: { radius: [1.0, 1.12], outerHalfAxes: [405, 203] },
    transparentBeyondRadius: 1.12,
  },
  beach: {
    openSea: { radius: [0, 0.8], outerHalfAxes: [290, 145] },
    surf: { radius: [0.8, 0.95], outerHalfAxes: [344, 172], foamLines: [1, 2] },
    swash: { radius: [0.95, 1.0], outerHalfAxes: [362, 181] },
    waterline: {
      radius: 1.0,
      halfAxes: [362, 181],
      points: [
        [874, 512],
        [512, 693],
        [150, 512],
        [512, 331],
      ],
    },
    wetSand: { radius: [1.0, 1.12], outerHalfAxes: [405, 203] },
    drySand: {
      radius: [1.12, 1.3],
      outerHalfAxes: [471, 235],
      outerPoints: [
        [983, 512],
        [512, 747],
        [41, 512],
        [512, 277],
      ],
    },
    transparentBeyondRadius: 1.3,
  },
};

fs.mkdirSync(path.join(folder, 'guides'), { recursive: true });
fs.mkdirSync(path.join(folder, 'refs'), { recursive: true });
fs.writeFileSync(
  path.join(folder, 'shore-geometry.json'),
  JSON.stringify(geometry, null, 2) + '\n',
);

function guide(name, bands) {
  const png = new PNG({ width: 1024, height: 1024 });
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const r = Math.hypot((x + 0.5 - 512) / 362, (y + 0.5 - 512) / 181);
      const band = bands.find(([outer]) => r <= outer);
      if (!band) continue;
      const p = (y * 1024 + x) * 4;
      const diamondDistance = Math.abs(
        Math.abs(x + 0.5 - 512) / 256 + Math.abs(y + 0.5 - 512) / 128 - 1,
      );
      const shade = diamondDistance < 0.006 ? 30 : band[1];
      png.data.set([shade, shade, shade, 255], p);
    }
  }
  fs.writeFileSync(path.join(folder, 'guides', name), PNG.sync.write(png, { colorType: 6 }));
}

guide('lake-ring.png', [
  [0.85, 90],
  [1, 155],
  [1.12, 115],
]);
guide('beach-ring.png', [
  [0.8, 90],
  [0.95, 145],
  [1, 210],
  [1.12, 120],
  [1.3, 180],
]);

for (const material of ['water', 'sand']) {
  const dest = path.join(folder, 'refs', `ref-${material}.png`);
  if (fs.existsSync(dest)) continue;
  const source = PNG.sync.read(
    fs.readFileSync(path.join(root, 'assets/source/base-v1', `terrain-${material}.png`)),
  );
  const x0 = Math.floor(source.width * 0.25);
  const y0 = Math.floor(source.height * 0.3);
  const width = Math.floor(source.width * 0.75) - x0;
  const height = Math.floor(source.height * 0.7) - y0;
  const crop = new PNG({ width, height });
  PNG.bitblt(source, crop, x0, y0, width, height, 0, 0);
  fs.writeFileSync(dest, PNG.sync.write(crop, { colorType: 6 }));
}
console.log('Wrote two guides, shore-geometry.json, and missing hue reference crops.');
