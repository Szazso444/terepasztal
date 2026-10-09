import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { FOOTPRINTS, loadInventory, pictureFile, project } from './building-kit.mjs';
import { blockOf, boxFaces, fillPoly } from './building-guides.mjs';
import { buildQueue, loadFamilies, progress, setStatus } from './building-queue.mjs';
import { SHEET, drawSheet, indexHtml, sheetFile } from './building-sheets.mjs';

const inv = loadInventory();
const fam = loadFamilies();
const family = (f) => inv.find((x) => x.family === f);
const at = (png, x, y) => {
  const o = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [...png.data.subarray(o, o + 3)];
};
const SHADE = { top: [220, 210, 180], left: [160, 120, 90], right: [110, 80, 60] };
/** A painted building: the guide's block on the ground, moved by `map`, on any canvas. */
function painted(fpId, rot, { canvas, map = (p) => p } = {}) {
  const fp = FOOTPRINTS[fpId];
  const [w, h] = canvas ?? fp.canvas;
  const png = new PNG({ width: w, height: h });
  const faces = boxFaces(fp, { ...blockOf(fpId, rot), z0: 0 });
  for (const [name, pts] of Object.entries(faces)) fillPoly(png, pts.map(map), SHADE[name]);
  return png;
}
const rotOf = (file) => Number(/-r(\d)\.png$/.exec(file)[1]);
/** every picture of a family is a painted block, unless left out */
const pictures =
  (f, { without = [], options } = {}) =>
  (file) =>
    without.includes(file) ? null : painted(f.footprint, rotOf(file), options);

describe('building review sheets', () => {
  it('makes a row per age and a column per view, a quarter of the canvas each', () => {
    const size = (name) => {
      const s = drawSheet(family(name), () => null);
      return [s.width, s.height];
    };
    expect(size('farm')).toEqual([1024, 1536]);
    expect(size('depot')).toEqual([1536, 1536]);
    expect(size('refinery')).toEqual([1024, 1280]);
    expect(size('water_tower')).toEqual([1024, 256]);
    expect(size('townhouse')).toEqual([1024, 2304]);
    expect(sheetFile('depot')).toBe('assets/source/buildings-v2/review/depot.png');
  });

  it('shows each picture in its cell, on its footprint', () => {
    const f = family('farm');
    const sheet = drawSheet(f, pictures(f));
    const fp = FOOTPRINTS.t1;
    const [tx, ty] = project(fp, 0, 0, blockOf('t1', 0).z1);
    // third age, fourth view: the middle of the block's top
    expect(at(sheet, 3 * 256 + tx / 4, 2 * 256 + ty / 4)).toEqual(SHADE.top);
    // a cell's corner is grass
    expect(at(sheet, 3 * 256 + 4, 2 * 256 + 4)).toEqual(SHEET.grass);
  }, 20_000);

  it('lays a picture of any size and place onto its footprint, as the game will', () => {
    // what a generator returns: half as large again, off centre, on a canvas of its own
    const f = family('farm');
    const map = ([x, y]) => [600 + (x - 512) * 1.5, 1000 + (y - 832) * 1.5];
    const sheet = drawSheet(f, pictures(f, { options: { canvas: [1254, 1254], map } }));
    const [tx, ty] = project(FOOTPRINTS.t1, 0, 0, blockOf('t1', 0).z1);
    expect(at(sheet, 1 * 256 + tx / 4, 4 * 256 + ty / 4)).toEqual(SHADE.top);
    // the footprint shows round the building's foot: its near corner is not covered
    const [sx, sy] = project(FOOTPRINTS.t1, 0.5, 0.5);
    expect(at(sheet, 1 * 256 + sx / 4, 4 * 256 + sy / 4 - 2)).toEqual(SHEET.footprint);
  }, 20_000);

  it("leaves a missing picture's cell empty", () => {
    const f = family('farm');
    const sheet = drawSheet(f, pictures(f, { without: [pictureFile('farm', 1, 2)] }));
    const [cx, cy] = FOOTPRINTS.t1.centre;
    // second age, third view: only the footprint on the grass
    expect(at(sheet, 2 * 256 + cx / 4, 1 * 256 + cy / 4)).toEqual(SHEET.footprint);
    const [tx, ty] = project(FOOTPRINTS.t1, 0, 0, blockOf('t1', 2).z1);
    expect(at(sheet, 2 * 256 + tx / 4, 1 * 256 + ty / 4)).toEqual(SHEET.grass);
    // its neighbour is there
    expect(at(sheet, 1 * 256 + tx / 4, 1 * 256 + ty / 4)).toEqual(SHADE.top);
  }, 20_000);

  it('leaves the cell empty and names the file when a picture cannot be read', () => {
    const f = family('farm');
    const broken = pictureFile('farm', 0, 1);
    const said = [];
    const load = (file) => {
      if (file === broken) throw new Error('Invalid file signature');
      return pictures(f)(file);
    };
    const sheet = drawSheet(f, load, (file, why) => said.push(`${file}: ${why}`));
    expect(said).toEqual([`${broken}: Invalid file signature`]);
    const [cx, cy] = FOOTPRINTS.t1.centre;
    expect(at(sheet, 1 * 256 + cx / 4, cy / 4)).toEqual(SHEET.footprint);
  }, 20_000);

  it('lists every family in the index, with what was made and what failed', () => {
    const queue = buildQueue(inv, fam);
    setStatus(queue, 'depot-a0-r0', 'generated');
    setStatus(queue, 'depot-a0-r1', 'rejected', { attempts: 3, note: 'portals on the wrong wall' });
    setStatus(queue, 'depot-a0-r2', 'generated');
    const report = {
      checked: 3,
      failed: 1,
      pictures: {
        'depot-a0-r0': { ok: true, problems: [], notes: [] },
        'depot-a0-r1': { ok: false, problems: ['background is not transparent'] },
        'depot-a0-r2': {
          ok: true,
          problems: [],
          notes: ['placed by its outline: no straight wall base was found'],
        },
      },
    };
    const there = (file) =>
      !file.startsWith('assets/source/buildings-v2/') || /depot-a0-r[02]\.png$/.test(file);
    const html = indexHtml(inv, queue, report, progress(queue, inv, fam, there));
    for (const f of inv) expect(html).toContain(`id="${f.family}"`);
    expect(html).toContain('src="depot.png"');
    // a rejected picture is not a made one
    expect(html).toContain('2 of 24 made, 1 rejected');
    expect(html).toContain('2 of 560 made');
    expect(html).not.toContain('3 of 24');
    expect(html).toContain('depot-a0-r1');
    expect(html).toContain('background is not transparent');
    expect(html).toContain('portals on the wrong wall');
    // what a reviewer should look at
    expect(html).toContain('depot-a0-r2');
    expect(html).toContain('placed by its outline');
    expect(html).toContain('0 of 4 made');
    // both gates and where they stand
    expect(html).toContain('"depot": waiting for approval');
    expect(html).toContain('"station": waiting for approval');
  });
});
