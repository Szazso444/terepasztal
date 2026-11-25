import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  COMPOSITE,
  CROP,
  PICTURES,
  buildPicture,
  capColour,
  compositeBelow,
  encodeIndexed,
  finish,
  indexedToRgb,
  quantise,
  toRgb,
} from './loading-pictures.mjs';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const SOURCE_DIR = here('../assets/source/loading-2026-10-11');
const shippedPath = (name) => here(`../public/assets/${name}.png`);

/** The two caps of the art direction, written out here and not read from the tool. */
const CURSOR_WHITE_LUMA = 0.2126 * 0xec + 0.7152 * 0xe4 + 0.0722 * 0xd0;
const AMBER_CHROMA = 0xe8 - 0x48;
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Hue in degrees and chroma of an 8-bit colour (the standard hexagonal formula). */
function hueChroma(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma === 0) return { hue: 0, chroma };
  let hue;
  if (max === r) hue = (60 * (g - b)) / chroma;
  else if (max === g) hue = 60 * (2 + (b - r) / chroma);
  else hue = 60 * (4 + (r - g) / chroma);
  return { hue: (hue + 360) % 360, chroma };
}

const chunkTypes = (buf) => {
  const types = [];
  for (let at = 8; at < buf.length;) {
    types.push(buf.toString('latin1', at + 4, at + 8));
    at += 12 + buf.readUInt32BE(at);
  }
  return types;
};

describe('loading pictures: what ships', () => {
  for (const { name } of PICTURES) {
    const path = shippedPath(name);

    it(`${name}.png is an indexed 1536x864 PNG of at most 1.5 MB, without alpha or text`, () => {
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeLessThanOrEqual(1.5 * 1024 * 1024);
      const buf = readFileSync(path);
      expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(buf.readUInt32BE(16)).toBe(1536);
      expect(buf.readUInt32BE(20)).toBe(CROP.height);
      expect(buf[24]).toBe(8); // bit depth
      expect(buf[25]).toBe(3); // colour type 3: indexed
      const types = chunkTypes(buf);
      expect(types).toContain('PLTE');
      expect(types).not.toContain('tRNS');
      expect(types.filter((t) => t === 'tEXt' || t === 'iTXt' || t === 'zTXt')).toEqual([]);
      const png = PNG.sync.read(buf);
      const colours = new Set();
      let translucent = 0;
      for (let i = 0; i < png.data.length; i += 4) {
        if (png.data[i + 3] !== 255) translucent++;
        colours.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
      }
      expect(translucent).toBe(0);
      expect(colours.size).toBeLessThanOrEqual(256);
    });

    it(`${name}.png keeps every pixel under the highlight cap and the amber cap`, () => {
      const rgb = toRgb(PNG.sync.read(readFileSync(path)));
      let atOrAboveWhite = 0;
      let strongWarm = 0;
      for (let i = 0; i < rgb.length; i += 3) {
        if (luma(rgb[i], rgb[i + 1], rgb[i + 2]) >= CURSOR_WHITE_LUMA) atOrAboveWhite++;
        const { hue, chroma } = hueChroma(rgb[i], rgb[i + 1], rgb[i + 2]);
        if (hue >= 20 && hue <= 70 && chroma >= AMBER_CHROMA) strongWarm++;
      }
      expect(atOrAboveWhite).toBe(0);
      expect(strongWarm).toBe(0);
    });

    it(`${name}.png is what tools/loading-pictures.mjs builds from the sources`, () => {
      const picture = PICTURES.find((p) => p.name === name);
      const built = buildPicture(picture, SOURCE_DIR);
      const shipped = PNG.sync.read(readFileSync(path));
      expect(shipped.width).toBe(built.width);
      expect(shipped.height).toBe(built.height);
      expect(Buffer.compare(Buffer.from(toRgb(shipped)), Buffer.from(indexedToRgb(built)))).toBe(0);
    }, 180_000);
  }

  it('prompts.json names the composite that loading-2 is built from, and every file it lists', () => {
    const doc = JSON.parse(readFileSync(`${SOURCE_DIR}/prompts.json`, 'utf8'));
    expect(doc.selection.composite).toEqual({
      above: COMPOSITE.above,
      below: COMPOSITE.below,
      line: COMPOSITE.line,
      feather: COMPOSITE.feather,
    });
    const selected = doc.images.filter((i) => i.selected);
    expect(selected.map((i) => i.file)).toEqual(['public/assets/loading-2.png']);
    expect(selected[0].composite).toEqual(expect.objectContaining({ ...doc.selection.composite }));
    for (const image of doc.images) {
      const onDisk = image.file.startsWith('public/')
        ? here(`../${image.file}`)
        : `${SOURCE_DIR}/${image.file}`;
      expect(existsSync(onDisk), image.file).toBe(true);
    }
    for (const attempt of [COMPOSITE.above, COMPOSITE.below])
      expect(doc.images.some((i) => i.file === attempt)).toBe(true);
  });
});

describe('loading pictures: the finishing steps', () => {
  it('compresses highlights below the cursor white and warm chroma below the amber, keeping hue', () => {
    const colours = [
      [255, 255, 255],
      [255, 250, 200],
      [255, 220, 90],
      [255, 180, 20],
      [240, 130, 30],
      [230, 200, 30],
      [255, 255, 0],
    ];
    for (const [r, g, b] of colours) {
      const [cr, cg, cb] = capColour(r, g, b).map(Math.round);
      expect(luma(cr, cg, cb), `${r},${g},${b}`).toBeLessThan(CURSOR_WHITE_LUMA);
      expect(luma(cr, cg, cb)).toBeLessThanOrEqual(luma(r, g, b) + 1); // rounding to bytes
      const before = hueChroma(r, g, b);
      const after = hueChroma(cr, cg, cb);
      if (before.hue >= 20 && before.hue <= 70) expect(after.chroma).toBeLessThan(AMBER_CHROMA);
      if (after.chroma > 100) expect(Math.abs(after.hue - before.hue)).toBeLessThan(1.5);
    }
  });

  it('leaves the art-direction palette, teal water and everything below the knees alone', () => {
    // forest, moss, limestone, slate, teal, copper, and a saturated blue (not a warm hue)
    const colours = [
      [0x29, 0x46, 0x38],
      [0x78, 0x80, 0x4c],
      [0xbc, 0xa9, 0x8b],
      [0x62, 0x6b, 0x6c],
      [0x47, 0x7b, 0x82],
      [0xa3, 0x6b, 0x42],
      [0, 100, 255],
    ];
    for (const c of colours) expect(capColour(...c).map(Math.round)).toEqual(c);
  });

  it('never reverses the order of two greys', () => {
    let last = -1;
    for (let v = 0; v <= 255; v++) {
      const [r] = capColour(v, v, v);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });

  it('takes the picture above the line from one source, below it from the other, blended on it', () => {
    const w = 8;
    const h = 40;
    const above = new Uint8Array(w * h * 3).fill(10);
    const below = new Uint8Array(w * h * 3).fill(250);
    const line = { x0: 0, y0: 20, x1: 8, y1: 20 };
    const out = compositeBelow(above, below, w, h, { line, feather: 8 });
    const at = (y) => out[(y * w + 3) * 3];
    expect(at(0)).toBe(10);
    expect(at(15)).toBe(10);
    expect(at(20)).toBe(130); // on the line: half and half
    expect(at(25)).toBe(250);
    expect(at(39)).toBe(250);
    for (let y = 1; y < h; y++) expect(at(y)).toBeGreaterThanOrEqual(at(y - 1));
  });

  it('darkens only the bottom 30% of the frame, more towards the bottom edge', () => {
    const w = 2;
    const h = 100;
    const out = finish(new Uint8Array(w * h * 3).fill(120), w, h);
    const at = (y) => out[y * w * 3];
    for (let y = 0; y <= 70; y++) expect(at(y)).toBe(120);
    for (let y = 71; y < h; y++) expect(at(y)).toBeLessThanOrEqual(at(y - 1));
    expect(at(h - 1)).toBeLessThan(120 * 0.6);
  });
});

describe('loading pictures: quantising and writing', () => {
  const noisy = (n) => {
    const rgb = new Uint8Array(n * 3);
    let s = 12345;
    for (let i = 0; i < rgb.length; i++) {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      rgb[i] = s >> 16;
    }
    return rgb;
  };

  it('keeps an image of at most 256 colours exactly', () => {
    const rgb = new Uint8Array(64 * 3);
    for (let p = 0; p < 64; p++) rgb.set([p * 2, p * 2 + 10, p * 2 + 20], p * 3);
    const q = quantise(rgb);
    expect([...indexedToRgb(q)]).toEqual([...rgb]);
  });

  it('reduces a noisy image to 256 colours, the same way every time', () => {
    const rgb = noisy(5000);
    const a = quantise(rgb);
    const b = quantise(rgb);
    expect(a.palette.length).toBeLessThanOrEqual(256 * 3);
    expect(Math.max(...a.indices)).toBeLessThan(a.palette.length / 3);
    expect([...a.palette]).toEqual([...b.palette]);
    expect([...a.indices]).toEqual([...b.indices]);
  });

  it('writes an indexed PNG that decodes to the quantised pixels', () => {
    const w = 40;
    const h = 30;
    const q = quantise(noisy(w * h));
    const png = PNG.sync.read(encodeIndexed(w, h, q.palette, q.indices));
    expect([png.width, png.height]).toEqual([w, h]);
    expect([...toRgb(png)]).toEqual([...indexedToRgb(q)]);
  });
});
