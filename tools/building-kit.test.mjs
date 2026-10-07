import { afterAll, describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  WALL_INSET,
  wallBase,
  writeWhole,
} from './building-kit.mjs';

/** the folders these tests make under the temp directory, removed when they are done */
const temp = [];
const tempFolder = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temp.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

describe('building inventory', () => {
  const inv = loadInventory();
  const family = (f) => inv.find((x) => x.family === f);

  it('counts 27 families and 548 pictures', () => {
    expect(inv).toHaveLength(27);
    expect(pictures(inv)).toHaveLength(548);
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

  it('stops modernising a building of one period at its last age', () => {
    // the charcoal kiln is upgraded up to the Electric age and keeps that model afterwards
    expect(family('kiln')).toMatchObject({ firstAge: 0, lastAge: 2, ages: 3 });
    expect(family('windmill')).toMatchObject({ firstAge: 0, lastAge: 5, ages: 6 });
    expect(family('water_tower')).toMatchObject({ firstAge: 0, lastAge: 0, ages: 1 });
    const kiln = pictures(inv).filter((p) => p.family === 'kiln');
    expect(kiln.map((p) => p.age)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
    // a last age is one of the game's ages, and not before the first
    const root = tempFolder('building-kit-');
    cpSync('src/data', join(root, 'src/data'), { recursive: true });
    const file = join(root, 'src/data/buildings.json');
    const last = (lastTier) => {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      data.find((d) => d.id === 'refinery').lastTier = lastTier;
      writeFileSync(file, JSON.stringify(data));
      return loadInventory(root).find((f) => f.family === 'refinery');
    };
    expect(last(3)).toMatchObject({ firstAge: 1, lastAge: 3, ages: 3 });
    expect(() => last(0)).toThrow(/refinery: its last age \(lastTier 0\) is before its first/);
    expect(() => last(9)).toThrow(/refinery: there is no age 9/);
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

  it('sets the walls in from the footprint edge, where the guide block stands', () => {
    expect(WALL_INSET).toBe(0.06);
    // one tile: 0.06 tile in from each edge, on the ground
    expect(wallBase(FOOTPRINTS.t1, 0)).toEqual({
      n: project(FOOTPRINTS.t1, -0.44, -0.44),
      e: project(FOOTPRINTS.t1, 0.44, -0.44),
      s: project(FOOTPRINTS.t1, 0.44, 0.44),
      w: project(FOOTPRINTS.t1, -0.44, 0.44),
    });
    // the narrow depot turns: two tiles along x at r0, along y at r1
    expect(wallBase(FOOTPRINTS.t1x2, 0).s).toEqual(project(FOOTPRINTS.t1x2, 0.94, 0.44));
    expect(wallBase(FOOTPRINTS.t1x2, 1).s).toEqual(project(FOOTPRINTS.t1x2, 0.44, 0.94));
    // its middle is the footprint centre
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS) {
        const b = wallBase(fp, r.index);
        expect([(b.w[0] + b.e[0]) / 2, (b.w[1] + b.e[1]) / 2]).toEqual(fp.centre);
      }
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

describe('writing a file whole', () => {
  const folder = () => tempFolder('write-whole-');
  const fails = (code, what) => () => {
    throw Object.assign(new Error(`${code}: ${what}`), { code });
  };

  it('writes the file and leaves nothing beside it', () => {
    const dir = folder();
    writeWhole(join(dir, 'list.json'), 'new\n');
    expect(readFileSync(join(dir, 'list.json'), 'utf8')).toBe('new\n');
    expect(readdirSync(dir)).toEqual(['list.json']);
  });

  it('leaves the file as it was when the write is cut short', () => {
    // a full disk: some of the bytes land, then the write fails
    const dir = folder();
    const file = join(dir, 'list.json');
    writeFileSync(file, 'old\n');
    const cut = (to, data) => {
      writeFileSync(to, String(data).slice(0, 2));
      fails('ENOSPC', 'no space left on device, write')();
    };
    expect(() => writeWhole(file, 'new and longer\n', { writeFileSync: cut })).toThrow(/ENOSPC/);
    expect(readFileSync(file, 'utf8')).toBe('old\n');
    expect(readdirSync(dir)).toEqual(['list.json']);
  });

  it('writes in place where the file cannot be replaced in one step', () => {
    // something has the file open: the rename is refused, the write itself is not
    const dir = folder();
    const file = join(dir, 'list.json');
    writeFileSync(file, 'old\n');
    writeWhole(file, 'new\n', { renameSync: fails('EPERM', 'operation not permitted, rename') });
    expect(readFileSync(file, 'utf8')).toBe('new\n');
    expect(readdirSync(dir)).toEqual(['list.json']);
  });

  it('still writes in place when the name beside the file cannot be cleared away', () => {
    // a scanner holds the fresh copy: neither the rename nor the clean-up goes through
    const dir = folder();
    const file = join(dir, 'list.json');
    writeFileSync(file, 'old\n');
    const held = fails('EPERM', 'operation not permitted, unlink');
    writeWhole(file, 'new\n', {
      renameSync: fails('EBUSY', 'resource busy, rename'),
      rmSync: held,
    });
    expect(readFileSync(file, 'utf8')).toBe('new\n');
  });

  it('reports the full disk, not the clean-up, when both fail', () => {
    const dir = folder();
    const file = join(dir, 'list.json');
    writeFileSync(file, 'old\n');
    const io = {
      writeFileSync: fails('ENOSPC', 'no space left on device, write'),
      rmSync: fails('EPERM', 'operation not permitted, unlink'),
    };
    expect(() => writeWhole(file, 'new\n', io)).toThrow(/ENOSPC/);
    expect(readFileSync(file, 'utf8')).toBe('old\n');
  });

  it('is loud when the write in place fails too', () => {
    const dir = folder();
    const file = join(dir, 'list.json');
    writeFileSync(file, 'old\n');
    let n = 0;
    const io = {
      // the copy beside the file is written, the file itself cannot be
      writeFileSync: (to, data) =>
        n++ ? fails('EBUSY', 'resource busy, open')() : writeFileSync(to, data),
      renameSync: fails('EPERM', 'operation not permitted, rename'),
    };
    expect(() => writeWhole(file, 'new\n', io)).toThrow(/EBUSY/);
    expect(readFileSync(file, 'utf8')).toBe('old\n');
    expect(readdirSync(dir)).toEqual(['list.json']);
  });

  it('gives each process a name of its own beside the file', () => {
    // two tools writing at once must not take each other's copy
    const dir = folder();
    const file = join(dir, 'list.json');
    const seen = [];
    const io = {
      writeFileSync: (to, data) => {
        seen.push(to);
        writeFileSync(to, data);
      },
    };
    writeWhole(file, 'new\n', io);
    expect(seen).toEqual([`${file}.${process.pid}.part`]);
  });
});
