import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { CARGO } from '../src/sim/cargo';
import { RESOURCE_GROUPS } from '../src/ui/resourceOrder';
import { isAmberStrong, luma } from './atlas-cap.mjs';
import { packFrames } from './illustrated-sprites.mjs';
import {
  EDGE,
  FIT,
  FRAME,
  SHEET,
  cutIcon,
  easeGold,
  easeGoldTexel,
  findIcons,
  lanczos,
  mergeIcons,
  placeIcon,
  run,
  sharpen,
} from './resource-icons.mjs';

/** A `w` x `h` image with every texel transparent. */
function blank(w, h) {
  const png = new PNG({ width: w, height: h });
  png.data.fill(0);
  return png;
}

function setPixel(png, x, y, rgba) {
  png.data.set(rgba, (y * png.width + x) * 4);
}

function pixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  return [...png.data.subarray(i, i + 4)];
}

/** Fills a rectangle, x1 and y1 exclusive. */
function rect(png, x0, y0, x1, y1, rgba) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPixel(png, x, y, rgba);
}

const DARK = [20, 14, 10, 253];
const BRIGHT = [240, 200, 60, 253];

describe('the shipped icons atlas', () => {
  const atlas = JSON.parse(readFileSync('public/assets/icons.json', 'utf8'));
  const sheet = PNG.sync.read(readFileSync('public/assets/icons.png'));
  const frame = (id) => atlas.frames[`icons/${id}`];
  const texels = (f, each) => {
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++)
        each(...sheet.data.subarray(((f.y + y) * sheet.width + f.x + x) * 4).subarray(0, 4), x, y);
  };

  it('is what the sheet builds: run `node tools/resource-icons.mjs` after an illustrated pack', () => {
    expect(run({ check: true }).same).toBe(true);
  });

  it('serves every resource of both production chains', () => {
    const ids = new Set([...RESOURCE_GROUPS.flat(), ...CARGO.map((c) => c.id)]);
    const missing = [...ids].filter((id) => !frame(id));
    expect(missing).toEqual([]);
  });

  it('keeps the file contract', () => {
    expect(atlas.resolution).toBe(4);
    expect(atlas.partial).toBe(true);
  });

  it('shows each painted icon in a square frame anchored on its centre, because the slots are', () => {
    for (const id of SHEET)
      expect(frame(id), id).toMatchObject({ w: FRAME, h: FRAME, ax: 32, ay: 32 });
  });

  it('leaves the frame edge clear and fills the frame along the longest side', () => {
    for (const id of SHEET) {
      let [x0, y0, x1, y1] = [FRAME, FRAME, -1, -1];
      texels(frame(id), (_r, _g, _b, a, x, y) => {
        if (!a) return;
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      });
      expect(Math.min(x0, y0, FRAME - 1 - x1, FRAME - 1 - y1), id).toBeGreaterThan(0);
      // one texel of leeway: the kernel feathers the outermost row
      expect(Math.max(x1 - x0, y1 - y0) + 1, id).toBeGreaterThanOrEqual(FIT - 1);
    }
  });

  it('has no light fringe: what is part transparent is the dark outline', () => {
    for (const id of SHEET)
      texels(frame(id), (r, g, b, a) => {
        if (a > 0 && a < 128) expect(luma(r, g, b), id).toBeLessThan(0.2);
      });
  });
});

describe('findIcons and cutIcon', () => {
  it('finds the parts left to right and drops specks', () => {
    const sheet = blank(200, 60);
    rect(sheet, 120, 10, 170, 50, DARK);
    rect(sheet, 10, 10, 60, 50, DARK);
    setPixel(sheet, 90, 30, DARK);
    expect(findIcons(sheet).map((i) => i.box)).toEqual([
      [10, 10, 59, 49],
      [120, 10, 169, 49],
    ]);
  });

  it('keeps a neighbour out of the box of an icon whose outline wraps around it', () => {
    const sheet = blank(120, 80);
    // an L around the corner of a block that stands inside its box
    rect(sheet, 5, 5, 25, 75, DARK);
    rect(sheet, 5, 55, 100, 75, DARK);
    rect(sheet, 60, 5, 110, 45, BRIGHT);
    const [ell] = findIcons(sheet);
    const cut = cutIcon(sheet, ell);
    expect(pixel(cut, 60, 10)[3]).toBe(0);
    expect(pixel(cut, 10, 10)[3]).toBe(255);
  });

  it('makes a dip in the alpha inside the outline solid', () => {
    const sheet = blank(80, 80);
    rect(sheet, 10, 10, 70, 70, DARK);
    rect(sheet, 30, 30, 50, 50, [90, 140, 200, 120]);
    const cut = cutIcon(sheet, findIcons(sheet)[0]);
    expect(pixel(cut, 30, 30)).toEqual([90, 140, 200, 255]);
  });

  it('gives the rim the colour of the solid pixels inside it, not its own noise', () => {
    const sheet = blank(80, 80);
    rect(sheet, 10, 10, 70, 70, [255, 255, 255, 140]);
    rect(sheet, 13, 13, 67, 67, DARK);
    const cut = cutIcon(sheet, findIcons(sheet)[0]);
    const [r, g, b, a] = pixel(cut, 1, 40);
    expect([r, g, b]).toEqual(DARK.slice(0, 3));
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
    expect(a).toBe(Math.round((255 * (140 - EDGE)) / (245 - EDGE)));
  });
});

describe('lanczos', () => {
  it('refuses to enlarge', () => {
    expect(() => lanczos(blank(10, 10), 11, 5)).toThrow();
  });

  it('keeps a flat colour flat, solid to the edge', () => {
    const src = blank(90, 90);
    rect(src, 0, 0, 90, 90, [100, 150, 200, 255]);
    const small = lanczos(src, 30, 30);
    for (const [x, y] of [
      [0, 0],
      [15, 15],
      [29, 7],
    ])
      expect(pixel(small, x, y)).toEqual([100, 150, 200, 255]);
  });

  it('works in premultiplied alpha: a transparent neighbour does not darken the colour', () => {
    const src = blank(90, 90);
    rect(src, 0, 0, 45, 90, [220, 40, 40, 255]);
    const small = lanczos(src, 30, 30);
    for (let x = 0; x < 30; x++) {
      const [r, g, b, a] = pixel(small, x, 15);
      if (a < 16) continue;
      expect(Math.abs(r - 220), `x ${x}`).toBeLessThanOrEqual(1);
      expect(Math.abs(g - 40), `x ${x}`).toBeLessThanOrEqual(1);
      expect(Math.abs(b - 40), `x ${x}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('placeIcon', () => {
  it('centres any shape in the square frame at the fit', () => {
    const tall = blank(100, 200);
    rect(tall, 0, 0, 100, 200, [100, 150, 200, 255]);
    const placed = placeIcon(tall);
    expect([placed.width, placed.height]).toEqual([FRAME, FRAME]);
    expect(pixel(placed, 32, 0)[3]).toBe(0);
    expect(pixel(placed, 32, 1)[3]).toBe(255);
    expect(pixel(placed, 32, 62)[3]).toBe(255);
    expect(pixel(placed, 15, 32)[3]).toBe(0);
    expect(pixel(placed, 16, 32)[3]).toBe(255);
    expect(pixel(placed, 47, 32)[3]).toBe(0);
  });
});

describe('sharpen', () => {
  it('moves no alpha and leaves a flat colour alone', () => {
    const png = blank(32, 32);
    rect(png, 4, 4, 28, 28, [100, 150, 200, 255]);
    setPixel(png, 3, 16, [100, 150, 200, 77]);
    const alpha = () => png.data.filter((_, i) => i % 4 === 3);
    const before = alpha();
    sharpen(png);
    expect(alpha()).toEqual(before);
    expect(pixel(png, 16, 16)).toEqual([100, 150, 200, 255]);
  });

  it('spreads the two sides of a step inside the icon', () => {
    const png = blank(32, 32);
    rect(png, 0, 0, 16, 32, [80, 80, 80, 255]);
    rect(png, 16, 0, 32, 32, [160, 160, 160, 255]);
    sharpen(png);
    expect(pixel(png, 15, 16)[0]).toBeLessThan(80);
    expect(pixel(png, 16, 16)[0]).toBeGreaterThan(160);
  });
});

describe('easeGold', () => {
  it('leaves no lit gold as strong as the amber, whatever comes in', () => {
    for (let r = 200; r <= 255; r += 5)
      for (let g = 100; g <= 255; g += 5)
        for (let b = 0; b <= 160; b += 10)
          expect(isAmberStrong(...easeGoldTexel(r, g, b)), `${r},${g},${b}`).toBe(false);
  });

  it('leaves other hues and the shaded side of the gold as they are', () => {
    expect(easeGoldTexel(30, 120, 230)).toEqual([30, 120, 230]);
    expect(easeGoldTexel(120, 60, 200)).toEqual([120, 60, 200]);
    expect(easeGoldTexel(160, 110, 20)).toEqual([160, 110, 20]);
  });

  it('keeps the value, so the bright side stays bright', () => {
    expect(Math.max(...easeGoldTexel(255, 205, 60))).toBe(255);
  });

  it('runs over a frame in place and skips what is transparent', () => {
    const png = blank(2, 1);
    setPixel(png, 0, 0, [255, 205, 60, 255]);
    setPixel(png, 1, 0, [255, 205, 60, 0]);
    expect(easeGold(png)).toBe(png);
    expect(isAmberStrong(...pixel(png, 0, 0).slice(0, 3))).toBe(false);
    expect(pixel(png, 1, 0)).toEqual([255, 205, 60, 0]);
  });
});

describe('mergeIcons', () => {
  const painted = (rgba, w = 8, h = 6) => {
    const png = blank(w, h);
    rect(png, 0, 0, w, h, rgba);
    return png;
  };
  const atlas = () => {
    const items = [
      { key: 'icons/kept', png: painted([10, 20, 30, 255]), ax: 4, ay: 3 },
      { key: 'icons/old', png: painted([40, 50, 60, 255]), ax: 4, ay: 3 },
    ];
    const { sheet, frames } = packFrames(items);
    return { sheet, json: { resolution: 4, partial: true, frames } };
  };

  it('replaces its items, keeps every other frame pixel for pixel and the file contract', () => {
    const { sheet, json } = atlas();
    const fresh = { key: 'icons/old', png: painted([200, 100, 50, 255], 16, 16), ax: 8, ay: 8 };
    const merged = mergeIcons(sheet, json, [fresh]);
    expect(merged.json.resolution).toBe(4);
    expect(merged.json.partial).toBe(true);
    expect(Object.keys(merged.json.frames)).toEqual(['icons/kept', 'icons/old']);
    const kept = merged.json.frames['icons/kept'];
    expect(kept).toMatchObject({ w: 8, h: 6, ax: 4, ay: 3 });
    expect(pixel(merged.sheet, kept.x + 3, kept.y + 2)).toEqual([10, 20, 30, 255]);
    const old = merged.json.frames['icons/old'];
    expect(old).toMatchObject({ w: 16, h: 16, ax: 8, ay: 8 });
    expect(pixel(merged.sheet, old.x + 8, old.y + 8)).toEqual([200, 100, 50, 255]);
  });

  it('adds no frame the atlas does not have', () => {
    const { sheet, json } = atlas();
    const stray = { key: 'icons/new', png: painted([1, 2, 3, 255]), ax: 4, ay: 3 };
    expect(() => mergeIcons(sheet, json, [stray])).toThrow(/no frame icons\/new/);
  });
});
