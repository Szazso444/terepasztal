import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { TREE_SCALE } from '../src/render/assetScale';
import { capFrame } from './atlas-cap.mjs';
import { forAll, shrinkInt } from '../src/testing/property';
import {
  inkBox,
  trimSource,
  resample,
  groundTile,
  packFrames,
  packMeasuredTree,
  projectionMatrix,
  readTreeScale,
  rectifyProjection,
} from './illustrated-sprites.mjs';

describe('illustrated atlas conversion', () => {
  it('rectifies both ground axes to 2:1 without tilting vertical edges', () => {
    const m = projectionMatrix(0.31, -0.39);
    expect(m.shear + m.vertical * 0.31).toBeCloseTo(0.5, 12);
    expect(m.shear + m.vertical * -0.39).toBeCloseTo(-0.5, 12);
    const p = new PNG({ width: 4, height: 4 });
    p.data.fill(255);
    const result = rectifyProjection(p, 0.31, -0.39);
    expect(result.width).toBe(p.width);
    expect(result.height).toBeGreaterThan(p.height);
    expect(p.data.every((v) => v === 255)).toBe(true);
  });
  it('retains source material contrast instead of fading every edge to a mean color', () => {
    const p = new PNG({ width: 100, height: 100 });
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++)
        p.data.set(
          (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? [70, 120, 30, 255] : [120, 170, 70, 255],
          (y * 100 + x) * 4,
        );
    const result = groundTile(p);
    const red = [];
    for (let i = 0; i < result.data.length; i += 4)
      if (result.data[i + 3]) red.push(result.data[i]);
    expect(Math.max(...red) - Math.min(...red)).toBeGreaterThan(45);
  });
  it('resamples in premultiplied alpha without opaque edges or transparent-color fringes', () => {
    const p = new PNG({ width: 2, height: 1 });
    p.data.set([200, 50, 25, 255, 0, 255, 0, 0]);
    expect([...resample(p, 1, 1).data]).toEqual([200, 50, 25, 128]);
  });
  it('removes glow while retaining edge coverage and leaves the source intact', () => {
    const p = new PNG({ width: 3, height: 1 });
    p.data.set([200, 0, 0, 30, 100, 80, 60, 128, 90, 80, 70, 255]);
    const clean = trimSource(p);
    expect(clean.width).toBe(2);
    expect(clean.data[3]).toBeGreaterThan(0);
    expect(clean.data[3]).toBeLessThan(255);
    expect(p.data[3]).toBe(30);
  });
  it('trims by a given box instead of the picture`s own alpha box', () => {
    // a 10x6 picture: a solid body at x 2..5, y 1..4, and a detached arm out to x 8
    const p = new PNG({ width: 10, height: 6 });
    for (let y = 1; y <= 4; y++)
      for (let x = 2; x <= 5; x++) p.data.set([90, 80, 70, 255], (y * 10 + x) * 4);
    p.data.set([90, 80, 70, 255], (2 * 10 + 8) * 4);
    expect(inkBox(p)).toEqual([2, 1, 8, 4]);
    const own = trimSource(p);
    expect([own.width, own.height]).toEqual([7, 4]);
    // the body's box leaves the arm out; the same box as the alpha box gives the same picture
    const body = trimSource(p, [2, 1, 5, 4]);
    expect([body.width, body.height]).toEqual([4, 4]);
    expect(body.data.every((v, i) => (i % 4 === 3 ? v === 255 : true))).toBe(true);
    expect(trimSource(p, inkBox(p)).data.equals(own.data)).toBe(true);
    // a box may reach past the ink, into the transparent canvas
    const wide = trimSource(p, [0, 0, 9, 5]);
    expect([wide.width, wide.height]).toEqual([10, 6]);
    expect(wide.data[3]).toBe(0);
    for (const bad of [
      [-1, 0, 5, 4],
      [2, 1, 10, 4],
      [5, 1, 2, 4],
      [2, 1.5, 5, 4],
    ])
      expect(() => trimSource(p, bad), `${bad}`).toThrow(/not inside/);
  });
  it('projects a flat opaque diamond without copying source-border colors', () => {
    const p = new PNG({ width: 100, height: 100 });
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++)
        p.data.set(
          x < 20 || y < 20 || x > 80 || y > 80 ? [255, 0, 0, 255] : [70, 100, 50, 255],
          (y * 100 + x) * 4,
        );
    const t = groundTile(p);
    expect([t.width, t.height]).toEqual([256, 128]);
    expect(t.data[3]).toBe(0);
    expect([...t.data.slice((64 * 256 + 128) * 4, (64 * 256 + 128) * 4 + 4)]).toEqual([
      70, 100, 50, 255,
    ]);
  });
  it('deduplicates artwork but preserves each frame anchor and extrudes the gutter', () => {
    const p = new PNG({ width: 2, height: 2 });
    p.data.fill(255);
    const packed = packFrames(
      [
        { key: 'a', png: p, ax: 1, ay: 2 },
        { key: 'b', png: p, ax: 7, ay: 8 },
      ],
      32,
    );
    expect(packed.unique).toBe(1);
    expect(packed.frames.a.x).toBe(packed.frames.b.x);
    expect(packed.frames.b.ax).toBe(7);
    const f = packed.frames.a;
    expect(packed.sheet.data[((f.y - 1) * packed.sheet.width + f.x - 1) * 4 + 3]).toBe(255);
  });
});

// --- properties of the trim and of a measured tree's packing ------------------------------------

/** A small picture: transparent canvas, glow (alpha 1 to 64), ink (65 to 255), often no ink. */
function genPicture(rng) {
  const w = rng.int(1, 12);
  const h = rng.int(1, 12);
  const ink = rng.chance(0.9);
  const texels = Array.from({ length: w * h }, () => {
    const alpha = rng.pick([0, 0, rng.int(1, 64), 64, 65, rng.int(65, 254), 255]);
    const a = ink ? alpha : Math.min(alpha, 64);
    return [rng.int(0, 255), rng.int(0, 255), rng.int(0, 255), a];
  });
  return { w, h, texels };
}
const picture = ({ w, h, texels }) => {
  const p = new PNG({ width: w, height: h });
  texels.forEach((t, i) => p.data.set(t, i * 4));
  return p;
};
const at = (c, x, y) => c.texels[y * c.w + x];
/** Fewer rows, then fewer columns, then one texel cleared. */
function* shrinkPicture(c) {
  for (const h of shrinkInt(c.h, 1)) yield { ...c, h, texels: c.texels.slice(0, c.w * h) };
  for (const w of shrinkInt(c.w, 1))
    yield {
      ...c,
      w,
      texels: Array.from({ length: c.h }, (_, y) => c.texels.slice(y * c.w, y * c.w + w)).flat(),
    };
  for (let i = 0; i < c.texels.length; i++)
    if (c.texels[i][3])
      yield { ...c, texels: c.texels.map((t, j) => (j === i ? [0, 0, 0, 0] : t)) };
}
/** The box of the texels with alpha above 64, found the slow way, or null. */
function slowInkBox(c) {
  const xs = [];
  const ys = [];
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++)
      if (at(c, x, y)[3] > 64) {
        xs.push(x);
        ys.push(y);
      }
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
}
/** The glow ramp trimSource documents: alpha 64 and under goes with its colour, the rest is
 * stretched from 65..255 onto 1..255. */
const unglow = ([r, g, b, a]) =>
  a <= 64 ? [0, 0, 0, 0] : [r, g, b, Math.round((255 * (a - 64)) / 191)];

describe('trimming a picture, as a property', () => {
  it('finds the ink box: the texels with alpha above 64, or none', () => {
    forAll(genPicture, (c) => expect(inkBox(picture(c))).toEqual(slowInkBox(c)), {
      shrink: shrinkPicture,
    });
  });

  it('trims by its own ink box when given no box, and refuses a picture with no ink', () => {
    forAll(
      genPicture,
      (c) => {
        const p = picture(c);
        const box = slowInkBox(c);
        if (!box) return void expect(() => trimSource(p)).toThrow(/empty/);
        expect(trimSource(p).data.equals(trimSource(p, box).data)).toBe(true);
      },
      { shrink: shrinkPicture },
    );
  });

  it('crops any box inside the picture to exactly its texels, glow removed, the input untouched', () => {
    forAll(
      (rng) => {
        const c = genPicture(rng);
        const l = rng.int(0, c.w - 1);
        const t = rng.int(0, c.h - 1);
        return { ...c, box: [l, t, rng.int(l, c.w - 1), rng.int(t, c.h - 1)] };
      },
      (c) => {
        const p = picture(c);
        const before = Buffer.from(p.data);
        if (!slowInkBox(c)) return void expect(() => trimSource(p, c.box)).toThrow(/empty/);
        const [l, t, r, b] = c.box;
        const out = trimSource(p, c.box);
        expect([out.width, out.height]).toEqual([r - l + 1, b - t + 1]);
        for (let y = 0; y < out.height; y++)
          for (let x = 0; x < out.width; x++) {
            const i = (y * out.width + x) * 4;
            expect([...out.data.subarray(i, i + 4)], `texel ${x},${y}`).toEqual(
              unglow(at(c, l + x, t + y)),
            );
          }
        expect(p.data.equals(before), 'the input is not changed').toBe(true);
      },
      // shrinking the picture can push the box out of it; keep the box where it still fits
      {
        shrink: (c) => [...shrinkPicture(c)].filter((s) => c.box[2] < s.w && c.box[3] < s.h),
      },
    );
  });

  it('refuses every box that is not inside the picture', () => {
    forAll(
      (rng) => {
        const w = rng.int(1, 12);
        const h = rng.int(1, 12);
        const l = rng.int(0, w - 1);
        const t = rng.int(0, h - 1);
        const r = rng.int(l, w - 1);
        const b = rng.int(t, h - 1);
        const bad = rng.pick([
          [-rng.int(1, 3), t, r, b],
          [l, -rng.int(1, 3), r, b],
          [l, t, w + rng.int(0, 2), b],
          [l, t, r, h + rng.int(0, 2)],
          [r + 1, t, l, b],
          [l, b + 1, r, t],
          [l + 0.5, t, r, b],
          [l, t, r, b - 0.25],
        ]);
        return { w, h, bad };
      },
      ({ w, h, bad }) => {
        // a solid picture, so the box is all that is wrong
        const p = new PNG({ width: w, height: h });
        p.data.fill(255);
        expect(() => trimSource(p, bad), `[${bad}] in ${w}x${h}`).toThrow(/not inside/);
      },
    );
  });
});

/**
 * A measured picture, packed at an atlas density and a tree scale of its own: a solid body
 * somewhere on a canvas with some glow around it, and its record. The body is at least two
 * texels across and high once packed, as every real tree is many more.
 */
function genMeasured(rng) {
  const opts = { density: rng.pick([2, 4]), treeScale: rng.pick([1, 1.25, 1.5, 2]) };
  const k = rng.range(0.05, 0.3);
  const least = Math.ceil(2 / ((k * opts.density) / opts.treeScale));
  const bw = rng.int(least, least + 30);
  const bh = rng.int(least, least + 30);
  const w = bw + rng.int(0, 8);
  const h = bh + rng.int(0, 8);
  const bx = rng.int(0, w - bw);
  const by = rng.int(0, h - bh);
  const texels = Array.from({ length: w * h }, (_, i) => {
    const x = i % w;
    const y = Math.floor(i / w);
    const body = x >= bx && x < bx + bw && y >= by && y < by + bh;
    if (body) return [rng.int(40, 200), rng.int(40, 200), rng.int(40, 200), rng.int(65, 255)];
    return rng.chance(0.2) ? [rng.int(0, 255), 255, 255, rng.int(1, 64)] : [0, 0, 0, 0];
  });
  const box = [bx, by, bx + bw - 1, by + bh - 1];
  // the anchor anywhere across the body, and at or a little under its foot
  const anchor = [rng.range(bx, bx + bw), rng.range(by + 0.5, by + bh + 2)];
  return { w, h, texels, opts, record: { box, anchor, k } };
}

describe('packing a measured tree, as a property', () => {
  it('stands the record`s height over the anchor and keeps the anchor on the painted foot', () => {
    forAll(genMeasured, (c) => {
      const { record, opts } = c;
      const made = packMeasuredTree(picture(c), record, 'case', opts);
      const [l, t, r, b] = record.box;
      const s = (record.k * opts.density) / opts.treeScale;
      const w0 = Math.max(1, Math.round((r - l + 1) * s));
      const { width: w, height: h } = made.png;
      // the frame: the box scaled by k * density / treeScale, then drawn 1.2 wider
      expect([w, h]).toEqual([Math.round(w0 * 1.2), Math.max(1, Math.round((b - t + 1) * s))]);
      // drawn px from the anchor to the top of the box, at the tree scale: the record's k times
      // the source px between them, which is what check-tree.mjs writes as the height
      const drawn = (made.ay * opts.treeScale) / opts.density;
      expect(drawn).toBeCloseTo((record.anchor[1] - t) * record.k, 9);
      // and where the painted foot lands in the resampled frame, within the rounding of its size
      const footX = ((record.anchor[0] - l) * w) / (r - l + 1);
      const footY = ((record.anchor[1] - t) * h) / (b - t + 1);
      expect(Math.abs(made.ax - footX), `ax ${made.ax} for ${footX}`).toBeLessThanOrEqual(
        (0.5 * w) / w0 + 1e-9,
      );
      expect(Math.abs(made.ay - footY), `ay ${made.ay} for ${footY}`).toBeLessThanOrEqual(
        (0.5 * (record.anchor[1] - t)) / (b - t + 1) + 1e-9,
      );
    });
  });

  it('refuses a record whose box is not the picture`s ink box', () => {
    forAll(
      (rng) => {
        const c = genMeasured(rng);
        const box = [...c.record.box];
        box[rng.int(0, 3)] += rng.pick([-1, 1]);
        return { ...c, bad: box };
      },
      (c) => {
        const record = { ...c.record, box: c.bad };
        expect(() => packMeasuredTree(picture(c), record, 'case', c.opts)).toThrow(
          /measure it again/,
        );
      },
    );
  });
});

const WATERSIDE = 'assets/source/waterside-trees-2026-10-16';
/**
 * The waterside trees of #460 and what Core's review of 2026-10-17 measured for them: the drawn
 * height from the anchor to the top at zoom 1 (tree scale included, beside the 9 px person) and
 * the packed frame, w x h at (ax, ay) texels.
 */
const WATERSIDE_FRAMES = [
  ['props/mangrove_0', 'tree-mangrove-1.png', 30, 107, 87, 54.4, 80.0],
  ['props/mangrove_1', 'tree-mangrove-2.png', 38, 144, 114, 72.4, 101.3],
  ['props/mangrove_2', 'tree-mangrove-3.png', 46, 197, 136, 99.4, 122.7],
  ['props/willow_0', 'tree-willow-1.png', 40, 140, 123, 69.3, 106.7],
  ['props/willow_1', 'tree-willow-2.png', 48, 173, 144, 86.1, 128.0],
  ['props/willow_2', 'tree-willow-3.png', 54, 197, 160, 101.9, 144.0],
];

describe('the waterside trees in the props atlas', () => {
  const props = JSON.parse(readFileSync('public/assets/props.json', 'utf8'));
  const trees = JSON.parse(readFileSync(`${WATERSIDE}/trees.json`, 'utf8'));
  const inventory = JSON.parse(readFileSync('docs/art-direction/frame-inventory.json', 'utf8'));

  it('read the renderer`s tree scale from src/render/assetScale.ts', () => {
    expect(readTreeScale()).toBe(TREE_SCALE);
  });
  it('are measured consistently: k is the height over the source px from the anchor to the top', () => {
    // check-tree.mjs: a mangrove stands on its foot, a willow 6 drawn px above it on the same
    // column; k is drawn px per source px, so the packer's ay is the height whatever the scale
    for (const [, file] of WATERSIDE_FRAMES) {
      const r = trees[file];
      expect(r.k * (r.anchor[1] - r.box[1]), file).toBeCloseTo(r.height, 9);
      expect(r.anchor[0], file).toBe(r.foot[0]);
      expect((r.foot[1] - r.anchor[1]) * r.k, file).toBeCloseTo(r.kind === 'willow' ? 6 : 0, 9);
    }
  });
  it('stand their measured height over the anchor, at the renderer`s tree scale', () => {
    for (const [key, file, height] of WATERSIDE_FRAMES) {
      const f = props.frames[key];
      expect(f, key).toBeDefined();
      expect(trees[file].height, `${file} in trees.json`).toBe(height);
      expect(Math.abs((f.ay * TREE_SCALE) / props.resolution - height), key).toBeLessThanOrEqual(
        0.5,
      );
    }
  });
  it('are the frames the review expects, anchored over the trunk or the root ring', () => {
    for (const [key, file, , w, h, ax, ay] of WATERSIDE_FRAMES) {
      const f = props.frames[key];
      expect([f.w, f.h], key).toEqual([w, h]);
      expect(Math.abs(f.ax - ax), `${key} ax`).toBeLessThanOrEqual(0.1);
      expect(Math.abs(f.ay - ay), `${key} ay`).toBeLessThanOrEqual(0.1);
      expect(f.ay, key).toBeLessThan(f.h);
      // the anchor lies where the measured foot lies across the picture, within a texel
      const r = trees[file];
      const across = (r.anchor[0] - r.box[0]) / (r.box[2] - r.box[0] + 1);
      expect(Math.abs(f.ax / f.w - across), key).toBeLessThan(1 / f.w);
    }
  });
  // slow: it decodes and resamples six 1254 px paintings, about a second alone
  it('are what the packer makes of the paintings and their trees.json entries', () => {
    const atlas = PNG.sync.read(readFileSync('public/assets/props.png'));
    for (const [key, file] of WATERSIDE_FRAMES) {
      const input = PNG.sync.read(readFileSync(`${WATERSIDE}/${file}`));
      const made = packMeasuredTree(input, trees[file], file);
      const f = props.frames[key];
      expect([f.w, f.h, f.ax, f.ay], key).toEqual([
        made.png.width,
        made.png.height,
        made.ax,
        made.ay,
      ]);
      const shipped = new PNG({ width: f.w, height: f.h });
      PNG.bitblt(atlas, shipped, f.x, f.y, f.w, f.h, 0, 0);
      const capped = capFrame(key, made.png).png;
      expect(
        shipped.data.equals(capped.data),
        `${key}: run node tools/illustrated-sprites.mjs`,
      ).toBe(true);
    }
  }, 20_000);
  it('refuse a painting whose alpha box is not the measured one', () => {
    const input = PNG.sync.read(readFileSync(`${WATERSIDE}/tree-willow-2.png`));
    const record = { ...trees['tree-willow-2.png'], box: [0, 0, 10, 10] };
    expect(() => packMeasuredTree(input, record, 'willow-2')).toThrow(/measure it again/);
  });
  it('are listed in the frame inventory at their packed size and anchor', () => {
    for (const [key] of WATERSIDE_FRAMES) {
      const f = props.frames[key];
      expect(
        inventory.find((e) => e.key === key),
        key,
      ).toEqual({
        key,
        group: 'props',
        width: f.w / props.resolution,
        height: f.h / props.resolution,
        anchorX: Math.round(f.ax / props.resolution),
        anchorY: Math.round(f.ay / props.resolution),
      });
    }
  });
});
