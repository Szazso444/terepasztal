import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import {
  FOOTPRINTS,
  diamond,
  loadInventory,
  pictureFile,
  project,
  wallBase,
} from './building-kit.mjs';
import { blockOf, boxFaces, fillPoly, openingsOf } from './building-guides.mjs';
import { buildQueue, loadFamilies, progress, setStatus } from './building-queue.mjs';
import {
  SHEET,
  TRACK,
  anglesFile,
  drawLook,
  drawSheet,
  indexHtml,
  lookFile,
  lookedAt,
  sheetFile,
} from './building-sheets.mjs';

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
    // the depot stands 1.3 times its footprint, so that the rails fit its portals (seen in the game)
    expect(fam.families.depot.size).toBe(1.3);
    expect(fam.families.farm.size).toBeUndefined();
  });

  it('shows one picture on grass, as painted, with the lines its walls should stand on', () => {
    const fp = FOOTPRINTS.t2x2;
    const look = drawLook(painted('t2x2', 1), 't2x2', 1);
    expect([look.width, look.height]).toEqual([768, 512]);
    // opaque everywhere: a viewer that ignores transparency cannot show a glow that is not there
    let faintest = 255;
    for (let i = 3; i < look.data.length; i += 4) faintest = Math.min(faintest, look.data[i]);
    expect(faintest).toBe(255);
    const [tx, ty] = project(fp, 0, 0, blockOf('t2x2', 1).z1);
    expect(at(look, tx / 2, ty / 2)).toEqual(SHADE.top);
    expect(at(look, 4, 4)).toEqual(SHEET.grass);
    // the footprint's edge and the line of the walls' feet are drawn over it
    const corner = diamond(fp, 1).s;
    const foot = wallBase(fp, 1).s;
    expect(at(look, corner[0] / 2, corner[1] / 2)).toEqual(SHEET.outline);
    expect(at(look, foot[0] / 2, foot[1] / 2)).toEqual(SHEET.walls);
    // the building stands on that line: just above its near corner is wall
    expect(at(look, foot[0] / 2, foot[1] / 2 - 6)).not.toEqual(SHEET.footprint);
    // and the frames of the guide's openings say which wall the door and the portals belong to
    for (const o of openingsOf('t2x2', 1))
      expect(at(look, o.pts[3][0] / 2, o.pts[3][1] / 2)).toEqual(SHEET.openings);
    // a camera that is off is left as painted, so the eye sees the foot leave its line: seen
    // from too low, the near corner stands well above where it should
    const low = painted('t2x2', 1, { map: ([x, y]) => [x, 760 + (y - 760) * 0.8] });
    expect(at(drawLook(low, 't2x2', 1), foot[0] / 2, foot[1] / 2 - 6)).toEqual(SHEET.footprint);
    // nothing to show of an empty picture
    expect(drawLook(new PNG({ width: 1024, height: 1024 }), 't1', 0)).toBeNull();
  });

  it("draws the game's rails through a depot's portals, under the picture", () => {
    // the game lays its track under a depot, through the portals. On grass alone a floor painted
    // in a portal looks harmless; with the rails drawn in, they are seen to stop at it
    const fp = FOOTPRINTS.t2x2;
    for (const rot of [0, 1]) {
      const sides = openingsOf('t2x2', rot).filter((o) => o.kind === 'side');
      expect(sides).toHaveLength(2);
      // the guide has its openings on the plinth; the painted block stands on the ground
      const down = fp.scale * blockOf('t2x2', rot).z0;
      const closed = painted('t2x2', rot);
      const open = painted('t2x2', rot);
      const part = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      for (const o of sides) {
        const [a0, c0, cTop0, aTop0] = o.pts.map(([x, y]) => [x, y + down]);
        const [a, c] = [part(a0, c0, 0.1), part(a0, c0, 0.9)];
        const [aTop, cTop] = [part(aTop0, cTop0, 0.1), part(aTop0, cTop0, 0.9)];
        fillPoly(open, [a, c, part(c, cTop, 0.4), part(a, aTop, 0.4)], [0, 0, 0], 0);
      }
      const [lookClosed, lookOpen] = [closed, open].map((png) => drawLook(png, 't2x2', rot));
      for (const o of sides) {
        const mid = part(o.pts[0], o.pts[1], 0.5).map((v, i) => v + (i ? down : 0));
        // the track runs square to the wall: into the hall is up and away from the wall. Far
        // enough in to be clear of the yellow frame, which the guide has at the plinth's height
        const step = fp.scale * 0.16;
        const inward = o.wall === 0 ? [32 * step, -16 * step] : [-32 * step, -16 * step];
        const inside = [mid[0] + inward[0], mid[1] + inward[1]];
        const outside = [mid[0] - inward[0] * 3, mid[1] - inward[1] * 3];
        // before the portal the track shows on the grass
        for (const look of [lookClosed, lookOpen])
          expect(at(look, outside[0] / 2, outside[1] / 2), `r${rot}`).toEqual(SHEET.bed);
        // a wall or a floor painted in the portal hides it; the ground left open, it runs in
        expect(at(lookClosed, inside[0] / 2, inside[1] / 2), `r${rot}`).not.toEqual(SHEET.bed);
        expect(at(lookOpen, inside[0] / 2, inside[1] / 2), `r${rot}`).toEqual(SHEET.bed);
      }
    }
    // the narrow depot has one track; a building without portals has none
    const count = (look, rgb) => {
      let n = 0;
      for (let i = 0; i < look.data.length; i += 4)
        if (look.data[i] === rgb[0] && look.data[i + 1] === rgb[1] && look.data[i + 2] === rgb[2])
          n++;
      return n;
    };
    expect(count(drawLook(painted('t1x2', 0), 't1x2', 0), SHEET.bed)).toBeGreaterThan(200);
    expect(count(drawLook(painted('t1', 0), 't1', 0), SHEET.bed)).toBe(0);
    expect(count(drawLook(painted('t1', 0), 't1', 0), SHEET.rail)).toBe(0);
    // the narrow depot's one track runs the length of the hall, through both end walls
    const narrow = FOOTPRINTS.t1x2;
    for (const [rot, along, across] of [
      [0, [1.5, 0], [0, 0.9]],
      [1, [0, 1.5], [0.9, 0]],
    ]) {
      const look = drawLook(painted('t1x2', rot), 't1x2', rot);
      const seen = ([x, y]) => at(look, ...project(narrow, x, y).map((v) => v / 2));
      expect(seen(along), `narrow r${rot}`).toEqual(SHEET.bed);
      expect(seen(along.map((v) => -v)), `narrow r${rot}`).toEqual(SHEET.bed);
      expect(seen(across), `narrow r${rot}`).toEqual(SHEET.grass);
    }
  });

  it("draws the game's own track: its gauge and its bed, for each depot", () => {
    // the look had its rails 0.22 tile apart where the game's are 0.32: on a seventh of the
    // first depot's portals it showed both rails clear of a door post the game runs one under
    const game = readFileSync('src/art/trackIllustrated.ts', 'utf8');
    const of = (cls) => {
      const m = new RegExp(
        `${cls}: \\{\\s*rail: ([\\d.]+),\\s*sleeper: ([\\d.]+),\\s*step: [\\d.]+,\\s*shoulder: ([\\d.]+),\\s*bed: (true|false)`,
      ).exec(game);
      return {
        rail: Number(m[1]),
        sleeper: Number(m[2]),
        shoulder: Number(m[3]),
        ballast: m[4] === 'true',
      };
    };
    // the depot stands on regular track, which shows as wide as its ballast; the narrow depot on
    // narrow gauge, which has none and shows as wide as its sleepers
    const regular = of('regular'),
      narrow = of('narrow');
    expect(regular.ballast).toBe(true);
    expect(TRACK.t2x2).toEqual({ rail: regular.rail, bed: regular.shoulder });
    expect(narrow.ballast).toBe(false);
    expect(TRACK.t1x2).toEqual({ rail: narrow.rail, bed: narrow.sleeper });
    // and so it is drawn: across the track before the portal wall, from its middle outwards
    for (const [fpId, lanes] of [
      ['t2x2', [-0.5, 0.5]],
      ['t1x2', [0]],
    ]) {
      const fp = FOOTPRINTS[fpId];
      // r1: the portals are in the lower-left wall, and the track runs out of them along y
      const look = drawLook(painted(fpId, 1), fpId, 1);
      const seen = (x) => at(look, ...project(fp, x, 1.5).map((v) => v / 2));
      const { rail, bed } = TRACK[fpId];
      for (const lane of lanes) {
        expect(seen(lane), `${fpId} ${lane}`).toEqual(SHEET.bed);
        for (const side of [-1, 1]) {
          expect(seen(lane + side * rail), `${fpId} ${lane}`).toEqual(SHEET.rail);
          expect(seen(lane + side * (rail + 0.04)), `${fpId} ${lane}`).toEqual(SHEET.bed);
          expect(seen(lane + side * (bed + 0.05)), `${fpId} ${lane}`).toEqual(SHEET.grass);
        }
      }
    }
  });

  it('lays a depot out at the size the game gives it, the rails where the game has them', () => {
    // the depot stands 1.3 times its footprint in the game, and the track does not grow with it.
    // Laid out at the footprint's own size, pictures whose rails the game shows in the portals
    // had them run onto the door posts
    const fp = FOOTPRINTS.t2x2;
    const size = 1.3;
    for (const rot of [0, 1]) {
      const sides = openingsOf('t2x2', rot).filter((o) => o.kind === 'side');
      const wall = sides[0].wall;
      const b = blockOf('t2x2', rot);
      const down = fp.scale * b.z0;
      const closed = painted('t2x2', rot);
      const open = painted('t2x2', rot);
      const part = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      for (const o of sides) {
        const [a0, c0, cTop0, aTop0] = o.pts.map(([x, y]) => [x, y + down]);
        const [a, c] = [part(a0, c0, 0.1), part(a0, c0, 0.9)];
        const [aTop, cTop] = [part(aTop0, cTop0, 0.1), part(aTop0, cTop0, 0.9)];
        fillPoly(open, [a, c, part(c, cTop, 0.4), part(a, aTop, 0.4)], [0, 0, 0], 0);
      }
      const [lookClosed, lookOpen] = [closed, open].map((png) =>
        drawLook(png, 't2x2', rot, { size }),
      );
      // the canvas grows with the building: nothing that fitted the footprint's canvas is cut off
      expect([lookOpen.width, lookOpen.height], `r${rot}`).toEqual([998, 666]);
      // the ground keeps its size about the footprint's centre; what belongs to the building is
      // 1.3 times as large
      const centre = fp.centre.map((v) => (v * size) / 2);
      const ground = ([x, y]) => [
        centre[0] + (x - fp.centre[0]) / 2,
        centre[1] + (y - fp.centre[1]) / 2,
      ];
      const built = ([x, y]) => [(x * size) / 2, (y * size) / 2];
      expect(at(lookOpen, ...ground(diamond(fp, rot).s)), `r${rot}`).toEqual(SHEET.outline);
      expect(at(lookOpen, ...built(wallBase(fp, rot).s)), `r${rot}`).toEqual(SHEET.walls);
      expect(at(lookOpen, ...built(project(fp, 0, 0, b.z1))), `r${rot}`).toEqual(SHADE.top);
      for (const o of openingsOf('t2x2', rot))
        expect(at(lookOpen, ...built(o.pts[3])), `r${rot}`).toEqual(SHEET.openings);
      // a point on the ground: `along` the portal wall from its middle, `out` from the footprint's
      // centre towards that wall (tiles)
      const on = (along, out) =>
        ground(wall === 0 ? project(fp, along, out) : project(fp, out, along));
      const foot = (wall === 0 ? b.y1 : b.x1) * size;
      // the game's tracks: through the middle of each of the footprint's two rows of tiles
      for (const lane of [-0.5, 0.5])
        for (const look of [lookClosed, lookOpen])
          expect(at(look, ...on(lane, foot + 0.3)), `r${rot} lane ${lane}`).toEqual(SHEET.bed);
      // and a track runs into its portal: a little inside the wall the ground shows through
      // the open portal, and a wall or a floor painted there hides it
      expect(at(lookClosed, ...on(0.5, foot - 0.3)), `r${rot}`).not.toEqual(SHEET.bed);
      expect(at(lookOpen, ...on(0.5, foot - 0.3)), `r${rot}`).toEqual(SHEET.bed);
    }
    // a family the game draws at its footprint's own size is laid out as before
    const plain = drawLook(painted('t1', 0), 't1', 0, { size: 1 });
    expect([plain.width, plain.height]).toEqual([512, 512]);
  });

  it('knows which picture a file is, wherever it lies and whichever attempt it is', () => {
    expect(lookedAt('assets/source/buildings-v2/depot/depot-a3-r2.png')).toEqual({
      family: 'depot',
      age: 3,
      rot: 2,
    });
    expect(lookedAt('assets/source/buildings-v2/.tries/depot-a0-r1-2.png')).toMatchObject({
      family: 'depot',
      age: 0,
      rot: 1,
    });
    expect(lookedAt('C:\\x\\depot_narrow-a1-r3.before.png')).toMatchObject({
      family: 'depot_narrow',
      rot: 3,
    });
    expect(lookedAt('depot/depot-a0-r0.rejected.png')).toMatchObject({ family: 'depot', rot: 0 });
    expect(lookedAt('depot/depot-a0-r0.rejected.2.png')).toMatchObject({ family: 'depot', rot: 0 });
    expect(lookedAt('depot/depot-a4-r1.before.1.png')).toMatchObject({ age: 4, rot: 1 });
    expect(lookedAt('notes.png')).toBeNull();
    // each is shown under its own name, so attempts can be told apart
    expect(lookFile('assets/source/buildings-v2/.tries/depot-a0-r1-2.png')).toBe(
      'assets/source/buildings-v2/.look/depot-a0-r1-2.png',
    );
    expect(lookFile('C:\\x\\depot-a0-r1.before.png')).toBe(
      'assets/source/buildings-v2/.look/depot-a0-r1.before.png',
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
    expect(html).toContain('2 of 548 made');
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

  it('shows in the index where the camera is off: what was kept, and what is painted again', () => {
    const queue = buildQueue(inv, fam);
    setStatus(queue, 'depot-a0-r0', 'generated');
    Object.assign(queue.entries[1], {
      status: 'generated',
      attempts: 3,
      note: 'kept with its camera off by 4.6° after 3 attempts',
      kept: true,
    });
    Object.assign(queue.entries[2], { note: 'The camera is too low.', repaint: true });
    const fit = (measured) => ({
      method: 'base',
      sure: [true, true],
      measured,
      area: 10000,
      vertical: 1,
      scale: 1,
    });
    const turned = 'camera off by 4.6°: the building is turned 4.6° towards its lower-right wall';
    const low = 'camera off by 6.4°: it looks down from 23.6° where the game looks down from 30°';
    const report = {
      checked: 3,
      failed: 1,
      pictures: {
        'depot-a0-r0': { ok: true, problems: [], notes: [], fit: fit([0.52, -0.47]) },
        'depot-a0-r1': {
          ok: true,
          problems: [],
          notes: [`${turned}; kept, and corrected by the tools`],
          fit: fit([0.58, -0.42]),
        },
        'depot-a0-r2': { ok: false, problems: [low], fit: fit([0.4, -0.4]) },
      },
    };
    const there = (file) =>
      !file.startsWith('assets/source/buildings-v2/') ||
      /depot-a0-r[01]\.png$/.test(file) ||
      file.endsWith('depot-a0-r2.before.png');
    const html = indexHtml(inv, queue, report, progress(queue, inv, fam, there));
    expect(html).toContain('2 of 24 made, 1 kept with the camera off, 1 to paint again.');
    // the angles table marks a camera further than two degrees from the game's
    expect(html).toContain("further than 2° from the game's");
    expect(html).toMatch(/<td class="">0\.52 \/ -0\.47<\/td>/);
    expect(html).toMatch(/<td class="off">0\.58 \/ -0\.42<\/td>/);
    expect(html).toMatch(/<td class="off">0\.40 \/ -0\.40<\/td>/);
    // the kept picture is one to look at; the one painted again is named with its reason
    expect(html).toContain(`<li class="note"><code>depot-a0-r1</code>: ${turned}; kept`);
    expect(html).toContain(`<li class="note"><code>depot-a0-r2</code> to paint again: ${low}</li>`);
    expect(html).not.toMatch(/depot-a0-r2<\/code> pending/);
  });
});
