import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { cutFace, SWATCHES } from './bridge-kit.mjs';

const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

describe('bridge material swatches', () => {
  const names = Object.keys(SWATCHES.swatches);

  it('packs every swatch the game maps onto a bridge, at its listed size', () => {
    // src/art/bridges.ts draws the same list procedurally (see src/art/bridges.test.ts); a name
    // missing from the packed file would leave that face of every bridge in the plain version.
    const packed = json('public/assets/bridges.json');
    expect(packed.resolution).toBe(SWATCHES.density);
    expect(packed.partial).toBe(true);
    for (const name of names) {
      const f = packed.frames[name];
      expect(f, name).toBeDefined();
      expect([f.w, f.h], name).toEqual(SWATCHES.swatches[name]);
    }
    // Nothing of the old projected pieces is left for the renderer to fall back on.
    expect(Object.keys(packed.frames).filter((k) => !names.includes(k))).toEqual([]);
  });

  it('has a source face for every swatch, lit and under the deck alike', () => {
    const faces = json('assets/source/bridges-v1/materials.json').swatches;
    for (const name of names) {
      const face = faces[name.replace(/-shade$/, '')];
      expect(face, name).toBeDefined();
      for (const p of [face.o, face.u, face.v]) expect(p).toHaveLength(2);
    }
  });

  it('pairs each face seen from the left with one seen from the right', () => {
    for (const name of names)
      if (/-l(-shade)?$/.test(name)) expect(names).toContain(name.replace(/-l(-shade)?$/, '-r$1'));
  });

  it('cuts a sheared face square-on, mirrored and shaded when asked', () => {
    // A 2:1 parallelogram, 8 wide and 4 high, whose left half is red and right half blue.
    const src = new PNG({ width: 16, height: 16 });
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const top = 2 + (x - 4) / 2,
          inside = x >= 4 && x < 12 && y >= top && y < top + 4;
        src.data.set(
          inside ? (x < 8 ? [200, 0, 0, 255] : [0, 0, 200, 255]) : [0, 0, 0, 0],
          (y * 16 + x) * 4,
        );
      }
    const face = { o: [4, 2], u: [12, 6], v: [4, 6] },
      at = (png, x, y) => [...png.data.slice((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
    const flat = cutFace(src, face, 8, 4);
    // Square-on: the colour boundary is a vertical line down the middle of every row.
    for (let y = 1; y < 3; y++) {
      expect(at(flat, 1, y)).toEqual([200, 0, 0, 255]);
      expect(at(flat, 6, y)).toEqual([0, 0, 200, 255]);
    }
    const turned = cutFace(src, { ...face, mirror: true }, 8, 4, 0.5);
    expect(at(turned, 1, 1)).toEqual([0, 0, 100, 255]);
    expect(at(turned, 6, 2)).toEqual([100, 0, 0, 255]);
  });

  it('leaves no hole in a solid face', () => {
    const src = new PNG({ width: 8, height: 8 });
    for (let y = 2; y < 6; y++)
      for (let x = 2; x < 6; x++) src.data.set([90, 80, 70, 255], (y * 8 + x) * 4);
    // The face reaches one pixel past the painted square on every side.
    const cut = cutFace(src, { o: [1, 1], u: [7, 1], v: [1, 7], solid: true }, 6, 6);
    for (let i = 0; i < 36; i++)
      expect([...cut.data.slice(i * 4, i * 4 + 4)]).toEqual([90, 80, 70, 255]);
  });
});
