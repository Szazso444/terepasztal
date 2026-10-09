import { describe, it, expect } from 'vitest';
import { DIRS, DIR_DX, DIR_DY, opposite, type Dir, type Vec2 } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll, shrinkInt } from '../testing/property';
import {
  EDGE_MID,
  linkLength,
  linkPoints,
  unitDef,
  type MemberLink,
  type SwitchForm,
  type UnitMember,
} from './trackGeom';
import { CLASS_N, TRACK_KINDS, pieceLinks, rotationCount, type Link } from './track';

// The geometry every train position is computed from. Finite domains (edge pairs, unit shapes) are
// enumerated in full and name their case on failure; sample counts are drawn by forAll, which names
// the seed and shrinks a failure to the smallest count. What src/world/track.test.ts already pins
// (class radius and footprint, unit membership, each route's whole line) is not repeated here.

const DIR_NAME = ['N', 'E', 'S', 'W'];

/** Every ordered pair of distinct edges: all the ways a one-tile link can run. */
const PAIRS: readonly Link[] = DIRS.flatMap((a) =>
  DIRS.filter((b) => b !== a).map((b): Link => [a, b]),
);

/** Sample counts every link property runs: linkPoints's own default, then the fewest it takes. */
const FIXED_SAMPLES = [undefined, 1] as const;
/** Sample counts forAll draws: 1 to a few thousand, shrunk toward 1. */
const drawSamples = (rng: Rng) => rng.int(1, 4096);
const bySamples = { shrink: (s: number) => shrinkInt(s, 1), format: (s: number) => `s = ${s}` };

/** One-tile points are exact up to rounding: 0.5·cos(π/2) leaves about 3e-17, sums about 1e-16. */
const LINK_EPS = 1e-12;
/** Unit points come from a dense line that is rotated, mirrored and clipped at tile edges. */
const UNIT_EPS = 1e-9;

const linkName = (a: Dir, b: Dir, s: number | undefined) =>
  `link a=${DIR_NAME[a]} b=${DIR_NAME[b]} s=${s ?? 'default'}`;
const pointsOf = (a: Dir, b: Dir, s: number | undefined) =>
  s === undefined ? linkPoints(a, b) : linkPoints(a, b, s);

/** The larger coordinate difference of two points; NaN when either is broken. */
const apart = (p: Vec2, q: Vec2) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));

function polyLength(pts: readonly Vec2[]) {
  let len = 0;
  for (let i = 1; i < pts.length; i++)
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** How far p lies off edge d of a tile centred on the origin: across the edge, or past its ends. */
function offEdge(p: Vec2, d: Dir) {
  const ew = DIR_DX[d] !== 0;
  const across = ew ? p.x - DIR_DX[d] / 2 : p.y - DIR_DY[d] / 2;
  const along = ew ? p.y : p.x;
  return Math.max(Math.abs(across), Math.abs(along) - 0.5);
}

describe('one-tile links', () => {
  it('only ever join two distinct edges, so the 12 ordered pairs are every link', () => {
    for (const kind of TRACK_KINDS)
      for (let rot = 0; rot < rotationCount(kind); rot++)
        for (const [a, b] of pieceLinks(kind, rot)) {
          const where = `${kind} rot=${rot} link ${a}-${b}`;
          expect(DIRS, where).toContain(a);
          expect(DIRS, where).toContain(b);
          expect(a, where).not.toBe(b);
        }
  });

  it('put each edge midpoint half a step toward the neighbour across that edge', () => {
    // So a link leaving by d ends exactly where the neighbour's link entering by opposite(d) starts.
    for (const d of DIRS) {
      const step = { x: DIR_DX[d], y: DIR_DY[d] };
      const facing = EDGE_MID[opposite(d)];
      const where = `edge ${DIR_NAME[d]}`;
      expect(apart(EDGE_MID[d], { x: step.x / 2, y: step.y / 2 }), where).toBe(0);
      expect(apart(EDGE_MID[d], { x: step.x + facing.x, y: step.y + facing.y }), where).toBe(0);
    }
  });

  it('run from the midpoint of the first edge to the midpoint of the second', () => {
    const ends = (s: number | undefined) => {
      for (const [a, b] of PAIRS) {
        const pts = pointsOf(a, b, s);
        const where = linkName(a, b, s);
        expect(pts.length, `${where}: point count`).toBeGreaterThanOrEqual(2);
        expect(apart(pts[0], EDGE_MID[a]), `${where}: first point`).toBeLessThanOrEqual(LINK_EPS);
        const last = pts[pts.length - 1];
        expect(apart(last, EDGE_MID[b]), `${where}: last point`).toBeLessThanOrEqual(LINK_EPS);
      }
    };
    for (const s of FIXED_SAMPLES) ends(s);
    forAll(drawSamples, ends, bySamples);
  });

  it('retrace the same points backwards when walked the other way', () => {
    const reverses = (s: number | undefined) => {
      for (const [a, b] of PAIRS) {
        // copy before reversing: a returned path is read-only
        const want = [...pointsOf(a, b, s)].reverse();
        const got = pointsOf(b, a, s);
        const where = `${linkName(a, b, s)}: linkPoints(b, a) against linkPoints(a, b) reversed`;
        expect(got.length, `${where}, point count`).toBe(want.length);
        const i = got.findIndex((p, k) => !(apart(p, want[k]) <= LINK_EPS));
        expect(i < 0 ? null : { point: i, got: got[i], want: want[i] }, where).toBeNull();
      }
    };
    for (const s of FIXED_SAMPLES) reverses(s);
    forAll(drawSamples, reverses, bySamples);
  });

  it('are as long as their sampled points converge to', () => {
    // s chords of a quarter circle of radius 1/2 fall short of it by at most
    // (1/2)(π/2)³ / 24s² = π³ / 384s², about 0.0807 / s²; C leaves room above that.
    const C = 0.1;
    const converges = (s: number | undefined) => {
      for (const [a, b] of PAIRS) {
        const pts = pointsOf(a, b, s);
        // the default's chord count is read off its points
        const chords = s ?? pts.length - 1;
        const sampled = polyLength(pts);
        const closed = linkLength(a, b);
        const where = `${linkName(a, b, s)}: sampled ${sampled}, linkLength ${closed}`;
        expect(sampled - closed, `${where}, chords longer than the path`).toBeLessThanOrEqual(
          LINK_EPS,
        );
        expect(closed - sampled, `${where}, short by more than C/s²`).toBeLessThanOrEqual(
          C / (chords * chords),
        );
        if (b === opposite(a)) {
          expect(closed, `${where}, a straight`).toBe(1);
          expect(Math.abs(sampled - 1), `${where}, a straight`).toBeLessThanOrEqual(LINK_EPS);
        }
      }
    };
    for (const s of FIXED_SAMPLES) converges(s);
    forAll(drawSamples, converges, bySamples);
  });
});

// ---------------------------------------------------------------------------- multi-tile units

/** Every distinct class size above one tile, read from CLASS_N so a new class is covered. */
const UNIT_SIZES = [...new Set(Object.values(CLASS_N))].filter((n) => n > 1).sort((p, q) => p - q);

/** unitDef ignores a curve's form, so only switches take both. */
const UNIT_SHAPES = [
  { kind: 'curve', form: 'turn' },
  { kind: 'switch', form: 'turn' },
  { kind: 'switch', form: 'parallel' },
] as const;

interface UnitCase {
  kind: 'curve' | 'switch';
  n: number;
  rot: number;
  form: SwitchForm;
  name: string;
}

/** Every (kind, n, rot, form) a unit can take. */
function unitCases(): UnitCase[] {
  const out: UnitCase[] = [];
  for (const n of UNIT_SIZES)
    for (const { kind, form } of UNIT_SHAPES)
      for (let rot = 0; rot < rotationCount(kind); rot++)
        out.push({ kind, n, rot, form, name: `${kind} n=${n} rot=${rot} form=${form}` });
  return out;
}

interface Step {
  member: UnitMember;
  link: MemberLink;
  /** e.g. "curve n=2 rot=1 form=turn route=0 member 2 (step 1)" */
  where: string;
}

/**
 * Each route of a unit as the members it lists, in order, with the one link each holds for it.
 * Fails unless every listed member exists and holds exactly one link of that route.
 */
function routesOf(c: UnitCase): Step[][] {
  const def = unitDef(c.kind, c.n, c.rot, c.form);
  return def.routes.map((route, ri) => {
    expect(route.members.length, `${c.name} route=${ri}: members`).toBeGreaterThan(0);
    return route.members.map((mi, k) => {
      const where = `${c.name} route=${ri} member ${mi} (step ${k})`;
      const member = def.members[mi];
      expect(member, `${where}: in the block`).toBeDefined();
      const own = member.links.filter((l) => l.route === ri);
      expect(own.length, `${where}: links on the route`).toBe(1);
      return { member, link: own[0], where };
    });
  });
}

/** A route's length in closed form, from n alone. */
function closedLength(c: UnitCase, ri: number) {
  const n = c.n;
  if (c.kind === 'switch' && ri === 0) return n; // the through road
  if (c.form === 'parallel') {
    // the S lane: two reverse arcs of radius R through asin(n / 2R) each, one track over in n tiles
    const R = (n * n) / 4 + 1 / 4;
    return 2 * R * Math.asin(n / (2 * R));
  }
  return ((n - 0.5) * Math.PI) / 2; // a quarter circle of the class radius
}

const firstOf = (l: MemberLink) => l.pts[0];
const lastOf = (l: MemberLink) => l.pts[l.pts.length - 1];

describe('multi-tile units', () => {
  it('are enumerated for at least one class larger than a tile', () => {
    expect(UNIT_SIZES.length).toBeGreaterThan(0);
  });

  it('hold one link per member on each route, and no link off a route', () => {
    for (const c of unitCases()) {
      const def = unitDef(c.kind, c.n, c.rot, c.form);
      const steps = routesOf(c).reduce((sum, r) => sum + r.length, 0);
      const held = def.members.reduce((sum, m) => sum + m.links.length, 0);
      expect(held, `${c.name}: links held against route steps`).toBe(steps);
    }
  });

  it('step from each member to the neighbour across its out edge, entering by the facing edge', () => {
    for (const c of unitCases())
      for (const route of routesOf(c))
        for (let k = 0; k + 1 < route.length; k++) {
          const { member, link, where } = route[k];
          const next = route[k + 1];
          const out = link.out;
          expect(
            { dx: next.member.dx, dy: next.member.dy },
            `${where}: next member across ${DIR_NAME[out]}`,
          ).toEqual({ dx: member.dx + DIR_DX[out], dy: member.dy + DIR_DY[out] });
          expect(next.link.in, `${next.where}: in edge`).toBe(opposite(out));
        }
  });

  it('end each member link where the next one starts, across the tile border', () => {
    // Zero-length links are walked too: where the parallel S lane crosses the block centre at a
    // tile corner (even n), one member holds a link of length 0 on purpose.
    for (const c of unitCases())
      for (const route of routesOf(c))
        for (let k = 0; k + 1 < route.length; k++) {
          const { member, link, where } = route[k];
          const next = route[k + 1];
          const end = lastOf(link);
          const start = firstOf(next.link);
          const gap = apart(
            { x: end.x + member.dx, y: end.y + member.dy },
            { x: start.x + next.member.dx, y: start.y + next.member.dy },
          );
          expect(gap, `${where}: gap to ${next.where}`).toBeLessThanOrEqual(UNIT_EPS);
        }
  });

  it('start each member link on its in edge and end it on its out edge', () => {
    for (const c of unitCases())
      for (const route of routesOf(c))
        for (const { link, where } of route) {
          const inEdge = `${where}: first point on ${DIR_NAME[link.in]}`;
          expect(offEdge(firstOf(link), link.in), inEdge).toBeLessThanOrEqual(UNIT_EPS);
          const outEdge = `${where}: last point on ${DIR_NAME[link.out]}`;
          expect(offEdge(lastOf(link), link.out), outEdge).toBeLessThanOrEqual(UNIT_EPS);
        }
  });

  it('meet one-tile track at the edges the one-tile piece of that rotation uses', () => {
    // A parallel switch's S lane leaves by the far end, like its through road, one track over.
    for (const c of unitCases()) {
      const links = pieceLinks(c.kind, c.rot);
      const routes = routesOf(c);
      expect(routes.length, `${c.name}: routes`).toBe(links.length);
      routes.forEach((route, ri) => {
        const lane = c.form === 'parallel' && ri === 1;
        const [a, b] = lane ? [links[1][0], links[0][1]] : links[ri];
        const first = route[0];
        const last = route[route.length - 1];
        expect(DIR_NAME[first.link.in], `${first.where}: entry edge`).toBe(DIR_NAME[a]);
        expect(DIR_NAME[last.link.out], `${last.where}: exit edge`).toBe(DIR_NAME[b]);
        const entry = apart(firstOf(first.link), EDGE_MID[a]);
        expect(entry, `${first.where}: entry at the edge midpoint`).toBeLessThanOrEqual(UNIT_EPS);
        const exit = apart(lastOf(last.link), EDGE_MID[b]);
        expect(exit, `${last.where}: exit at the edge midpoint`).toBeLessThanOrEqual(UNIT_EPS);
      });
    }
  });

  it('give each member link the length of its points, and each route its closed-form length', () => {
    for (const c of unitCases())
      routesOf(c).forEach((route, ri) => {
        const closed = closedLength(c, ri);
        let sum = 0;
        for (const { link, where } of route) {
          const own = polyLength(link.pts);
          expect(
            Math.abs(link.len - own),
            `${where}: len ${link.len}, points ${own}`,
          ).toBeLessThanOrEqual(LINK_EPS);
          sum += link.len;
        }
        // chords fall short of an arc and never run past it; the route is cut fine enough to
        // stay within 0.1% of it (today it falls short by under 2e-5 of its length)
        const where = `${c.name} route=${ri}: member lengths sum to ${sum}, closed form ${closed}`;
        expect(sum - closed, where).toBeLessThanOrEqual(UNIT_EPS);
        expect(closed - sum, where).toBeLessThanOrEqual(1e-3 * closed);
      });
  });
});
