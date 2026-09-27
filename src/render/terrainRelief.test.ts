import { describe, it, expect } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import {
  buildRelief,
  reliefHeight,
  reliefCorners,
  reliefTileAtWorld,
  hillFamily,
  groundAllows,
  RELIEF_MAX,
  TILE_SIDE_PX,
  type ReliefStyle,
} from './terrainRelief';
import { surfaceMaterial, surfaceColor, surfaceBlend, grassDetail } from './terrainMaterials';
import { readFileSync } from 'node:fs';
import { lineSpans, type RailBed } from '../world/railProfile';
import { PNG } from 'pngjs';

/** The corner-slope style these geometry tests were written for (still selectable). */
const CORNERS: ReliefStyle = { step: TILE_SIDE_PX / 4, maxRise: 2, faces: true };
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
  it('keeps the hill under built tiles and only smooths their crown', () => {
    const m = fixture(),
      natural = buildRelief(m, new Set()),
      r = buildRelief(m, new Set([16 * 32 + 16]));
    // Building never cuts the hill away: every corner keeps its natural level.
    expect(r.corners).toEqual(natural.corners);
    const [a, b, d, e] = reliefCorners(m, r, 16, 16);
    // No crown: the built tile is exactly the bilinear surface through its corners.
    for (let v = 0; v <= 1; v += 0.25)
      for (let u = 0; u <= 1; u += 0.25)
        expect(reliefHeight(m, r, 15.5 + u, 15.5 + v)).toBeCloseTo(
          a + (b - a) * u + (e - a) * v + (a - b - e + d) * u * v,
          4,
        );
    for (let y = -0.5; y < 0.5; y += 0.1)
      for (let x = -0.5; x < 0.5; x += 0.1) expect(reliefHeight(m, r, 1 + x, 1 + y)).toBe(0);
    expect(reliefHeight(m, r, -5, 4)).toBe(0);
  });
  it('lets straight rails climb one level per tile and keeps everything else on level ground', () => {
    const m = fixture(),
      r = buildRelief(m, new Set(), CORNERS);
    let straightOnly = 0,
      level = 0,
      refused = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const c = reliefCorners(m, r, x, y).map((v) => Math.round(v / r.style.step)),
          span = Math.max(...c) - Math.min(...c);
        expect(groundAllows(m, r, x, y, 'level')).toBe(span === 0);
        expect(groundAllows(m, r, x, y, 'straight')).toBe(span <= 1);
        if (span === 0) level++;
        else if (span === 1) straightOnly++;
        else refused++;
      }
    expect(level && straightOnly && refused).toBeTruthy();
    expect(groundAllows(m, r, -1, 0, 'straight')).toBe(false);
  });
  it('bounds projection slopes so the painted surface cannot fold behind itself', () => {
    const m = fixture(),
      r = buildRelief(m, new Set([16 * 32 + 16]), CORNERS);
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
      r = buildRelief(m, new Set(), CORNERS),
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
  it('keeps every relief style within its per-edge rise, height budget and picking', () => {
    const m = fixture();
    const styles: ReliefStyle[] = [
      { step: 10, maxRise: 1, faces: false },
      { step: TILE_SIDE_PX / 10, maxRise: 2, faces: true },
      { step: TILE_SIDE_PX / 3, maxRise: 2, faces: true },
    ];
    for (const style of styles) {
      const r = buildRelief(m, new Set([16 * 32 + 16]), style),
        stride = 33;
      let steep = 0;
      for (let y = 0; y <= 32; y++)
        for (let x = 0; x <= 32; x++) {
          const k = y * stride + x;
          for (const n of [x < 32 ? k + 1 : -1, y < 32 ? k + stride : -1]) {
            if (n < 0) continue;
            const rise = Math.abs(r.corners[k] - r.corners[n]);
            expect(rise).toBeLessThanOrEqual(style.maxRise);
            if (rise === 2) steep++;
          }
        }
      if (style.maxRise === 2) expect(steep).toBeGreaterThan(0);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const z = reliefHeight(m, r, x, y);
          expect(z).toBeLessThanOrEqual(RELIEF_MAX);
          // A tile centre that is not hidden behind nearer ground picks back to itself.
          const hit = reliefTileAtWorld(m, r, (x - y) * 32, (x + y) * 16 - z);
          if (hit.x !== x || hit.y !== y) expect(hit.x + hit.y).toBeGreaterThan(x + y);
        }
    }
  });
  it('runs straight rails over terraces on a continuous bed without cutting the hill', () => {
    const m = fixture(),
      y = 16,
      natural = buildRelief(m, new Set()),
      { spans } = lineSpans(Array.from({ length: 32 }, (_, x) => natural.tiles![y * 32 + x])),
      rails = new Map<number, RailBed>();
    for (let x = 0; x < 32; x++) rails.set(y * 32 + x, { axis: 'x', spans, flat: false });
    const r = buildRelief(m, new Set(), undefined, rails),
      step = r.style.step;
    // The hill keeps its levels; only the bed under the rail follows its own line.
    expect(r.tiles).toEqual(natural.tiles);
    for (let x = 0; x < 31; x++) {
      // Adjacent track tiles meet at the same height on their shared edge.
      const edge = x + 0.5;
      expect(reliefHeight(m, r, edge - 1e-6, y)).toBeCloseTo(reliefHeight(m, r, edge + 1e-6, y), 3);
      // Across one tile the rail climbs at most one level.
      const rise = Math.abs(reliefHeight(m, r, x + 0.49, y) - reliefHeight(m, r, x - 0.49, y));
      expect(rise).toBeLessThanOrEqual(step * 1.001);
    }
    expect(reliefHeight(m, r, 16, y)).toBeGreaterThan(0);
  });
  it('keeps level pieces and structures on terrace tiles no bank reaches into', () => {
    const m = fixture(),
      r = buildRelief(m, new Set());
    let level = 0,
      edge = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const here = r.tiles![y * 32 + x],
          same = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].every(([dx, dy]) => {
            const nx = x + dx,
              ny = y + dy;
            return (nx < 0 || ny < 0 || nx > 31 || ny > 31 ? 0 : r.tiles![ny * 32 + nx]) === here;
          });
        expect(groundAllows(m, r, x, y, 'level')).toBe(same);
        expect(groundAllows(m, r, x, y, 'straight')).toBe(true);
        if (same) level++;
        else edge++;
      }
    expect(level && edge).toBeTruthy();
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
