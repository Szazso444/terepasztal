import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { PAL } from '../src/art/palette';
import { forAll, shrinkArray, shrinkInt } from '../src/testing/property';
import {
  ALPHA_FLOOR,
  ALPHA_FULL,
  AMBER_STRENGTH,
  AMBER_TONE,
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
  fromHsv,
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

// --- properties: every texel, not a few examples ------------------------------------------------
//
// The properties judge the pass by #465's own numbers, restated here rather than imported from
// tools/atlas-cap.mjs, so a wrong threshold or predicate there is caught and not agreed with.

const AC = {
  alphaFloor: 16,
  alphaFull: 250,
  white: [...PAL.white],
  whiteCap: PAL.white.map((c) => c - 1),
  amber: { hueFrom: 25, hueTo: 50, saturation: 0.62, value: 0.85 },
  tone: { saturation: 0.6, value: 0.88 },
  knee: 0.85,
};
/** Rec. 709 luma in 0..1. */
const lumaAc = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
/** [hue in degrees, saturation, value] of an 8-bit colour. */
function hsvAc(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0 && max === r) h = 60 * ((g - b) / d);
  else if (d > 0 && max === g) h = 60 * (2 + (b - r) / d);
  else if (d > 0) h = 60 * (4 + (r - g) / d);
  return [h < 0 ? h + 360 : h, max ? d / max : 0, max / 255];
}
const overWhiteAc = (r, g, b) => r >= AC.white[0] && g >= AC.white[1] && b >= AC.white[2];
function amberStrongAc(r, g, b) {
  const [h, s, v] = hsvAc(r, g, b);
  const a = AC.amber;
  return h >= a.hueFrom && h <= a.hueTo && s >= a.saturation && v >= a.value;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
/** Hue distance in degrees, around the circle. */
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
/**
 * How far 8-bit rounding of the result may move its saturation, value and hue. Over all 281,570
 * colours as strong as the amber the toning moves them at most 0.0018, 0.4 / 255 and 0.35 degrees
 * from the tone it aims at (219,92,0 -> 219,143,88 is saturation 0.6018).
 */
const ROUND_S = 0.005;
const ROUND_V = 0.5 / 255 + 1e-9;
const ROUND_H = 1;

/** Any colour, or one near the edges the pass draws: the cursor white, the amber, the knee. */
function genRgb(rng) {
  switch (rng.int(0, 4)) {
    case 0:
      return [rng.int(0, 255), rng.int(0, 255), rng.int(0, 255)];
    case 1:
      // around the cursor white's corner, on both sides of each channel's threshold
      return [rng.int(224, 255), rng.int(216, 255), rng.int(196, 255)];
    case 2: {
      // around the amber's strength, in its own terms
      const h = rng.range(AC.amber.hueFrom - 6, AC.amber.hueTo + 6);
      return fromHsv(h, rng.range(0.5, 1), rng.range(0.78, 1)).map(clamp255);
    }
    case 3: {
      // light, near-neutral and warm: the lit stone, cream and plaster of the painted sets
      const v = rng.int(190, 255);
      return [v, v * rng.range(0.85, 1), v * rng.range(0.7, 1)].map(clamp255);
    }
    default:
      return [rng.int(200, 255), rng.int(200, 255), rng.int(200, 255)];
  }
}
/** An alpha that is often one of the pass's edges: 0, the haze floor, the solid threshold. */
const genAlpha = (rng) =>
  rng.pick([
    0,
    255,
    rng.int(1, AC.alphaFloor + 4),
    rng.int(AC.alphaFull - 4, 255),
    rng.int(0, 255),
  ]);
/** A batch of texels; a failing batch shrinks to the one texel that fails. */
const genTexels = (rng, n = 300) =>
  Array.from({ length: n }, () => [...genRgb(rng), genAlpha(rng)]);
const shrinkTexels = (ts) => shrinkArray(ts);
/** A batch of opaque texels drawn by `gen` until `keep` holds for each. */
function genWhere(rng, gen, keep, n = 200) {
  const out = [];
  while (out.length < n) {
    const t = gen(rng);
    if (keep(...t)) out.push(t);
  }
  return out;
}

/**
 * Fails with the message `what()` builds when `ok` is false. The message is built only on a
 * failure, so a property over thousands of texels stays fast.
 */
function holds(ok, what) {
  if (!ok) throw new Error(what());
}
const same = (p, q) => p.length === q.length && p.every((v, i) => v === q[i]);

describe('the cap pass, as a property of every texel', () => {
  it('names #465`s numbers', () => {
    expect([ALPHA_FLOOR, ALPHA_FULL]).toEqual([AC.alphaFloor, AC.alphaFull]);
    expect(WHITE_CAP).toEqual(AC.whiteCap);
    expect(AMBER_STRENGTH).toEqual(AC.amber);
    expect(AMBER_TONE).toEqual(AC.tone);
    expect(LUMA_KNEE).toBe(AC.knee);
  });

  it('reads hue, saturation and value the way it writes them', () => {
    forAll(
      (rng) => genTexels(rng),
      (ts) => {
        for (const [r, g, b] of ts) {
          const [h, s, v] = toHsv(r, g, b);
          const back = fromHsv(h, s, v);
          holds(
            h >= 0 && h < 360 && s >= 0 && s <= 1 && v >= 0 && v <= 1,
            () => `${[r, g, b]} -> hsv ${[h, s, v]}`,
          );
          holds(
            [r, g, b].every((c, i) => Math.abs(back[i] - c) < 1e-9),
            () => `${[r, g, b]} -> hsv ${[h, s, v]} -> ${back}`,
          );
        }
      },
      { shrink: shrinkTexels },
    );
  });

  it('never leaves a texel that breaks the cap, with or without compression', () => {
    forAll(
      (rng) => ({ compress: rng.chance(0.5), texels: genTexels(rng) }),
      ({ compress, texels: ts }) => {
        for (const t of ts) {
          const [r, g, b, a] = capTexel(...t, { compress });
          const what = (why) => () => `${t} -> ${[r, g, b, a]}: ${why}`;
          holds(
            a === 0 || (a >= AC.alphaFloor && a < AC.alphaFull) || a === 255,
            what('alpha haze or near-solid'),
          );
          if (a === 0) continue;
          holds(!overWhiteAc(r, g, b), what('over the cursor white'));
          holds(!amberStrongAc(r, g, b), what('as strong as the amber'));
        }
      },
      { shrink: (c) => [...shrinkTexels(c.texels)].map((texels) => ({ ...c, texels })) },
    );
  });

  it('is idempotent without compression', () => {
    forAll(
      (rng) => genTexels(rng),
      (ts) => {
        for (const t of ts) {
          const once = capTexel(...t);
          const twice = capTexel(...once);
          holds(same(once, twice), () => `${t} -> ${once} -> ${twice}`);
        }
      },
      { shrink: shrinkTexels },
    );
  });

  it('leaves a texel alone that breaks nothing: no haze, solid or near-solid, under both caps', () => {
    forAll(
      (rng) => ({ compress: rng.chance(0.5), texels: genTexels(rng) }),
      ({ compress, texels: ts }) => {
        for (const t of ts) {
          const [r, g, b, a] = t;
          if (a !== 0 && (a < AC.alphaFloor || (a >= AC.alphaFull && a < 255))) continue;
          if (overWhiteAc(r, g, b) || amberStrongAc(r, g, b)) continue;
          if (compress && lumaAc(r, g, b) > AC.knee) continue;
          const out = capTexel(r, g, b, a, { compress });
          holds(same(out, t), () => `${t} -> ${out} (compress ${compress})`);
        }
      },
      { shrink: (c) => [...shrinkTexels(c.texels)].map((texels) => ({ ...c, texels })) },
    );
  });

  it('maps alpha by alpha alone, and the colour of a kept texel does not depend on its alpha', () => {
    forAll(
      (rng) => ({ rgb: genRgb(rng), compress: rng.chance(0.5) }),
      ({ rgb, compress }) => {
        const solid = capTexel(...rgb, 255, { compress });
        // every alpha, not a sample: 256 values
        for (let a = 0; a <= 255; a++) {
          const out = capTexel(...rgb, a, { compress });
          const want =
            a === 0
              ? [...rgb, 0]
              : a < AC.alphaFloor
                ? [0, 0, 0, 0]
                : [...solid.slice(0, 3), a >= AC.alphaFull ? 255 : a];
          holds(same(out, want), () => `${[...rgb, a]} -> ${out}, not ${want}`);
        }
      },
    );
  });

  it('scales a texel over the cursor white as a whole, by the least that brings it under', () => {
    forAll(
      (rng) =>
        genWhere(
          rng,
          (q) => [q.int(AC.white[0], 255), q.int(AC.white[1], 255), q.int(AC.white[2], 255)],
          overWhiteAc,
        ),
      (ts) => {
        for (const rgb of ts) {
          const out = capTexel(...rgb, 255).slice(0, 3);
          const what = (why) => () => `${rgb} -> ${out}: ${why}`;
          // one factor for all three channels, rounded: the hue and saturation stay
          const f = Math.min(...AC.whiteCap.map((c, i) => c / rgb[i]));
          holds(
            out.every((c, i) => c <= AC.whiteCap[i]),
            what(`over ${AC.whiteCap}`),
          );
          holds(
            out.every((c, i) => Math.abs(c - f * rgb[i]) <= 0.5 + 1e-9),
            what(`not ${rgb} scaled by ${f}`),
          );
          // and no darker than it must be: one channel lands on its cap
          holds(
            out.some((c, i) => c === AC.whiteCap[i]),
            what('darker than it must be'),
          );
        }
      },
      { shrink: shrinkTexels },
    );
  });

  it('tones a texel as strong as the amber to the nearest colour under it, keeping its hue', () => {
    const a = AC.amber;
    forAll(
      (rng) =>
        genWhere(
          rng,
          (q) =>
            fromHsv(q.range(a.hueFrom, a.hueTo), q.range(a.saturation, 1), q.range(a.value, 1)).map(
              clamp255,
            ),
          amberStrongAc,
        ),
      (ts) => {
        for (const rgb of ts) {
          const out = capTexel(...rgb, 255).slice(0, 3);
          const [h0, s0, v0] = hsvAc(...rgb);
          const [h1, s1, v1] = hsvAc(...out);
          // saturation and value at most the tone's, up to 8-bit rounding, and no lower than that
          const s = Math.min(s0, AC.tone.saturation);
          const v = Math.min(v0, AC.tone.value);
          const what = (why) => () => `${rgb} -> ${out}: ${why}`;
          holds(hueGap(h0, h1) <= ROUND_H, what(`hue ${h0} -> ${h1}`));
          holds(Math.abs(s1 - s) <= ROUND_S, what(`saturation ${s1}, not ${s}`));
          holds(Math.abs(v1 - v) <= ROUND_V, what(`value ${v1}, not ${v}`));
        }
      },
      { shrink: shrinkTexels },
    );
  });

  it('compresses a lit texel as a whole by its luma, never brightening it, under the cursor white`s luma', () => {
    const limit = lumaAc(...AC.white);
    forAll(
      // light colours too weakly saturated for the amber step, so compression is all that acts
      (rng) =>
        genWhere(
          rng,
          (q) => {
            const v = q.int(200, 255);
            return [v, v * q.range(0.8, 1), v * q.range(0.6, 1)].map(clamp255);
          },
          (r, g, b) => lumaAc(r, g, b) > AC.knee && hsvAc(r, g, b)[1] < 0.5,
        ),
      (ts) => {
        for (const rgb of ts) {
          const out = capTexel(...rgb, 255, { compress: true }).slice(0, 3);
          const y = lumaAc(...rgb);
          const f = compressLuma(y) / y;
          const what = (why) => () => `${rgb} -> ${out}: ${why}`;
          holds(f <= 1, what(`brightened by ${f}`));
          holds(
            out.every((c, i) => Math.abs(c - f * rgb[i]) <= 0.5 + 1e-9),
            what(`not ${rgb} scaled by ${f}`),
          );
          holds(lumaAc(...out) < limit, what(`luma ${lumaAc(...out)}`));
        }
      },
      { shrink: shrinkTexels },
    );
  });

  it('keeps the order of brightness: a texel at least as bright in every channel never comes out darker', () => {
    // with compression the lit gradient stays a gradient. Each result is rounded to 8 bits, which
    // moves its luma by up to half a step, so two results may swap by up to one step (seed 1:
    // 251,252,224 comes out at luma 0.8898 and 255,255,243 at 0.8874)
    forAll(
      (rng) =>
        genWhere(
          rng,
          (q) => {
            const lo = genRgb(q);
            return [...lo, ...lo.map((c) => Math.min(255, c + q.int(0, 24)))];
          },
          (...pair) => hsvAc(...pair.slice(0, 3))[1] < 0.5 && hsvAc(...pair.slice(3))[1] < 0.5,
        ),
      (pairs) => {
        for (const p of pairs) {
          const dim = capTexel(...p.slice(0, 3), 255, { compress: true });
          const bright = capTexel(...p.slice(3), 255, { compress: true });
          holds(
            lumaAc(...bright.slice(0, 3)) >= lumaAc(...dim.slice(0, 3)) - 1 / 255,
            () => `${p.slice(0, 3)} -> ${dim}, but ${p.slice(3)} -> ${bright}`,
          );
        }
      },
      { shrink: shrinkTexels },
    );
  });

  it('compresses luma smoothly: no kink, never brighter, still rising, under the cursor white`s', () => {
    // a clip at the ceiling, or a straight knee, is a kink: the slope jumps there
    const h = 1e-5;
    const limit = lumaAc(...AC.white);
    let last = -1;
    for (let i = 0; i <= 2000; i++) {
      const y = 0.5 + i / 4000;
      const c = compressLuma(y);
      const left = (c - compressLuma(y - h)) / h;
      const right = (compressLuma(y + h) - c) / h;
      holds(Math.abs(right - left) < 1e-2, () => `slope at ${y}: ${left} then ${right}`);
      holds(right > 0 && right <= 1 + 1e-6, () => `slope at ${y}: ${right}`);
      holds(c <= y && c > last && c < limit, () => `${y} -> ${c}, after ${last}`);
      last = c;
    }
  });
});

/** A small image of random texels, `w` x `h`. */
function genImage(rng) {
  const w = rng.int(1, 8);
  const h = rng.int(1, 8);
  return { w, h, texels: genTexels(rng, w * h), compress: rng.chance(0.3) };
}
const toPng = ({ w, h, texels: ts }) => {
  const p = new PNG({ width: w, height: h });
  ts.forEach((t, i) => p.data.set(t, i * 4));
  return p;
};
/** Smaller images: fewer rows, then fewer columns, then one texel made transparent. */
function* shrinkImage(c) {
  for (const h of shrinkInt(c.h, 1)) yield { ...c, h, texels: c.texels.slice(0, c.w * h) };
  for (const w of shrinkInt(c.w, 1))
    yield {
      ...c,
      w,
      texels: Array.from({ length: c.h }, (_, y) => c.texels.slice(y * c.w, y * c.w + w)).flat(),
    };
  for (let i = 0; i < c.texels.length; i++)
    if (c.texels[i][3] !== 0)
      yield { ...c, texels: c.texels.map((t, j) => (j === i ? [0, 0, 0, 0] : t)) };
}

describe('the cap pass on an image, as a property', () => {
  it('is the texel pass on every texel, leaves its input alone and counts what it changed', () => {
    forAll(
      genImage,
      (c) => {
        const p = toPng(c);
        const before = Buffer.from(p.data);
        const { png, counts } = capPng(p, { compress: c.compress });
        expect(p.data.equals(before), 'the input is not changed').toBe(true);
        expect([png.width, png.height]).toEqual([c.w, c.h]);
        const want = { texels: 0, haze: 0, solid: 0, white: 0, amber: 0, compressed: 0 };
        c.texels.forEach(([r, g, b, a], i) => {
          const out = capTexel(r, g, b, a, { compress: c.compress });
          expect([...png.data.subarray(i * 4, i * 4 + 4)], `texel ${i}: ${[r, g, b, a]}`).toEqual(
            out,
          );
          if (out.every((v, k) => v === [r, g, b, a][k])) return;
          want.texels++;
          if (a < AC.alphaFloor) return void want.haze++;
          if (a >= AC.alphaFull && a < 255) want.solid++;
          if (c.compress && lumaAc(r, g, b) > AC.knee) want.compressed++;
          if (overWhiteAc(r, g, b)) want.white++;
          if (amberStrongAc(r, g, b)) want.amber++;
        });
        expect(counts).toEqual(want);
        expect(capViolations(png)).toEqual({ haze: 0, solid: 0, white: 0, amber: 0 });
      },
      { shrink: shrinkImage },
    );
  });

  it('finds every texel that breaks the cap, and only those', () => {
    forAll(
      genImage,
      (c) => {
        const want = { haze: 0, solid: 0, white: 0, amber: 0 };
        for (const [r, g, b, a] of c.texels) {
          if (a === 0) continue;
          if (a < AC.alphaFloor) want.haze++;
          if (a >= AC.alphaFull && a < 255) want.solid++;
          if (r >= AC.white[0] && g >= AC.white[1] && b >= AC.white[2]) want.white++;
          const [hue, s, v] = hsvAc(r, g, b);
          if (hue >= 25 && hue <= 50 && s >= 0.62 && v >= 0.85) want.amber++;
        }
        expect(capViolations(toPng(c))).toEqual(want);
      },
      { shrink: shrinkImage },
    );
  });

  it('compresses exactly the frames of the lit sets, by key', () => {
    // the Fuel Pump's four views and nothing else (Core, 2026-10-17: other lit sets take the
    // white cap alone)
    const LIT_KEYS = [
      ['structures/fuel_pump', true],
      ['structures/fuel_pump_r1', true],
      ['structures/fuel_pump_r2', true],
      ['structures/fuel_pump_r3', true],
      ['structures/fuel_pump_r4', false],
      ['structures/fuel_pumps', false],
      ['structures/fuel_pump_a0_r1', false],
      ['props/fuel_pump', false],
      ['structures/station', false],
      ['structures/townhouse_0', false],
      ['props/tree_0', false],
      ['bridgekit/stone-deck-x', false],
    ].map(([key, lit]) => ({ key, lit }));
    forAll(
      (rng) => ({
        ...genImage(rng),
        ...rng.pick(LIT_KEYS),
      }),
      (c) => {
        const p = toPng(c);
        const want = capPng(p, { compress: c.lit });
        const got = capFrame(c.key, p);
        expect(got.png.data.equals(want.png.data), c.key).toBe(true);
        expect(got.counts).toEqual(want.counts);
      },
      { shrink: shrinkImage },
    );
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
  // slow because every texel of a group's whole atlas is checked: 0.37 s alone for structures, the
  // largest, so a limit of 30 s for each group
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
    30_000,
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
