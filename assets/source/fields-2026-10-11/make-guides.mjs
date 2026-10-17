import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { FOOTPRINTS } from '../../../tools/building-kit.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fp = FOOTPRINTS.t1;
const geometry = {
  projection: '2:1 orthographic isometric',
  tileGamePx: [64, 32],
  footprint: 'FOOTPRINTS.t1',
  tiles: fp.tiles,
  canvas: fp.canvas,
  canvasPxPerGamePx: fp.scale,
  centre: fp.centre,
  anchor: [512, 832],
  tileCorners: { top: [512, 704], right: [768, 832], bottom: [512, 960], left: [256, 832] },
  tileAxes: { x: 'NW to SE', y: 'NE to SW' },
  edges: { NE: 'upper-right', SE: 'lower-right', SW: 'lower-left', NW: 'upper-left' },
  pointFormula: ['512 + 256 * (x - y)', '832 + 128 * (x + y)'],
  projectionCoefficients: [256, 128],
  patch: {
    absoluteTileBounds: { x: 0.42, y: 0.42 },
    cornersRounded: [
      [512, 724],
      [727, 832],
      [512, 940],
      [297, 832],
    ],
    edgeWanderTile: 0.04,
    edgeWander: {
      SE: 'inward and outward',
      SW: 'inward and outward',
      NE: 'inward only',
      NW: 'inward only',
    },
    edge: 'soft and irregular; neighbouring patches do not touch',
  },
  rows: {
    axis: 'tile y',
    parallelEdges: ['NW', 'SE'],
    directionCanvas: [
      [256, 832],
      [512, 704],
    ],
    periodGamePx: 6,
    cropGamePx: 4,
    furrowGamePx: 2,
    approximateCount: 9,
    phaseFormulaGamePx: '(screenX + 2 * screenY) % 6',
    pitchTileX: 6 / 64,
    cropToFurrowRatio: 2,
  },
  earsMaxHeightGamePx: 2,
  earsMaxHeightCanvasPx: 16,
};

const png = new PNG({ width: fp.canvas[0], height: fp.canvas[1] });
// Invert the projection and draw analytically; no painting is processed by this script.
for (let py = 0; py < png.height; py++) {
  for (let px = 0; px < png.width; px++) {
    const sx = (px + 0.5 - 512) / 256;
    const sy = (py + 0.5 - 832) / 128;
    const x = (sx + sy) / 2;
    const y = (sy - sx) / 2;
    const index = (py * png.width + px) * 4;
    let grey = null;
    if (Math.abs(x) <= 0.42 && Math.abs(y) <= 0.42) {
      grey = 216;
      // x + 2*y in screen game pixels advances 64 pixels per tile-x step.
      const phase = (((64 * x + 3) % 6) + 6) % 6;
      if (Math.min(phase, 6 - phase) < 0.16) grey = 132;
    }
    const distance = Math.max(Math.abs(x), Math.abs(y));
    if (Math.abs(distance - 0.5) < 0.0045) grey = 100;
    if (grey !== null) png.data.set([grey, grey, grey, 255], index);
  }
}
mkdirSync(join(root, 'guides'), { recursive: true });
writeFileSync(join(root, 'guides/wheat.png'), PNG.sync.write(png));
writeFileSync(join(root, 'geometry.json'), `${JSON.stringify(geometry, null, 2)}\n`);
console.log('Wrote guides/wheat.png (1024x1024 RGBA) and geometry.json');
