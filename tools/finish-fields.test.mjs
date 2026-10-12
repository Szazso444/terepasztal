import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import {
  CANVAS,
  DENSITY,
  HIGHLIGHT_CAP,
  STALK_MIN,
  STALK_SWELL,
  VARIANTS,
  capHighlight,
  clipToGeometry,
  finishAll,
  mergeFrames,
  placePainting,
  raiseField,
  run,
  toFrame,
} from './finish-fields.mjs';
import { packFrames } from './illustrated-sprites.mjs';

const geometry = JSON.parse(
  readFileSync(
    new URL('../assets/source/fields-2026-10-11/geometry.json', import.meta.url),
    'utf8',
  ),
);
const bounds = {
  bounds: geometry.patch.absoluteTileBounds,
  wander: geometry.patch.edgeWanderTile,
  ears: geometry.earsMaxHeightGamePx,
};
const AMBER = [232, 170, 72];
const CURSOR_WHITE = [236, 228, 208];
const dominates = (px, ref) => px[0] >= ref[0] && px[1] >= ref[1] && px[2] >= ref[2];

/** A float image with a flat diamond of `colour` of half-extent `half` tile units, centred on the tile. */
function diamond(half, colour = [214, 170, 80]) {
  const { w, h, ax, ay } = CANVAS;
  const img = { w, h, rgb: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
  for (let v = 0; v < h; v++)
    for (let u = 0; u < w; u++) {
      const px = (u + 0.5 - ax) / (32 * DENSITY);
      const py = (v + 0.5 - ay) / (16 * DENSITY);
      const tx = (px + py) / 2;
      const ty = (py - px) / 2;
      if (Math.abs(tx) <= half && Math.abs(ty) <= half) {
        const o = v * w + u;
        img.a[o] = 1;
        img.rgb.set(colour, o * 3);
      }
    }
  return img;
}

/** [lowest, highest] opaque row of every column that has any. */
function columns(img) {
  const out = [];
  for (let u = 0; u < img.w; u++) {
    let lo = -1;
    let hi = img.h;
    for (let v = 0; v < img.h; v++)
      if (img.a[v * img.w + u] > 0.5) {
        hi = Math.min(hi, v);
        lo = Math.max(lo, v);
      }
    if (lo >= 0) out.push([u, hi, lo]);
  }
  return out;
}

describe('highlight cap', () => {
  it('keeps every colour below the selection amber and the cursor white, in red alone', () => {
    for (let r = 0; r <= 255; r += 3)
      for (let g = 0; g <= 255; g += 15)
        for (let b = 0; b <= 255; b += 15) {
          const out = capHighlight([r, g, b]).map(Math.round);
          expect(out[0], `${[r, g, b]}`).toBeLessThan(HIGHLIGHT_CAP);
          expect(dominates(out, AMBER)).toBe(false);
          expect(dominates(out, CURSOR_WHITE)).toBe(false);
        }
  });
  it('leaves a colour under the knee alone and keeps the hue of one above it', () => {
    expect(capHighlight([180, 150, 70])).toEqual([180, 150, 70]);
    const [r, g, b] = capHighlight([240, 200, 100]);
    expect(g / r).toBeCloseTo(200 / 240, 6);
    expect(b / r).toBeCloseTo(100 / 240, 6);
  });
  it('is monotone: a brighter red never comes out darker', () => {
    let last = -1;
    for (let r = 0; r <= 255; r++) {
      const out = capHighlight([r, 0, 0])[0];
      expect(out).toBeGreaterThanOrEqual(last);
      last = out;
    }
  });
});

describe('geometry clip', () => {
  const frame = { ...bounds };
  it('removes what lies outside the patch bounds and keeps what lies inside', () => {
    const img = diamond(0.6);
    clipToGeometry(img, frame, CANVAS, 0);
    const { ax, ay } = CANVAS;
    const at = (tx, ty) => {
      const u = Math.floor(ax + (tx - ty) * 32 * DENSITY);
      const v = Math.floor(ay + (tx + ty) * 16 * DENSITY);
      return img.a[v * img.w + u];
    };
    expect(at(0, 0)).toBe(1);
    expect(at(0.4, 0)).toBe(1);
    expect(at(-0.4, -0.4)).toBe(1);
    // the SE and SW sides may wander 0.04 out, the NE and NW sides may not
    expect(at(0.45, 0)).toBe(1);
    expect(at(0, 0.45)).toBe(1);
    expect(at(0.5, 0)).toBe(0);
    expect(at(0, 0.5)).toBe(0);
    expect(at(-0.45, 0)).toBe(0);
    expect(at(0, -0.45)).toBe(0);
  });
  it('lets an ear stand up to the geometry allows over the ground, and no higher', () => {
    const img = diamond(0.42);
    clipToGeometry(img, frame);
    const rows = columns(img);
    const ground = diamond(0.42);
    const g = columns(ground);
    // the clip may only take away: the patch is as it was
    expect(rows).toEqual(g);
    // a pixel above the back corner by more than the ears stands outside
    const hi = Math.min(...g.map(([, top]) => top));
    const tall = diamond(0.42);
    for (let u = CANVAS.ax - 3; u <= CANVAS.ax + 3; u++)
      for (let v = hi - 20; v < hi - bounds.ears * DENSITY - 2; v++) {
        tall.a[v * tall.w + u] = 1;
        tall.rgb.fill(200, (v * tall.w + u) * 3, (v * tall.w + u) * 3 + 3);
      }
    clipToGeometry(tall, frame);
    expect(Math.min(...columns(tall).map(([, top]) => top))).toBeGreaterThanOrEqual(
      hi - bounds.ears * DENSITY - 1,
    );
  });
});

describe('raise', () => {
  it('lifts the heads and leaves the footprint where it was', () => {
    const flat = diamond(0.4);
    const before = columns(flat);
    const up = raiseField(flat, 5);
    const after = columns(up);
    // the lowest row of each column is the ground contact: it does not move
    expect(after.map(([u, , lo]) => [u, lo])).toEqual(before.map(([u, , lo]) => [u, lo]));
    // the highest row rises by the stalks' height, 2.6 to 3.5 world px, short of that at the edge
    const rise = after.map(([, hi], i) => before[i][1] - hi);
    const interior = after
      .map(([u, hi], i) => ({ u, rise: before[i][1] - hi }))
      .filter(({ u }) => Math.abs(u - CANVAS.ax) < 40);
    expect(Math.max(...interior.map((c) => c.rise))).toBeLessThanOrEqual(
      Math.ceil((STALK_MIN + STALK_SWELL) * DENSITY) + 1,
    );
    expect(Math.max(...interior.map((c) => c.rise))).toBeGreaterThanOrEqual(
      Math.floor(STALK_MIN * DENSITY),
    );
    expect(Math.min(...rise)).toBeGreaterThanOrEqual(0);
  });
  it('shades the front darker than the heads, the lower right darker than the lower left', () => {
    const img = diamond(0.4, [200, 160, 80]);
    const up = raiseField(img, 5);
    const { ax } = CANVAS;
    const lum = (o) => up.rgb[o * 3] + up.rgb[o * 3 + 1] + up.rgb[o * 3 + 2];
    const front = (u) => {
      const col = columns(up).find(([x]) => x === u);
      return lum(col[2] * up.w + u);
    };
    expect(front(ax - 30)).toBeLessThan(600 * 0.95);
    expect(front(ax + 30)).toBeLessThan(front(ax - 30));
  });
  it('is the painting itself at raise 0', () => {
    const img = diamond(0.4);
    expect(raiseField(img, 5, 0)).toBe(img);
  });
  it('is deterministic', () => {
    const a = raiseField(diamond(0.4), 7);
    const b = raiseField(diamond(0.4), 7);
    expect(Buffer.from(a.a.buffer).equals(Buffer.from(b.a.buffer))).toBe(true);
    expect(Buffer.from(a.rgb.buffer).equals(Buffer.from(b.rgb.buffer))).toBe(true);
  });
});

describe('placing a painting', () => {
  it('scales about the anchor and keeps the colour of an opaque square', () => {
    const p = new PNG({ width: 100, height: 100 });
    for (let y = 40; y < 60; y++)
      for (let x = 40; x < 60; x++) p.data.set([200, 100, 50, 255], (y * 100 + x) * 4);
    const img = placePainting(p, [50, 50], 0.5);
    const { ax, ay } = CANVAS;
    const o = (ay - 2) * img.w + (ax - 2);
    expect(img.a[o]).toBeCloseTo(1, 6);
    expect([...img.rgb.slice(o * 3, o * 3 + 3)]).toEqual([200, 100, 50]);
    // 20 painting px at 0.5 texels per px is 10 texels wide, about the anchor
    let width = 0;
    for (let u = 0; u < img.w; u++) if (img.a[ay * img.w + u] > 0.5) width++;
    expect(width).toBe(10);
  });
});

describe('merging into the atlas', () => {
  const sheetOf = (w, h, fill) => {
    const s = new PNG({ width: w, height: h });
    s.data.fill(fill);
    return s;
  };
  const item = (key, w, h, rgb) => {
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) png.data.set([...rgb, 255], i * 4);
    return { key, png, ax: w / 2, ay: h - 1 };
  };
  const base = () => {
    const sheet = sheetOf(60, 20, 77);
    const json = {
      resolution: 4,
      partial: true,
      frames: { 'props/a': { x: 4, y: 4, w: 20, h: 12, ax: 10, ay: 11 } },
    };
    return { sheet, json };
  };
  it('keeps the frames that were there byte for byte and adds a row below them', () => {
    const { sheet, json } = base();
    const out = mergeFrames(sheet, json, [item('props/wheat_0', 10, 8, [200, 160, 60])]);
    expect(out.json.resolution).toBe(4);
    expect(out.json.partial).toBe(true);
    expect(out.json.frames['props/a']).toEqual(json.frames['props/a']);
    const f = out.json.frames['props/wheat_0'];
    expect(f.y).toBeGreaterThanOrEqual(sheet.height);
    expect(out.sheet.width).toBe(sheet.width);
    expect(out.sheet.data.subarray(0, sheet.width * sheet.height * 4).equals(sheet.data)).toBe(
      true,
    );
    const at = (x, y) => [...out.sheet.data.subarray((y * out.sheet.width + x) * 4).slice(0, 4)];
    expect(at(f.x, f.y)).toEqual([200, 160, 60, 255]);
    expect(at(f.x + f.w - 1, f.y + f.h - 1)).toEqual([200, 160, 60, 255]);
    expect(f.ax).toBe(5);
  });
  it('replaces its own frames on a second run instead of stacking them', () => {
    const { sheet, json } = base();
    const items = [
      item('props/wheat_0', 10, 8, [200, 160, 60]),
      item('props/wheat_1', 12, 9, [1, 2, 3]),
    ];
    const once = mergeFrames(sheet, json, items);
    const twice = mergeFrames(once.sheet, once.json, items);
    expect(twice.json).toEqual(once.json);
    expect(twice.sheet.height).toBe(once.sheet.height);
    expect(twice.sheet.data.equals(once.sheet.data)).toBe(true);
  });
  it('packs with the gutters of the atlas the rest was packed with', () => {
    const packed = packFrames([item('x', 10, 8, [9, 9, 9])], 100);
    expect(packed.frames.x.x).toBe(4);
    expect(packed.frames.x.y).toBe(4);
  });
});

describe('the shipped wheat frames', () => {
  const shipped = run({ check: true });
  const json = JSON.parse(
    readFileSync(new URL('../public/assets/props.json', import.meta.url), 'utf8'),
  );

  it('are what the script makes of the paintings: the shipped atlas holds nothing else', () => {
    expect(
      shipped.same,
      'run `node tools/finish-fields.mjs` after tools/illustrated-sprites.mjs',
    ).toBe(true);
  });
  it('sit in the props atlas as a partial override at resolution 4, next to the other props', () => {
    expect(json.resolution).toBe(4);
    expect(json.partial).toBe(true);
    for (const v of VARIANTS) expect(json.frames[v.key]).toBeDefined();
    expect(Object.keys(json.frames)).toContain('props/tree_0');
  });
  it('keep the highlights under the selection amber and the cursor white', () => {
    for (const f of shipped.frames)
      for (let i = 0; i < f.png.data.length; i += 4) {
        if (!f.png.data[i + 3]) continue;
        const px = [f.png.data[i], f.png.data[i + 1], f.png.data[i + 2]];
        expect(px[0]).toBeLessThan(HIGHLIGHT_CAP);
        expect(dominates(px, AMBER)).toBe(false);
        expect(dominates(px, CURSOR_WHITE)).toBe(false);
      }
  });
  it('stay inside the tile: every texel lies over a ground point of the patch, within the stalks and ears', () => {
    const reach = Math.ceil(((STALK_MIN + STALK_SWELL) * 1 + bounds.ears) * DENSITY) + 2;
    for (const f of shipped.frames) {
      const inside = (x, y) => {
        const px = (x + 0.5 - f.ax) / (32 * DENSITY);
        const py = (y + 0.5 - f.ay) / (16 * DENSITY);
        const tx = (px + py) / 2;
        const ty = (py - px) / 2;
        const eps = 0.012;
        return (
          tx >= -bounds.bounds.x - eps &&
          ty >= -bounds.bounds.y - eps &&
          tx <= bounds.bounds.x + bounds.wander + eps &&
          ty <= bounds.bounds.y + bounds.wander + eps
        );
      };
      const bad = [];
      for (let y = 0; y < f.png.height; y++)
        for (let x = 0; x < f.png.width; x++) {
          if (!f.png.data[(y * f.png.width + x) * 4 + 3]) continue;
          let ok = false;
          for (let e = 0; e <= reach && !ok; e++) ok = inside(x, y + e);
          if (!ok) bad.push([x, y]);
        }
      expect(bad.slice(0, 5), f.key).toEqual([]);
      // the ground contact: the lowest opaque texel of each column is a ground point of the patch
      for (let x = 0; x < f.png.width; x++) {
        let low = -1;
        for (let y = 0; y < f.png.height; y++)
          if (f.png.data[(y * f.png.width + x) * 4 + 3] > 127) low = y;
        if (low >= 0) expect(inside(x, low), `${f.key} column ${x}`).toBe(true);
      }
    }
  });
  it('keep the tile centre as their anchor, inside the frame, and the patch centred on it', () => {
    for (const f of shipped.frames) {
      expect(f.ax).toBeGreaterThan(0);
      expect(f.ax).toBeLessThan(f.png.width);
      expect(f.ay).toBeGreaterThan(0);
      expect(f.ay).toBeLessThan(f.png.height);
      let left = f.png.width;
      let right = 0;
      for (let y = 0; y < f.png.height; y++)
        for (let x = 0; x < f.png.width; x++)
          if (f.png.data[(y * f.png.width + x) * 4 + 3] > 127) {
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
      // within a world px of the middle of the diamond, across
      expect(Math.abs((left + right) / 2 - f.ax), f.key).toBeLessThan(DENSITY * 2);
    }
  });
  it('stand 2.6 to 3.5 world px over the ground and keep their ground contact where it was', () => {
    // the same paintings finished flat, to measure against; across the middle of the patch
    const flat = finishAll({ raise: 0, ears: 0 });
    const top = (f, x) => {
      for (let y = 0; y < f.png.height; y++)
        if (f.png.data[(y * f.png.width + x) * 4 + 3] > 127) return y;
      return -1;
    };
    const bottom = (f, x) => {
      for (let y = f.png.height - 1; y >= 0; y--)
        if (f.png.data[(y * f.png.width + x) * 4 + 3] > 127) return y;
      return -1;
    };
    shipped.frames.forEach((f, k) => {
      const rises = [];
      for (let dx = -60; dx <= 60; dx += 4) {
        const here = f.ay - top(f, f.ax + dx);
        const was = flat[k].ay - top(flat[k], flat[k].ax + dx);
        rises.push((here - was) / DENSITY);
        // the front edge of the ground did not move
        const low = bottom(f, f.ax + dx) - f.ay;
        const lowWas = bottom(flat[k], flat[k].ax + dx) - flat[k].ay;
        expect(Math.abs(low - lowWas) / DENSITY, `${f.key} at ${dx}`).toBeLessThanOrEqual(0.5);
      }
      rises.sort((a, b) => a - b);
      const median = rises[Math.floor(rises.length / 2)];
      expect(median, f.key).toBeGreaterThanOrEqual(2.4);
      expect(median, f.key).toBeLessThanOrEqual(3.6);
    });
  });
});

describe('finishing', () => {
  it('scales by the reviewed factors and moves only the one painting that sat high', () => {
    const frames = finishAll();
    expect(frames.map((f) => f.report.scale)).toEqual([0.72, 0.77, 0.73]);
    expect(frames.map((f) => f.report.shiftWorldPx[1] !== 0)).toEqual([false, false, true]);
    // about 2 world px after scaling, the 3 that the review measured before it
    expect(frames[2].report.shiftWorldPx[1]).toBeGreaterThan(1.5);
    expect(frames[2].report.shiftWorldPx[1]).toBeLessThan(3);
  });
  it('turns a frame empty of ink into an error rather than an empty frame', () => {
    const { w, h } = CANVAS;
    expect(() =>
      toFrame({ w, h, rgb: new Float32Array(w * h * 3), a: new Float32Array(w * h) }),
    ).toThrow(/empty/);
  });
});
