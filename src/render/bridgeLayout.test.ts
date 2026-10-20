import { describe, expect, it } from 'vitest';
import { Graphics, MeshSimple, Texture, type Container, type FillInstruction } from 'pixi.js';
import {
  bridgeJoins,
  bridgePlan,
  deckAt,
  deckAtOffset,
  deckSamples,
  DECK_SAMPLES,
  roadDeckSamples,
  type BridgePlan,
  type BridgeSite,
  type Joins,
  type Rect,
} from './bridgeLayout';
import {
  bridgeTileMeshes,
  GROUND_BOX,
  WATER_TILES,
  WATERLINE,
  type BridgeSurfaces,
} from './bridgeMeshes';
import { paintedWater, underPaintedWater } from './terrainMaterials';
import type { Rng } from '../engine/rng';
import { SEEDS, forAll, shrinkArray } from '../testing/property';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { lineSpans, railLevel, type RailBed } from '../world/railProfile';
import { TILE_H, tileToWorld, worldToTile } from '../engine/iso';

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

describe('bridge meshes over the painted waterline', () => {
  const surfaces: BridgeSurfaces = {
    stoneTop: Texture.WHITE,
    stoneWall: Texture.WHITE,
    woodTop: Texture.WHITE,
    woodGrain: Texture.WHITE,
  };
  const meshes = (c: Container) =>
    c.children.filter((m): m is MeshSimple => m instanceof MeshSimple);
  /** The meshes of every tile, cut to `ground` (and `top`, the highest it rises, if given). */
  const build = (sites: Site[], ground: (x: number, y: number) => number, top?: number) =>
    plans(sites).map((t) =>
      bridgeTileMeshes(
        { ...t.site, water: !!t.site.water, level: 1, ground, top },
        t.plan,
        surfaces,
      ),
    );
  /** The triangles of a mesh, as screen points. */
  const triangles = (m: MeshSimple) => {
    const v = m.geometry.positions,
      ix = m.geometry.indices,
      out: [number, number][][] = [];
    for (let i = 0; i < ix.length; i += 3)
      out.push([0, 1, 2].map((k) => [v[ix[i + k] * 2], v[ix[i + k] * 2 + 1]]));
    return out;
  };
  /** Screen points inside a triangle, on one quarter-pixel grid for all. */
  function* inside(tri: [number, number][]) {
    const [[ax, ay], [bx, by], [cx, cy]] = tri,
      d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(d) < 1e-9) return;
    for (let sy = Math.ceil(Math.min(ay, by, cy) * 4) / 4; sy <= Math.max(ay, by, cy); sy += 0.25)
      for (
        let sx = Math.ceil(Math.min(ax, bx, cx) * 4) / 4;
        sx <= Math.max(ax, bx, cx);
        sx += 0.25
      ) {
        const u = ((bx - sx) * (cy - sy) - (by - sy) * (cx - sx)) / d,
          v = ((cx - sx) * (ay - sy) - (cy - sy) * (ax - sx)) / d;
        if (u > 1e-6 && v > 1e-6 && 1 - u - v > 1e-6) yield [sx, sy] as const;
      }
  }
  /** A map with a river two tiles wide along y at x = 30, 31 and one along x at y = 20, 21. */
  const riverMap = () => {
    const m = emptyMap(4242, W, W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++)
        if (x === 30 || x === 31 || y === 20 || y === 21) m.terrain[y * W + x] = Terrain.Water;
    return m;
  };
  /** The ground bridges see on a flat map: the waterline where the painter paints water. */
  const painted = (m: ReturnType<typeof riverMap>) => (x: number, y: number) =>
    underPaintedWater(m, x, y) ? WATERLINE : 0;
  /** Lone spans across both rivers, over water, the track running on off both ends. */
  const crossings = (material: 'stone' | 'wood'): Site[] => [
    ...[30, 31].map((x) =>
      span(x, 10, 1, 0, { material, water: true, open: [false, true, false, true] }),
    ),
    ...[20, 21].map((y) =>
      span(10, y, 0, 0, { material, water: true, open: [true, false, true, false] }),
    ),
  ];
  const isUnder = (label: string) =>
    label.startsWith('support:') || (label.startsWith('deck:') && !label.endsWith(':top'));

  /**
   * The quarter pixels of every support and deck side that no deck top or parapet covers, each
   * with the map point the ground under it on screen shows on a flat map.
   */
  const shownUnder = (tiles: { under: Container; near: Container }[]) => {
    const all = tiles.flatMap((t) => [...meshes(t.under), ...meshes(t.near)]),
      covered = new Set<string>(),
      out: { label: string; x: number; y: number }[] = [];
    for (const c of all)
      if (c.label.endsWith(':top') || c.label.startsWith('parapet:'))
        for (const tri of triangles(c))
          for (const [sx, sy] of inside(tri)) covered.add(`${sx},${sy}`);
    for (const c of all) {
      if (!isUnder(c.label)) continue;
      for (const tri of triangles(c))
        for (const [sx, sy] of inside(tri))
          if (!covered.has(`${sx},${sy}`))
            out.push({ label: c.label, x: sx / 64 + sy / 32, y: sy / 32 - sx / 64 });
    }
    return out;
  };

  // slow because a whole crossing's meshes are rasterised to the quarter pixel for stone and wood
  // at two ground heights: 0.82 s alone, so a limit of 30 s
  it('shows nothing under a deck over ground painted as bank, only over painted water', () => {
    const m = riverMap();
    for (const material of ['stone', 'wood'] as const)
      for (const top of [undefined, 0]) {
        const shown = shownUnder(build(crossings(material), painted(m), top)),
          onBank = shown
            .filter((p) => paintedWater(m, p.x, p.y) === 0)
            .map((p) => `${p.label} at ${p.x.toFixed(3)},${p.y.toFixed(3)}`);
        expect(shown.length, material).toBeGreaterThan(1000);
        expect(onBank, `${material}, top ${top}`).toEqual([]);
      }
  }, 30_000);

  /**
   * A stone span over land at (5, 5) with its deck 20 px up, cut to `ground`: the foot of each
   * strip of its near pier's +x face (on x = 5.45), from one end to the other, as y along the
   * face and z up; and where, outside `skip`, a foot strays more than half a pixel from the
   * height the ground in front hides there (looked for every 1/16384 tile).
   */
  const pierFace = (ground: (x: number, y: number) => number, skip: (y: number) => boolean) => {
    const fx = 5.45,
      [tile] = build([span(5, 5, 1, 20)], ground),
      face = meshes(tile.under)
        .filter((c) => c.label === 'support:stoneWall:right')
        .at(-1)!,
      v = face.geometry.positions,
      at = (k: number) => {
        const y = fx - v[k * 2] / 32;
        return { y, z: (fx + y) * 16 - v[k * 2 + 1] };
      },
      hidden = (y: number) => {
        let h = ground(fx, y);
        for (let d = 1 / 16384; d <= 1.5; d += 1 / 16384)
          h = Math.max(h, ground(fx + d, y + d) - 32 * d);
        return h;
      },
      // Each strip's corners: top a, top b, bottom b, bottom a. Its foot runs from a to b.
      feet = Array.from({ length: v.length / 8 }, (_, q) => [at(q * 4 + 3), at(q * 4 + 2)]),
      strays: string[] = [];
    for (const [a, b] of feet)
      for (let k = 0; k <= 8; k++) {
        const y = a.y + ((b.y - a.y) * k) / 8,
          z = a.z + ((b.z - a.z) * k) / 8;
        if (!skip(y) && Math.abs(z - hidden(y)) > 0.5)
          strays.push(`${y.toFixed(4)}: ${z.toFixed(2)} vs ${hidden(y).toFixed(2)}`);
      }
    return { feet, strays };
  };

  it('drops a face straight where the ground in front of it ends, not in a slant over it', () => {
    // The pier stands over a ditch 40 px deep with a small bank in front: ground ahead of the
    // face hides it down to a height that changes along it, and jumps where the line of sight
    // starts to miss the bank (at y = 5.1). The line of sight is looked along every 1/32 tile, so
    // it may miss a sliver of the bank narrower than that: the drop stands within 1/32 of the jump.
    const bank = (x: number, y: number) => x >= 5.85 && x <= 6.15 && y >= 5.2 && y <= 5.5,
      jump = 5.1,
      { feet, strays } = pierFace(
        (x, y) => (bank(x, y) ? 0 : -40),
        (y) => y >= jump - 1 / 32 && y <= jump,
      ),
      drops = feet
        .filter(([a, b]) => Math.abs(a.z - b.z) > 20)
        .map(([a, b]) => Math.abs(b.y - a.y));
    expect(strays).toEqual([]);
    // One strip carries the drop from -12.8 to -40 px, over 1/256 tile at most.
    expect(drops.length).toBe(1);
    expect(drops[0]).toBeLessThanOrEqual(2 / 512);
  });

  it('cuts a face to a bank in front narrower than a quarter tile of it', () => {
    // A strip of bank running away from the face, seen only from y = 5.05 to 5.1 along it: the
    // face is split finely enough where ground in front may cut it to find it.
    const bank = (x: number, y: number) =>
        x - y >= 0.35 && x - y <= 0.4 && x + y >= 11 && x + y <= 11.4,
      { feet, strays } = pierFace(
        (x, y) => (bank(x, y) ? 0 : -40),
        (y) => Math.abs(y - 5.05) < 2 / 512 || Math.abs(y - 5.1) < 2 / 512,
      );
    expect(strays).toEqual([]);
    expect(feet.some(([a]) => a.y > 5.05 && a.y < 5.1 && a.z > -10)).toBe(true);
  });

  it('fades a foot into the water only where it shows down to the waterline all along its faces', () => {
    // A timber span over open water; a narrow bank ahead hides the far corner of one post's +x
    // face, though not the post's own foot point.
    const bank = (x: number, y: number) =>
        x - y >= 0.08 && x - y <= 0.2 && x + y > 11.2 && x + y < 11.6,
      fills = (ground: (x: number, y: number) => number) => {
        const [tile] = build([span(5, 5, 1, 0, { material: 'wood', water: true })], ground),
          fade = tile.under.children.find((c): c is Graphics => c instanceof Graphics)!;
        return fade.context.instructions.filter((i) => i.action === 'fill').length;
      };
    // Four posts, six bands each.
    expect(fills(() => WATERLINE)).toBe(24);
    expect(fills((x, y) => (bank(x, y) ? 0 : WATERLINE))).toBe(18);
  });

  it("rests the deck's end on the bank where the track leaves it, whatever water is painted there", () => {
    // A span over water from x = 3 to 5 with water beyond it too, and the track running on off
    // its +x end onto the tile x = 6: nothing under the deck shows over that tile, where the
    // line's bed carries on, and the deck's end face is buried in it.
    const endFace = (c: Container) =>
      meshes(c).some((m) => m.label.startsWith('deck:') && m.label.endsWith(':right'));
    for (const material of ['stone', 'wood'] as const) {
      const site = (x: number, open: boolean) =>
          span(x, 5, 1, 0, {
            material,
            water: true,
            open: open ? [false, true, false, true] : undefined,
          }),
        tiles = build(
          [3, 4, 5].map((x) => site(x, true)),
          () => WATERLINE,
        ),
        shown = shownUnder(tiles),
        onApproach = shown.filter((p) => p.x > 5.5 && Math.abs(p.y - 5) < 0.5);
      expect(onApproach.map((p) => `${p.label} at ${p.x.toFixed(3)},${p.y.toFixed(3)}`)).toEqual(
        [],
      );
      expect(endFace(tiles[2].under)).toBe(false);
      // The supports show over the water beside it.
      expect(shown.some((p) => p.x > 5.5)).toBe(true);
      // Where the track ends on the bridge, its end stands over the water and shows.
      const ending = build(
        [3, 4, 5].map((x) => site(x, false)),
        () => WATERLINE,
      );
      expect(endFace(ending[2].under)).toBe(true);
    }
  });

  // slow because the water and the meshes of one bridge tile are read again with each tile round its
  // window flipped between water and grass: 0.33 s alone, so a limit of 30 s
  it('reads the water of no tile outside WATER_TILES', () => {
    // Where a tile's faces read the ground (GROUND_BOX, and half a pixel below), the water painted
    // stays the same whatever lies on the tiles round its window, and so do its meshes: the mesh
    // key, which holds the water and paving of the window's tiles (worldRenderer.ts), covers all
    // it reads.
    const m = riverMap(),
      site = span(30, 10, 1, 0, { water: true, open: [false, true, false, true] }),
      [t] = plans([site]),
      [low, high] = GROUND_BOX,
      water = () => {
        let out = '';
        for (let y = site.y + low; y <= site.y + high + 1 / 64; y += 1 / 16)
          for (let x = site.x + low; x <= site.x + high + 1 / 64; x += 1 / 16)
            out += underPaintedWater(m, x, y) ? 1 : 0;
        return out;
      },
      draw = () =>
        meshes(
          bridgeTileMeshes(
            { ...site, water: true, level: 1, ground: painted(m), top: 0 },
            t.plan,
            surfaces,
          ).under,
        )
          .map((c) => `${c.label}:${Array.from(c.geometry.positions).join(',')}`)
          .join('|'),
      first = [water(), draw()],
      [from, to] = WATER_TILES,
      changed: string[] = [];
    for (let y = site.y + from - 2; y <= site.y + to + 2; y++)
      for (let x = site.x + from - 2; x <= site.x + to + 2; x++) {
        if (x >= site.x + from && x <= site.x + to && y >= site.y + from && y <= site.y + to)
          continue;
        const k = y * W + x,
          was = m.terrain[k];
        m.terrain[k] = was === Terrain.Water ? Terrain.Grass : Terrain.Water;
        if (water() !== first[0] || draw() !== first[1]) changed.push(`${x},${y}`);
        m.terrain[k] = was;
      }
    expect(changed).toEqual([]);
    // The window's own tiles do matter: a bank right in front of the near supports hides them.
    m.terrain[(site.y + 1) * W + site.x] = Terrain.Grass;
    expect(draw()).not.toBe(first[1]);
  }, 30_000);

  // Properties over seeded cases (docs/process/verification.md): a few bridge tiles round (8, 8),
  // spans along either axis and pads, stone and timber, over water and land, level and graded,
  // with any edges open, over the waterline with banks raised in it (slivers included).

  /** A bank over the water: a map rect and its plane, `z` px up at (x0, y0), rising gx, gy per tile. */
  interface Bank {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    z: number;
    gx: number;
    gy: number;
  }
  type Placed = Site & { level: number };
  interface Crossing {
    sites: Placed[];
    banks: Bank[];
    /** How far above the highest ground the bound given to the tiles stands. */
    slack: number;
  }
  const bankAt = (b: Bank, x: number, y: number) => b.z + b.gx * (x - b.x0) + b.gy * (y - b.y0);
  const onBank = (b: Bank, x: number, y: number) =>
    x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  /** The waterline, and over it each bank's plane where it stands highest. */
  const bankGround = (banks: Bank[]) => (x: number, y: number) => {
    let z = WATERLINE;
    for (const b of banks) if (onBank(b, x, y)) z = Math.max(z, bankAt(b, x, y));
    return z;
  };
  /** The highest the ground stands in GROUND_BOX of a tile: a plane peaks at a corner. */
  const bankTop = (banks: Bank[], s: Site) => {
    const [low, high] = GROUND_BOX;
    let top = WATERLINE;
    for (const b of banks) {
      const xs = [Math.max(s.x + low, b.x0), Math.min(s.x + high, b.x1)],
        ys = [Math.max(s.y + low, b.y0), Math.min(s.y + high, b.y1)];
      if (xs[0] > xs[1] || ys[0] > ys[1]) continue;
      for (const x of xs) for (const y of ys) top = Math.max(top, bankAt(b, x, y));
    }
    return top;
  };
  /**
   * A crossing whose banks are at least `thinnest` tile across, down to slivers by default. Half
   * the crossings are tiles alike, which merge into one bridge and stand supports on their seams.
   * Banks lie anywhere round the tiles, in front of one of them, or start on a tile edge.
   */
  function crossing(rng: Rng, thinnest = 0.02): Crossing {
    const kind = () => ({
        material: rng.pick(['stone', 'wood'] as const),
        water: rng.chance(0.6),
        level: rng.int(1, 3),
        z: rng.pick([0, 0, 8, 20, 40]),
        pad: rng.chance(0.3),
        axis: rng.pick([0, 1] as const),
        grade: rng.chance(0.5) ? 0 : rng.range(-12, 12),
      }),
      alike = rng.chance(0.5) ? kind() : undefined,
      sites: Placed[] = [],
      taken = new Set<number>();
    for (let n = rng.int(1, 4); n > 0; n--) {
      const x = rng.int(7, 9),
        y = rng.int(7, 9);
      if (taken.has(y * W + x)) continue;
      taken.add(y * W + x);
      const k = alike ?? kind(),
        more = {
          material: k.material,
          water: k.water,
          open: [0, 1, 2, 3].map(() => rng.chance(0.5)),
        };
      if (k.pad) sites.push({ ...pad(x, y, k.z, more), level: k.level });
      else {
        const deck = DECK_SAMPLES.map((l) => Math.max(k.water ? 0 : -40, k.z + k.grade * l));
        sites.push({ ...span(x, y, k.axis, k.z, { ...more, deck }), level: k.level });
      }
    }
    const size = () => (rng.chance(0.3) ? rng.range(thinnest, 0.1) : rng.range(0.1, 2));
    const banks = Array.from({ length: rng.int(0, 5) }, (): Bank => {
      const place = rng.int(0, 3),
        // a small bank right in front of a support's foot hides part of a face, not all of it
        w = place === 3 ? rng.range(thinnest, 0.06) : size(),
        h = place === 3 ? rng.range(thinnest, 0.06) : size();
      let x0 = rng.range(6, 11),
        y0 = rng.range(6, 11);
      if (place === 1 || place === 3) {
        // across the line of sight from a point of a tile (by a support's foot), `d` tiles ahead
        const s = rng.pick(sites),
          d = place === 3 ? rng.range(0.05, 0.6) : rng.range(0.05, 1.2),
          at = () =>
            place === 3
              ? rng.pick([-0.4, -0.38, 0.38, 0.4]) + rng.range(-0.06, 0.06)
              : rng.range(-0.6, 0.6);
        x0 = s.x + at() + d - w / 2;
        y0 = s.y + at() + d - h / 2;
      } else if (place === 2) {
        if (rng.chance(0.5)) x0 = Math.floor(x0) + 0.5;
        else y0 = Math.floor(y0) + 0.5;
      }
      return {
        x0,
        y0,
        x1: x0 + w,
        y1: y0 + h,
        z: rng.range(-24, 30),
        gx: rng.range(-10, 10),
        gy: rng.range(-10, 10),
      };
    });
    return { sites, banks, slack: rng.chance(0.5) ? 0 : rng.range(0, 20) };
  }
  function* shrinkCrossing(c: Crossing): Iterable<Crossing> {
    for (const sites of shrinkArray(c.sites)) if (sites.length) yield { ...c, sites };
    for (const banks of shrinkArray(c.banks)) yield { ...c, banks };
    if (c.slack) yield { ...c, slack: 0 };
  }
  /** Each tile of a crossing as bridgeTileMeshes takes it, cut to `ground`. */
  const tilesOf = (c: Crossing, ground: (x: number, y: number) => number) =>
    plans(c.sites).map((t) => ({
      tile: { ...t.site, water: !!t.site.water, level: (t.site as Placed).level, ground },
      plan: t.plan,
    }));
  /** How tall (px) the tallest strip of a mesh of walls stands: each quad is a top edge over its foot. */
  const tallest = (m: MeshSimple) => {
    const v = m.geometry.positions;
    let most = 0;
    for (let q = 0; q < v.length; q += 8)
      most = Math.max(most, v[q + 7] - v[q + 1], v[q + 5] - v[q + 3]);
    return most;
  };
  /**
   * The support meshes under a tile, each as its label and corners, and how many bands of water
   * fade it draws. A timber bent's cap beam, 2.5 px tall, by label only: its foot is the deck's,
   * which a bound may spare from being looked along, so its faces may be split otherwise.
   */
  const supportsOf = (under: Container) => {
    const fades = under.children
      .filter((g): g is Graphics => g instanceof Graphics)
      .map((g) => g.context.instructions.length);
    return [
      ...meshes(under)
        .filter((m) => m.label.startsWith('support:'))
        .map((m) =>
          tallest(m) <= 2.5 + 1e-3
            ? m.label
            : `${m.label} ${Array.from(m.geometry.positions).join(',')}`,
        ),
      `fades ${fades.join(',')}`,
    ];
  };

  // slow because 40 seeded crossings have the meshes of each tile built twice, with the ground
  // watched: 0.33 s alone, so a limit of 30 s
  it('reads the ground only inside GROUND_BOX of each tile, whatever its parts', () => {
    // A tile's ground bound and its mesh key (worldRenderer.ts) cover GROUND_BOX: a face read
    // outside it could be cut to ground neither of them saw.
    const [low, high] = GROUND_BOX;
    forAll(
      crossing,
      (c) => {
        const ground = bankGround(c.banks);
        for (const { tile, plan } of tilesOf(c, ground))
          for (const top of [undefined, bankTop(c.banks, tile) + c.slack]) {
            const outside: string[] = [];
            bridgeTileMeshes(
              {
                ...tile,
                top,
                ground: (x, y) => {
                  const dx = x - tile.x,
                    dy = y - tile.y;
                  if (dx < low || dx > high || dy < low || dy > high)
                    outside.push(`${dx.toFixed(4)},${dy.toFixed(4)}`);
                  return ground(x, y);
                },
              },
              plan,
              surfaces,
            );
            expect(outside.slice(0, 5), `tile ${tile.x},${tile.y}, top ${top}`).toEqual([]);
          }
      },
      { seeds: SEEDS.slice(0, 40), shrink: shrinkCrossing },
    );
  }, 30_000);

  /** A half-pixel point (2 sx, 2 sy) as one number; the bridges here lie well inside 4096 px. */
  const HALF = 16384,
    halfPoint = (hx: number, hy: number) => (hy + HALF) * 2 * HALF + hx + HALF;
  /**
   * The half-pixel points the faces of a tile's parts cover, by label. Tops are left out: they
   * follow the deck alone, never the ground.
   */
  const coverage = (parts: { under: Container; near: Container }) => {
    const out = new Map<string, Set<number>>();
    for (const m of [...meshes(parts.under), ...meshes(parts.near)]) {
      if (m.label.endsWith(':top')) continue;
      const at = out.get(m.label) ?? new Set<number>();
      out.set(m.label, at);
      for (const [[ax, ay], [bx, by], [cx, cy]] of triangles(m)) {
        const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(d) < 1e-9) continue;
        for (let hy = Math.ceil(Math.min(ay, by, cy) * 2); hy <= Math.max(ay, by, cy) * 2; hy++)
          for (let hx = Math.ceil(Math.min(ax, bx, cx) * 2); hx <= Math.max(ax, bx, cx) * 2; hx++) {
            const sx = hx / 2,
              sy = hy / 2,
              u = ((bx - sx) * (cy - sy) - (by - sy) * (cx - sx)) / d,
              v = ((cx - sx) * (ay - sy) - (cy - sy) * (ax - sx)) / d;
            if (u > 1e-6 && v > 1e-6 && 1 - u - v > 1e-6) at.add(halfPoint(hx, hy));
          }
      }
    }
    return out;
  };
  /** Points of `a` with no point of `b` at or next to them (half a pixel), by label. */
  const beyond = (a: Map<string, Set<number>>, b: Map<string, Set<number>>) => {
    const out: string[] = [];
    for (const [label, points] of a) {
      const other = b.get(label) ?? new Set<number>();
      for (const p of points) {
        const hx = (p % (2 * HALF)) - HALF,
          hy = Math.floor(p / (2 * HALF)) - HALF;
        if (
          ![-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => other.has(halfPoint(hx + dx, hy + dy))))
        )
          out.push(`${label} at ${hx / 2},${hy / 2}`);
      }
    }
    return out;
  };

  // 40 crossings, each tile drawn twice and rasterised to the half pixel: under a second alone
  it('cuts every part as it would with no ground bound, given one the ground stays under', () => {
    // The bound only spares looking along ground that cannot rise high enough to hide anything.
    // Every pier, arch wall, post and brace, and every water fade, comes out the same to the
    // vertex; every face (decks, parapets and cap beams too, whose splits may differ where a
    // bound spares a look) covers the same pixels to within half a pixel.
    forAll(
      crossing,
      (c) => {
        const ground = bankGround(c.banks);
        for (const { tile, plan } of tilesOf(c, ground)) {
          const top = bankTop(c.banks, tile) + c.slack,
            free = bridgeTileMeshes(tile, plan, surfaces),
            bound = bridgeTileMeshes({ ...tile, top }, plan, surfaces),
            where = `tile ${tile.x},${tile.y}, top ${top}`;
          expect(supportsOf(bound.under), where).toEqual(supportsOf(free.under));
          const [a, b] = [coverage(free), coverage(bound)];
          expect(beyond(a, b).slice(0, 5), `${where}: drawn only without the bound`).toEqual([]);
          expect(beyond(b, a).slice(0, 5), `${where}: drawn only with the bound`).toEqual([]);
        }
      },
      { seeds: SEEDS.slice(0, 40), shrink: shrinkCrossing },
    );
  }, 30_000);

  it("paints the water a tile's faces read from the tiles of WATER_TILES alone, on any map", () => {
    // What the mesh key holds (worldRenderer.ts, bridgeWaterKey): on any map, bridge tile and
    // paving, no tile outside WATER_TILES, by its water or its paving, changes the painted water
    // anywhere in GROUND_BOX. Maps from 3 tiles, so bridge tiles sit at every edge.
    const [low, high] = GROUND_BOX,
      [from, to] = WATER_TILES;
    forAll(
      (rng) => {
        const w = rng.int(3, 9),
          h = rng.int(3, 9),
          density = rng.range(0.2, 0.9),
          x = rng.int(0, w - 1),
          y = rng.int(0, h - 1),
          water: number[] = [],
          paved: number[] = [],
          flips: { tile: number; paving: boolean }[] = [];
        for (let k = 0; k < w * h; k++) {
          if (rng.chance(density)) water.push(k);
          if (rng.chance(0.15)) paved.push(k);
          const tx = k % w,
            ty = Math.floor(k / w);
          if (tx < x + from || tx > x + to || ty < y + from || ty > y + to)
            flips.push({ tile: k, paving: rng.chance(0.3) });
        }
        return {
          w,
          h,
          originX: rng.int(-4000, 4000),
          originY: rng.int(-4000, 4000),
          x,
          y,
          water,
          paved,
          flips: rng.shuffle(flips).slice(0, 6),
          // inside the box, and on its edges, where the reach is longest
          points: Array.from({ length: 48 }, (_, i) => {
            const edge = rng.pick([low, high]),
              along = rng.range(low, high),
              [dx, dy] =
                i < 24 ? [rng.range(low, high), along] : i % 2 ? [edge, along] : [along, edge];
            return [x + dx, y + dy];
          }),
        };
      },
      (c) => {
        const m = emptyMap(1, c.w, c.h, Terrain.Grass, c.originX, c.originY),
          paved = new Set(c.paved);
        for (const k of c.water) m.terrain[k] = Terrain.Water;
        const read = () =>
          c.points
            .map(([x, y]) => (underPaintedWater(m, x, y, (k) => paved.has(k)) ? 1 : 0))
            .join('');
        const before = read();
        for (const { tile, paving } of c.flips) {
          const was = m.terrain[tile];
          if (paving) paved[paved.has(tile) ? 'delete' : 'add'](tile);
          else m.terrain[tile] = was === Terrain.Water ? Terrain.Grass : Terrain.Water;
          expect(read(), `${paving ? 'paving' : 'water'} of tile ${tile}`).toBe(before);
          if (paving) paved[paved.has(tile) ? 'delete' : 'add'](tile);
          else m.terrain[tile] = was;
        }
      },
      {
        shrink: function* (c) {
          for (const flips of shrinkArray(c.flips)) if (flips.length) yield { ...c, flips };
          for (const points of shrinkArray(c.points)) if (points.length) yield { ...c, points };
        },
      },
    );
  });

  /** Spans across the water a row (axis 1) or column (axis 0) meets first, open at both ends. */
  const acrossWater = (
    m: ReturnType<typeof emptyMap>,
    axis: 0 | 1,
    at: number,
    more: Partial<Site>,
  ) => {
    const sites: Placed[] = [];
    for (let l = 0; l < W; l++) {
      const [x, y] = axis === 1 ? [l, at] : [at, l];
      if (m.terrain[y * W + x] !== Terrain.Water) {
        if (sites.length) break;
        continue;
      }
      if (sites.length === 3) break;
      const open = axis === 1 ? [false, true, false, true] : [true, false, true, false];
      sites.push({ ...span(x, y, axis, 0, { water: true, open, ...more }), level: 1 });
    }
    return sites;
  };

  // A whole crossing's meshes, rasterised to the quarter pixel, per case: some 2 s alone
  it('shows nothing under a deck over painted bank, across any lake', () => {
    // Lakes of a few overlapping rects with ponds and islets round them, a town paving some of
    // their shore; a crossing along either axis over the first water a row or column meets, its
    // deck at the ground's level. Everything under such a deck stands below the ground, so a
    // quarter pixel of it shows over the ground point in front of it that it hides (on a deck
    // raised over the ground, a part above it rightly hides the ground behind it instead).
    forAll(
      (rng) => {
        const water: number[] = [],
          paved: number[] = [];
        for (let n = rng.int(1, 3); n > 0; n--) {
          const x0 = rng.int(4, 10),
            y0 = rng.int(4, 10),
            x1 = x0 + rng.int(0, 4),
            y1 = y0 + rng.int(0, 4);
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) water.push(y * W + x);
        }
        for (let n = rng.int(0, 6); n > 0; n--) {
          const k = rng.int(3, 15) * W + rng.int(3, 15);
          if (rng.chance(0.5)) water.push(k);
          else paved.push(k);
        }
        const axis = rng.pick([0, 1] as const),
          // a row or column with water in it
          k = rng.pick(water);
        return {
          water,
          paved,
          originX: rng.int(-4000, 4000),
          originY: rng.int(-4000, 4000),
          axis,
          at: axis === 1 ? Math.floor(k / W) : k % W,
          material: rng.pick(['stone', 'wood'] as const),
        };
      },
      (c) => {
        const m = emptyMap(4242, W, W, Terrain.Grass, c.originX, c.originY),
          paved = new Set(c.paved),
          town = (k: number) => paved.has(k);
        for (const k of c.water) m.terrain[k] = Terrain.Water;
        // a shrunk lake may leave the row dry: nothing to cross
        const sites = acrossWater(m, c.axis, c.at, { material: c.material });
        if (!sites.length) return;
        const ground = (x: number, y: number) => (underPaintedWater(m, x, y, town) ? WATERLINE : 0),
          tiles = plans(sites).map((t) =>
            bridgeTileMeshes(
              { ...t.site, water: true, level: 1, ground, top: 0 },
              t.plan,
              surfaces,
            ),
          ),
          shown = shownUnder(tiles),
          onBank = shown
            .filter(
              (p) => paintedWater(m, p.x, p.y, town(Math.round(p.y) * W + Math.round(p.x))) === 0,
            )
            .map((p) => `${p.label} at ${p.x.toFixed(3)},${p.y.toFixed(3)}`);
        expect(onBank.slice(0, 5), `${onBank.length} quarter pixels over bank`).toEqual([]);
        return shown.length > 0;
      },
      {
        seeds: SEEDS.slice(0, 16),
        shrink: function* (c) {
          for (const water of shrinkArray(c.water)) yield { ...c, water };
          for (const paved of shrinkArray(c.paved)) yield { ...c, paved };
        },
      },
    );
  }, 60_000);

  /**
   * How many bands of water fade each tile of a crossing draws, and where they stray off the
   * support faces drawn there: the quarter pixels of them that lie neither on those faces nor
   * within half a pixel below their foot (the fade reaches the waterline, a face may end half a
   * pixel over it).
   */
  const fadeOffFaces = (c: Crossing) => {
    const ground = bankGround(c.banks),
      out: { tile: string; bands: number; off: string[] }[] = [];
    for (const { tile, plan } of tilesOf(c, ground)) {
      const { under } = bridgeTileMeshes(tile, plan, surfaces),
        faces = new Set<string>();
      for (const m of meshes(under))
        if (m.label.startsWith('support:'))
          for (const tri of triangles(m))
            for (const [sx, sy] of inside(tri)) faces.add(`${sx},${sy}`);
      const off: string[] = [];
      let bands = 0;
      for (const g of under.children.filter((g): g is Graphics => g instanceof Graphics))
        for (const ins of g.context.instructions) {
          bands++;
          for (const { shape } of (ins as FillInstruction).data.path.shapePath.shapePrimitives) {
            const pts = (shape as { points?: number[] }).points ?? [];
            for (const [sx, sy] of inPolygon(pts))
              if (
                ![0, -0.25, 0.25].some((dx) =>
                  [0, -0.25, -0.5].some((dy) => faces.has(`${sx + dx},${sy + dy}`)),
                )
              )
                off.push(`${sx},${sy}`);
          }
        }
      out.push({ tile: `${tile.x},${tile.y}`, bands, off });
    }
    return out;
  };

  /**
   * A crossing whose tiles all stand over water, its spans in timber (stone ones stand on arched
   * walls, which have no feet to fade): every tile has feet in the water.
   */
  const overWater = (rng: Rng) => {
    const c = crossing(rng);
    for (const s of c.sites) {
      s.water = true;
      // over water a deck never sinks below the ground (worldRenderer.ts, deckProfile)
      s.deck = s.deck.map((z) => Math.max(0, z));
      if (s.axis !== null) s.material = 'wood';
    }
    return c;
  };

  // 40 crossings, each rasterised to the quarter pixel: about a second alone
  it('fades a foot into the water only on the faces it shows, whatever bank stands in front', () => {
    // Every quarter pixel of a water fade lies on the support faces drawn there, or within half
    // a pixel below their foot: never over a bank in front of the foot. Timber spans and pads
    // over water, with banks round them down to slivers far narrower than the line of sight is
    // read at: the fade goes by where the faces were cut, not by looks of its own.
    forAll(
      overWater,
      (c) => {
        for (const { tile, off } of fadeOffFaces(c))
          expect(off.slice(0, 5), `tile ${tile}: ${off.length} off its faces`).toEqual([]);
      },
      { seeds: SEEDS.slice(0, 40), shrink: shrinkCrossing },
    );
  }, 30_000);

  it('fades no foot over a bank sliver that slips between looks one STEP apart', () => {
    // A bank 0.045 by 0.021 tile in front of a post of a timber span over water hides the strip
    // y = 8.39 to 8.41 of the post's +x face. The face, split down to 1/512 tile where its cut
    // jumps, is cut to the sliver; a fade that looked along the face every 0.03 tile, at y = 8.385
    // and 8.415, missed it and hung over the bank.
    const c: Crossing = {
      sites: [
        {
          ...span(7, 8, 0, 0, {
            material: 'wood',
            water: true,
            open: [false, true, false, true],
            deck: [0, 0, 0, 2.8682962311431766, 5.736592462286353],
          }),
          level: 2,
        },
      ],
      banks: [
        {
          x0: 6.933093570114579,
          y0: 8.670708859472068,
          x1: 6.978171222729142,
          y1: 8.691595564403103,
          z: -7.110157078597695,
          gx: -4.301147181540728,
          gy: -6.5278556337580085,
        },
      ],
      slack: 0,
    };
    const [{ bands, off }] = fadeOffFaces(c);
    // The posts the sliver leaves whole still fade into the water.
    expect(bands).toBeGreaterThan(0);
    expect(off.slice(0, 5), `${off.length} off the faces`).toEqual([]);
  });

  /** A support's foot as its fade gives it: the +y face from (x0, y) to (x1, y). */
  type Foot = { x0: number; x1: number; y: number };
  /**
   * The feet a tile fades into the water, read back from its fade: a foot's bands stack, each
   * one's top edge on the bottom edge of the one before, and the last ends on the waterline. The
   * foot's +y face runs from (x0, y) to (x1, y) there, its +x face on to (x1, y - (x1 - x0)).
   */
  const fadedFeet = (under: Container) => {
    const feet: Foot[] = [];
    let last: number[] | undefined;
    // A band is a, b, c along its top edge, then c2, b2, a2 along its bottom edge.
    const end = () => {
      if (!last) return;
      const a = worldToTile(last[10], last[11] + WATERLINE),
        b = worldToTile(last[8], last[9] + WATERLINE);
      feet.push({ x0: a.x, x1: b.x, y: a.y });
    };
    for (const g of under.children.filter((g): g is Graphics => g instanceof Graphics))
      for (const ins of g.context.instructions) {
        const [{ shape }] = (ins as FillInstruction).data.path.shapePath.shapePrimitives,
          pts = (shape as unknown as { points: number[] }).points;
        if (!last || Math.hypot(pts[0] - last[10], pts[1] - last[11]) > 1e-9) end();
        last = pts;
      }
    end();
    return feet;
  };
  const footKey = (f: Foot) => `${f.x0.toFixed(5)},${f.x1.toFixed(5)},${f.y.toFixed(5)}`;
  /** A bank grown by `e` on every side, on the same plane. */
  const grown = (b: Bank, e: number): Bank => ({
    ...b,
    x0: b.x0 - e,
    y0: b.y0 - e,
    x1: b.x1 + e,
    y1: b.y1 + e,
    z: bankAt(b, b.x0 - e, b.y0 - e),
  });
  /**
   * The most bank `b` hides of the face from (ax, ay) to (bx, by): the highest `z - TILE_H * d`
   * over its points `d` tiles (0 to `reach`) along the line of sight (+x +y) from a point of the
   * face, `z` its plane there. Where along the face the look starts (`s`, 0 to 1) and `d` lie in
   * a polygon the rect and the ranges bound, and the height is linear in both, so the highest is
   * at a corner of it: where two of its bounds cross.
   */
  const hides = (b: Bank, ax: number, ay: number, bx: number, by: number, reach: number) => {
    const ux = bx - ax,
      uy = by - ay,
      // each [k, l, m] stands for k s + l d <= m
      bounds = [
        [-ux, -1, ax - b.x0],
        [ux, 1, b.x1 - ax],
        [-uy, -1, ay - b.y0],
        [uy, 1, b.y1 - ay],
        [0, -1, 0],
        [0, 1, reach],
        [-1, 0, 0],
        [1, 0, 1],
      ];
    let most = -Infinity;
    for (const [k1, l1, m1] of bounds)
      for (const [k2, l2, m2] of bounds) {
        const det = k1 * l2 - k2 * l1;
        if (Math.abs(det) < 1e-12) continue;
        const s = (m1 * l2 - m2 * l1) / det,
          d = (k1 * m2 - k2 * m1) / det;
        if (bounds.every(([k, l, m]) => k * s + l * d <= m + 1e-9))
          most = Math.max(most, bankAt(b, ax + ux * s + d, ay + uy * s + d) - TILE_H * d);
      }
    return most;
  };
  /**
   * Where a tile's deck ends on an abutment, the ground past that edge stands at least at the
   * deck's end (bridgeMeshes.ts, onAbutments): a level bank there, reaching in farther than the
   * abutment starts.
   */
  const abutmentBanks = (t: BridgeSite, plan: BridgePlan): Bank[] => {
    const inset = 1 / 16,
      out: Bank[] = [];
    if (plan.abutments.e)
      out.push({
        x0: t.x + 0.5 - inset,
        x1: t.x + 1.5,
        y0: t.y - 0.5,
        y1: t.y + 0.5,
        z: deckAtOffset(t, 0.5, 0),
        gx: 0,
        gy: 0,
      });
    if (plan.abutments.s)
      out.push({
        x0: t.x - 0.5,
        x1: t.x + 0.5,
        y0: t.y + 0.5 - inset,
        y1: t.y + 1.5,
        z: deckAtOffset(t, 0, 0.5),
        gx: 0,
        gy: 0,
      });
    return out;
  };

  /** Each tile of a crossing with the feet it stands on, found on open water, where all fade. */
  const feetOf = (c: Crossing, ground: (x: number, y: number) => number) =>
    tilesOf(c, ground).map(({ tile, plan }) => ({
      tile,
      plan,
      feet: fadedFeet(
        bridgeTileMeshes(
          { ...tile, ground: () => WATERLINE },
          { ...plan, abutments: { e: false, s: false } },
          surfaces,
        ).under,
      ),
    }));
  /** How far ahead the faces are cut: GROUND_BOX reaches that far past the parts' 0.6 tile. */
  const SIGHT = GROUND_BOX[1] + GROUND_BOX[0];
  /** The most bank `b` hides of a foot's two faces (hides). */
  const hidesFoot = (b: Bank, f: Foot, reach = SIGHT) =>
    Math.max(
      hides(b, f.x0, f.y, f.x1, f.y, reach),
      hides(b, f.x1, f.y, f.x1, f.y - (f.x1 - f.x0), reach),
    );

  // 40 crossings, each tile drawn three times: about half a second alone
  it('fades every foot no bank in front of it rises to hide, abutments included', () => {
    // The other half of the fade lying on the faces: no fade is lost where the faces reach the
    // water. On the crossing, a foot that no bank, nor the line's bed past an abutment, rises
    // within half a pixel of hiding anywhere along its two faces (found exactly: a bank is a plane
    // over a rect) fades. Besides the crossing's own banks, a bank or two grazes the line of sight
    // from a foot's faces, its highest within half a pixel either side of that. The banks are
    // grown by NUDGE and the sight by as much, for the ground read just inside a tile's edge and
    // just past an edge the sight crosses (Painter.ground, Painter.horizon), which moves a plane
    // by less than SLACK px.
    const NUDGE = 2e-3,
      SLACK = 0.05;
    let near = 0,
      grazed = 0;
    forAll(
      (rng) => {
        const c = overWater(rng),
          feet = feetOf(c, () => WATERLINE).flatMap((t) => t.feet);
        for (let n = rng.int(1, 3); n > 0; n--) {
          const f = rng.pick(feet),
            k = rng.range(0, 1),
            // a point of the +y face, or of the +x face
            [px, py] = rng.chance(0.5)
              ? [f.x0 + (f.x1 - f.x0) * k, f.y]
              : [f.x1, f.y - (f.x1 - f.x0) * k],
            d = rng.range(0.02, 1.4),
            w = rng.range(0.02, 0.6),
            h = rng.range(0.02, 0.6),
            x0 = px + d - w * rng.range(0, 1),
            y0 = py + d - h * rng.range(0, 1),
            flat = {
              x0,
              y0,
              x1: x0 + w,
              y1: y0 + h,
              z: 0,
              gx: rng.range(-10, 10),
              gy: rng.range(-10, 10),
            };
          c.banks.push({ ...flat, z: WATERLINE + rng.range(-0.5, 0.5) - hidesFoot(flat, f) });
        }
        return c;
      },
      (c) => {
        const ground = bankGround(c.banks),
          reach = SIGHT + NUDGE;
        for (const { tile, plan, feet } of feetOf(c, ground)) {
          const where = `tile ${tile.x},${tile.y}`,
            faded = new Set(fadedFeet(bridgeTileMeshes(tile, plan, surfaces).under).map(footKey)),
            banks = [...c.banks, ...abutmentBanks(tile, plan)].map((b) => grown(b, NUDGE));
          // a pier stands on one foot, a timber bent on a post at each end
          expect(feet.length, `${where}: feet on open water`).toBe(
            plan.piers.length + 2 * plan.trestles.length,
          );
          for (const f of feet) {
            const most = Math.max(WATERLINE, ...banks.map((b) => hidesFoot(b, f, reach)));
            if (most > WATERLINE + 0.5 - SLACK) continue;
            if (banks.some((b) => hidesFoot(b, f, reach) > -Infinity)) near++;
            if (most > WATERLINE + 0.25) grazed++;
            expect(faded.has(footKey(f)), `${where}: foot ${footKey(f)} hidden to ${most} px`).toBe(
              true,
            );
          }
        }
      },
      { seeds: SEEDS.slice(0, 40), shrink: shrinkCrossing },
    );
    // Feet with a bank in sight were among them, some within a quarter pixel of being hidden.
    expect(near).toBeGreaterThan(0);
    expect(grazed).toBeGreaterThan(0);
  }, 10_000);
  /** Quarter-pixel points strictly inside a polygon (even-odd), as `inside` finds them in a triangle. */
  function* inPolygon(pts: number[]) {
    const xs = pts.filter((_, i) => i % 2 === 0),
      ys = pts.filter((_, i) => i % 2 === 1);
    for (let sy = Math.ceil(Math.min(...ys) * 4) / 4; sy <= Math.max(...ys); sy += 0.25)
      for (let sx = Math.ceil(Math.min(...xs) * 4) / 4; sx <= Math.max(...xs); sx += 0.25) {
        let inside = false;
        for (let i = 0, j = xs.length - 1; i < xs.length; j = i++)
          if (
            ys[i] > sy !== ys[j] > sy &&
            sx < ((xs[j] - xs[i]) * (sy - ys[i])) / (ys[j] - ys[i]) + xs[i]
          )
            inside = !inside;
        if (inside) yield [sx, sy] as const;
      }
  }
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

describe('road decks beside rail decks (#503)', () => {
  const road = (x: number, y: number, axis: 0 | 1 = 1, z = 20, more: Partial<Site> = {}) =>
    span(x, y, axis, z, { carries: 'road', ...more });
  /** The long sides of a span, far then near: N and S along x, W and E along y. */
  const longSides = (axis: 0 | 1) => (axis === 1 ? ['N', 'S'] : ['W', 'E']);
  /** The `i`th of a row of tiles side by side across `axis`, from (5, 5). */
  const across = (axis: 0 | 1, i: number) => (axis === 1 ? [5, 5 + i] : [5 + i, 5]);
  /** Tile offset of a support line at across offset `w` of tile `s`, in map units. */
  const acrossAt = (axis: 0 | 1, s: BridgeSite, w: number) => (axis === 1 ? s.y : s.x) + w;
  const KINDS = [
    ['stone', false],
    ['stone', true],
    ['wood', false],
    ['wood', true],
  ] as const;

  it('a road deck beside a rail deck makes one deck: outer parapets only, shared supports', () => {
    for (const axis of [0, 1] as const)
      for (const [material, water] of KINDS)
        for (const roadFirst of [false, true]) {
          const more = { material, water },
            [ax, ay] = across(axis, 0),
            [bx, by] = across(axis, 1),
            first = roadFirst ? road(ax, ay, axis, 20, more) : span(ax, ay, axis, 20, more),
            second = roadFirst ? span(bx, by, axis, 20, more) : road(bx, by, axis, 20, more),
            [a, b] = plans([first, second]),
            [far, near] = longSides(axis);
          expect(parapetSides(a.site, a.plan)).toEqual([far]);
          expect(parapetSides(b.site, b.plan)).toEqual([near]);
          // Each half keeps its own tile's deck: the rail on one, the road on the other.
          for (const t of [a, b])
            expect(onMap(t.site, t.plan.deck)).toEqual({
              x0: t.site.x - 0.5,
              x1: t.site.x + 0.5,
              y0: t.site.y - 0.5,
              y1: t.site.y + 0.5,
            });
          if (material === 'wood' || water) {
            // Three support lines across the two tiles, one of them under the seam.
            const at = [a, b].flatMap((t) =>
              (material === 'wood' ? t.plan.trestles : t.plan.arches).map((w) =>
                acrossAt(axis, t.site, w),
              ),
            );
            expect(at.length).toBe(3);
            expect(new Set(at.map((v) => v.toFixed(3))).size).toBe(3);
            expect(at).toContainEqual(5.5);
          } else {
            // Stone piers over land run across both tiles without a break.
            expect(a.plan.piers.length).toBe(2);
            expect(b.plan.piers.length).toBe(2);
            for (let i = 0; i < 2; i++) {
              const p = onMap(a.site, a.plan.piers[i]),
                q = onMap(b.site, b.plan.piers[i]);
              expect(axis === 1 ? p.y1 : p.x1).toBeCloseTo(axis === 1 ? q.y0 : q.x0, 9);
            }
          }
        }
  });

  it('a lone road deck walls both long sides', () => {
    for (const axis of [0, 1] as const)
      for (const [material, water] of KINDS) {
        const [t] = plans([road(5, 5, axis, 20, { material, water })]);
        expect(t.joins).toEqual([false, false, false, false]);
        expect(parapetSides(t.site, t.plan).sort()).toEqual([...longSides(axis)].sort());
      }
  });

  it('road decks merge with each other as rail decks do', () => {
    const layouts: Site[][] = [
      [span(5, 5), span(5, 6)],
      [span(5, 5), span(5, 6), span(5, 7)],
      [span(4, 5), span(5, 5), span(6, 5)],
      [...[4, 5, 6, 7].map((x) => span(x, 5)), ...[3, 4, 5, 6, 7, 8].map((x) => span(x, 6))],
      [span(5, 5, 0), span(6, 5, 0, 20, { material: 'wood' }), span(7, 5, 0, 20.4)],
    ];
    for (const rail of layouts) {
      const roads = rail.map((s) => ({ ...s, carries: 'road' as const }));
      expect(plans(roads).map((t) => [t.joins, t.plan])).toEqual(
        plans(rail).map((t) => [t.joins, t.plan]),
      );
    }
  });

  it('does not merge a road deck with another material, another axis, another height or a pad', () => {
    const cases: [Site, Site][] = [
      [road(5, 5), span(5, 6, 1, 20, { material: 'wood' })],
      [road(5, 5, 1, 20, { material: 'wood' }), span(5, 6)],
      [road(5, 5), road(5, 6, 1, 20, { material: 'wood' })],
      [road(5, 5, 1), span(5, 6, 0)],
      [road(5, 5, 0), road(5, 6, 1)],
      [road(5, 5), span(5, 6, 1, 21)],
      [road(5, 5), pad(5, 6)],
      [road(4, 5), pad(5, 5, 20, { open: [false, false, false, true] })],
    ];
    for (const pair of cases) {
      const ts = plans(pair);
      for (const t of ts) expect(t.joins).toEqual([false, false, false, false]);
      for (const t of ts.filter((t) => t.site.axis !== null))
        expect(parapetSides(t.site, t.plan).length).toBe(2);
    }
  });

  /** The merge rule before decks carried roads, which rail-only layouts must keep. */
  function railMerges(a: BridgeSite, b: BridgeSite, d: number) {
    if (a.material !== b.material) return false;
    if (a.axis !== null && b.axis !== null && a.axis !== b.axis) return false;
    const edge = (s: BridgeSite, e: number) =>
      [-0.5, 0, 0.5].map((v) =>
        e === N || e === S
          ? deckAtOffset(s, v, e === N ? -0.5 : 0.5)
          : deckAtOffset(s, e === 3 ? -0.5 : 0.5, v),
      );
    const ha = edge(a, d),
      hb = edge(b, (d + 2) % 4);
    return ha.every((h, i) => Math.abs(h - hb[i]) <= 0.5);
  }
  const DX = [0, 1, 0, -1],
    DY = [-1, 0, 1, 0];
  const neighbours = (sites: readonly Site[], s: Site) =>
    [0, 1, 2, 3].map((d) => sites.find((n) => n.x === s.x + DX[d] && n.y === s.y + DY[d]));
  /** Bridge tiles of every kind on a 5 x 5 block, often alike so that they merge. */
  function layout(rng: Rng, carries: () => Site['carries']): Site[] {
    const alike = rng.chance(0.5),
      material = rng.pick(['stone', 'wood'] as const),
      axis = rng.pick([0, 1] as const),
      sites: Site[] = [];
    for (let y = 4; y < 9; y++)
      for (let x = 4; x < 9; x++) {
        if (rng.chance(0.4)) continue;
        const z = rng.pick([20, 20, 20, 20.3, 21, 30]),
          more: Partial<Site> = {
            material: alike ? material : rng.pick(['stone', 'wood'] as const),
            water: rng.chance(0.5),
            open: [0, 1, 2, 3].map(() => rng.chance(0.3)),
            carries: carries(),
          };
        if (rng.chance(0.2)) sites.push(pad(x, y, z, more));
        else {
          const grade = rng.chance(0.7) ? 0 : rng.range(-4, 4),
            a = alike && rng.chance(0.8) ? axis : rng.pick([0, 1] as const);
          sites.push(span(x, y, a, z, { ...more, deck: DECK_SAMPLES.map((l) => z + grade * l) }));
        }
      }
    return sites;
  }

  it('lays out rail-only bridges as before, whether or not they say they carry rail', () => {
    forAll(
      (rng) => layout(rng, () => (rng.chance(0.5) ? 'rail' : undefined)),
      (sites) => {
        const joins = bridgeJoins(sites, W),
          bare = sites.map((s) => ({ ...s, carries: undefined })),
          bareJoins = bridgeJoins(bare, W);
        sites.forEach((s, i) => {
          const j = joins.get(s.y * W + s.x)!;
          expect(j).toEqual(neighbours(sites, s).map((n, d) => !!n && railMerges(s, n, d)));
          expect(bridgePlan(s, j, !!s.water)).toEqual(
            bridgePlan(bare[i], bareJoins.get(s.y * W + s.x)!, !!s.water),
          );
        });
      },
      { shrink: (s) => shrinkArray(s) },
    );
  });

  it('merges whatever each deck carries, symmetrically, and never across materials or axes', () => {
    forAll(
      (rng) => layout(rng, () => rng.pick(['rail', 'road', undefined] as const)),
      (sites) => {
        const joins = bridgeJoins(sites, W),
          rail = sites.map((s) => ({ ...s, carries: 'rail' as const })),
          railJoins = bridgeJoins(rail, W);
        sites.forEach((s, i) => {
          const j = joins.get(s.y * W + s.x)!;
          neighbours(sites, s).forEach((n, d) => {
            if (!n) return expect(j[d]).toBe(false);
            const roadPad =
              (s.carries === 'road' || n.carries === 'road') &&
              (s.axis === null || n.axis === null);
            expect(joins.get(n.y * W + n.x)![(d + 2) % 4]).toBe(j[d]);
            if (n.material !== s.material) expect(j[d]).toBe(false);
            if (s.axis !== null && n.axis !== null && s.axis !== n.axis) expect(j[d]).toBe(false);
            // What two spans carry never decides; a road deck only refuses a pad.
            expect(j[d]).toBe(roadPad ? false : railJoins.get(s.y * W + s.x)![d]);
          });
          // The plan reads only the joins: a road deck is laid out as a rail deck joined alike.
          expect(bridgePlan(s, j, !!s.water)).toEqual(bridgePlan(rail[i], j, !!s.water));
        });
      },
      { shrink: (s) => shrinkArray(s) },
    );
  });

  type Row = {
    axis: 0 | 1;
    material: 'stone' | 'wood';
    water: boolean;
    z: number;
    carries: ('rail' | 'road')[];
    along: boolean;
  };
  function* shrinkRow(r: Row): Iterable<Row> {
    for (const carries of shrinkArray(r.carries)) if (carries.length >= 2) yield { ...r, carries };
  }

  it('makes one bridge of any row of decks alike, walled on its two outer long edges only', () => {
    forAll(
      (rng): Row => ({
        axis: rng.pick([0, 1] as const),
        material: rng.pick(['stone', 'wood'] as const),
        water: rng.chance(0.5),
        z: rng.pick([0, 20, 40]),
        carries: Array.from({ length: rng.int(2, 6) }, () => rng.pick(['rail', 'road'] as const)),
        along: rng.chance(0.3),
      }),
      ({ axis, material, water, z, carries, along }) => {
        // Side by side across the axis, or end to end along it.
        const sites = carries.map((c, i) => {
            const [x, y] = along ? (axis === 1 ? [5 + i, 5] : [5, 5 + i]) : across(axis, i);
            return span(x, y, axis, z, { material, water, carries: c });
          }),
          ts = plans(sites),
          [far, near] = longSides(axis),
          n = sites.length;
        // Every seam of the row is merged from both sides, so the row is one bridge.
        for (const t of ts)
          neighbours(sites, t.site).forEach((m, d) => expect(t.joins[d]).toBe(!!m));
        const walls = ts.map((t) => parapetSides(t.site, t.plan));
        if (along) for (const w of walls) expect(w).toEqual([far, near]);
        else {
          expect(walls.flat()).toEqual([far, near]);
          expect(walls[0]).toEqual([far]);
          expect(walls[n - 1]).toEqual([near]);
        }
        if (!along && (material === 'wood' || water)) {
          // A support line under each seam and the two outer ones, never two in one place.
          const at = ts.flatMap((t) =>
            (material === 'wood' ? t.plan.trestles : t.plan.arches).map((w) =>
              acrossAt(axis, t.site, w),
            ),
          );
          expect(at.length).toBe(n + 1);
          expect(new Set(at.map((v) => v.toFixed(3))).size).toBe(n + 1);
        }
      },
      { shrink: shrinkRow },
    );
  });

  it('walls a span on exactly the long sides it merges across nothing, in any layout', () => {
    forAll(
      (rng) => layout(rng, () => rng.pick(['rail', 'road', undefined] as const)),
      (sites) => {
        for (const t of plans(sites)) {
          if (t.site.axis === null) continue;
          const [far, near] = longSides(t.site.axis),
            [df, dn] = t.site.axis === 1 ? [N, S] : [3, E],
            free = [...(t.joins[df] ? [] : [far]), ...(t.joins[dn] ? [] : [near])];
          // Never a parapet on a merged seam or across a span's ends, always one on a free side.
          expect(parapetSides(t.site, t.plan), `${t.site.x},${t.site.y}`).toEqual(free);
        }
      },
      { shrink: (s) => shrinkArray(s) },
    );
  });

  it('keeps every merged bridge of one material, and its spans of one axis where no pad joins', () => {
    forAll(
      (rng) => layout(rng, () => rng.pick(['rail', 'road', undefined] as const)),
      (sites) => {
        const joins = bridgeJoins(sites, W),
          key = (s: Site) => s.y * W + s.x,
          seen = new Set<number>();
        for (const start of sites) {
          if (seen.has(key(start))) continue;
          // One merged bridge: every tile its joins reach from `start`.
          const bridge: Site[] = [start];
          seen.add(key(start));
          for (let i = 0; i < bridge.length; i++)
            neighbours(sites, bridge[i]).forEach((n, d) => {
              if (n && joins.get(key(bridge[i]))![d] && !seen.has(key(n))) {
                seen.add(key(n));
                bridge.push(n);
              }
            });
          const at = bridge.map((s) => `${s.x},${s.y}`).join(' ');
          expect(new Set(bridge.map((s) => s.material)).size, at).toBe(1);
          if (bridge.every((s) => s.axis !== null))
            expect(new Set(bridge.map((s) => s.axis)).size, at).toBe(1);
          // A road deck reaches pads only through rail; its own seams join spans of its axis.
          for (const s of bridge.filter((s) => s.carries === 'road'))
            neighbours(sites, s).forEach((n, d) => {
              if (n && joins.get(key(s))![d]) expect(n.axis, at).toBe(s.axis);
            });
        }
      },
      { shrink: (s) => shrinkArray(s) },
    );
  });

  type Mixed = {
    axis: 0 | 1;
    decks: { material: 'stone' | 'wood'; axis: 0 | 1; road: boolean }[];
  };
  function* shrinkMixed(r: Mixed): Iterable<Mixed> {
    for (const decks of shrinkArray(r.decks)) if (decks.length >= 2) yield { ...r, decks };
  }

  it('breaks a row of side-by-side decks exactly where material or axis changes', () => {
    forAll(
      (rng): Mixed => {
        const axis = rng.pick([0, 1] as const),
          material = rng.pick(['stone', 'wood'] as const);
        return {
          axis,
          decks: Array.from({ length: rng.int(2, 7) }, () => ({
            material: rng.chance(0.75) ? material : rng.pick(['stone', 'wood'] as const),
            axis: rng.chance(0.75) ? axis : rng.pick([0, 1] as const),
            road: rng.chance(0.5),
          })),
        };
      },
      ({ axis, decks }) => {
        const sites = decks.map((k, i) => {
            const [x, y] = across(axis, i);
            return span(x, y, k.axis, 20, {
              material: k.material,
              carries: k.road ? 'road' : 'rail',
            });
          }),
          ts = plans(sites),
          alike = (i: number, j: number) =>
            decks[i].material === decks[j].material && decks[i].axis === decks[j].axis,
          // Across the row is +y along x and +x along y: S or E of a tile, N or W of the next.
          [back, fwd] = axis === 1 ? [N, S] : [3, E];
        // Tile i and i + 1 merge, from both sides, exactly when they are alike, so two tiles are
        // one bridge exactly when every tile between them is alike: the bridges are the runs.
        for (let i = 0; i + 1 < sites.length; i++) {
          expect(ts[i].joins[fwd], `seam ${i}`).toBe(alike(i, i + 1));
          expect(ts[i + 1].joins[back], `seam ${i}`).toBe(alike(i, i + 1));
        }
        expect(ts[0].joins[back]).toBe(false);
        expect(ts[sites.length - 1].joins[fwd]).toBe(false);
        // A run along the row's axis is walled on its two outer long edges only.
        for (let i = 0; i < sites.length; i++) {
          if (decks[i].axis !== axis) continue;
          const [far, near] = longSides(axis),
            first = i === 0 || !alike(i - 1, i),
            last = i === sites.length - 1 || !alike(i, i + 1);
          expect(parapetSides(ts[i].site, ts[i].plan), `deck ${i}`).toEqual([
            ...(first ? [far] : []),
            ...(last ? [near] : []),
          ]);
        }
      },
      { shrink: shrinkMixed },
    );
  });
});

describe('a road deck (#506)', () => {
  /** A run of road decks along one axis, from `first` on, and the banks it meets at each end. */
  function run(rng: Rng) {
    const n = rng.int(1, 7),
      first = rng.int(-20, 20),
      from = rng.chance(0.3) ? 0 : rng.range(-20, 30),
      to = rng.chance(0.3) ? from : rng.range(-20, 30),
      floor = rng.chance(0.5) ? -Infinity : rng.range(-10, 10);
    return { n, first, from, to, floor };
  }
  const decksOf = ({ n, first, from, to, floor }: ReturnType<typeof run>) =>
    Array.from({ length: n }, (_, i) => ({
      axis: 1 as const,
      deck: roadDeckSamples(first + i, first - 0.5, from, first + n - 0.5, to, floor),
    }));

  it('meets the ground of the bank at each end of its run, and the next deck along it', () => {
    forAll(run, (r) => {
      const decks = decksOf(r),
        at = (z: number) => Math.max(r.floor, z);
      expect(decks.every((d) => d.deck.length === DECK_SAMPLES.length)).toBe(true);
      expect(deckAt(decks[0], -0.5)).toBeCloseTo(at(r.from), 9);
      expect(deckAt(decks[r.n - 1], 0.5)).toBeCloseTo(at(r.to), 9);
      for (let i = 0; i + 1 < r.n; i++)
        expect(deckAt(decks[i], 0.5)).toBeCloseTo(deckAt(decks[i + 1], -0.5), 9);
    });
  });

  it('runs straight from bank to bank at its samples, never below its floor, level where the banks are', () => {
    forAll(run, (r) => {
      const decks = decksOf(r),
        start = r.first - 0.5,
        length = r.n;
      for (let i = 0; i < r.n; i++)
        for (const l of DECK_SAMPLES) {
          const t = (r.first + i + l - start) / length,
            line = r.from + (r.to - r.from) * t,
            z = deckAt(decks[i], l);
          expect(z).toBeGreaterThanOrEqual(r.floor);
          expect(z).toBeCloseTo(Math.max(r.floor, line), 9);
          if (r.from === r.to) expect(z).toBeCloseTo(Math.max(r.floor, r.from), 9);
        }
    });
  });
});
