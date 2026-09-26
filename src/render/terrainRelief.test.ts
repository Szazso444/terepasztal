import { describe, it, expect } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import {
  buildRelief,
  reliefHeight,
  reliefCorners,
  reliefTileAtWorld,
  hillFamily,
  RELIEF_MAX,
} from './terrainRelief';
import { surfaceMaterial, surfaceColor, surfaceBlend, grassDetail } from './terrainMaterials';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

function fixture() {
  const m = emptyMap(7412, 32, 32);
  for (let y = 3; y < 29; y++)
    for (let x = 3; x < 29; x++)
      m.terrain[y * 32 + x] = x > 7 && x < 25 && y > 7 && y < 25 ? Terrain.Mountain : Terrain.Hill;
  return m;
}
describe('connected illustrated terrain', () => {
  it('rounds isolated hill crowns without a triangular shading crease', () => {
    const m = emptyMap(7412, 16, 16);
    m.terrain[8 * 16 + 8] = Terrain.Hill;
    const r = buildRelief(m, new Set()),
      step = 0.0001,
      centre = reliefHeight(m, r, 8, 8);
    expect(centre).toBeGreaterThan(0);
    const left = (centre - reliefHeight(m, r, 8 - step, 8)) / step,
      right = (reliefHeight(m, r, 8 + step, 8) - centre) / step;
    expect(Math.abs(left - right)).toBeLessThan(0.02);
  });
  it('picks the same tile after projecting onto raised land and excavated cuts', () => {
    const m = fixture(),
      r = buildRelief(m, new Set([16 * 32 + 16]));
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++)
        for (const offset of [-0.3, 0, 0.3]) {
          const tx = x + offset,
            ty = y - offset,
            z = reliefHeight(m, r, tx, ty);
          expect(reliefTileAtWorld(m, r, (tx - ty) * 32, (tx + ty) * 16 - z)).toEqual({ x, y });
        }
  });
  it('mixes detail smoothly and feathers only material boundaries', () => {
    const m = emptyMap(5, 16, 16),
      weights: number[] = [];
    for (let y = 0; y < 16; y++)
      for (let x = 8; x < 16; x++) m.terrain[y * 16 + x] = Terrain.Forest;
    let softEdges = 0,
      light = false,
      rich = false;
    for (let y = 2; y < 14; y += 0.17)
      for (let x = 2; x < 14; x += 0.17) {
        const detail = grassDetail(x, y);
        light ||= detail < 0.55;
        rich ||= detail > 0.95;
        expect(detail).toBeGreaterThanOrEqual(0.48);
        expect(detail).toBeLessThanOrEqual(1);
        expect(Math.abs(detail - grassDetail(x + 0.001, y))).toBeLessThan(0.002);
        surfaceBlend(m, x, y, weights);
        expect(weights.slice(4).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
        const forest = weights
          .slice(0, 4)
          .reduce((n, t, i) => n + (t === 1 ? weights[i + 4] : 0), 0);
        if (forest > 1e-8 && forest < 1 - 1e-8) {
          softEdges++;
          expect(Math.abs(x - 7.5)).toBeLessThan(0.45);
        }
      }
    expect(light && rich).toBe(true);
    expect(softEdges).toBeGreaterThan(0);
  });
  it('shares every edge continuously, including where excavation meets a raised region', () => {
    const m = fixture(),
      before = m.terrain.slice(),
      r = buildRelief(m, new Set([16 * 32 + 16]));
    for (let y = 1; y < 31; y++)
      for (let x = 1; x < 31; x++)
        for (const t of [-0.4, 0, 0.4]) {
          expect(reliefHeight(m, r, x + 0.5 - 1e-7, y + t)).toBeCloseTo(
            reliefHeight(m, r, x + 0.5 + 1e-7, y + t),
            4,
          );
          expect(reliefHeight(m, r, x + t, y + 0.5 - 1e-7)).toBeCloseTo(
            reliefHeight(m, r, x + t, y + 0.5 + 1e-7),
            4,
          );
        }
    expect(m.terrain).toEqual(before);
  });
  it('keeps the entire excavated footprint flat and dry lowlands at zero', () => {
    const m = fixture(),
      r = buildRelief(m, new Set([16 * 32 + 16]));
    for (let y = -0.5; y < 0.5; y += 0.1)
      for (let x = -0.5; x < 0.5; x += 0.1) {
        expect(reliefHeight(m, r, 16 + x, 16 + y)).toBeCloseTo(0, 6);
        expect(reliefHeight(m, r, 1 + x, 1 + y)).toBe(0);
      }
    expect(reliefHeight(m, r, -5, 4)).toBe(0);
    expect(reliefCorners(m, r, 16, 16)).toEqual([0, 0, 0, 0]);
  });
  it('bounds projection slopes so the painted surface cannot fold behind itself', () => {
    const m = fixture(),
      r = buildRelief(m, new Set([16 * 32 + 16]));
    for (let y = 0.13; y < 31; y += 0.31)
      for (let x = 0.07; x < 31; x += 0.29) {
        const z = reliefHeight(m, r, x, y),
          next = reliefHeight(m, r, x + 0.001, y + 0.001);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThanOrEqual(RELIEF_MAX);
        expect((next - z) / 0.001).toBeLessThan(28.01);
      }
  });
  it('uses varied connecting families and limits summit caps instead of stamping every tile', () => {
    const m = fixture(),
      r = buildRelief(m, new Set()),
      families = new Set<string>();
    let peaks = 0,
      mountains = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const f = hillFamily(m, r, x, y);
        families.add(f);
        peaks += f === 'peak' ? 1 : 0;
        mountains += m.terrain[y * 32 + x] === Terrain.Mountain ? 1 : 0;
      }
    for (const f of ['flat', 'slope', 'shoulder', 'plateau', 'peak'])
      expect(families.has(f)).toBe(true);
    expect(peaks).toBeGreaterThan(0);
    expect(peaks).toBeLessThan(mountains / 3);
  });
  it('keeps source texture sampling fixed in world coordinates across expansion', () => {
    const m = emptyMap(5, 32, 32),
      expanded = emptyMap(5, 48, 48);
    expanded.originX = -8;
    expanded.originY = -8;
    const pixels = new Uint8ClampedArray(512 * 512 * 10 * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 17 + (i >>> 11)) % 256;
    const a = [0, 0, 0],
      b = [0, 0, 0];
    for (const [x, y] of [
      [5.3, 7.2],
      [11.8, 12.1],
    ]) {
      const material = surfaceMaterial(m, x, y);
      expect(surfaceMaterial(expanded, x + 8, y + 8)).toBe(material);
      surfaceColor(pixels, material, x + m.originX, y + m.originY, a);
      surfaceColor(pixels, material, x + 8 + expanded.originX, y + 8 + expanded.originY, b);
      a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 8));
    }
  });
  it('reads only the opaque painted part of every packed surface', () => {
    // Alpha copied into the colour channels: any sample reaching a transparent tile corner or the
    // packed cell edge comes out below full coverage.
    const sheet = PNG.sync.read(readFileSync('public/assets/terrain-surfaces.png')),
      alpha = new Uint8ClampedArray(sheet.data.length);
    for (let i = 0; i < alpha.length; i += 4)
      alpha[i] = alpha[i + 1] = alpha[i + 2] = alpha[i + 3] = sheet.data[i + 3];
    const out = [0, 0, 0];
    for (let material = 0; material < 10; material++)
      for (let y = -40; y < 40; y += 0.37)
        for (let x = -40; x < 40; x += 0.41) {
          surfaceColor(alpha, material, x, y, out);
          expect(out[0]).toBeGreaterThan(210);
        }
  });
  it('keeps tile centres classified correctly, including all four shoreline directions', () => {
    const m = emptyMap(5, 16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        m.terrain[y * 16 + x] = (x + y) % 2 ? Terrain.Water : Terrain.Grass;
    for (let y = 1; y < 15; y++)
      for (let x = 1; x < 15; x++) expect(surfaceMaterial(m, x, y)).toBe((x + y) % 2 ? 5 : 0);
  });
});
