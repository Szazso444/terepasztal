import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { Rng } from '../src/engine/rng';
import { capFrame, capViolations } from './atlas-cap.mjs';

const script = fileURLToPath(new URL('./pack-atlas.mjs', import.meta.url));
let dir;
const src = () => join(dir, 'src');
const out = () => join(dir, 'out');

/** A `w` x `h` transparent frame with one opaque rectangle in it. */
function frame(name, w, h, box, rgb) {
  const png = new PNG({ width: w, height: h });
  png.data.fill(0);
  for (let y = box.y; y < box.y + box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * w + x) * 4;
      png.data[i] = rgb[0];
      png.data[i + 1] = rgb[1];
      png.data[i + 2] = rgb[2];
      png.data[i + 3] = 255;
    }
  writeFileSync(join(src(), `${name}.png`), PNG.sync.write(png));
}

const run = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const readAtlas = (group) => JSON.parse(readFileSync(join(out(), `${group}.json`), 'utf8'));
const readSheet = (group) => PNG.sync.read(readFileSync(join(out(), `${group}.png`)));
const pixel = (png, x, y) => [
  ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4),
];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pack-atlas-'));
  mkdirSync(src(), { recursive: true });
  frame('wide', 64, 64, { x: 20, y: 30, w: 10, h: 6 }, [255, 0, 0]);
  frame('small', 64, 64, { x: 5, y: 5, w: 4, h: 4 }, [0, 255, 0]);
  frame('tall', 64, 64, { x: 40, y: 10, w: 3, h: 20 }, [0, 0, 255]);
  frame('blank', 64, 64, { x: 0, y: 0, w: 0, h: 0 }, [0, 0, 0]);
  writeFileSync(
    join(src(), 'atlas.json'),
    JSON.stringify({ anchor: { ax: 32, ay: 48 }, frames: { 'rolling/small': { ax: 0, ay: 0 } } }),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('pack-atlas', () => {
  it('writes the frame table src/engine/atlas.ts reads', () => {
    run('rolling', '--src', src(), '--out', out());
    const { frames } = readAtlas('rolling');
    expect(Object.keys(frames).sort()).toEqual(['rolling/small', 'rolling/tall', 'rolling/wide']);
    for (const f of Object.values(frames))
      for (const k of ['x', 'y', 'w', 'h', 'ax', 'ay']) expect(typeof f[k]).toBe('number');
  });

  it('trims transparent margins down to the drawn pixels', () => {
    run('rolling', '--src', src(), '--out', out());
    const { frames } = readAtlas('rolling');
    expect(frames['rolling/wide']).toMatchObject({ w: 10, h: 6 });
    expect(frames['rolling/small']).toMatchObject({ w: 4, h: 4 });
    expect(frames['rolling/tall']).toMatchObject({ w: 3, h: 20 });
  });

  it('shifts the anchor by whatever the trim cut away', () => {
    run('rolling', '--src', src(), '--out', out());
    const { frames } = readAtlas('rolling');
    // Group anchor (32, 48) against a render whose pixels start at (20, 30).
    expect(frames['rolling/wide']).toMatchObject({ ax: 12, ay: 18 });
    // Per-frame anchor wins, and may sit outside the trimmed box.
    expect(frames['rolling/small']).toMatchObject({ ax: -5, ay: -5 });
  });

  it('puts the pixels where the frame rectangle says they are', () => {
    run('rolling', '--src', src(), '--out', out());
    const { frames } = readAtlas('rolling');
    const sheet = readSheet('rolling');
    const colours = {
      'rolling/wide': [255, 0, 0, 255],
      'rolling/small': [0, 255, 0, 255],
      'rolling/tall': [0, 0, 255, 255],
    };
    for (const [name, rgba] of Object.entries(colours)) {
      const f = frames[name];
      expect(f.x + f.w).toBeLessThanOrEqual(sheet.width);
      expect(f.y + f.h).toBeLessThanOrEqual(sheet.height);
      expect(pixel(sheet, f.x, f.y)).toEqual(rgba);
      expect(pixel(sheet, f.x + f.w - 1, f.y + f.h - 1)).toEqual(rgba);
    }
  });

  it('leaves no frame overlapping another', () => {
    run('rolling', '--src', src(), '--out', out());
    const list = Object.values(readAtlas('rolling').frames);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
  });

  it('drops a fully transparent frame instead of packing nothing', () => {
    const log = run('rolling', '--src', src(), '--out', out());
    expect(readAtlas('rolling').frames['rolling/blank']).toBeUndefined();
    expect(log).toContain('rolling/blank');
  });

  it('names frames by the prefix, which need not be the group', () => {
    run('wagons', '--src', src(), '--out', out(), '--prefix', 'rolling/');
    expect(Object.keys(readAtlas('wagons').frames)).toContain('rolling/wide');
  });

  it('keeps the whole render when trimming is off', () => {
    run('untrimmed', '--src', src(), '--out', out(), '--no-trim');
    const f = readAtlas('untrimmed').frames['untrimmed/wide'];
    expect(f).toMatchObject({ w: 64, h: 64, ax: 32, ay: 48 });
  });

  it('marks the table partial only when the source asks for it', () => {
    run('rolling', '--src', src(), '--out', out());
    expect(readAtlas('rolling').partial).toBeUndefined();
    const partial = join(dir, 'partial');
    mkdirSync(partial, { recursive: true });
    writeFileSync(join(partial, 'atlas.json'), JSON.stringify({ partial: true }));
    writeFileSync(join(partial, 'one.png'), readFileSync(join(src(), 'wide.png')));
    run('structures', '--src', partial, '--out', out());
    expect(readAtlas('structures')).toMatchObject({
      partial: true,
      frames: { 'structures/one': {} },
    });
  });

  it('re-packs unchanged art to the same bytes', () => {
    run('rolling', '--src', src(), '--out', out());
    const png = readFileSync(join(out(), 'rolling.png'));
    const json = readFileSync(join(out(), 'rolling.json'));
    run('rolling', '--src', src(), '--out', out());
    expect(readFileSync(join(out(), 'rolling.png')).equals(png)).toBe(true);
    expect(readFileSync(join(out(), 'rolling.json')).equals(json)).toBe(true);
  });

  it('refuses a folder it cannot pack', () => {
    expect(() => run('rolling', '--src', join(dir, 'nope'), '--out', out())).toThrow();
    const empty = join(dir, 'empty');
    mkdirSync(empty, { recursive: true });
    expect(() => run('rolling', '--src', empty, '--out', out())).toThrow();
  });
});

describe('pack-atlas and the atlas cap pass', () => {
  // renders drawn from fixed seeds: a body of edge-case texels (over the cursor white, as strong
  // as the amber, light cream, near-solid alpha) with alpha haze scattered round it, out to the
  // margins, so the trim box takes the haze in and the cap then clears it
  const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
  const COLOURS = [
    [255, 255, 255],
    [250, 245, 236],
    [240, 236, 224],
    [232, 170, 72],
    [247, 120, 24],
    [226, 214, 190],
    [90, 120, 60],
  ];
  /** The last seed's render is a Fuel Pump view, a lit set's frame. */
  const LIT = 'structures/fuel_pump';
  let capDir;
  const renders = new Map();
  /** One render, w x h, from its seed, its colours drawn from `colours`. */
  function render(seed, colours = COLOURS) {
    const rng = new Rng(seed);
    const w = rng.int(6, 20);
    const h = rng.int(6, 20);
    const png = new PNG({ width: w, height: h });
    png.data.fill(0);
    const bx = rng.int(1, w - 3);
    const by = rng.int(1, h - 3);
    const bw = rng.int(1, w - bx - 1);
    const bh = rng.int(1, h - by - 1);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const body = x >= bx && x < bx + bw && y >= by && y < by + bh;
        if (!body && !rng.chance(0.15)) continue;
        const a = body ? rng.pick([255, 255, rng.int(250, 254), rng.int(16, 249)]) : rng.int(1, 15);
        png.data.set([...rng.pick(colours), a], (y * w + x) * 4);
      }
    return png;
  }
  /** The pixels of `box` as an image of their own. */
  function crop(png, box) {
    const out = new PNG({ width: box.w, height: box.h });
    PNG.bitblt(png, out, box.x, box.y, box.w, box.h, 0, 0);
    return out;
  }
  /** The box of the texels with any alpha, which the trim keeps. */
  function inked(png) {
    let [x0, y0, x1, y1] = [png.width, png.height, -1, -1];
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++)
        if (png.data[(y * png.width + x) * 4 + 3]) {
          [x0, y0] = [Math.min(x0, x), Math.min(y0, y)];
          [x1, y1] = [Math.max(x1, x), Math.max(y1, y)];
        }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  const trimmed = (png) => crop(png, inked(png));

  beforeAll(() => {
    capDir = mkdtempSync(join(tmpdir(), 'pack-atlas-cap-'));
    mkdirSync(join(capDir, 'src'), { recursive: true });
    for (const seed of SEEDS) {
      const lit = seed === SEEDS.at(-1);
      const key = lit ? LIT : `structures/piece_${seed}`;
      // the Fuel Pump's render is all lit cream and white, over the knee of the compression
      const png = render(seed, lit ? COLOURS.slice(0, 3) : COLOURS);
      renders.set(key, png);
      writeFileSync(join(capDir, 'src', `${key.split('/')[1]}.png`), PNG.sync.write(png));
    }
    run('structures', '--src', join(capDir, 'src'), '--out', join(capDir, 'out'));
  });
  afterAll(() => rmSync(capDir, { recursive: true, force: true }));

  it('packs every frame as the cap pass of its trimmed render, keeping its size and anchor', () => {
    const { frames } = JSON.parse(readFileSync(join(capDir, 'out', 'structures.json'), 'utf8'));
    const sheet = PNG.sync.read(readFileSync(join(capDir, 'out', 'structures.png')));
    expect(Object.keys(frames).sort()).toEqual([...renders.keys()].sort());
    for (const [key, png] of renders) {
      const box = inked(png);
      const f = frames[key];
      // the haze is trimmed with the frame, then cleared: the size and anchor do not move
      expect([f.w, f.h, f.ax, f.ay], key).toEqual([
        box.w,
        box.h,
        png.width / 2 - box.x,
        png.height - box.y,
      ]);
      const want = capFrame(key, crop(png, box)).png;
      expect(crop(sheet, f).data.equals(want.data), `${key} is its capped render`).toBe(true);
    }
    expect(capViolations(sheet)).toEqual({ haze: 0, solid: 0, white: 0, amber: 0 });
  });

  it('compresses the lit set`s frame and no other', () => {
    expect(capFrame(LIT, trimmed(renders.get(LIT))).counts.compressed).toBeGreaterThan(0);
    for (const [key, png] of renders)
      if (key !== LIT) expect(capFrame(key, trimmed(png)).counts.compressed, key).toBe(0);
  });
});
