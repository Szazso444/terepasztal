import { describe, expect, it, vi } from 'vitest';
import { Dir, DIRS, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import { hash2, type Rng } from '../engine/rng';
import {
  TrackGraph,
  makePiece,
  pieceLinks,
  rotationCount,
  type TrackClass,
  type TrackPiece,
} from '../world/track';
import { findPath, type PathSegment } from '../world/pathfinding';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import {
  blockingGroups,
  blockingCycles,
  findRefugePath,
  RecoveryReservations,
  stateKey,
  statesReaching,
} from './recovery';
import { Train, defaultStop, type TickCtx } from './trains';
import type { Station } from './stations';
import { content } from '../data/content';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

function line(end = 14) {
  const track = new TrackGraph(24, 24);
  for (let x = 1; x <= end; x++) track.place(x, 5, 'straight', 1);
  return track;
}

/**
 * A main line along y 5 from x `from` to 24 with a switch block on x 14 and 15. Its throat faces
 * west, so a train heading east turns into the dead-end siding that runs south under x 15 from
 * y 7 to 12, and one leaving the siding heads west.
 */
function sided(from = 1) {
  const track = new TrackGraph(28, 28);
  track.place(14, 5, 'switch', 7);
  for (let x = from; x <= 13; x++) track.place(x, 5, 'straight', 1);
  for (let x = 16; x <= 24; x++) track.place(x, 5, 'straight', 1);
  for (let y = 7; y <= 12; y++) track.place(15, y, 'straight', 0);
  return track;
}

describe('coordinated recovery', () => {
  it('preserves the underlying fuel failure when releasing a recovery', () => {
    const def = content.locomotives.find((d) => d.id === 'f7')!;
    const t = new Train([{ uid: 1, level: 0, def }]);
    t.holding = true;
    t.state = 'noFuel';
    t.lastMessage = 'out of fuel';
    t.cancelRetreat(20);
    expect(t.holding).toBe(false);
    expect(t.state).toBe('noFuel');
    expect(t.lastMessage).toBe('out of fuel');
  });
  it('finds a complete 30-train blocking chain, including a feeder into its cycle', () => {
    const trains = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      blocked: true,
      blockedBy: i === 29 ? 20 : i + 2,
      claimBlocker: null,
      claimLimit: Infinity,
    }));
    const groups = blockingGroups(trains);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(30);
    expect([...blockingCycles(trains)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 11 }, (_, i) => i + 20),
    );
  });

  it('grants only one escape per group and never gives two groups the same corridor', () => {
    const r = new RecoveryReservations();
    expect(r.reserve(1, [1, 2], new Set([5, 6, 7]), 0, 1)).toBe(true);
    expect(r.reserve(2, [1, 2], new Set([8, 9]), 0, 1)).toBe(false);
    expect(r.reserve(3, [3, 4], new Set([7, 8]), 0, 1)).toBe(false);
    expect(r.reserve(3, [3, 4], new Set([10, 11]), 0, 1)).toBe(true);
    expect(r.ownerAt(5, 1)).toBeNull();
    expect(r.ownerAt(5, 2)).toBe(1);
  });

  it('requires enough clear rail for the entire consist including couplers and a margin', () => {
    const track = line();
    const start = { x: 5, y: 5, in: Dir.W };
    const path = findRefugePath(
      track,
      start,
      4.4,
      () => false,
      (x) => x >= 8,
      () => true,
    )!;
    expect(path.at(-1)!.x).toBe(13); // 5.5 tiles from entry of tile 8 to centre of 13
    expect(
      findRefugePath(
        line(11),
        start,
        4.4,
        () => false,
        (x) => x >= 8,
        () => true,
      ),
    ).toBeNull();
  });

  it('does not park across an occupied tile, a junction, or another group route', () => {
    const track = line();
    const start = { x: 5, y: 5, in: Dir.W };
    expect(
      findRefugePath(
        track,
        start,
        4,
        (x) => x === 10,
        (x) => x >= 8,
        () => true,
      ),
    ).toBeNull();
    expect(
      findRefugePath(
        track,
        start,
        4,
        () => false,
        (x) => x >= 8 && x !== 11,
        () => true,
      ),
    ).toBeNull();
    expect(
      findRefugePath(
        track,
        start,
        4,
        () => false,
        (x) => x >= 8,
        () => false,
      ),
    ).toBeNull();
  });

  it('knows which way along the track runs on to a stop without reversing', () => {
    const track = sided();
    const w = track.w;
    const east = statesReaching(track, [{ x: 24, y: 5 }], () => true);
    const west = statesReaching(track, [{ x: 1, y: 5 }], () => true);
    // on the main line: only heading towards the stop (came in through the side facing away)
    expect(east.has(stateKey(w, 8, 5, Dir.W))).toBe(true);
    expect(east.has(stateKey(w, 8, 5, Dir.E))).toBe(false);
    expect(west.has(stateKey(w, 20, 5, Dir.E))).toBe(true);
    expect(west.has(stateKey(w, 20, 5, Dir.W))).toBe(false);
    // the siding lets a train out westwards only, whichever way it stands in it
    for (const entry of [Dir.N, Dir.S]) {
      expect(east.has(stateKey(w, 15, 10, entry))).toBe(false);
      expect(west.has(stateKey(w, 15, 10, entry))).toBe(entry === Dir.S);
    }
    // standing on the stop counts, whichever way
    for (const entry of [Dir.E, Dir.W]) expect(east.has(stateKey(w, 24, 5, entry))).toBe(true);
    // a consist barred from the switch reaches the far side from neither end
    const barred = statesReaching(track, [{ x: 24, y: 5 }], (p) => p.kind !== 'switch');
    expect(barred.has(stateKey(w, 8, 5, Dir.W))).toBe(false);
    expect(barred.has(stateKey(w, 18, 5, Dir.W))).toBe(true);
  });

  it('passes over a refuge it is told leaves no way on, for the next one', () => {
    const start = { x: 5, y: 5, in: Dir.W };
    const refuge = (x: number) => x >= 8;
    const turned: number[] = [];
    const path = findRefugePath(
      line(18),
      start,
      4.4,
      () => false,
      refuge,
      () => true,
      (p) => {
        turned.push(p.at(-1)!.x);
        return p.at(-1)!.x >= 16;
      },
    )!;
    expect(path.at(-1)!.x).toBe(16);
    // the nearer refuges were each offered first, and turned down
    expect(turned).toEqual([13, 14, 15, 16]);
    expect(
      findRefugePath(
        line(18),
        start,
        4.4,
        () => false,
        refuge,
        () => true,
        () => false,
      ),
    ).toBeNull();
  });

  it('backs a train off only into a siding it can go on to its stop from', () => {
    // a train heading east with its head at x 11; an oncoming train needs the line from x 10 on,
    // and the line behind is too short to hold it, so the siding is the only refuge
    const track = sided(7);
    const w = track.w;
    const def = content.locomotives.find((d) => d.id === 'f7')!;
    const hopper = content.wagons.find((d) => d.id === 'wood_hopper')!;
    const plan = (stopX: number) => {
      const t = new Train([{ uid: 1, level: 0, def }], 'Behind', 1);
      t.wagons = [{ uid: 2, def: hopper, level: 1, cargo: null, amount: 0, origin: null }];
      expect(t.spawnAt(track, 11, 5, Dir.W)).toBe(true);
      const stop = { id: 7 } as Station;
      t.schedule = [defaultStop(stop.id)];
      t.blockedBy = 2;
      const ctx = {
        track,
        now: 10,
        map: emptyMap(1, 28, 28, Terrain.Grass),
        builder: {
          stations: [stop],
          stationById: (id: number) => (id === stop.id ? stop : undefined),
          platformTiles: () => [{ x: stopX, y: 5 }],
        },
        trainPath: () => new Set(Array.from({ length: 15 }, (_, i) => 5 * w + 10 + i)),
        occupied: (x: number, y: number) => y === 5 && x >= 20,
        recoveryOwner: () => null,
        claimedBy: () => null,
      } as unknown as TickCtx;
      return t.planRetreat(ctx, [1, 2]);
    };
    // its stop lies east, and the siding lets it out westwards only: nowhere to go
    expect(plan(24)).toBeNull();
    // its stop lies west, the way out of the siding: in it goes
    const into = plan(7)!;
    expect(into.flip).toBe(false);
    const end = into.path.at(-1)!;
    expect(end.x === 15 && end.y >= 7).toBe(true);
  });

  it('previews a reverse retreat from the rear and leaves the train unchanged on reservation failure', () => {
    const track = line(18);
    const def = content.locomotives.find((d) => d.id === 'f7')!;
    const t = new Train([{ uid: 1, level: 0, def }], 'Retreat', 1);
    t.spawnAt(track, 10, 5, Dir.W);
    t.blockedBy = 2;
    const before = t.toJSON();
    let attempted = 0;
    const ctx = {
      track,
      now: 10,
      map: emptyMap(1, 24, 24, Terrain.Grass),
      builder: { stations: [] },
      trainPath: () => new Set([8, 9, 10, 11, 12].map((x) => 5 * 24 + x)),
      occupied: (x: number) => x === 11,
      recoveryOwner: () => null,
      claimedBy: () => null,
      reserveRecovery: (_train: Train, path: { x: number }[]) => {
        attempted++;
        expect(path[0].x).toBeLessThan(10);
        return false;
      },
    } as unknown as TickCtx;
    expect(t.retreat(ctx, [1, 2])).toBe(false);
    expect(attempted).toBe(1);
    expect(t.toJSON()).toEqual(before);
    ctx.reserveRecovery = () => true;
    expect(t.retreat(ctx, [1, 2])).toBe(true);
    expect(t.reversed).toBe(true);
    expect(t.holding).toBe(true);
    expect(t.pathAhead().at(-1)!.x).toBeLessThan(8);
  });
});

// ------------------------------------------------------------------ generated track

interface Tile {
  x: number;
  y: number;
}
/** Inside tile (x, y), having come in through edge `in`. */
interface State extends Tile {
  in: Dir;
}
const EDGE = 'NESW';
const showState = (s: State) => `(${s.x},${s.y}) in ${EDGE[s.in]}`;
const showWay = (p: readonly PathSegment[]) =>
  p.map((s) => `(${s.x},${s.y}) ${EDGE[s.in]}->${EDGE[s.out]}`).join(' ');

type OneTile = 'straight' | 'curve' | 'switch' | 'crossing' | 'transition';
/** One 1×1 piece laid with `set`, of any class, so gauge and class breaks turn up between them. */
interface Lay extends Tile {
  kind: OneTile;
  rot: number;
  cls: TrackClass;
  /** a crossing's second axis */
  cls2?: TrackClass;
}
/** A regular 2×2 curve or switch laid with `place`, before the 1×1 pieces. */
interface Unit extends Tile {
  kind: 'curve' | 'switch';
  rot: number;
}
/** An entry the consist may not make: into (x, y) through `entry`. */
interface Deny extends Tile {
  entry: Dir;
}

const CLASSES: readonly TrackClass[] = ['narrow', 'regular', 'high_speed'];
/** Every 1×1 piece by its links. */
const PIECES = (['straight', 'curve', 'switch', 'crossing', 'transition'] as const).flatMap(
  (kind) =>
    Array.from({ length: rotationCount(kind) }, (_, rot) => ({
      kind,
      rot,
      links: pieceLinks(kind, rot),
    })),
);
/** The edges a piece has track on. */
const edgesOf = (links: readonly (readonly Dir[])[]) =>
  DIRS.filter((d) => links.some(([a, b]) => a === d || b === d));
const hasLink = (links: readonly (readonly Dir[])[], a: Dir, b: Dir) =>
  links.some(([p, q]) => (p === a && q === b) || (p === b && q === a));

function layOut(size: number, units: readonly Unit[], lays: readonly Lay[]) {
  const g = new TrackGraph(size, size);
  for (const u of units) g.place(u.x, u.y, u.kind, u.rot, 'regular');
  for (const l of lays) g.set(l.x, l.y, makePiece(l.kind, l.rot, l.cls, l.cls2));
  return g;
}
/** An access check that refuses the entries in `deny` and allows every other. */
function accessOf(g: TrackGraph, deny: readonly Deny[]) {
  const tileOf = new Map<TrackPiece, number>();
  for (const { x, y, piece } of g.tiles()) tileOf.set(piece, g.key(x, y));
  const refused = new Set(deny.map((d) => g.key(d.x, d.y) * 4 + d.entry));
  return (p: TrackPiece, entry: Dir) => !refused.has(tileOf.get(p)! * 4 + entry);
}

/**
 * Track laid along random walks: each runs on or turns from tile to tile, mostly on plain track,
 * now and then through a switch, crossing or transition that carries its way, and keeps one
 * class but for the odd piece of another. Walks that meet overwrite each other, which makes
 * junctions, loops, dead ends and joints that do not connect.
 */
function walks(rng: Rng, size: number): Lay[] {
  const lays: Lay[] = [];
  for (let n = rng.int(1, 4), i = 0; i < n; i++) {
    let x = rng.int(0, size - 1);
    let y = rng.int(0, size - 1);
    let entry = rng.pick(DIRS);
    const cls = rng.pick(CLASSES);
    for (let steps = rng.int(2, 2 * size); steps > 0; steps--) {
      if (x < 0 || y < 0 || x >= size || y >= size) break;
      const out = rng.chance(0.6)
        ? opposite(entry)
        : rng.pick(DIRS.filter((d) => d !== entry && d !== opposite(entry)));
      const fits = PIECES.filter((p) => hasLink(p.links, entry, out));
      const plain = fits.filter((p) => p.kind === 'straight' || p.kind === 'curve');
      const p = rng.chance(0.7) ? rng.pick(plain) : rng.pick(fits);
      const lay: Lay = {
        x,
        y,
        kind: p.kind,
        rot: p.rot,
        cls: rng.chance(0.1) ? rng.pick(CLASSES) : cls,
      };
      if (p.kind === 'crossing' && rng.chance(0.3)) lay.cls2 = rng.pick(CLASSES);
      lays.push(lay);
      x += DIR_DX[out];
      y += DIR_DY[out];
      entry = opposite(out);
    }
  }
  return lays;
}

interface ReachCase {
  size: number;
  units: Unit[];
  lays: Lay[];
  targets: Tile[];
  deny: Deny[];
}
function reachCase(rng: Rng): ReachCase {
  const size = rng.int(4, 8);
  const units = Array.from({ length: rng.int(0, 2) }, (): Unit => {
    const kind = rng.pick(['curve', 'switch'] as const);
    const rot = rng.int(0, rotationCount(kind) - 1);
    return { x: rng.int(0, size - 2), y: rng.int(0, size - 2), kind, rot };
  });
  const lays = walks(rng, size);
  const laid: Tile[] = [...units, ...lays];
  const targets = Array.from({ length: rng.int(1, 3) }, () => {
    const { x, y } = rng.pick(laid);
    return { x, y };
  });
  const deny = Array.from({ length: rng.int(0, 3) }, () => {
    const { x, y } = rng.pick(laid);
    return { x, y, entry: rng.pick(DIRS) };
  });
  return { size, units, lays, targets, deny };
}
function* shrinkReach(c: ReachCase): Iterable<ReachCase> {
  for (const lays of shrinkArray(c.lays)) yield { ...c, lays };
  for (const units of shrinkArray(c.units)) yield { ...c, units };
  for (const deny of shrinkArray(c.deny)) yield { ...c, deny };
  for (const targets of shrinkArray(c.targets)) yield { ...c, targets };
}

describe('statesReaching on generated track', () => {
  // the oracle: findPath from each state in turn, with the same access
  it('holds exactly the states findPath reaches a target from, and every state on a target', () => {
    forAll(
      reachCase,
      (c) => {
        const g = layOut(c.size, c.units, c.lays);
        const access = accessOf(g, c.deny);
        const goal = new Set(c.targets.filter((t) => g.has(t.x, t.y)).map((t) => g.key(t.x, t.y)));
        const isTarget = (x: number, y: number) => goal.has(g.key(x, y));
        const states = statesReaching(g, c.targets, access);
        let reaching = 0;
        for (let y = 0; y < g.h; y++)
          for (let x = 0; x < g.w; x++)
            for (const d of DIRS) {
              const s = { x, y, in: d };
              const want =
                isTarget(x, y) || findPath(g, s, isTarget, Infinity, undefined, access) !== null;
              if (want) reaching++;
              expect(states.has(stateKey(g.w, x, y, d)), showState(s)).toBe(want);
            }
        expect(states.size, 'states off the grid').toBe(reaching);
      },
      { shrink: shrinkReach },
    );
  });
});

/**
 * A tree of narrow 1×1 pieces: each piece joins only the one it grew from, so a train reaches any
 * tile along one way only, and a search that keeps the first way to each state misses none.
 */
function tree(rng: Rng, size: number): Lay[] {
  const g = new TrackGraph(size, size);
  const lays: Lay[] = [];
  const kinds = PIECES.filter((p) => ['straight', 'curve', 'switch'].includes(p.kind));
  const ends: (Tile & { edge: Dir })[] = [];
  const put = (x: number, y: number, p: (typeof kinds)[number], entry: Dir | null) => {
    g.set(x, y, makePiece(p.kind, p.rot, 'narrow'));
    lays.push({ x, y, kind: p.kind, rot: p.rot, cls: 'narrow' });
    for (const edge of edgesOf(p.links)) if (edge !== entry) ends.push({ x, y, edge });
  };
  // a switch to start from: three ways out
  const mid = Math.floor(size / 2);
  put(mid, mid, rng.pick(kinds.filter((p) => p.kind === 'switch')), null);
  for (const want = rng.int(size, 4 * size); ends.length && lays.length < want;) {
    const [end] = ends.splice(rng.int(0, ends.length - 1), 1);
    const x = end.x + DIR_DX[end.edge];
    const y = end.y + DIR_DY[end.edge];
    if (!g.inBounds(x, y) || g.has(x, y)) continue;
    const entry = opposite(end.edge);
    // mostly straight on, so there are runs long enough to hold a train
    const order = rng.chance(0.6)
      ? ['straight', 'curve', 'switch']
      : rng.pick([
          ['curve', 'straight', 'switch'],
          ['switch', 'straight', 'curve'],
        ]);
    // it opens only onto empty tiles, or onto track that does not open back: no loops
    const fit = order
      .flatMap((k) => rng.shuffle(kinds.filter((p) => p.kind === k)))
      .filter((p) => edgesOf(p.links).includes(entry))
      .find((p) =>
        edgesOf(p.links).every(
          (e) => e === entry || !g.opensTo(x + DIR_DX[e], y + DIR_DY[e], opposite(e)),
        ),
      );
    if (fit) put(x, y, fit, entry);
  }
  return lays;
}

/**
 * Every way `findRefugePath` may offer, found the slow way: each walk from `start` that never
 * repeats a tile, enters only open, unblocked track the consist may use, and ends on a refuge
 * tile with `length` and half a tile of clear rail behind the head, counted as the search counts
 * it (refuge tiles in a row, in twentieths of a tile, rounded down).
 */
function refugeWays(
  g: TrackGraph,
  start: State,
  length: number,
  blocked: (x: number, y: number) => boolean,
  refuge: (x: number, y: number) => boolean,
  access: (p: TrackPiece, entry: Dir) => boolean,
): PathSegment[][] {
  const out: PathSegment[][] = [];
  const walk = (s: State, clear: number, path: PathSegment[]) => {
    for (const exit of g.exits(s.x, s.y, s.in)) {
      const way = [...path, { x: s.x, y: s.y, in: s.in, out: exit }];
      const arc = g.segLength(s.x, s.y, s.in, exit);
      const here = refuge(s.x, s.y);
      if (here && clear + arc / 2 >= length + 0.5) out.push(way);
      const next = { x: s.x + DIR_DX[exit], y: s.y + DIR_DY[exit], in: opposite(exit) };
      if (!g.opensTo(next.x, next.y, next.in) || blocked(next.x, next.y)) continue;
      if (!access(g.get(next.x, next.y)!, next.in)) continue;
      if (way.some((p) => p.x === next.x && p.y === next.y)) continue;
      walk(next, here ? Math.floor((clear + arc) * 20) / 20 : 0, way);
    }
  };
  walk(start, 0, []);
  return out;
}
const sameWay = (a: readonly PathSegment[], b: readonly PathSegment[]) =>
  a.length === b.length &&
  a.every((s, i) => s.x === b[i].x && s.y === b[i].y && s.in === b[i].in && s.out === b[i].out);

interface RefugeCase {
  size: number;
  lays: Lay[];
  start: State;
  /** tenths of a tile */
  length: number;
  refuges: Tile[];
  blocked: Tile[];
  deny: Deny[];
  /** the accept takes a way whose last crossing hashes below `cut` */
  cut: number;
  salt: number;
}
function refugeCase(rng: Rng): RefugeCase {
  const size = rng.int(6, 10);
  const lays = tree(rng, size);
  const s = rng.pick(lays);
  const some = (p: number) => lays.filter(() => rng.chance(p)).map(({ x, y }) => ({ x, y }));
  return {
    size,
    lays,
    start: { x: s.x, y: s.y, in: rng.pick(edgesOf(pieceLinks(s.kind, s.rot))) },
    length: rng.int(3, 30),
    refuges: some(0.9),
    blocked: some(0.06),
    deny: Array.from({ length: rng.int(0, 2) }, () => {
      const { x, y } = rng.pick(lays);
      return { x, y, entry: rng.pick(DIRS) };
    }),
    cut: rng.int(0, 10) / 10,
    salt: rng.int(0, 999),
  };
}
function* shrinkRefuge(c: RefugeCase): Iterable<RefugeCase> {
  for (const lays of shrinkArray(c.lays)) yield { ...c, lays };
  for (const blocked of shrinkArray(c.blocked)) yield { ...c, blocked };
  for (const deny of shrinkArray(c.deny)) yield { ...c, deny };
  for (const refuges of shrinkArray(c.refuges)) yield { ...c, refuges };
  for (const length of shrinkInt(c.length, 3)) yield { ...c, length };
}
function refugeSearch(c: RefugeCase) {
  const g = layOut(c.size, [], c.lays);
  const set = (ts: readonly Tile[]) => new Set(ts.map((t) => g.key(t.x, t.y)));
  const refuges = set(c.refuges);
  const blockedSet = set(c.blocked);
  const blocked = (x: number, y: number) => blockedSet.has(g.key(x, y));
  const refuge = (x: number, y: number) => refuges.has(g.key(x, y));
  const access = accessOf(g, c.deny);
  const takes = (p: readonly PathSegment[]) => {
    const last = p[p.length - 1];
    return hash2(last.x * 4 + last.in, last.y * 4 + last.out, c.salt) < c.cut;
  };
  const length = c.length / 10;
  const ways = refugeWays(g, c.start, length, blocked, refuge, access);
  const search = (accept?: (p: readonly PathSegment[]) => boolean) =>
    findRefugePath(g, c.start, length, blocked, refuge, access, accept);
  return { ways, takes, search };
}

/** Cheap cases, many of which hold no refuge at all: three times the usual seeds. */
const MANY_SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('findRefugePath on generated trees', () => {
  // the oracle: every way to a refuge, by exhaustive search; on a tree the search loses none
  it('finds the nearest refuge that holds the train, and one whenever there is one', () => {
    forAll(
      refugeCase,
      (c) => {
        const { ways, search } = refugeSearch(c);
        const got = search();
        if (!ways.length) return expect(got).toBeNull();
        expect(got, 'there is a refuge').not.toBeNull();
        expect(
          ways.some((w) => sameWay(w, got!)),
          showWay(got!),
        ).toBe(true);
        expect(got!.length).toBe(Math.min(...ways.map((w) => w.length)));
        // an accept that takes every refuge changes nothing
        expect(
          sameWay(
            search(() => true)!,
            got!,
          ),
        ).toBe(true);
      },
      { seeds: MANY_SEEDS, shrink: shrinkRefuge },
    );
  });

  it('offers accept only refuges that hold the train, nearest first, and returns the nearest it takes', () => {
    forAll(
      refugeCase,
      (c) => {
        const { ways, takes, search } = refugeSearch(c);
        const offered: PathSegment[][] = [];
        const got = search((p) => {
          offered.push(p.map((s) => ({ ...s })));
          return takes(p);
        });
        for (const p of offered)
          expect(
            ways.some((w) => sameWay(w, p)),
            `offered ${showWay(p)}`,
          ).toBe(true);
        for (let i = 1; i < offered.length; i++)
          expect(offered[i].length, 'offered nearest first').toBeGreaterThanOrEqual(
            offered[i - 1].length,
          );
        const taken = ways.filter(takes);
        if (!taken.length) return expect(got, `took ${got && showWay(got)}`).toBeNull();
        // a refuge turned down does not end the search: it goes on to the next
        expect(got, `${offered.length} offered, none taken`).not.toBeNull();
        expect(takes(got!)).toBe(true);
        expect(sameWay(offered.at(-1)!, got!), 'nothing offered after the one taken').toBe(true);
        expect(got!.length).toBe(Math.min(...taken.map((w) => w.length)));
      },
      { seeds: MANY_SEEDS, shrink: shrinkRefuge },
    );
  });
});

// ------------------------------------------------------------ a refuge with a way on

/** Row of the generated main line. */
const MAIN = 11;
/** A dead-end siding off the main line: a switch block on x and x + 1, plain track beyond. */
interface Siding {
  x: number;
  north: boolean;
  /** its throat faces east: a train heading west turns into it */
  east: boolean;
  len: number;
}
/**
 * The main line along MAIN from x 1 to `end` with sidings off it, a stop, a train on the main
 * line with its head at `head`, and another train ahead of it that it is held by: the other
 * stands on the main-line columns `other` and its route covers `theirs`.
 */
interface RetreatCase {
  end: number;
  sidings: Siding[];
  platform: Tile[];
  head: number;
  east: boolean;
  wagons: number;
  other: [number, number];
  theirs: [number, number];
}
const sidingTiles = (s: Siding): Tile[] =>
  Array.from({ length: s.len }, (_, i) => ({
    x: s.east ? s.x : s.x + 1,
    y: s.north ? MAIN - 2 - i : MAIN + 2 + i,
  }));
const columns = ([a, b]: [number, number]) =>
  Array.from({ length: b - a + 1 }, (_, i) => ({ x: a + i, y: MAIN }));

function layMain(c: RetreatCase) {
  const g = new TrackGraph(48, 26);
  const blocks = new Set<number>();
  for (const s of c.sidings) {
    if (s.north) g.place(s.x, MAIN - 1, 'switch', s.east ? 5 : 3);
    else g.place(s.x, MAIN, 'switch', s.east ? 1 : 7);
    blocks.add(s.x).add(s.x + 1);
    for (const t of sidingTiles(s)) g.place(t.x, t.y, 'straight', 0);
  }
  for (let x = 1; x <= c.end; x++) if (!blocks.has(x)) g.place(x, MAIN, 'straight', 1);
  return g;
}

/** The private Train member the refuge search starts from when the train backs off rear first. */
interface Reversible {
  reversedTrail(): { trail: { seg: PathSegment }[] };
}

/** The station the train is bound for, and the one an idle train stood at. */
const STOP = 7;
const STOOD = 8;

/**
 * The case laid out: the train, the context the fleet plans its way aside in, and the oracle the
 * planner must agree with. With `stood`, there is a station the train stood at, with its platform
 * under the train's head. Null when the train cannot stand there, stands on the other train, or
 * is not in the other's way.
 */
function standing(c: RetreatCase, stood = false) {
  const g = layMain(c);
  const def = content.locomotives.find((d) => d.id === 'f7')!;
  const hopper = content.wagons.find((d) => d.id === 'wood_hopper')!;
  const t = new Train([{ uid: 1, level: 0, def }], 'Behind', 1);
  t.wagons = Array.from({ length: c.wagons }, (_, i) => ({
    uid: 2 + i,
    def: hopper,
    level: 1,
    cargo: null,
    amount: 0,
    origin: null,
  }));
  if (!t.spawnAt(g, c.head, MAIN, c.east ? Dir.W : Dir.E)) return null;
  const keys = (ts: Tile[]) => new Set(ts.map((p) => g.key(p.x, p.y)));
  const theirs = keys(columns(c.theirs));
  const other = keys(columns(c.other));
  const under = t.occupancyKeys(g.w);
  if (under.some((k) => other.has(k)) || !under.some((k) => theirs.has(k))) return null;
  t.schedule = [defaultStop(STOP)];
  const platforms = new Map([
    [STOP, c.platform],
    [STOOD, [{ x: c.head, y: MAIN }]],
  ]);
  const stations = (stood ? [STOP, STOOD] : [STOP]).map((id) => ({ id }) as Station);
  const ctx = {
    track: g,
    now: 10,
    map: emptyMap(1, g.w, g.h, Terrain.Grass),
    builder: {
      stations,
      stationById: (id: number) => stations.find((s) => s.id === id),
      platformTiles: (s: Station) => platforms.get(s.id)!,
    },
    trainPath: (id: number) => (id === 2 ? theirs : new Set<number>()),
    occupied: (x: number, y: number) => other.has(g.key(x, y)),
    occupants: (x: number, y: number) => (other.has(g.key(x, y)) ? [2] : []),
    recoveryOwner: () => null,
    claimedBy: () => null,
  } as unknown as TickCtx;
  const blocked = (x: number, y: number) => other.has(g.key(x, y));
  /** refugePlan's rules: plain 1×1 track off the other's route and train, off `barred`, on `only` */
  const refugeOff = (barred: Set<number>, only?: Set<number>) => (x: number, y: number) => {
    const p = g.get(x, y);
    const k = g.key(x, y);
    const off = !theirs.has(k) && !barred.has(k) && !blocked(x, y);
    return !!p && p.links.length === 1 && !p.unit && off && (!only || only.has(k));
  };
  const starts = [t.headSeg!, (t as unknown as Reversible).reversedTrail().trail.at(-1)!.seg];
  /** every refuge either end of the train could pull into */
  const waysTo = (refuge: (x: number, y: number) => boolean) =>
    starts.flatMap((s) => refugeWays(g, s, t.length, blocked, refuge, t.canUse));
  /** the oracle for a way to a station: on its platform, or a way there as findPath finds it */
  const wayTo = (id: number) => {
    const plat = keys(platforms.get(id)!);
    const isStop = (x: number, y: number) => plat.has(g.key(x, y));
    return (s: State) =>
      isStop(s.x, s.y) || findPath(g, s, isStop, Infinity, undefined, t.canUse) !== null;
  };
  /** the train standing at the end of `way`: a way on, head first or rear first */
  const wayOn = (way: readonly PathSegment[], to: (s: State) => boolean) => {
    const last = way[way.length - 1];
    if (to(last)) return true;
    // the rear stands `t.length` back from the head, which stops at the last tile's centre
    let behind = 0;
    for (let i = way.length - 1; i >= 0; i--) {
      const s = way[i];
      behind += g.segLength(s.x, s.y, s.in, s.out) / (i === way.length - 1 ? 2 : 1);
      if (behind >= t.length || i === 0) return to({ x: s.x, y: s.y, in: s.out });
    }
    return false;
  };
  return { g, t, ctx, keys, starts, refugeOff, waysTo, wayTo, wayOn, platforms };
}

/** A train held by the other, planning where to back off to (`planRetreat`). */
function retreatSetUp(c: RetreatCase) {
  const s = standing(c);
  if (!s) return null;
  const { t, ctx, keys, starts, refugeOff, waysTo, wayTo, wayOn } = s;
  t.state = 'moving';
  t.blockedBy = 2;
  // the jam resolution keeps every refuge off every platform
  const ways = waysTo(refugeOff(keys(c.platform)));
  const to = wayTo(STOP);
  return { t, ctx, starts, ways, wayFrom: to, wayOn: (w: readonly PathSegment[]) => wayOn(w, to) };
}

function retreatCase(rng: Rng): RetreatCase {
  for (;;) {
    const end = rng.int(24, 44);
    const sidings: Siding[] = [];
    for (let n = rng.int(1, 4), i = 0; sidings.length < n && i < 30; i++) {
      const s: Siding = {
        x: rng.int(3, end - 4),
        north: rng.chance(0.5),
        east: rng.chance(0.5),
        len: rng.int(3, 8),
      };
      if (sidings.every((o) => Math.abs(o.x - s.x) >= 3)) sidings.push(s);
    }
    const blocks = new Set(sidings.flatMap((s) => [s.x, s.x + 1]));
    const plain = columns([1, end]).filter((t) => !blocks.has(t.x));
    const platform = [rng.chance(0.5) ? rng.pick(plain) : rng.pick(sidingTiles(rng.pick(sidings)))];
    const east = rng.chance(0.5);
    const head = rng.int(2, end - 1);
    const gap = rng.int(1, 4);
    const size = rng.int(1, 3);
    const other: [number, number] = east
      ? [head + gap, head + gap + size]
      : [head - gap - size, head - gap];
    const reach = rng.int(2, 16);
    const theirs: [number, number] = east
      ? [Math.max(1, head - reach), other[1]]
      : [other[0], Math.min(end, head + reach)];
    const c = { end, sidings, platform, head, east, wagons: rng.int(0, 2), other, theirs };
    if (other[0] >= 1 && other[1] <= end && retreatSetUp(c)) return c;
  }
}
function* shrinkRetreat(c: RetreatCase): Iterable<RetreatCase> {
  const out: RetreatCase[] = [];
  for (const sidings of shrinkArray(c.sidings)) out.push({ ...c, sidings });
  for (const wagons of shrinkInt(c.wagons)) out.push({ ...c, wagons });
  c.sidings.forEach((s, i) => {
    for (const len of shrinkInt(s.len, 1))
      out.push({ ...c, sidings: c.sidings.map((d, j) => (j === i ? { ...d, len } : d)) });
  });
  for (const r of out) if (retreatSetUp(r)) yield r;
}

describe('planRetreat on generated lines with sidings', () => {
  // the oracle: every refuge either end of the train could back into (an exhaustive search on
  // a line whose sidings are dead ends), and findPath on from the end of each
  it('backs a train only into a refuge it can go on to its stop from, and into one if there is one', () => {
    forAll(
      retreatCase,
      (c) => {
        const { t, ctx, starts, ways, wayFrom, wayOn } = retreatSetUp(c)!;
        // with no way to its stop from where it stands, any refuge will do
        const had = starts.some(wayFrom);
        const fit = had ? ways.filter(wayOn) : ways;
        const plan = t.planRetreat(ctx, [1, 2]);
        const story = `had a way on: ${had}; ${fit.length} of ${ways.length} refuges fit; plan ${plan && showWay(plan.path)}`;
        if (!plan) return expect(fit.map(showWay), story).toEqual([]);
        expect(
          ways.some((w) => sameWay(w, plan.path)),
          story,
        ).toBe(true);
        if (had) expect(wayOn(plan.path), story).toBe(true);
      },
      { seeds: MANY_SEEDS, shrink: shrinkRetreat },
    );
  });
});
