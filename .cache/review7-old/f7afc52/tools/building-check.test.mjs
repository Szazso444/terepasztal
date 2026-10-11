import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { FOOTPRINTS, ROTATIONS, project } from './building-kit.mjs';
import { blockOf, boxFaces, fillPoly, drawGuide, openingsOf } from './building-guides.mjs';
import { checkPicture, pictureOf, summarise } from './building-check.mjs';

/**
 * A stand-in picture: the guide's block as a painted building. By default it stands on the ground
 * of its footprint; `block` takes another box, `map` moves every canvas point, `canvas` is the
 * size of the picture. A depot's portals are open to the ground, as the game needs them, unless
 * `closed` says otherwise (true, or one answer for each portal). `ground` says how: the open
 * ground runs along the portal's foot from `from` to `to` (shares of the portal's width, the
 * door posts left standing), reaches `deep` above the foot and starts `lift` above it (both as
 * shares of the portal's width); `wedge` makes it a wedge, as a real hall shows its floor: no
 * depth at `from`, `deep` at `to`. One answer for all portals, or one each. `after` paints over
 * the finished picture.
 */
function picture(fpId, rot, o = {}) {
  const fp = FOOTPRINTS[fpId];
  const [w, h] = o.canvas ?? fp.canvas;
  const png = new PNG({ width: w, height: h });
  if (o.background) png.data.fill(200);
  const map = o.map ?? ((p) => p);
  const b = blockOf(fpId, rot);
  const faces = boxFaces(fp, { ...b, z0: 0, ...o.block });
  const shade = { top: [220, 210, 180], left: [160, 120, 90], right: [110, 80, 60] };
  o.under?.(png, fp, map);
  for (const [name, pts] of Object.entries(faces))
    fillPoly(png, pts.map(map), shade[name], o.alpha ?? 255);
  o.over?.(png, fp, map);
  // the ground inside each portal: nothing painted for the lower part of the opening. The guide
  // has its openings on the plinth; the picture's block stands on the ground
  const down = fp.scale * (b.z0 - (o.block?.z0 ?? 0));
  openingsOf(fpId, rot)
    .filter((op) => op.kind === 'side')
    .forEach((op, i) => {
      if (o.closed === true || o.closed?.[i]) return;
      const g = (Array.isArray(o.ground) ? o.ground[i] : o.ground) ?? {};
      const { from = 0.15, to = 0.85, deep = 0.7, lift = 0, wedge = false } = g;
      const part = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      const [a0, c0] = op.pts.map(([x, y]) => [x, y + down]);
      const wide = Math.abs(c0[0] - a0[0]);
      const [a, c] = [part(a0, c0, from), part(a0, c0, to)];
      const up = ([x, y], share) => [x, y - wide * share];
      const open = [up(a, lift), up(c, lift), up(c, deep), ...(wedge ? [] : [up(a, deep)])];
      fillPoly(png, open.map(map), [0, 0, 0], 0);
    });
  o.after?.(png, fp, map);
  return png;
}
/** Scale a picture's contents about a point and move them. */
const moved =
  (k, [cx, cy], [dx, dy] = [0, 0]) =>
  ([x, y]) => [cx + (x - cx) * k + dx, cy + (y - cy) * k + dy];

describe('building check', () => {
  it('passes a building that stands on its footprint, for every footprint and rotation', () => {
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS)
        expect(
          checkPicture(picture(fp.id, r.index), fp.id, r.index),
          `${fp.id} r${r.index}`,
        ).toMatchObject({ ok: true, problems: [], notes: [] });
  });

  it("passes the guide's own block, painted where the guide draws it", () => {
    // on the plinth, as every guide shows it: a picture that keeps its guide's place must pass
    for (const fp of Object.values(FOOTPRINTS))
      for (const r of ROTATIONS) {
        const kept = picture(fp.id, r.index, { block: blockOf(fp.id, r.index) });
        expect(checkPicture(kept, fp.id, r.index), `${fp.id} r${r.index}`).toMatchObject({
          ok: true,
          problems: [],
        });
      }
  });

  it('passes a building drawn larger, off centre and on a canvas of its own', () => {
    // the pilot: generators fill the canvas and choose its size themselves
    const big = picture('t2x2', 0, { map: moved(1.5, FOOTPRINTS.t2x2.centre, [20, -20]) });
    const r = checkPicture(big, 't2x2', 0);
    expect(r).toMatchObject({ ok: true, problems: [] });
    expect(Math.abs(r.fit.scale - 1 / 1.5)).toBeLessThan(0.01);
    const square = picture('t1x2', 0, {
      canvas: [1254, 1254],
      map: moved(1.3, FOOTPRINTS.t1x2.centre, [110, 60]),
    });
    expect(checkPicture(square, 't1x2', 0)).toMatchObject({ ok: true, problems: [] });
  });

  it('wants a picture large enough to work from', () => {
    const small = picture('t1', 0, {
      canvas: [600, 900],
      map: moved(0.55, [512, 832], [-212, -300]),
    });
    expect(checkPicture(small, 't1', 0)).toEqual({
      ok: false,
      problems: ['picture is 600x900; its short side must be at least 768 px'],
    });
  });

  it('wants a transparent background, and says only that', () => {
    expect(checkPicture(picture('t1', 0, { background: true }), 't1', 0)).toEqual({
      ok: false,
      problems: ['background is not transparent'],
    });
  });

  it('wants the building large enough in its picture', () => {
    const r = checkPicture(picture('t1', 0, { map: moved(0.3, [512, 832]) }), 't1', 0);
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(
      /^too small in the picture: its foot is 13[0-9] px wide, at least 226 px are needed$/,
    );
  });

  it('wants the whole building inside the picture', () => {
    const r = checkPicture(picture('t1', 0, { map: moved(1, [512, 832], [290, 0]) }), 't1', 0);
    expect(r.problems).toContain('touches the right edge');
    const tall = picture('t1', 0, { block: { z1: 110 } });
    expect(checkPicture(tall, 't1', 0).problems).toContain('touches the top edge');
  });

  it('wants solid surfaces and something to look at', () => {
    expect(checkPicture(picture('t1', 0, { alpha: 150 }), 't1', 0).problems).toContain(
      'mostly translucent',
    );
    const empty = new PNG({ width: 1024, height: 1024 });
    expect(checkPicture(empty, 't1', 0)).toEqual({ ok: false, problems: ['empty picture'] });
  });

  it('fails a shadow or glow on the ground around the building', () => {
    // a soft shadow spilling out of the footprint to the lower right
    const under = (png, fp, map) =>
      fillPoly(
        png,
        [
          [512, 800],
          [900, 800],
          [900, 990],
          [512, 990],
        ].map(map),
        [20, 20, 20],
        100,
      );
    const r = checkPicture(picture('t1', 0, { under }), 't1', 0);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/^a translucent shadow or glow surrounds the building/);
  });

  it('fails a guide that came back unpainted', () => {
    const r = checkPicture(drawGuide('t1', 0), 't1', 0);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('still grey: not painted');
  });

  it("fails a picture that is not in the game's view", () => {
    // seen straight from the front: the foot is one level line
    const front = new PNG({ width: 1024, height: 1024 });
    fillPoly(
      front,
      [
        [262, 400],
        [762, 400],
        [762, 880],
        [262, 880],
      ],
      [160, 120, 90],
    );
    expect(checkPicture(front, 't1', 0).problems).toEqual([
      "not the game's view: the building's foot is a level line, as if seen from the front",
    ]);
    // far too flat a camera: ground lines at 0.2 instead of 0.5
    const flat = picture('t1', 0, { map: ([x, y]) => [x, 832 + (y - 832) * 0.4] });
    expect(checkPicture(flat, 't1', 0).problems).toEqual([
      "not the game's view: the lower-left wall's ground line slopes 0.20, the game's 0.50",
      "not the game's view: the lower-right wall's ground line slopes -0.20, the game's -0.50",
    ]);
  });

  /** a picture of the block with every point moved: how a camera that is off draws it */
  const seen = (map, o = {}) => checkPicture(picture('t1', 0, { map, ...o }), 't1', 0, o.check);
  const lower = ([x, y]) => [x, 832 + (y - 832) * 0.8];

  it("fails a picture whose camera is not the game's, and says what to ask for next", () => {
    // seen from too low, both wall feet too flat: 0.5 x 0.8 = 0.4 is 23.6 degrees
    const low = seen(lower);
    expect(low.ok).toBe(false);
    expect(low.problems).toEqual([
      "camera off by 6.4°: it looks down from 23.6° where the game looks down from 30° (the wall feet slope 0.40 and -0.40, the game's 0.50 and -0.50)",
    ]);
    expect(low.camera.by).toBe(6.4);
    // for the next attempt, which is painted from this one straightened: what was wrong with it.
    // Not what to do about it: told to look down more steeply, a generator overshoots
    expect(Object.keys(low.camera)).toEqual(['by', 'was']);
    expect(low.camera.was).toBe(
      'It was painted from too low a camera, so too little of its roof showed. The reference shows it put right: paint it as the reference and the block-out are seen.',
    );
    // seen from too high: 0.5 x 1.2 = 0.6 is 36.9 degrees
    const high = seen(([x, y]) => [x, 832 + (y - 832) * 1.2], { block: { z1: 30 } });
    expect(high.problems).toEqual([
      "camera off by 6.9°: it looks down from 36.9° where the game looks down from 30° (the wall feet slope 0.60 and -0.60, the game's 0.50 and -0.50)",
    ]);
    expect(high.camera.was).toMatch(
      /^It was painted from too high a camera, so too much of its roof showed\. /,
    );
    // turned towards its lower-right wall: that wall's foot flatter, the other steeper
    const right = seen(([x, y]) => [x, y + (x - 512) * 0.08]);
    expect(right.problems).toHaveLength(1);
    expect(right.problems[0]).toMatch(
      /^camera off by 4\.\d°: the building is turned 4\.\d° towards its lower-right wall \(the wall feet slope 0\.58 and -0\.42, the game's 0\.50 and -0\.50\)$/,
    );
    expect(right.camera.was).toMatch(
      /^It was painted turned, its lower-right wall facing the viewer too much\. /,
    );
    const left = seen(([x, y]) => [x, y - (x - 512) * 0.08]);
    expect(left.problems[0]).toMatch(/the building is turned 4\.\d° towards its lower-left wall/);
    expect(left.camera.was).toMatch(
      /^It was painted turned, its lower-left wall facing the viewer too much\. /,
    );
    // both at once: said in one line, and both asked for
    const both = seen(([x, y]) => [x, 832 + (y - 832) * 0.8 + (x - 512) * 0.08]);
    expect(both.problems).toHaveLength(1);
    expect(both.problems[0]).toMatch(
      /^camera off by 6\.\d°: it looks down from 23\.\d° where the game looks down from 30° and the building is turned 5\.\d° towards its lower-right wall \(/,
    );
    expect(both.camera.was).toMatch(
      /^It was painted from too low a camera, so too little of its roof showed, and turned, its lower-right wall facing the viewer too much\. /,
    );
  });

  it("passes a camera within two degrees of the game's", () => {
    // 0.5 x 0.96 = 0.48 is 28.7 degrees; and one wall's foot a little flat
    for (const map of [
      ([x, y]) => [x, 832 + (y - 832) * 0.96],
      ([x, y]) => [x, y - Math.max(0, 512 - x) * 0.05],
    ]) {
      const r = seen(map);
      expect(r).toMatchObject({ ok: true, problems: [], notes: [] });
      expect(r.camera).toBeUndefined();
    }
  });

  it('keeps a picture whose camera is off when told to, and says so', () => {
    // the closest of a picture's attempts: recorded, corrected by the tools, and marked
    const kept = seen(lower, { check: { camera: false } });
    expect(kept).toMatchObject({ ok: true, problems: [] });
    expect(kept.notes).toEqual([
      "camera off by 6.4°: it looks down from 23.6° where the game looks down from 30° (the wall feet slope 0.40 and -0.40, the game's 0.50 and -0.50); kept, and corrected by the tools",
    ]);
    expect(kept.camera.by).toBe(6.4);
    // further off than the tools correct: said too
    const far = seen(([x, y]) => [x, 832 + (y - 832) * 0.6], { check: { camera: false } });
    expect(far.notes[0]).toMatch(
      /^camera off by 12\.\d°: .*; kept, and corrected part of the way by the tools$/,
    );
    // a view that is no isometric picture at all is never kept
    const flat = seen(([x, y]) => [x, 832 + (y - 832) * 0.4], { check: { camera: false } });
    expect(flat.ok).toBe(false);
    expect(flat.problems[0]).toMatch(/^not the game's view/);
  });

  /** a straight wall on the lower left and a round bay on the lower right: one straight foot */
  const bay = (slope) => {
    const png = new PNG({ width: 1024, height: 1024 });
    const rise = 250 * slope;
    fillPoly(
      png,
      [
        [262, 800 - rise],
        [512, 800],
        [512, 400],
        [262, 400 - rise],
      ],
      [160, 120, 90],
    );
    const arc = Array.from({ length: 64 }, (_, i) => [
      512 + 250 * Math.cos((i / 64) * 2 * Math.PI),
      600 + 200 * Math.sin((i / 64) * 2 * Math.PI),
    ]);
    fillPoly(
      png,
      arc.filter(([x]) => x >= 511.5),
      [110, 80, 60],
    );
    return png;
  };

  it('judges the camera by one wall foot where only one is straight', () => {
    const fine = checkPicture(bay(0.5), 't1', 0);
    expect(fine).toMatchObject({ ok: true, problems: [] });
    expect(fine.fit.sure).toEqual([true, false]);
    expect(fine.notes).toEqual(['placed by its outline: no straight wall base was found']);
    // no camera near the game's draws a wall foot at 0.65
    const steep = checkPicture(bay(0.65), 't1', 0);
    expect(steep.ok).toBe(false);
    expect(steep.problems).toEqual([
      "camera off: the lower-left wall's foot slopes 0.65 where the game's slopes 0.50",
    ]);
    expect(steep.camera).toEqual({
      by: null,
      was: "Its lower-left wall's foot ran too steep. The reference shows it put right: paint it as the reference and the block-out are seen.",
    });
  });

  /**
   * A block with two dark portals painted on one of its visible walls (0 the lower-left, 1 the
   * lower-right), as a depot has them. `floor` paints the ground inside the portals over: true,
   * or one answer for each portal.
   */
  const portals = (fpId, rot, wall, { floor = false } = {}) =>
    picture(fpId, rot, {
      closed: floor,
      over: (png, fp) => {
        const b = blockOf(fpId, rot);
        for (const mid of [-0.5, 0.5]) {
          const a = (mid - 0.25) * (wall ? b.y1 : b.x1),
            c = (mid + 0.25) * (wall ? b.y1 : b.x1);
          const quad = wall
            ? [
                [b.x1, a, 0],
                [b.x1, c, 0],
                [b.x1, c, 30],
                [b.x1, a, 30],
              ]
            : [
                [a, b.y1, 0],
                [c, b.y1, 0],
                [c, b.y1, 30],
                [a, b.y1, 30],
              ];
          fillPoly(
            png,
            quad.map(([x, y, z]) => project(fp, x, y, z)),
            [30, 44, 34],
          );
        }
      },
    });

  it("wants a depot's portals in the wall the guide has them in", () => {
    // r0 and r2 show an end wall on the lower right, r1 and r3 on the lower left
    for (const [rot, wall] of [
      [0, 1],
      [1, 0],
      [2, 1],
      [3, 0],
    ]) {
      const names = ['lower-left', 'lower-right'];
      expect(checkPicture(portals('t2x2', rot, wall), 't2x2', rot), `r${rot}`).toMatchObject({
        ok: true,
        problems: [],
      });
      // the view of another rotation: in the game the rails would run into a blank wall
      const wrong = checkPicture(portals('t2x2', rot, 1 - wall), 't2x2', rot);
      expect(wrong.ok, `r${rot}`).toBe(false);
      expect(wrong.problems, `r${rot}`).toEqual([
        `the portals are in the ${names[1 - wall]} wall; they belong in the ${names[wall]} wall, where the block-out has them`,
      ]);
    }
    // a building with no portals may be dark on either wall
    expect(checkPicture(portals('t1', 0, 0), 't1', 0)).toMatchObject({ ok: true, problems: [] });
    // and a depot whose walls are much alike is left to the eye
    expect(checkPicture(picture('t2x2', 0), 't2x2', 0)).toMatchObject({ ok: true, problems: [] });
  });

  const NUM = '-?\\d\\.\\d\\d?';
  /** what the check asks for in a portal, whatever was wrong with it */
  const asked = (each) =>
    `Inside ${each} paint the hall's inner wall, in shadow, and leave out only the floor: the ground inside the portal and before it stays unpainted, about a third of the portal's height up`;
  const closedTo = (who, each) =>
    new RegExp(
      `^${who} not open to the ground \\(over a stretch 0\\.3 of the portal's width the ground is open ${NUM} of that width deep, and 0\\.3 is asked\\): a floor, a threshold, an apron, rails, a door leaf or a post stands where the game's rails run in, or the portal is too narrow\\. ${asked(each)}$`,
    );
  /** what the check says of portals closed to the ground: all of them, one of two, the only one */
  const CLOSED = {
    all: closedTo('the portals are', 'each portal'),
    left: closedTo('the left portal is', 'it'),
    right: closedTo('the right portal is', 'it'),
    only: closedTo('the portal is', 'it'),
  };
  const throughTo = (who, each) =>
    new RegExp(
      `^${who} seen right through \\(over ${NUM} of the portal's width\\): the inside of the hall is not painted\\. ${asked(each)}$`,
    );
  /** and of portals that are holes through the building */
  const THROUGH = {
    all: throughTo('the portals are', 'each portal'),
    left: throughTo('the left portal is', 'it'),
    right: throughTo('the right portal is', 'it'),
    only: throughTo('the portal is', 'it'),
  };
  /** the one thing a failed picture is told */
  const told = (r, words, label = '') => {
    expect(r.ok, label).toBe(false);
    expect(r.problems, label).toHaveLength(1);
    expect(r.problems[0], label).toMatch(words);
  };
  const FINE = { ok: true, problems: [], notes: [] };
  /** r0 and r2 show a depot's end wall on the lower right, r1 and r3 on the lower left */
  const END_WALLS = [
    [0, 1],
    [1, 0],
    [2, 1],
    [3, 0],
  ];
  /** where in the picture a wall's n-th opening of the guide is: the lower-right wall's run right to left */
  const sideOf = (wall, n) => (wall === 0 ? ['left', 'right'] : ['right', 'left'])[n];
  /** both depots, on both walls */
  const DEPOTS = [
    ['t2x2', 0],
    ['t2x2', 1],
    ['t1x2', 0],
    ['t1x2', 1],
  ];

  it("wants the ground inside a depot's portals left open, for the game's rails", () => {
    // the game lays its rails under the picture, through the portals. Four of the first depot's
    // pictures had a floor painted in the portals, and the rails did not show running in
    for (const [rot, wall] of END_WALLS) {
      const open = checkPicture(portals('t2x2', rot, wall), 't2x2', rot);
      expect(open, `r${rot}`).toMatchObject(FINE);
      // how deep the ground is open in each portal, as a share of the portal's width: recorded,
      // to two places
      expect(open.ground, `r${rot}`).toHaveLength(2);
      for (const share of open.ground) {
        expect(share, `r${rot}`).toBeCloseTo(0.7, 1);
        expect(share, `r${rot}`).toBe(Math.round(share * 100) / 100);
      }
      const floored = checkPicture(portals('t2x2', rot, wall, { floor: true }), 't2x2', rot);
      told(floored, CLOSED.all, `r${rot}`);
      for (const share of floored.ground) expect(Math.abs(share), `r${rot}`).toBeLessThan(0.03);
      // it is no fault of the camera: a picture kept with its camera off is held to it as well
      const low = { closed: true, map: ([x, y]) => [x, 760 + (y - 760) * 0.8] };
      const kept = checkPicture(picture('t2x2', rot, low), 't2x2', rot, { camera: false });
      told(kept, CLOSED.all, `r${rot}`);
      expect(kept.notes[0], `r${rot}`).toMatch(/^camera off by 6\.\d°/);
      // each portal has a track of its own: one of them closed fails the picture, and is named
      for (const n of [0, 1])
        told(
          checkPicture(portals('t2x2', rot, wall, { floor: [n === 0, n === 1] }), 't2x2', rot),
          CLOSED[sideOf(wall, n)],
          `r${rot} portal ${n}`,
        );
    }
    // a depot with no portals at all fails the same way
    told(checkPicture(picture('t2x2', 0, { closed: true }), 't2x2', 0), CLOSED.all);
    // drawn larger and off centre, the portals are found where the walls stand
    const big = { map: moved(1.5, FOOTPRINTS.t2x2.centre, [20, -20]) };
    expect(checkPicture(picture('t2x2', 0, big), 't2x2', 0)).toMatchObject({ ok: true, notes: [] });
    told(checkPicture(picture('t2x2', 0, { ...big, closed: true }), 't2x2', 0), CLOSED.all);
    // the narrow depot has one portal in each end wall
    for (const rot of [0, 1, 2, 3]) {
      const narrow = checkPicture(picture('t1x2', rot), 't1x2', rot);
      expect(narrow, `narrow r${rot}`).toMatchObject(FINE);
      expect(narrow.ground, `narrow r${rot}`).toHaveLength(1);
      told(
        checkPicture(picture('t1x2', rot, { closed: true }), 't1x2', rot),
        CLOSED.only,
        `narrow r${rot}`,
      );
    }
    // a building without portals has no such ground
    const plain = checkPicture(picture('t1', 0, { closed: true }), 't1', 0);
    expect(plain.ok).toBe(true);
    expect(plain).not.toHaveProperty('ground');
    expect(plain).not.toHaveProperty('through');
    // where the portals are in the wrong wall, that is the one thing said
    expect(checkPicture(portals('t2x2', 0, 0, { floor: true }), 't2x2', 0).problems).toEqual([
      'the portals are in the lower-left wall; they belong in the lower-right wall, where the block-out has them',
    ]);
  });

  it("measures a portal's open ground by the portal's own width: how deep, how wide", () => {
    // the limits, on both depots and both walls. Measured on the first depot's pictures: those
    // whose rails did not show were open 0 to 0.18 of a portal's width, the others 0.48 and more
    for (const [fpId, rot] of DEPOTS) {
      const seen = (ground) => checkPicture(picture(fpId, rot, { ground }), fpId, rot);
      const [said, which] = fpId === 't2x2' ? [CLOSED.all, 'portals'] : [CLOSED.only, 'portal'];
      const at = `${fpId} r${rot}`;
      const little = (share) =>
        new RegExp(
          `^the ground inside the ${which} is open only a little way in \\(${share} of the portal's width\\): see in the look picture that the rails run in$`,
        );
      // a floor painted a little way inside the portal hides the rails as well
      told(seen({ deep: 0.27 }), said, at);
      // open a little deeper than the limit: passed, and said, for the eye to judge
      for (const [deep, share] of [
        [0.33, '0\\.3\\d'],
        [0.42, '0\\.4[0-4]'],
      ]) {
        const r = seen({ deep });
        expect(r.ok, `${at} ${deep}`).toBe(true);
        expect(r.notes, `${at} ${deep}`).toHaveLength(1);
        expect(r.notes[0], `${at} ${deep}`).toMatch(little(share));
      }
      // nearly half the portal's width deep: nothing to say
      expect(seen({ deep: 0.48 }), at).toMatchObject(FINE);
      // a slit a fifth of the portal wide lets no track through
      told(seen({ from: 0.4, to: 0.6 }), said, at);
      // a quarter does, in the stand-in, whose open ground is as deep at its edges as in the
      // middle: a few columns of the stretch looked at may be shallower (a door post, a lamp)
      expect(seen({ from: 0.37, to: 0.63 }), at).toMatchObject(FINE);
      // a portal is seldom painted just where the block-out has it: it is looked for in its own
      // part of the wall, to either side of the block-out's
      for (const [from, to] of [
        [0.8, 1.3],
        [-0.3, 0.2],
      ])
        expect(seen({ from, to }), `${at} ${from}`).toMatchObject(FINE);
      // a threshold along the foot of the wall: the open ground behind it does not count
      told(seen({ lift: 0.08 }), said, at);
      // in a real hall the open ground is a wedge: the hall's inner wall stands on the floor
      // from the near door post inwards, so the ground is as deep as it is far from that post
      const hall = seen({ from: 0, to: 1, deep: 1, wedge: true });
      expect(hall, at).toMatchObject(FINE);
      for (const share of hall.ground) expect(share, at).toBeCloseTo(0.78, 1);
      // so a portal half as wide as the block-out's is too narrow for the track
      told(seen({ from: 0.25, to: 0.75, deep: 0.5, wedge: true }), said, at);
    }
  });

  it('takes the lowest thing painted in a column: an apron, a rail, a gap in the building', () => {
    const fp = FOOTPRINTS.t2x2;
    for (const [rot, wall] of END_WALLS) {
      const b = blockOf('t2x2', rot);
      // a point on the ground: `along` the portal wall from its middle, `out` before it (tiles)
      const on = (along, out) =>
        wall === 0 ? project(fp, along, b.y1 + out, 0) : project(fp, b.x1 + out, along, 0);
      const first = CLOSED[sideOf(wall, 0)];
      const slab = (png, at, out) =>
        fillPoly(
          png,
          [on(at - 0.25, 0), on(at + 0.25, 0), on(at + 0.25, out), on(at - 0.25, out)],
          [150, 150, 150],
        );
      // an apron before a portal hides the rails before they reach it
      const apron = picture('t2x2', rot, { after: (png) => slab(png, -0.5, 0.12) });
      told(checkPicture(apron, 't2x2', rot), first, `apron r${rot}`);
      // a deep apron before each portal: its front edges run in one line, further than the
      // wall's own foot shows, but the wall stands where the building's near corner is
      for (const out of [0.15, 0.25, 0.4]) {
        const aprons = picture('t2x2', rot, {
          after: (png) => [-0.5, 0.5].forEach((at) => slab(png, at, out)),
        });
        told(checkPicture(aprons, 't2x2', rot), CLOSED.all, `aprons ${out} r${rot}`);
      }
      // rails painted through the open ground are painted ground: the game lays its own
      const rails = picture('t2x2', rot, {
        after: (png) => {
          for (const at of [-0.61, -0.39])
            fillPoly(
              png,
              [on(at - 0.02, 0), on(at + 0.02, 0), on(at + 0.02, -0.6), on(at - 0.02, -0.6)],
              [58, 54, 50],
            );
        },
      });
      told(checkPicture(rails, 't2x2', rot), first, `rails r${rot}`);
      // a gap right through the building is no portal: an empty column is not open ground
      const gap = picture('t2x2', rot, {
        closed: true,
        after: (png) => {
          const x = Math.round(on(-0.5, 0)[0]);
          for (let y = 0; y < png.height; y++)
            for (let dx = -20; dx <= 20; dx++) png.data[(y * png.width + x + dx) * 4 + 3] = 0;
        },
      });
      told(checkPicture(gap, 't2x2', rot), CLOSED.all, `gap r${rot}`);
    }
  });

  it('does not take a hairline or a speck for a floor', () => {
    // paint a pixel or two thick hides no rail: a line along the foot of the wall across the
    // open portals, and stray pixels in the open ground, as a generator leaves them
    for (const [fpId, rot] of DEPOTS) {
      const fp = FOOTPRINTS[fpId];
      const down = fp.scale * blockOf(fpId, rot).z0;
      const sides = openingsOf(fpId, rot).filter((o) => o.kind === 'side');
      const dot = (png, x, y) => {
        const o = (Math.round(y) * png.width + Math.round(x)) * 4;
        png.data.set([90, 80, 70, 255], o);
      };
      const hairline = picture(fpId, rot, {
        after: (png) => {
          for (const o of sides) {
            const [a, c] = o.pts.map(([x, y]) => [x, y + down]);
            const [x0, x1] = [Math.min(a[0], c[0]), Math.max(a[0], c[0])];
            for (let x = x0; x <= x1; x++)
              dot(png, x, a[1] + ((c[1] - a[1]) * (x - a[0])) / (c[0] - a[0]) - 1);
          }
        },
      });
      expect(checkPicture(hairline, fpId, rot), `hairline ${fpId} r${rot}`).toMatchObject(FINE);
      const specks = picture(fpId, rot, {
        after: (png) => {
          for (const o of sides) {
            const [a, c] = o.pts.map(([x, y]) => [x, y + down]);
            const [x0, x1] = [Math.min(a[0], c[0]), Math.max(a[0], c[0])];
            for (let x = x0 + 3; x <= x1; x += 3)
              dot(
                png,
                x,
                a[1] + ((c[1] - a[1]) * (x - a[0])) / (c[0] - a[0]) - 4 - (Math.round(x) % 4) * 6,
              );
          }
        },
      });
      expect(checkPicture(specks, fpId, rot), `specks ${fpId} r${rot}`).toMatchObject(FINE);
    }
  });

  it('refuses a portal that is a hole right through the building', () => {
    // told to leave the ground "transparent from the foot of the wall upwards", the generator
    // emptied the whole portal: the rails showed, and the hall's inner walls were gone. The
    // user asked for those two pictures again. A portal is such a hole when the ground in it
    // is open a full portal's width deep over half the portal's width
    for (const [fpId, rot] of DEPOTS) {
      const seen = (ground) => checkPicture(picture(fpId, rot, { ground }), fpId, rot);
      const [said, which] = fpId === 't2x2' ? [THROUGH.all, 'portals'] : [THROUGH.only, 'portal'];
      const at = `${fpId} r${rot}`;
      const far = new RegExp(
        `^one sees far through the ${which} \\(over 0\\.[34]\\d? of the portal's width\\): see in the look picture that the hall's inner wall shows$`,
      );
      const hole = seen({ deep: 1.6 });
      told(hole, said, at);
      // how wide each portal is seen through, as a share of its width: recorded
      for (const share of hole.through) expect(share, at).toBeCloseTo(0.7, 1);
      for (const share of seen({}).through) expect(share, at).toBe(0);
      // the limits: seen through over more than half the portal's width it fails
      told(seen({ from: 0.23, to: 0.77, deep: 1.6 }), said, at);
      // over less it passes, and is said for the eye from three tenths on
      for (const [from, to] of [
        [0.27, 0.73],
        [0.33, 0.67],
      ]) {
        const r = seen({ from, to, deep: 1.6 });
        expect(r.ok, `${at} ${from}`).toBe(true);
        expect(r.notes, `${at} ${from}`).toHaveLength(1);
        expect(r.notes[0], `${at} ${from}`).toMatch(far);
      }
      expect(seen({ from: 0.37, to: 0.63, deep: 1.6 }), at).toMatchObject(FINE);
      // and a full portal's width deep: a little less is open ground, deep as it is
      expect(seen({ deep: 0.95 }), at).toMatchObject(FINE);
      told(seen({ deep: 1.05 }), said, at);
      // a real hall's wedge of open ground is that deep at its far end only
      expect(seen({ from: 0, to: 1, deep: 1.2, wedge: true }), at).toMatchObject(FINE);
    }
    // one of two is named
    for (const [rot, wall] of END_WALLS)
      for (const n of [0, 1])
        told(
          checkPicture(
            picture('t2x2', rot, {
              ground: [n === 0 ? { deep: 1.6 } : {}, n === 1 ? { deep: 1.6 } : {}],
            }),
            't2x2',
            rot,
          ),
          THROUGH[sideOf(wall, n)],
          `r${rot} portal ${n}`,
        );
  });

  it('leaves the portal of a wall without a straight foot to the eye', () => {
    // a narrow depot whose end wall is a round bay: there is no foot to measure the ground from
    const r = checkPicture(bay(0.5), 't1x2', 0);
    expect(r.ok).toBe(true);
    expect(r.fit.sure).toEqual([true, false]);
    expect(r.notes).toEqual([
      'the ground inside the portal was not measured: the wall it is in has no straight foot',
      'placed by its outline: no straight wall base was found',
    ]);
    expect(r).not.toHaveProperty('ground');
  });

  it('notes what a person should look at without failing the picture', () => {
    // a round tower: placed by its outline
    const tower = new PNG({ width: 1024, height: 1024 });
    const ring = (cy) =>
      Array.from({ length: 48 }, (_, i) => [
        512 + 200 * Math.cos((i / 48) * 2 * Math.PI),
        cy + 100 * Math.sin((i / 48) * 2 * Math.PI),
      ]);
    fillPoly(tower, ring(760), [200, 180, 150]);
    fillPoly(
      tower,
      [
        [312, 760],
        [712, 760],
        [712, 300],
        [312, 300],
      ],
      [200, 180, 150],
    );
    fillPoly(tower, ring(300), [230, 220, 200]);
    const t = checkPicture(tower, 't1', 0);
    expect(t.ok).toBe(true);
    expect(t.notes).toEqual(['placed by its outline: no straight wall base was found']);
    expect(t.fit.method).toBe('outline');
  });

  it('records how the picture is laid onto its footprint', () => {
    const r = checkPicture(picture('t2x2', 1), 't2x2', 1);
    expect(r.fit).toMatchObject({ method: 'base', vertical: 1, shear: 0 });
    expect(Object.keys(r.fit)).toEqual([
      'method',
      'sure',
      'measured',
      'slopes',
      'base',
      'scale',
      'vertical',
      'shear',
      'cx',
      'cy',
      'box',
      'camera',
      'area',
    ]);
  });

  it('knows a picture by its file name', () => {
    expect(pictureOf('assets/source/buildings-v2/power_plant/power_plant-a3-r2.png')).toEqual({
      id: 'power_plant-a3-r2',
      family: 'power_plant',
      age: 3,
      rot: 2,
    });
    expect(pictureOf('C:\\x\\depot_narrow-a0-r1.png').family).toBe('depot_narrow');
    expect(pictureOf('notes.png')).toBeNull();
    // a picture set aside after a rejection is not a picture of the list
    expect(pictureOf('depot/depot-a0-r1.rejected.png')).toBeNull();
  });

  it('adds new results to an earlier report', () => {
    const before = summarise({ 'depot-a0-r0': { ok: true, problems: [] } });
    expect(before).toMatchObject({ checked: 1, failed: 0 });
    const after = summarise({ 'depot-a0-r1': { ok: false, problems: ['too small'] } }, before);
    expect(after).toMatchObject({ checked: 2, failed: 1 });
    expect(Object.keys(after.pictures)).toEqual(['depot-a0-r0', 'depot-a0-r1']);
  });
});
