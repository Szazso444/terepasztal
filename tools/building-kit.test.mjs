import { describe, it, expect } from 'vitest';
import {
  AGES,
  ROTATIONS,
  FOOTPRINTS,
  wallRole,
  footprintTiles,
  project,
  diamond,
  loadInventory,
  pictures,
  pictureFile,
  frameKey,
} from './building-kit.mjs';

describe('building inventory', () => {
  const inv = loadInventory();
  const family = (f) => inv.find((x) => x.family === f);

  it('counts 27 families and 560 pictures', () => {
    expect(inv).toHaveLength(27);
    expect(pictures(inv)).toHaveLength(560);
    expect(inv[0].family).toBe('depot');
    expect(inv[1].family).toBe('station');
    expect(inv.at(-1).family).toBe('fuel_stop');
    expect(new Set(inv.map((x) => x.family)).size).toBe(27);
  });

  it('gives later buildings fewer ages', () => {
    expect(family('refinery')).toMatchObject({ firstAge: 1, ages: 5, kind: 'works' });
    expect(family('substation')).toMatchObject({ firstAge: 2, ages: 4 });
    expect(family('copper_mine')).toMatchObject({ firstAge: 2, ages: 4, kind: 'station' });
    expect(family('water_tower')).toMatchObject({ firstAge: 0, ages: 1, upgradeable: false });
    expect(family('townhouse')).toMatchObject({ ages: 6, kind: 'house', upgradeable: true });
  });

  it('gives the mines their own family and the depots their footprints', () => {
    for (const f of ['mine', 'sand_pit', 'copper_mine']) expect(family(f).id).toBe(f);
    expect(family('depot')).toMatchObject({ footprint: 't2x2', kind: 'depot' });
    expect(family('depot_narrow')).toMatchObject({ footprint: 't1x2', id: 'narrow_depot' });
    expect(family('farm').footprint).toBe('t1');
    // houses grow tall in the later ages: they get the tall canvas
    expect(family('townhouse').footprint).toBe('t1tall');
  });

  it('lists a family age by age, the front view first', () => {
    const list = pictures(inv).filter((p) => p.family === 'refinery');
    expect(list).toHaveLength(20);
    expect(list.slice(0, 5).map((p) => `a${p.age}r${p.rot}`)).toEqual([
      'a1r0',
      'a1r1',
      'a1r2',
      'a1r3',
      'a2r0',
    ]);
    expect(pictures(inv)[0]).toMatchObject({ family: 'depot', age: 0, rot: 0 });
  });

  it('names files and frame keys', () => {
    expect(pictureFile('power_plant', 3, 2)).toBe(
      'assets/source/buildings-v2/power_plant/power_plant-a3-r2.png',
    );
    expect(frameKey('power_plant', 3, 2)).toBe('structures/power_plant_a3_r2');
  });
});

describe('building conventions', () => {
  it('has six ages and four rotations', () => {
    expect(AGES.map((a) => a.id)).toEqual([
      'steam',
      'diesel',
      'electric',
      'nuclear',
      'magnetic',
      'hyper',
    ]);
    expect(AGES.map((a) => a.tag)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
    expect(ROTATIONS.map((r) => r.front)).toEqual(['S', 'W', 'N', 'E']);
  });

  it('names the wall roles for each rotation', () => {
    // the lower-left wall is the S wall, the lower-right wall the E wall
    const seen = ROTATIONS.map((r) => [wallRole('S', r.index), wallRole('E', r.index)]);
    expect(seen).toEqual([
      ['front', 'sideA'],
      ['sideA', 'back'],
      ['back', 'sideB'],
      ['sideB', 'front'],
    ]);
  });

  it('projects ground edges at exactly two across for one down', () => {
    for (const fp of Object.values(FOOTPRINTS)) {
      const [x0, y0] = project(fp, 0, 0);
      const [x1, y1] = project(fp, 1, 0);
      const [x2, y2] = project(fp, 0, 1);
      expect((y1 - y0) / (x1 - x0)).toBe(0.5);
      expect((y2 - y0) / (x2 - x0)).toBe(-0.5);
      // height runs straight up the canvas
      expect(project(fp, 0, 0, 10)).toEqual([x0, y0 - 10 * fp.scale]);
    }
  });

  it('puts the footprint centre on its pixel', () => {
    expect(project(FOOTPRINTS.t1, 0, 0)).toEqual([512, 832]);
    expect(project(FOOTPRINTS.t1x2, 0, 0)).toEqual([512, 800]);
    expect(project(FOOTPRINTS.t2x2, 0, 0)).toEqual([768, 760]);
    expect(project(FOOTPRINTS.t1tall, 0, 0)).toEqual([512, 1344]);
    expect(FOOTPRINTS.t1tall.canvas).toEqual([1024, 1536]);
    expect(Object.keys(FOOTPRINTS)).toEqual(['t1', 't1tall', 't1x2', 't2x2']);
    expect(FOOTPRINTS.t2x2.canvas).toEqual([1536, 1024]);
    expect(diamond(FOOTPRINTS.t1, 0)).toEqual({
      n: [512, 704],
      e: [768, 832],
      s: [512, 960],
      w: [256, 832],
    });
  });

  it("turns the narrow depot's footprint with it", () => {
    expect(footprintTiles(FOOTPRINTS.t1x2, 0)).toEqual({ w: 2, h: 1 });
    expect(footprintTiles(FOOTPRINTS.t1x2, 1)).toEqual({ w: 1, h: 2 });
    expect(footprintTiles(FOOTPRINTS.t1x2, 2)).toEqual({ w: 2, h: 1 });
    expect(footprintTiles(FOOTPRINTS.t2x2, 3)).toEqual({ w: 2, h: 2 });
    // every footprint stays inside its canvas with room to spare
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS) {
        const d = diamond(fp, r.index);
        expect(d.w[0]).toBeGreaterThanOrEqual(64);
        expect(d.e[0]).toBeLessThanOrEqual(fp.canvas[0] - 64);
        expect(d.s[1]).toBeLessThanOrEqual(fp.canvas[1] - 24);
      }
  });
});
