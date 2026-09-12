import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

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
const pixel = (png, x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];

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
        const apart =
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
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
