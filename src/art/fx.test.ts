import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FrameDef } from '../engine/atlas';
import { TILE_W } from '../engine/iso';
import { generateFxAtlas } from './fx';

/** Node has no ImageData or canvas: a stand-in that keeps the pixels the packer puts down. */
class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    this.width = typeof a === 'number' ? a : b;
    this.height = typeof a === 'number' ? b : (c ?? a.length / 4 / b);
    this.data = typeof a === 'number' ? new Uint8ClampedArray(a * b * 4) : a;
  }
}

let frames: Record<string, FrameDef> = {};
const placed: { img: FakeImageData; x: number; y: number }[] = [];

beforeAll(() => {
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        putImageData: (img: FakeImageData, x: number, y: number) => placed.push({ img, x, y }),
      }),
    }),
  });
  frames = generateFxAtlas().frames;
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** The pixels packed for one frame, as [r, g, b, a] per pixel. */
function pixels(key: string) {
  const f = frames[key];
  const p = placed.find((q) => q.x === f.x && q.y === f.y)!;
  const out: { x: number; y: number; rgba: number[] }[] = [];
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const i = (y * f.w + x) * 4;
      out.push({ x, y, rgba: [...p.img.data.subarray(i, i + 4)] });
    }
  return out;
}

describe('fx frames', () => {
  it('keep every frame the effects renderer draws', () => {
    const drawn = ['fx/rain', 'fx/light_tile', 'fx/glow', 'fx/glow_small'];
    for (let i = 0; i < 3; i++) drawn.push(`fx/fog_${i}`, `fx/smoke_${i}`);
    for (const k of drawn) expect(frames[k], k).toBeDefined();
  });

  it('anchor the halo ring at its centre, one tile across in the 2:1 projection', () => {
    const f = frames['fx/halo_ring'];
    expect([f.ax, f.ay]).toEqual([f.w / 2, f.h / 2]);
    expect(Math.abs(f.w - 2 * f.h)).toBeLessThanOrEqual(2);
    expect(Math.abs(f.w - TILE_W)).toBeLessThanOrEqual(TILE_W / 8);
    // a ring, not a disc: its centre is empty
    const centre = pixels('fx/halo_ring').find((p) => p.x === f.ax && p.y === f.ay)!;
    expect(centre.rgba[3]).toBe(0);
  });

  it('stand the halo beam on its bottom centre and fade it out upwards', () => {
    const f = frames['fx/halo_beam'];
    expect([f.ax, f.ay]).toEqual([f.w / 2, f.h]);
    const px = pixels('fx/halo_beam');
    const rowPeak = (y: number) => Math.max(...px.filter((p) => p.y === y).map((p) => p.rgba[3]));
    const peak = Math.max(...px.map((p) => p.rgba[3]));
    // the foot is lit where the anchor stands; the top has no hard edge to show when stretched
    expect(rowPeak(f.h - 1)).toBeGreaterThan(0);
    expect(rowPeak(0)).toBeLessThan(peak / 4);
  });

  it('anchor the spark at its centre and keep it a few pixels', () => {
    const f = frames['fx/spark'];
    expect([f.ax, f.ay]).toEqual([f.w / 2, f.h / 2]);
    expect(Math.max(f.w, f.h)).toBeLessThanOrEqual(9);
  });

  it('draw the halo as warm gold light on transparent, never dark', () => {
    for (const key of ['fx/halo_ring', 'fx/halo_beam', 'fx/spark']) {
      const ink = pixels(key).filter((p) => p.rgba[3] > 0);
      expect(ink.length, key).toBeGreaterThan(0);
      for (const { rgba } of ink) {
        const [r, g, b] = rgba;
        expect(r >= g && g >= b && r >= 200, `${key} ${rgba}`).toBe(true);
      }
    }
  });
});
