/**
 * Turn a smooth Blender render into pixel art in the game's own medium.
 *
 * The game is hard-edged, palette-limited pixel art (see docs/art-direction). A raw Cycles render
 * is smooth and full-colour, so it clashes. This snaps every pixel to a shade of the game palette
 * and hardens the alpha, which bands the 3D light into pixel-art shading while keeping the form
 * and occlusion the render gives. Run in place on a rendered PNG before packing.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

// the kit palette (src/art/palette.ts), sRGB — the only base colours an asset uses
const BASE = [
  [188, 169, 139], // limestone
  [206, 190, 162], // trim
  [98, 107, 108], // slate
  [154, 88, 62], // clay roof
  [158, 116, 70], // timber
  [112, 80, 50], // timber dark
  [86, 96, 102], // iron
  [214, 172, 92], // brass
  [232, 170, 72], // amber
  [163, 107, 66], // copper
  [166, 96, 66], // brick
  [152, 146, 134], // ballast
  [128, 132, 136], // rail
  [122, 146, 76], // grass
  [236, 228, 208], // white
];
// a few light steps per base give the pixel-art shading bands the light falls into. The top step
// stays near 1: pushing it past ~1.1 chalks limestone and trim out to a washed grey in the render.
const STEPS = [1.1, 0.98, 0.84, 0.7, 0.58];
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const SNAP = BASE.flatMap((c) =>
  STEPS.map((s) => [clamp(c[0] * s), clamp(c[1] * s), clamp(c[2] * s)]),
);

function nearest(r, g, b) {
  let best = SNAP[0];
  let bd = Infinity;
  for (const c of SNAP) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Snap colours to the palette and harden the alpha, writing the PNG back in place. */
export function pixelate(path, alphaCut = 140) {
  const png = PNG.sync.read(readFileSync(path));
  const { data, width, height } = png;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o + 3] < alphaCut) {
      data[o + 3] = 0;
      continue;
    }
    const c = nearest(data[o], data[o + 1], data[o + 2]);
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
}
