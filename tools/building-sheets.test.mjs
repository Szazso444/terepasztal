import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import {
  FOOTPRINTS,
  diamond,
  loadInventory,
  pictureFile,
  project,
  wallBase,
} from './building-kit.mjs';
import { blockOf, boxFaces, fillPoly } from './building-guides.mjs';
import { buildQueue, loadFamilies, progress, setStatus } from './building-queue.mjs';
import { SHEET, anglesFile, drawSheet, indexHtml, sheetFile } from './building-sheets.mjs';

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
  });

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
  });

  it('draws the footprint and the wall lines over the pictures on the angles sheet', () => {
    // twice the size, with the lines every wall's foot should run along: drift shows at a glance
    const f = family('farm');
    const sheet = drawSheet(f, pictures(f), undefined, { outlines: true, shrink: 2 });
    expect([sheet.width, sheet.height]).toEqual([2048, 3072]);
    expect(anglesFile('farm')).toBe('assets/source/buildings-v2/review/farm-angles.png');
    const fp = FOOTPRINTS.t1;
    // first age, second view: the near corner of the footprint and of the walls
    const [fx, fy] = diamond(fp, 1).s;
    const [wx, wy] = wallBase(fp, 1).s;
    expect(at(sheet, 512 + fx / 2, fy / 2)).toEqual(SHEET.outline);
    expect(at(sheet, 512 + wx / 2, wy / 2)).toEqual(SHEET.walls);
    // the plain sheet shows the picture and nothing over it
    const plain = drawSheet(f, pictures(f));
    expect(at(plain, 256 + wx / 4, wy / 4)).not.toEqual(SHEET.walls);
  });

  it('shows the views of a building at one size, however large each came back', () => {
    // the first view drawn at 0.7 of the others: on the sheet all four are equally large
    const f = family('farm');
    const load = (file) =>
      painted(
        f.footprint,
        rotOf(file),
        rotOf(file) === 0
          ? { map: ([x, y]) => [512 + (x - 512) * 0.7, 832 + (y - 832) * 0.7] }
          : {},
      );
    const sheet = drawSheet(f, load);
    const [tx, ty] = project(FOOTPRINTS.t1, 0, 0, blockOf('t1', 0).z1);
    // the middle of every view's top face is where a full-size block has it
    for (let rot = 0; rot < 4; rot++)
      expect(at(sheet, rot * 256 + tx / 4, ty / 4), `r${rot}`).toEqual(SHADE.top);
  });

  it('stands a family as large on its tile as its description says', () => {
    const f = family('farm');
    const [sx, sy] = wallBase(FOOTPRINTS.t1, 0).s;
    const just = [sx / 4, sy / 4 + 3];
    // a little below the near corner of the walls: footprint at size 1, building at size 1.25
    expect(at(drawSheet(f, pictures(f)), ...just)).toEqual(SHEET.footprint);
    expect(at(drawSheet(f, pictures(f), undefined, { size: 1.25 }), ...just)).not.toEqual(
      SHEET.footprint,
    );
  });

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
  });

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
  });

  it('lists every family in the index, with what was made and what failed', () => {
    const queue = buildQueue(inv, fam);
    setStatus(queue, 'depot-a0-r0', 'generated');
    setStatus(queue, 'depot-a0-r1', 'rejected', { attempts: 3, note: 'portals on the wrong wall' });
    setStatus(queue, 'depot-a0-r2', 'generated');
    const report = {
      checked: 3,
      failed: 1,
      pictures: {
        'depot-a0-r0': {
          ok: true,
          problems: [],
          notes: [],
          fit: {
            method: 'base',
            sure: [true, true],
            measured: [0.504, -0.326],
            area: 10000,
            vertical: 1,
            scale: 1,
          },
        },
        'depot-a0-r1': { ok: false, problems: ['background is not transparent'] },
        'depot-a0-r2': {
          ok: true,
          problems: [],
          notes: ['placed by its outline: no straight wall base was found'],
          fit: {
            method: 'outline',
            sure: [false, true],
            measured: [0.5, -0.5],
            area: 14400,
            vertical: 1,
            scale: 1,
          },
        },
        'depot-a1-r0': {
          ok: true,
          problems: [],
          notes: [],
          fit: { method: 'base', sure: [true, true], measured: [0.498, -0.503] },
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
    // the ground lines as measured, picture by picture, and the sheet that shows them
    expect(html).toContain('href="depot-angles.png"');
    expect(html).toMatch(/<td class="far">0\.50 \/ -0\.33<\/td>/);
    expect(html).toMatch(/<td class="">0\.50 \/ -0\.50<\/td>/);
    expect(html).toMatch(/<td class="outline">by its outline<\/td>/);
    // how far apart in size the views of one building came back, before they were evened out
    expect(html).toContain('<th>sizes apart</th>');
    expect(html).toMatch(/<td class="off">x1\.20<\/td>/);
    // both gates and where they stand
    expect(html).toContain('"depot": waiting for approval');
    expect(html).toContain('"station": waiting for approval');
  });
});
