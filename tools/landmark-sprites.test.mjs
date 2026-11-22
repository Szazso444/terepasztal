import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { FIT } from './building-fit.mjs';
import { capViolations } from './atlas-cap.mjs';
import {
  cornerErrors,
  footprintCorners,
  medianOf,
  readDoorPx,
  shrink,
  verdictOf,
} from './landmark-sprites.mjs';

const FINAL = 'assets/source/rare-landmarks-v1/final';
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** A clear picture with the given pixels solid. */
function picture(w, h, solid) {
  const png = new PNG({ width: w, height: h });
  for (const [x, y] of solid) {
    const i = (y * w + x) * 4;
    png.data[i] = 200;
    png.data[i + 3] = 255;
  }
  return png;
}

describe('footprint geometry', () => {
  it('puts W along the lower-left wall and D along the lower-right, round the centre', () => {
    expect(footprintCorners(3, 2)).toEqual({ w: [-80, -8], s: [16, 40], e: [80, 8] });
    expect(footprintCorners(1, 1)).toEqual({ w: [-32, 0], s: [0, 16], e: [32, 0] });
  });

  it('measures no error for a base that lies on its diamond', () => {
    const base = { w: [-30, 92], s: [66, 140], e: [130, 108] };
    expect(cornerErrors(base, [50, 100], 1, [3, 2])).toEqual({ w: 0, s: 0, e: 0, max: 0 });
  });

  it('measures the distance in world px, at the picture`s scale', () => {
    const base = { w: [-64, 0], s: [0, 40], e: [64, 0] };
    expect(cornerErrors(base, [0, 0], 0.5, [1, 1])).toEqual({ w: 0, s: 4, e: 0, max: 4 });
  });
});

describe('the door', () => {
  it('reads DOOR_PX from the renderer rather than copying it', () => {
    expect(readDoorPx()).toBe(13.2);
  });

  it('takes the median of what was measured', () => {
    expect(medianOf([109, 101, 123])).toBe(109);
    expect(medianOf([114, 112])).toBe(113);
  });
});

describe('verdict', () => {
  it('fails a camera past the near limit and keeps one inside it', () => {
    expect(verdictOf({ by: FIT.near + 0.1, off: true })).toBe('regenerate');
    expect(verdictOf({ by: FIT.near, off: true })).toBe('fit');
  });

  it('judges a single foot by whether a camera near the game`s can draw it', () => {
    expect(verdictOf({ by: null, off: true })).toBe('regenerate');
    expect(verdictOf({ by: null, off: false })).toBe('fit');
  });
});

describe('shrink', () => {
  it('scales both axes by the one factor and keeps the anchor on the same picture point', () => {
    const png = picture(10, 6, [[4, 2]]);
    const out = shrink(png, 0.5, [5, 3]);
    // the anchor stays on a texel corner: the grid starts one source pixel before the picture
    expect([out.ax, out.ay]).toEqual([3, 2]);
    expect([out.png.width, out.png.height]).toEqual([6, 4]);
    expect(out.png.data[(1 * 6 + 2) * 4 + 3]).toBeGreaterThan(0);
  });

  it('keeps an anchor that does not fall on a texel of the shrunk picture exact', () => {
    const out = shrink(picture(9, 9, [[4, 4]]), 1 / 3, [4, 4]);
    expect(out.ax).toBe(2);
    expect(out.ay).toBe(2);
    // the texel grid moved with the anchor, so the solid pixel at the anchor is the texel after it
    const i = (2 * out.png.width + 2) * 4;
    expect(out.png.data[i + 3]).toBeGreaterThan(0);
  });

  it('keeps coverage: a solid pixel in a 2x2 cell is a quarter of the texel', () => {
    const out = shrink(picture(4, 4, [[0, 0]]), 0.5, [0, 0]);
    const i = 0;
    expect(out.png.data[i + 3]).toBe(64);
    expect(out.png.data[i]).toBe(200);
  });
});

const shipped = existsSync(`${FINAL}/calibration.json`) && existsSync('public/assets/landmarks.png');

describe.runIf(shipped)('the exported landmarks', () => {
  const calibration = shipped ? readJson(`${FINAL}/calibration.json`) : null;
  const atlas = shipped ? readJson('public/assets/landmarks.json') : null;
  const manifest = readJson(`${FINAL}/manifest.json`);
  const footprints = readJson('src/art/landmarkFootprints.json');

  it('has every picture of the manifest, and only those', () => {
    expect(calibration.landmarks.map((l) => l.file)).toEqual(manifest.assets.map((a) => a.file));
  });

  it('has one frame per landmark, no turned views', () => {
    const keys = Object.keys(footprints).map((id) => `landmarks/${id}`);
    expect(Object.keys(atlas.frames).sort()).toEqual(keys.sort());
    expect(atlas.resolution).toBe(calibration.resolution);
  });

  it('scales every picture uniformly by the door rule, or by the median where it has no door', () => {
    const door = readDoorPx();
    for (const l of calibration.landmarks) {
      if (l.door.px !== null) expect(l.scale).toBeCloseTo(door / l.door.px, 3);
      else expect(l.door.basis).toBe('median');
    }
  });

  it('lists a frame anchor inside the frame, the footprint`s centre', () => {
    for (const l of calibration.landmarks) {
      const f = atlas.frames[`landmarks/${l.id}`];
      expect([f.ax, f.ay]).toEqual(l.anchor.frame);
      expect(l.anchor.point).toBe('footprint centre');
      expect(f.ax).toBeGreaterThan(0);
      expect(f.ax).toBeLessThan(f.w);
      expect(f.ay).toBeGreaterThan(0);
      expect(f.ay).toBeLessThan(f.h);
    }
  });

  it('keeps the spec`s footprints', () => {
    for (const l of calibration.landmarks) expect(l.footprint.spec).toEqual(footprints[l.id]);
  });

  it('passes the cap', () => {
    const png = PNG.sync.read(readFileSync('public/assets/landmarks.png'));
    expect(capViolations(png)).toEqual({ haze: 0, solid: 0, white: 0, amber: 0 });
  });
});
