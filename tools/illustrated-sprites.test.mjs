import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { TREE_SCALE } from '../src/render/assetScale';
import { capFrame } from './atlas-cap.mjs';
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
  });
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
