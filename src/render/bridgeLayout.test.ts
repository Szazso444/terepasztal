import { describe, expect, it } from 'vitest';
import { MeshSimple, Texture, type Container } from 'pixi.js';
import {
  bridgeJoins,
  bridgePlan,
  deckAt,
  deckSamples,
  DECK_SAMPLES,
  type BridgePlan,
  type BridgeSite,
  type Joins,
  type Rect,
} from './bridgeLayout';
import { bridgeTileMeshes, WATERLINE, type BridgeSurfaces } from './bridgeMeshes';
import { lineSpans, railLevel, type RailBed } from '../world/railProfile';
import { tileToWorld } from '../engine/iso';

const W = 64;
const N = 0,
  E = 1,
  S = 2;
type Site = BridgeSite & { water?: boolean };
/** A straight span along x (axis 1) or y (axis 0) with a level deck at `z` px. */
const span = (x: number, y: number, axis: 0 | 1 = 1, z = 20, more: Partial<Site> = {}): Site => ({
  x,
  y,
  material: 'stone',
  axis,
  deck: DECK_SAMPLES.map(() => z),
  ...more,
});
const pad = (x: number, y: number, z = 20, more: Partial<Site> = {}): Site => ({
  x,
  y,
  material: 'stone',
  axis: null,
  deck: [z],
  ...more,
});
/** Every tile's plan, from the joins the sites make together. */
function plans(sites: Site[]) {
  const joins = bridgeJoins(sites, W);
  return sites.map((s) => {
    const j = joins.get(s.y * W + s.x)!;
    return { site: s, joins: j, plan: bridgePlan(s, j, !!s.water) };
  });
}
/** A plan's rect in map coordinates. */
const onMap = (s: BridgeSite, r: Rect): Rect => ({
  x0: s.x + r.x0,
  x1: s.x + r.x1,
  y0: s.y + r.y0,
  y1: s.y + r.y1,
});
const parapetSides = (s: BridgeSite, p: BridgePlan): string[] =>
  p.parapets.map((r) => {
    const m = onMap(s, r);
    return m.y1 <= s.y - 0.4 ? 'N' : m.y0 >= s.y + 0.4 ? 'S' : m.x1 <= s.x - 0.4 ? 'W' : 'E';
  });

describe('bridge adjacency', () => {
  it('a lone span walls both long sides and stands on two support lines', () => {
    for (const axis of [0, 1] as const)
      for (const [material, water] of [
        ['stone', false],
        ['stone', true],
        ['wood', false],
        ['wood', true],
      ] as const) {
        const [t] = plans([span(5, 5, axis, 20, { material, water })]);
        expect(t.joins).toEqual([false, false, false, false]);
        expect(parapetSides(t.site, t.plan).sort()).toEqual(axis === 1 ? ['N', 'S'] : ['E', 'W']);
        const lines = material === 'wood' ? t.plan.trestles : water ? t.plan.arches : t.plan.piers;
        expect(lines.length).toBe(2);
      }
  });

  it('side-by-side spans merge: one deck, outer parapets only, shared supports', () => {
    for (const n of [2, 3, 4])
      for (const [material, water] of [
        ['stone', false],
        ['stone', true],
        ['wood', false],
        ['wood', true],
      ] as const) {
        const rows = plans(
          Array.from({ length: n }, (_, i) => span(5, 5 + i, 1, 20, { material, water })),
        );
        // Parapets on the outermost long sides and nowhere between the tracks.
        expect(rows.flatMap((r) => parapetSides(r.site, r.plan))).toEqual(['N', 'S']);
        expect(parapetSides(rows[0].site, rows[0].plan)).toEqual(['N']);
        expect(parapetSides(rows[n - 1].site, rows[n - 1].plan)).toEqual(['S']);
        // Support lines: the two outer ones and one under each seam, never two in one place.
        const across =
          material === 'wood'
            ? rows.flatMap((r) => r.plan.trestles.map((w) => r.site.y + w))
            : water
              ? rows.flatMap((r) => r.plan.arches.map((w) => r.site.y + w))
              : null;
        if (across) {
          expect(across.length).toBe(n + 1);
          expect(new Set(across.map((v) => v.toFixed(3))).size).toBe(n + 1);
          for (let i = 0; i < n - 1; i++) expect(across).toContainEqual(5 + i + 0.5);
        } else {
          // Stone piers over land run across all the tracks without a break.
          for (const l of [-0.38, 0.38]) {
            const walls = rows
              .flatMap((r) => r.plan.piers.map((q) => onMap(r.site, q)))
              .filter((q) => Math.abs((q.x0 + q.x1) / 2 - (5 + l)) < 1e-9)
              .sort((a, b) => a.y0 - b.y0);
            expect(walls.length).toBe(n);
            for (let i = 1; i < n; i++) expect(walls[i].y0).toBeCloseTo(walls[i - 1].y1, 9);
          }
        }
      }
  });

  it('a longer bridge keeps its wall where the shorter one ends', () => {
    // Row 6 runs from x = 3 to 8, row 5 beside it only from 4 to 7.
    const sites = [
      ...[4, 5, 6, 7].map((x) => span(x, 5)),
      ...[3, 4, 5, 6, 7, 8].map((x) => span(x, 6)),
    ];
    for (const t of plans(sites)) {
      const sides = parapetSides(t.site, t.plan);
      if (t.site.y === 5) expect(sides).toEqual(['N']);
      else expect(sides).toEqual(t.site.x === 3 || t.site.x === 8 ? ['N', 'S'] : ['S']);
    }
  });

  it('does not merge different materials, crossing directions or decks at different heights', () => {
    const cases: [Site, Site][] = [
      [span(5, 5), span(5, 6, 1, 20, { material: 'wood' })],
      [span(5, 5, 1), span(5, 6, 0)],
      [span(5, 5, 1, 20), span(5, 6, 1, 21)],
    ];
    for (const pair of cases)
      for (const t of plans(pair)) expect(parapetSides(t.site, t.plan).length).toBe(2);
    // Within half a pixel the decks still meet.
    for (const t of plans([span(5, 5, 1, 20), span(5, 6, 1, 20.4)]))
      expect(parapetSides(t.site, t.plan).length).toBe(1);
  });

  it('a block of pads under a curve shares one deck, walls its free edges and one pier grid', () => {
    // A 2 x 2 curve: the track enters the block from the west at (4, 4) and leaves south at (5, 5).
    const block = [
      pad(4, 4, 20, { open: [false, true, false, true] }),
      pad(5, 4, 20, { open: [false, false, true, true] }),
      pad(4, 5, 20),
      pad(5, 5, 20, { open: [true, false, true, false] }),
    ];
    const ts = plans(block);
    const sides = ts.map((t) => parapetSides(t.site, t.plan).sort());
    expect(sides).toEqual([['N'], ['E', 'N'], ['S', 'W'], ['E']]);
    const piers = ts.flatMap((t) =>
      t.plan.piers.map((r) => {
        const m = onMap(t.site, r);
        return `${((m.x0 + m.x1) / 2).toFixed(2)},${((m.y0 + m.y1) / 2).toFixed(2)}`;
      }),
    );
    expect(piers.length).toBe(9);
    expect(new Set(piers).size).toBe(9);
    expect(piers).toContain('4.50,4.50');
  });

  it('a span running into a pad joins it, and their walls line up', () => {
    const ts = plans([span(4, 5, 1), pad(5, 5, 20, { open: [false, false, false, true] })]);
    expect(ts[0].joins[E]).toBe(true);
    expect(ts[1].joins[3]).toBe(true);
    const wall = (t: (typeof ts)[number], side: string) =>
      onMap(t.site, t.plan.parapets[parapetSides(t.site, t.plan).indexOf(side)]);
    for (const side of ['N', 'S']) {
      const a = wall(ts[0], side),
        b = wall(ts[1], side);
      expect([a.y0, a.y1]).toEqual([b.y0, b.y1]);
      expect(a.x1).toBeCloseTo(b.x0, 9);
    }
  });
});

describe('bridge deck geometry', () => {
  it('every deck covers its tile exactly, so neighbouring decks meet without gap or overlap', () => {
    const sites = [span(4, 5), span(5, 5), span(5, 6), pad(6, 5), pad(6, 6, 30)];
    for (const t of plans(sites)) {
      const m = onMap(t.site, t.plan.deck);
      expect([m.x0, m.x1, m.y0, m.y1]).toEqual([
        t.site.x - 0.5,
        t.site.x + 0.5,
        t.site.y - 0.5,
        t.site.y + 0.5,
      ]);
    }
  });

  it('follows the rail across a sloping bridge end and meets the next deck at the seam', () => {
    // Levels 0 0 2 2 2 2 . . . 0 0 0, bridged at 6 to 9: the deck holds level 2 and the last
    // bridge tile carries the start of the descent.
    const levels = [0, 0, 1, 2, 2, 2, 1, 0, 0, 0, 0, 0, 0],
      bridge = levels.map((_, i) => i >= 6 && i <= 9),
      { spans } = lineSpans(levels, bridge),
      bed: RailBed = { axis: 'x', spans, flat: false },
      step = 10,
      decks = levels.map((_, i) => ({ axis: 1 as const, deck: deckSamples(bed, i, step) }));
    expect(decks[9].deck[4]).toBeLessThan(decks[9].deck[0]);
    for (let i = 6; i <= 9; i++) {
      for (let l = -0.5; l <= 0.5; l += 1 / 64)
        expect(Math.abs(deckAt(decks[i], l) - railLevel(bed, i + l) * step)).toBeLessThan(0.25);
      if (i < 9) expect(deckAt(decks[i], 0.5)).toBeCloseTo(deckAt(decks[i + 1], -0.5), 9);
    }
  });
});

describe('bridge meshes', () => {
  const surfaces: BridgeSurfaces = {
    stoneTop: Texture.WHITE,
    stoneWall: Texture.WHITE,
    woodTop: Texture.WHITE,
    woodGrain: Texture.WHITE,
  };
  /** Screen points of every mesh in `c` whose label starts with `part`. */
  const points = (c: Container, part: string) =>
    c.children
      .filter((m): m is MeshSimple => m instanceof MeshSimple && m.label.startsWith(part))
      .flatMap((m) => {
        const v = m.geometry.positions,
          out: string[] = [];
        for (let i = 0; i < v.length; i += 2) out.push(`${v[i].toFixed(3)},${v[i + 1].toFixed(3)}`);
        return out;
      });
  const build = (sites: Site[], ground: (x: number, y: number) => number = () => 0) =>
    plans(sites).map((t) =>
      bridgeTileMeshes({ ...t.site, water: !!t.site.water, level: 1, ground }, t.plan, surfaces),
    );
  const seamPoint = (x: number, y: number, z: number) => {
    const p = tileToWorld(x, y);
    return `${p.x.toFixed(3)},${(p.y - z).toFixed(3)}`;
  };

  it('neighbouring deck tops share their seam corners, along and across a wide bridge', () => {
    const [a, b, c] = build([span(4, 5), span(5, 5), span(4, 6)]);
    const top = (m: { under: Container }) => points(m.under, 'deck:stoneTop');
    for (const corner of [seamPoint(4.5, 4.5, 20), seamPoint(4.5, 5.5, 20)]) {
      expect(top(a)).toContain(corner);
      expect(top(b)).toContain(corner);
    }
    for (const corner of [seamPoint(3.5, 5.5, 20), seamPoint(4.5, 5.5, 20)]) {
      expect(top(a)).toContain(corner);
      expect(top(c)).toContain(corner);
    }
  });

  it('draws no parapet on a merged edge, and near parapets in front of the trains', () => {
    for (const material of ['stone', 'wood'] as const) {
      const [far, mid, near] = build([0, 1, 2].map((i) => span(5, 5 + i, 1, 20, { material })));
      expect(points(far.under, 'parapet').length).toBeGreaterThan(0);
      expect(points(far.near, 'parapet').length).toBe(0);
      expect(points(mid.under, 'parapet').length + points(mid.near, 'parapet').length).toBe(0);
      expect(points(near.under, 'parapet').length).toBe(0);
      expect(points(near.near, 'parapet').length).toBeGreaterThan(0);
    }
  });

  it("buries a deck's end in the bank it meets and keeps its side over the water", () => {
    // A span over water from x = 3 to 5; the bank beyond x = 5.5 is at the deck's level.
    const ground = (x: number) => (x > 5.5 ? 0 : WATERLINE),
      ends = build(
        [3, 4, 5].map((x) => span(x, 5, 1, 0, { water: true })),
        (x) => ground(x),
      );
    // Between bridge tiles the end faces stay (the next deck covers them); at the bank, none.
    expect(points(ends[1].under, 'deck:stoneWall:right').length).toBeGreaterThan(0);
    expect(points(ends[2].under, 'deck:stoneWall:right').length).toBe(0);
    for (const t of ends) expect(points(t.under, 'deck:stoneWall:left').length).toBeGreaterThan(0);
  });

  it('sends the supports at the near end into the bank instead of over it', () => {
    // A span over water from x = 3 to 5 with the bank beyond x = 5.5 at the deck's level. The
    // bank's top covers, on screen, everything below its edge line: nothing behind it may be
    // drawn there.
    const a = tileToWorld(5.5, 0),
      b = tileToWorld(5.5, 10),
      edge = (sx: number) => a.y + ((sx - a.x) * (b.y - a.y)) / (b.x - a.x),
      vertices = (c: Container, part = '') =>
        c.children
          .filter((m): m is MeshSimple => m instanceof MeshSimple && m.label.startsWith(part))
          .flatMap((m) => {
            const v = m.geometry.positions,
              out: [number, number][] = [];
            for (let i = 0; i < v.length; i += 2) out.push([v[i], v[i + 1]]);
            return out;
          });
    for (const material of ['stone', 'wood'] as const) {
      const tiles = build(
        [3, 4, 5].map((x) => span(x, 5, 1, 0, { material, water: true })),
        (x) => (x > 5.5 ? 0 : WATERLINE),
      );
      for (const t of tiles)
        for (const [sx, sy] of [...vertices(t.under), ...vertices(t.near)])
          expect(sy, `${material} at ${sx}`).toBeLessThanOrEqual(edge(sx) + 0.05);
      // The last tile still stands on supports where the bank does not hide them.
      expect(vertices(tiles[2].under, 'support').length).toBeGreaterThan(0);
    }
  });

  it('cuts the piers to sloping ground: their faces end on it, never above or below', () => {
    // Ground rising along both axes under a merged pair of stone spans over land.
    const ground = (x: number, y: number) => (x - 4.5) * 8 + (y - 5) * 3;
    const sites = [span(5, 5, 1, 40), span(5, 6, 1, 40)],
      ts = plans(sites),
      meshes = build(sites, ground);
    ts.forEach((t, i) => {
      // The two faces the camera sees of each pier: +y (y = y1) and +x (x = x1), in map units.
      type Face = { alongX: boolean; at: number; from: number; to: number };
      const faces: Face[] = t.plan.piers.flatMap((r) => {
        const m = onMap(t.site, r);
        return [
          { alongX: true, at: m.y1, from: m.x0, to: m.x1 },
          { alongX: false, at: m.x1, from: m.y0, to: m.y1 },
        ];
      });
      const bottoms = new Map<string, number>();
      let n = 0;
      // Screen (sx, sy) of map (tx, ty, z): sx = (tx - ty) * 32, sy = (tx + ty) * 16 - z.
      const unproject = (f: Face, sx: number, sy: number) => {
        const tx = f.alongX ? f.at + sx / 32 : f.at,
          ty = f.alongX ? f.at : f.at - sx / 32;
        return { tx, ty, along: f.alongX ? tx : ty, z: (tx + ty) * 16 - sy };
      };
      for (const c of meshes[i].under.children) {
        if (!(c instanceof MeshSimple) || !c.label.startsWith('support:stoneWall')) continue;
        const v = Array.from(c.geometry.positions),
          xs = v.filter((_, k) => k % 2 === 0),
          // The +y faces are lit (left), the +x faces shaded (right); one face per mesh.
          fits = faces
            .map((f, fi) => ({ f, fi }))
            .filter(({ f }) => f.alongX === c.label.endsWith(':left'))
            .filter(({ f }) =>
              xs.every((sx) => {
                const a = unproject(f, sx, 0).along;
                return a >= f.from - 1e-6 && a <= f.to + 1e-6;
              }),
            );
        expect(fits.length).toBe(1);
        const { f, fi } = fits[0];
        for (let k = 0; k < v.length; k += 2) {
          const p = unproject(f, v[k], v[k + 1]),
            gap = p.z - ground(p.tx, p.ty),
            key = `${fi}:${p.along.toFixed(4)}`;
          expect(gap).toBeGreaterThanOrEqual(-0.05);
          bottoms.set(key, Math.min(bottoms.get(key) ?? Infinity, gap));
          n++;
        }
      }
      expect(n).toBeGreaterThan(0);
      // Wherever a face has an edge, its lowest point is on the ground.
      for (const [key, gap] of bottoms) expect(Math.abs(gap), key).toBeLessThan(0.05);
    });
  });
});

it('joins are symmetric', () => {
  const sites = [span(4, 5), span(5, 5), span(4, 6), pad(5, 6), span(6, 5, 0), pad(6, 6, 30)];
  const joins = bridgeJoins(sites, W);
  const DX = [0, 1, 0, -1],
    DY = [-1, 0, 1, 0];
  for (const s of sites) {
    const j: Joins = joins.get(s.y * W + s.x)!;
    for (let d = 0; d < 4; d++) {
      const n = joins.get((s.y + DY[d]) * W + s.x + DX[d]);
      expect(j[d]).toBe(!!n && n[(d + 2) % 4]);
    }
  }
  expect(joins.get(5 * W + 4)![S]).toBe(true);
  expect(joins.get(5 * W + 4)![N]).toBe(false);
});
