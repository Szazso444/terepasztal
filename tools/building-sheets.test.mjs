import { describe, it, expect } from 'vitest';
import { FOOTPRINTS, loadInventory, pictureFile, project } from './building-kit.mjs';
import { GREY, blockOf, drawGuide } from './building-guides.mjs';
import { buildQueue, loadFamilies, setStatus } from './building-queue.mjs';
import { SHEET, drawSheet, indexHtml, sheetFile } from './building-sheets.mjs';

const inv = loadInventory();
const family = (f) => inv.find((x) => x.family === f);
const at = (png, x, y) => {
  const o = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [...png.data.subarray(o, o + 3)];
};
/** every picture of a family is its guide's block-out, unless left out */
const guides =
  (f, without = []) =>
  (file) => {
    if (without.includes(file)) return null;
    const rot = Number(/-r(\d)\.png$/.exec(file)[1]);
    return drawGuide(f.footprint, rot);
  };

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
    const sheet = drawSheet(f, guides(f));
    const fp = FOOTPRINTS.t1;
    const b = blockOf('t1', 0);
    const [tx, ty] = project(fp, 0, 0, b.z1);
    // third age, fourth view: the block's top is the guide's light grey
    expect(at(sheet, 3 * 256 + tx / 4, 2 * 256 + ty / 4)).toEqual(GREY.top);
    // a cell's corner is grass
    expect(at(sheet, 3 * 256 + 4, 2 * 256 + 4)).toEqual(SHEET.grass);
  });

  it("leaves a missing picture's cell empty", () => {
    const f = family('farm');
    const sheet = drawSheet(f, guides(f, [pictureFile('farm', 1, 2)]));
    const [cx, cy] = FOOTPRINTS.t1.centre;
    // second age, third view: only the footprint on the grass
    expect(at(sheet, 2 * 256 + cx / 4, 1 * 256 + cy / 4)).toEqual(SHEET.footprint);
    const [tx, ty] = project(FOOTPRINTS.t1, 0, 0, blockOf('t1', 2).z1);
    expect(at(sheet, 2 * 256 + tx / 4, 1 * 256 + ty / 4)).toEqual(SHEET.grass);
    // its neighbour is there
    expect(at(sheet, 1 * 256 + tx / 4, 1 * 256 + ty / 4)).toEqual(GREY.top);
  });

  it('lists every family in the index, with its progress and what failed', () => {
    const queue = buildQueue(inv, loadFamilies());
    setStatus(queue, 'depot-a0-r0', 'generated');
    setStatus(queue, 'depot-a0-r1', 'rejected', { attempts: 3, note: 'portals on the wrong wall' });
    const report = {
      checked: 2,
      failed: 1,
      pictures: {
        'depot-a0-r0': { ok: true, problems: [] },
        'depot-a0-r1': { ok: false, problems: ['base is 80 px right of the footprint'] },
      },
    };
    const html = indexHtml(inv, queue, report);
    for (const f of inv) expect(html).toContain(`id="${f.family}"`);
    expect(html).toContain('src="depot.png"');
    expect(html).toContain('2 of 24');
    expect(html).toContain('depot-a0-r1');
    expect(html).toContain('base is 80 px right of the footprint');
    expect(html).toContain('portals on the wrong wall');
    expect(html).toContain('0 of 4');
  });
});
