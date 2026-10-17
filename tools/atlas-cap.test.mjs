import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { PAL } from '../src/art/palette';
import {
  ALPHA_FLOOR,
  ALPHA_FULL,
  CURSOR_WHITE,
  LUMA_CEILING,
  LUMA_KNEE,
  SELECTION_AMBER,
  WHITE_CAP,
  capFrame,
  capPng,
  capTexel,
  capViolations,
  compressLuma,
  isAmberStrong,
  isLitFrame,
  isOverWhite,
  luma,
  toHsv,
} from './atlas-cap.mjs';

const ASSETS = new URL('../public/assets/', import.meta.url);

/** An image of the given texels in a row. */
function row(...texels) {
  const p = new PNG({ width: texels.length, height: 1 });
  texels.forEach((t, i) => p.data.set(t, i * 4));
  return p;
}
const texels = (p) =>
  Array.from({ length: p.width * p.height }, (_, i) => [...p.data.subarray(i * 4, i * 4 + 4)]);

describe('the cap colours', () => {
  it('are the game palette`s cursor white and selection amber', () => {
    expect(CURSOR_WHITE).toEqual([...PAL.white]);
    expect(SELECTION_AMBER).toEqual([...PAL.amber]);
    expect(WHITE_CAP).toEqual(PAL.white.map((c) => c - 1));
  });
  it('count the amber itself as strong and the cursor white as white', () => {
    expect(isAmberStrong(...SELECTION_AMBER)).toBe(true);
    expect(isOverWhite(...CURSOR_WHITE)).toBe(true);
    expect(isOverWhite(...WHITE_CAP)).toBe(false);
  });
});

describe('the cap pass on one texel', () => {
  it('drops alpha haze with its colour and makes a near-solid surface solid', () => {
    expect(capTexel(200, 100, 50, ALPHA_FLOOR - 1)).toEqual([0, 0, 0, 0]);
    expect(capTexel(200, 100, 50, 1)).toEqual([0, 0, 0, 0]);
    expect(capTexel(200, 100, 50, ALPHA_FLOOR)).toEqual([200, 100, 50, ALPHA_FLOOR]);
    expect(capTexel(200, 100, 50, ALPHA_FULL - 1)).toEqual([200, 100, 50, ALPHA_FULL - 1]);
    for (const a of [ALPHA_FULL, 254, 255])
      expect(capTexel(200, 100, 50, a)).toEqual([200, 100, 50, 255]);
  });
  it('leaves a transparent texel as it is', () => {
    expect(capTexel(255, 255, 255, 0)).toEqual([255, 255, 255, 0]);
  });
  it('brings a texel over the cursor white to at most one step under it, keeping its hue', () => {
    for (const rgb of [
      [255, 255, 255],
      [254, 252, 240],
      [240, 232, 212],
      [236, 228, 208],
      [250, 245, 210],
    ]) {
      const [r, g, b] = capTexel(...rgb, 255);
      expect([r <= WHITE_CAP[0], g <= WHITE_CAP[1], b <= WHITE_CAP[2]], `${rgb}`).toEqual([
        true,
        true,
        true,
      ]);
      expect(isOverWhite(r, g, b)).toBe(false);
      const [h0, s0] = toHsv(...rgb);
      const [h1, s1] = toHsv(r, g, b);
      if (s0 > 0.02) expect(Math.abs(h1 - h0), `${rgb} hue`).toBeLessThan(4);
      expect(Math.abs(s1 - s0), `${rgb} saturation`).toBeLessThan(0.02);
    }
  });
  it('leaves a light colour under the cursor white in any channel alone', () => {
    expect(capTexel(245, 232, 200, 255)).toEqual([245, 232, 200, 255]);
    expect(capTexel(235, 240, 240, 255)).toEqual([235, 240, 240, 255]);
  });
  it('tones a texel as strong as the amber to saturation 0.6 and value 0.88, keeping its hue', () => {
    for (const rgb of [
      SELECTION_AMBER,
      [255, 200, 40],
      [247, 120, 24],
      [227, 123, 5],
      [220, 153, 63],
    ]) {
      expect(isAmberStrong(...rgb), `${rgb} is amber-strong`).toBe(true);
      const [r, g, b] = capTexel(...rgb, 255);
      expect(isAmberStrong(r, g, b), `${rgb} -> ${[r, g, b]}`).toBe(false);
      const [h0] = toHsv(...rgb);
      const [h1, s1, v1] = toHsv(r, g, b);
      expect(Math.abs(h1 - h0), `${rgb} hue`).toBeLessThan(1.5);
      expect(s1).toBeLessThanOrEqual(0.605);
      expect(v1).toBeLessThanOrEqual(0.885);
    }
  });
  it('leaves warm colours weaker than the amber alone', () => {
    // a hue outside 25 to 50 degrees, too little saturation, too little value
    for (const rgb of [
      [232, 90, 72],
      [232, 200, 150],
      [200, 140, 50],
    ])
      expect(capTexel(...rgb, 255)).toEqual([...rgb, 255]);
  });
  it('is idempotent without compression', () => {
    for (const t of [
      [255, 255, 255, 252],
      [232, 170, 72, 255],
      [240, 232, 212, 20],
      [12, 200, 90, 8],
    ]) {
      const once = capTexel(...t);
      expect(capTexel(...once)).toEqual(once);
    }
  });
});

describe('the luma compression of a lit set', () => {
  it('is the identity up to the knee, continuous and monotone above it, and stays under the ceiling', () => {
    expect(compressLuma(0.5)).toBe(0.5);
    expect(compressLuma(LUMA_KNEE)).toBe(LUMA_KNEE);
    expect(compressLuma(LUMA_KNEE + 1e-6)).toBeCloseTo(LUMA_KNEE + 1e-6, 9);
    let last = LUMA_KNEE;
    for (let y = LUMA_KNEE + 0.005; y <= 1; y += 0.005) {
      const c = compressLuma(y);
      expect(c).toBeGreaterThan(last);
      expect(c).toBeLessThan(LUMA_CEILING);
      last = c;
    }
  });
  it('keeps the ceiling under the cursor white`s own luma', () => {
    expect(LUMA_CEILING).toBeLessThan(luma(...CURSOR_WHITE));
  });
  it('brings every texel under the cursor white`s luma, a brighter one never darker than a dimmer', () => {
    const ramp = [];
    for (let v = 200; v <= 255; v++)
      ramp.push([v, Math.round(v * 0.96), Math.round(v * 0.86), 255]);
    const out = texels(capPng(row(...ramp), { compress: true }).png);
    let last = 0;
    for (const [r, g, b] of out) {
      const y = luma(r, g, b);
      expect(y).toBeLessThan(luma(...CURSOR_WHITE));
      expect(y).toBeGreaterThanOrEqual(last - 1 / 255);
      last = y;
    }
    // the white cap alone clips the ramp's top, everything over the cursor white, to a couple of
    // colours; the compressed ramp keeps more of its steps there
    const over = ramp.filter(([r, g, b]) => isOverWhite(r, g, b)).length;
    expect(over).toBeGreaterThan(8);
    const distinct = (list) => new Set(list.slice(-over).map(([r, g, b]) => `${r},${g},${b}`)).size;
    expect(distinct(out)).toBeGreaterThan(distinct(texels(capPng(row(...ramp)).png)));
  });
  it('is chosen by frame key for the sets in LIT_FRAMES only', () => {
    for (const key of [
      'structures/fuel_pump',
      'structures/fuel_pump_r1',
      'structures/fuel_pump_r3',
    ])
      expect(isLitFrame(key), key).toBe(true);
    for (const key of [
      'structures/fuel_pump_r4',
      'structures/station_4',
      'bridgekit/stone-deck-x',
      'props/tree_0',
    ])
      expect(isLitFrame(key), key).toBe(false);
    const lit = row([240, 236, 224, 255]);
    expect(texels(capFrame('structures/fuel_pump', lit).png)[0]).not.toEqual(
      texels(capFrame('structures/station', lit).png)[0],
    );
  });
});

describe('the cap pass on an image', () => {
  it('returns a new image and counts what it changed', () => {
    const p = row(
      [255, 255, 255, 255],
      [232, 170, 72, 252],
      [10, 20, 30, 9],
      [10, 20, 30, 0],
      [90, 90, 90, 255],
    );
    const before = Buffer.from(p.data);
    const { png, counts } = capPng(p);
    expect(p.data.equals(before)).toBe(true);
    expect(counts).toEqual({ texels: 3, haze: 1, solid: 1, white: 1, amber: 1, compressed: 0 });
    expect(capViolations(png)).toEqual({ haze: 0, solid: 0, white: 0, amber: 0 });
    expect(capViolations(p)).toEqual({ haze: 1, solid: 1, white: 1, amber: 1 });
  });
});

/** Every atlas group shipped in public/assets: a json with a frame table, beside its png. */
function shippedAtlases() {
  return readdirSync(ASSETS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .filter((name) => {
      const json = JSON.parse(readFileSync(new URL(`${name}.json`, ASSETS), 'utf8'));
      return json.frames && existsSync(new URL(`${name}.png`, ASSETS));
    });
}

describe('every packed atlas in public/assets', () => {
  const groups = shippedAtlases();
  it('is found: the groups the packers write', () => {
    for (const g of ['props', 'terrain', 'structures', 'icons', 'bridges', 'rolling'])
      expect(groups).toContain(g);
  });
  it.each(groups)(
    '%s: no texel at or above the cursor white, none as strong as the amber, no alpha haze',
    (group) => {
      const png = PNG.sync.read(readFileSync(new URL(`${group}.png`, ASSETS)));
      expect(
        capViolations(png),
        `re-pack ${group} through its packer (tools/atlas-cap.mjs)`,
      ).toEqual({
        haze: 0,
        solid: 0,
        white: 0,
        amber: 0,
      });
    },
  );
  it.each(groups)('%s: the frames of a lit set stay under the cursor white`s luma', (group) => {
    const png = PNG.sync.read(readFileSync(new URL(`${group}.png`, ASSETS)));
    const { frames } = JSON.parse(readFileSync(new URL(`${group}.json`, ASSETS), 'utf8'));
    const limit = luma(...CURSOR_WHITE);
    for (const [key, f] of Object.entries(frames)) {
      if (!isLitFrame(key)) continue;
      for (let y = f.y; y < f.y + f.h; y++)
        for (let x = f.x; x < f.x + f.w; x++) {
          const i = (y * png.width + x) * 4;
          if (png.data[i + 3])
            expect(luma(png.data[i], png.data[i + 1], png.data[i + 2]), key).toBeLessThan(limit);
        }
    }
  });
});
