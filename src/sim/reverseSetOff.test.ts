// Where a train that ran to where it stands sets off reversing (#200): from the tile its rear end
// lies on, which is the tile `Train.onwardTest` counts a way on from. Every locomotive with 0-4
// wagons runs to a warehouse on straight track and through curves, regular and narrow. Then, from
// seeded cases: lines winding either way through curves of either gauge, run with ticks of random
// length, cut short or run to the stop and back, with the rear end put on each tile edge behind
// the head and just either side of it.
import { describe, it, expect, beforeEach } from 'vitest';
import { Dir, DIRS, DIR_DX, DIR_DY, opposite, rotateDir } from '../engine/iso';
import { Rng } from '../engine/rng';
import { simWorld, station, type SimWorld } from '../testing/simWorld';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { Train, defaultStop, type TickCtx } from './trains';
import { Polyline } from './body';
import { locoDef, wagonDef } from '../gacha/items';
import { rules, DEFAULT_RULES } from './rules';
import { setSeasonOffset } from './weather';
import { content } from '../data/content';
import { SUPPLY_KINDS, collectorCeiling } from './catenary';
import type { Station } from './stations';
import type { PathSegment } from '../world/pathfinding';
import {
  TrackGraph,
  footprintOf,
  pieceLinks,
  rotationCount,
  type TrackClass,
  type TrackKind,
} from '../world/track';

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSeasonOffset(0);
});

/** How far from a tile edge a point counts as on it (`EDGE_SLACK` in trains.ts). */
const SLACK = 1e-6;

interface TrailPoint {
  x: number;
  y: number;
  seg: PathSegment;
}
/** The private parts of a train the properties read. */
interface Peek {
  trail: TrailPoint[];
  path: PathSegment[] | null;
  reversedTrail(): { trail: TrailPoint[] };
}

/** One piece: a tile, `straight` or `curve`, and its turn. */
type Lay = readonly [x: number, y: number, kind: 'straight' | 'curve', rot: number];

/**
 * A layout: its pieces, the tile the train stands on facing east (entering from the west), and
 * the warehouse whose gate tile is the stop.
 */
interface Layout {
  name: string;
  cls: TrackClass;
  pieces: Lay[];
  start: { x: number; y: number };
  warehouse: { x: number; y: number };
}

/** East-west straights along row `y` from `x0` to `x1`. */
function row(y: number, x0: number, x1: number): Lay[] {
  return Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y, 'straight', 1] as const);
}

/** Straight along row 30, the stop 18 tiles on. */
function straight(cls: TrackClass): Layout {
  return {
    name: `${cls} straight`,
    cls,
    pieces: row(30, 2, 40),
    start: { x: 12, y: 30 },
    warehouse: { x: 30, y: 29 },
  };
}

/**
 * East along row 20, a step down to row 24 through two 2×2 curves (east to south, then south to
 * east, one straight between), and east again, `gap` tiles more past the first, to the stop.
 */
function wideStep(cls: TrackClass, gap: number): Layout {
  return {
    name: `${cls} curves ${gap + 1} tiles behind the stop`,
    cls,
    pieces: [
      ...row(20, 2, 15),
      [16, 20, 'curve', 2],
      [17, 22, 'straight', 0],
      [17, 23, 'curve', 0],
      ...row(24, 19, 40),
    ],
    start: { x: 8, y: 20 },
    warehouse: { x: 19 + gap, y: 25 },
  };
}

/**
 * East along row 20 and down two rows through four 1×1 curves (east to south, south to east, a
 * straight, and the same again), and east again, `gap` tiles more past the first, to the stop.
 */
function narrowSteps(gap: number): Layout {
  return {
    name: `narrow curves ${gap + 1} tiles behind the stop`,
    cls: 'narrow',
    pieces: [
      ...row(20, 2, 15),
      [16, 20, 'curve', 2],
      [16, 21, 'curve', 0],
      [17, 21, 'straight', 1],
      [18, 21, 'curve', 2],
      [18, 22, 'curve', 0],
      ...row(22, 19, 40),
    ],
    start: { x: 8, y: 20 },
    warehouse: { x: 19 + gap, y: 23 },
  };
}

const GAPS = [0, 1, 2];
const LAYOUTS: Record<'regular' | 'narrow', Layout[]> = {
  regular: [straight('regular'), ...GAPS.map((g) => wideStep('regular', g))],
  narrow: [straight('narrow'), ...GAPS.map(narrowSteps)],
};

/**
 * The wagons behind each locomotive: 0-4 wood hoppers on regular gauge; on narrow gauge 0-4 mine
 * tubs and box wagons by turns, and five tubs, which make a Muki a whole number of tiles and a half
 * long, its rear end on a tile edge on straight track.
 */
function consists(narrow: boolean): string[][] {
  if (!narrow) return [0, 1, 2, 3, 4].map((n) => Array<string>(n).fill('wood_hopper'));
  const mixed = [0, 1, 2, 3, 4].map((n) =>
    Array.from({ length: n }, (_, i) => (i % 2 ? 'narrow_box' : 'mine_tub')),
  );
  return [...mixed, Array<string>(5).fill('mine_tub')];
}

/** A world with the layout laid through the builder, as a player lays it, and its warehouse. */
function build(layout: Layout) {
  const w = simWorld({ terrain: 'grass', size: 64 });
  w.builder.free = true;
  for (const [x, y, kind, rot] of layout.pieces) {
    const item = { kind, cls: layout.cls };
    if (!w.builder.placeTrack(x, y, item, rot))
      throw new Error(
        `${layout.name}: no ${kind} at ${x},${y}: ${w.builder.checkTrack(x, y, item, rot).reason}`,
      );
  }
  const stop = station(w, 'warehouse', layout.warehouse.x, layout.warehouse.y);
  return { w, stop };
}

/**
 * The train standing at the start, sent to the warehouse and run until it stops, with the path it
 * ran. Null when it never set off.
 */
function run(w: SimWorld, stopId: number, layout: Layout, loco: string, wagons: string[]) {
  const t = board(w, stopId, loco, wagons, { ...layout.start, entry: Dir.W });
  if (!t || !t.dispatch(w.track, w.builder, w.map)) return null;
  const path = [...(t as unknown as Peek).path!];
  t.onPathReady({ builder: w.builder });
  let now = 0;
  for (let i = 0; i < 4000 && t.state === 'moving'; i++) w.fleet.tick(0.05, (now += 0.05));
  return { t, path };
}

/**
 * A train of `loco` and `wagons` placed on a tile, entered through `entry`, with full tanks
 * (electric stock under a live wire its collector takes, everywhere) and bound for the station
 * `stopId`. Null when it cannot stand there.
 */
function board(
  w: SimWorld,
  stopId: number,
  loco: string,
  wagons: string[],
  at: { x: number; y: number; entry: Dir },
) {
  const def = locoDef(loco);
  if (def.type === 'electric') {
    const kind = SUPPLY_KINDS.find((k) => collectorCeiling(def.collector, k) !== null) ?? null;
    w.fleet.powered = () => true;
    w.fleet.supplyAt = () => kind;
    w.fleet.gridFactor = () => 1;
    w.fleet.gridDraw = () => {};
    w.stock.add('power', 1e9);
  }
  const t = new Train([{ uid: 1, level: 1, def }]);
  t.wagons = wagons.map((id, i) => ({
    uid: 2 + i,
    def: wagonDef(id),
    level: 1,
    cargo: null,
    amount: 0,
    origin: null,
  }));
  if (!t.spawnAt(w.track, at.x, at.y, at.entry)) return null;
  t.oil = t.oilCap;
  t.coal = t.coalCap;
  t.water = t.waterCap;
  t.battery = t.batteryCap;
  t.mode = 'schedule';
  t.schedule = [{ ...defaultStop(stopId), waitFull: false, load: 'none' }];
  w.fleet.trains.push(t);
  return t;
}

/** The chords of a tile crossing, as the cars stand along them: up to the centre with `head`. */
function chords(track: TrackGraph, s: PathSegment, head: boolean) {
  const pts = track.segGeom(s.x, s.y, s.in, s.out, s.route).pts;
  const upto = head ? Math.floor(pts.length / 2) + 1 : pts.length;
  return pts.slice(0, upto).map((p) => ({ x: s.x + p.x, y: s.y + p.y }));
}

/** Within `SLACK` of a tile edge along x or y. */
function onEdge(p: { x: number; y: number }) {
  const off = (v: number) => Math.abs(v + 0.5 - Math.round(v + 0.5));
  return off(p.x) < SLACK || off(p.y) < SLACK;
}

/**
 * Everything wrong with where the train stands after its run, one line each:
 * - every point of its trail lies on the tile it carries;
 * - every tile edge the path crosses within the trail is a point of the trail, as far back from
 *   the head as the tiles' chords add up to: the trail measures what `onwardTest` measures;
 * - its reversed trail starts on the tile the rear end lies on, `length` back along the trail
 *   from the head, and for a rear end on a tile edge on the tile beyond it;
 * - and on the tile `onwardTest` counts from, worked out from the tiles the train ran: the first
 *   one back from the head whose chords take the count past the train's length, entered the
 *   other way round.
 */
function wrongs(track: TrackGraph, t: Train, path: PathSegment[]): string[] {
  const out: string[] = [];
  const { trail } = t as unknown as Peek;
  const line = new Polyline(trail);
  const total = line.length;
  const off = trail.find(
    (p) => Math.max(Math.abs(p.x - p.seg.x), Math.abs(p.y - p.seg.y)) > 0.5 + SLACK,
  );
  if (off)
    out.push(
      `trail point (${off.x.toFixed(3)},${off.y.toFixed(3)}) carries (${off.seg.x},${off.seg.y})`,
    );
  // back from the head along the tiles the train ran: the chords to each tile's far edge, and the
  // tile whose chords take the count past the train's length
  let behind = 0;
  let counted: PathSegment | null = null;
  let astray: string | null = null;
  for (let i = path.length - 1; i >= 0; i--) {
    const pts = chords(track, path[i], i === path.length - 1);
    for (let k = pts.length - 1; k > 0; k--)
      behind += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    if (!counted && behind > t.length + SLACK) counted = path[i];
    const edge = pts[0];
    const at = line.at(total - behind);
    if (!astray && behind < total - 1e-9 && Math.hypot(at.x - edge.x, at.y - edge.y) > 1e-9)
      astray = `the edge at (${edge.x.toFixed(3)},${edge.y.toFixed(3)}) lies ${behind.toFixed(6)} back by the chords; the trail there is at (${at.x.toFixed(6)},${at.y.toFixed(6)})`;
  }
  if (astray) out.push(astray);
  const end = total - t.length;
  const rearEnd = line.at(end);
  const lies = onEdge(rearEnd) ? line.at(end - 1e-3) : rearEnd;
  const want = { x: Math.round(lies.x), y: Math.round(lies.y) };
  const got = (t as unknown as Peek).reversedTrail().trail.at(-1)!.seg;
  const edgeNote = onEdge(rearEnd) ? ' (on an edge)' : '';
  if (got.x !== want.x || got.y !== want.y)
    out.push(
      `rear end at (${rearEnd.x.toFixed(3)},${rearEnd.y.toFixed(3)})${edgeNote} on (${want.x},${want.y}); sets off from (${got.x},${got.y})`,
    );
  if (!counted) out.push(`the path is shorter than the train`);
  else if (
    got.x !== counted.x ||
    got.y !== counted.y ||
    got.in !== counted.out ||
    got.out !== counted.in
  )
    out.push(
      `onwardTest counts from (${counted.x},${counted.y}) entered through ${counted.out}; sets off from (${got.x},${got.y}) entered through ${got.in}`,
    );
  return out;
}

describe('a train that ran to where it stands, reversing', () => {
  it(
    'sets off from the tile its rear end lies on, which onwardTest counts from, for every locomotive with 0-4 wagons on straight and curved track',
    { timeout: 300_000 },
    () => {
      const rows: string[] = [];
      let runs = 0;
      let onAnEdge = 0;
      for (const def of content.locomotives) {
        const narrow = def.gauge === 'narrow';
        for (const layout of LAYOUTS[narrow ? 'narrow' : 'regular'])
          for (const wagons of consists(narrow)) {
            const { w, stop } = build(layout);
            const ran = run(w, stop.id, layout, def.id, wagons);
            const what = `${def.id}+${wagons.length} on ${layout.name}`;
            if (!ran) {
              rows.push(`${what}: never set off`);
              continue;
            }
            const { t, path } = ran;
            // the head stands where its path ends, on the stop's centre
            const end = chords(w.track, path[path.length - 1], true).at(-1)!;
            const head = t.headPos!;
            if (
              (t.state !== 'loading' && t.state !== 'waiting') ||
              Math.hypot(head.x - end.x, head.y - end.y) > 1e-9
            ) {
              rows.push(`${what}: ${t.state} at (${head.x},${head.y}), not at its stop`);
              continue;
            }
            runs++;
            const trail = new Polyline((t as unknown as Peek).trail);
            if (onEdge(trail.at(trail.length - t.length))) onAnEdge++;
            for (const wrong of wrongs(w.track, t, path))
              rows.push(`${what}, ${t.length.toFixed(1)} tiles long: ${wrong}`);
          }
      }
      expect(rows).toEqual([]);
      // every consist ran, and some stood with the rear end on an edge
      expect(runs).toBe(
        content.locomotives.reduce((n, d) => n + 4 * consists(d.gauge === 'narrow').length, 0),
      );
      expect(onAnEdge).toBeGreaterThan(0);
    },
  );
});

// ----------------------------------------------------- wherever the rear end lies, either way on

/** The private parts of a train the properties below read and drive. */
interface Inside {
  trail: TrailPoint[];
  trailCum: number[];
  path: PathSegment[] | null;
  reversedTrail(): { trail: TrailPoint[] };
  reverseConsist(): void;
  samplePath(arc: number): TrailPoint;
  onwardTest(ctx: TickCtx): ((path: readonly PathSegment[]) => boolean) | null;
}
const inside = (t: Train) => t as unknown as Inside;

/** A tile a train runs through, entered through `in` and left through `out`. */
interface Step {
  x: number;
  y: number;
  in: Dir;
  out: Dir;
}
/** A piece to lay: its anchor, kind and turn. */
interface Put {
  x: number;
  y: number;
  kind: TrackKind;
  rot: number;
}

/** The turn of a one-tile `kind` that joins edges `a` and `b`. */
function turnOf(kind: TrackKind, a: Dir, b: Dir) {
  for (let rot = 0; rot < rotationCount(kind); rot++)
    if (pieceLinks(kind, rot).some(([p, q]) => (p === a && q === b) || (p === b && q === a)))
      return rot;
  throw new Error(`no ${kind} joins ${a} and ${b}`);
}

/**
 * The 2×2 curve a train enters at (0, 0) through `entry` and leaves heading `to`: its anchor and
 * turn, and the tiles the train runs through it, found by laying each turn and anchor on a scratch
 * graph and following the rails in from the edge of the block.
 */
function bigCurve(entry: Dir, to: Dir): { put: Put; steps: Step[] } {
  for (let rot = 0; rot < rotationCount('curve'); rot++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const g = new TrackGraph(8, 8);
        g.place(3 - dx, 3 - dy, 'curve', rot, 'regular');
        if (g.has(3 + DIR_DX[entry], 3 + DIR_DY[entry])) continue;
        const steps: Step[] = [];
        let x = 3;
        let y = 3;
        let from = entry;
        for (;;) {
          const out = g.exits(x, y, from);
          if (out.length !== 1) break;
          steps.push({ x: x - 3, y: y - 3, in: from, out: out[0] });
          x += DIR_DX[out[0]];
          y += DIR_DY[out[0]];
          if (!g.has(x, y)) {
            if (out[0] === to) return { put: { x: -dx, y: -dy, kind: 'curve', rot }, steps };
            break;
          }
          from = opposite(out[0]);
        }
      }
  throw new Error(`no 2×2 curve turns from entry ${entry} to heading ${to}`);
}

/**
 * A line that never meets itself: legs of straight track, each turning through a curve of its
 * class to the other of two headings at right angles.
 */
interface Line {
  cls: 'regular' | 'narrow';
  /** the heading of the first leg, and the one the line turns to and back from */
  first: Dir;
  side: Dir;
  /** straight tiles in each leg; the start is the first leg's second tile, the stop the last tile */
  legs: number[];
}

/**
 * The line laid from (0, 0): its pieces, the tiles a train runs along it from end to end, the
 * warehouse beside its last tile, on the side the line never turns back to, and the one beside
 * its first tile (`home`), on the side it never turns to.
 */
function plan(line: Line) {
  const puts: Put[] = [];
  const steps: Step[] = [];
  let x = 0;
  let y = 0;
  let heading = line.first;
  line.legs.forEach((n, leg) => {
    for (let i = 0; i < n; i++) {
      puts.push({ x, y, kind: 'straight', rot: turnOf('straight', opposite(heading), heading) });
      steps.push({ x, y, in: opposite(heading), out: heading });
      x += DIR_DX[heading];
      y += DIR_DY[heading];
    }
    if (leg === line.legs.length - 1) return;
    const to = heading === line.first ? line.side : line.first;
    if (line.cls === 'narrow') {
      puts.push({ x, y, kind: 'curve', rot: turnOf('curve', opposite(heading), to) });
      steps.push({ x, y, in: opposite(heading), out: to });
      x += DIR_DX[to];
      y += DIR_DY[to];
    } else {
      const c = bigCurve(opposite(heading), to);
      puts.push({ ...c.put, x: x + c.put.x, y: y + c.put.y });
      for (const s of c.steps) steps.push({ ...s, x: x + s.x, y: y + s.y });
      const last = c.steps[c.steps.length - 1];
      x += last.x + DIR_DX[to];
      y += last.y + DIR_DY[to];
    }
    heading = to;
  });
  const stop = steps[steps.length - 1];
  const away = heading === line.first ? line.side : line.first;
  const back = opposite(line.side);
  return {
    puts,
    steps,
    warehouse: { x: stop.x + DIR_DX[away], y: stop.y + DIR_DY[away] },
    home: { x: DIR_DX[back], y: DIR_DY[back] },
  };
}

/** Where pieces and warehouses go: by the stop and, when given, by the first tile (`home`). */
interface Plan {
  puts: Put[];
  steps: Step[];
  warehouse: { x: number; y: number };
  home?: { x: number; y: number };
}

/**
 * A grass world with the pieces laid through the builder, as a player lays them, two tiles in
 * from the corner, and the warehouses; the steps moved with them.
 */
function layDown(cls: TrackClass, p: Plan) {
  const tiles = [
    ...p.puts.flatMap((q) => footprintOf(q.x, q.y, q.kind, q.rot, cls)),
    p.warehouse,
    ...(p.home ? [p.home] : []),
  ];
  const dx = 2 - Math.min(...tiles.map((t) => t.x));
  const dy = 2 - Math.min(...tiles.map((t) => t.y));
  const size = Math.max(...tiles.map((t) => Math.max(t.x + dx, t.y + dy))) + 3;
  const w = simWorld({ terrain: 'grass', size: Math.max(16, size) });
  w.builder.free = true;
  for (const q of p.puts) {
    const item = { kind: q.kind, cls, cls2: cls };
    if (!w.builder.placeTrack(q.x + dx, q.y + dy, item, q.rot))
      throw new Error(
        `no ${q.kind} at ${q.x + dx},${q.y + dy}: ${w.builder.checkTrack(q.x + dx, q.y + dy, item, q.rot).reason}`,
      );
  }
  const stop = station(w, 'warehouse', p.warehouse.x + dx, p.warehouse.y + dy);
  const home = p.home && station(w, 'warehouse', p.home.x + dx, p.home.y + dy);
  return { w, stop, home, steps: p.steps.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })) };
}

/** A run cut short or run to its stop, and what it is checked against. */
interface Winding {
  line: Line;
  loco: string;
  wagons: string[];
  /** the longest tick in seconds of game time; each is drawn from 0.01 up to it */
  tick: number;
  /** the seed the ticks are drawn with */
  ticks: number;
  /** ticks after which the run is cut short, wherever the head is; null: it runs to its stop */
  cut: number | null;
  /**
   * When it reached its stop: ticks after which the run back, turned round, to the warehouse by
   * the first tile is cut short (20 000 to run there); null: it does not turn back
   */
  back: number | null;
  /** distances behind the head to probe besides the tile edges, as shares of the trail run */
  spots: number[];
}

function stockOf(narrow: boolean) {
  return {
    locos: content.locomotives.filter((d) => (d.gauge === 'narrow') === narrow).map((d) => d.id),
    wagons: content.wagons.filter((d) => (d.gauge === 'narrow') === narrow).map((d) => d.id),
  };
}

function winding(rng: Rng): Winding {
  const cls = rng.chance(0.5) ? 'regular' : 'narrow';
  const first = rng.pick(DIRS);
  const turns = rng.int(0, 4);
  const legs = Array.from({ length: turns + 1 }, (_, i) =>
    i === 0 ? rng.int(turns ? 2 : 3, 8) : rng.int(i === turns ? 1 : 0, 4),
  );
  const stock = stockOf(cls === 'narrow');
  return {
    line: { cls, first, side: rotateDir(first, rng.chance(0.5) ? 1 : 3), legs },
    loco: rng.pick(stock.locos),
    wagons: Array.from({ length: rng.int(0, 4) }, () => rng.pick(stock.wagons)),
    tick: rng.pick([0.05, 0.25, 0.8]),
    ticks: rng.int(1, 0x7fffffff),
    cut: rng.chance(0.4) ? rng.int(4, 120) : null,
    back: rng.chance(0.5) ? null : rng.chance(0.5) ? 20_000 : rng.int(4, 120),
    spots: Array.from({ length: 6 }, () => rng.next()),
  };
}

/** A line has a start and a stop beyond it: the first leg two tiles or more, the last one. */
function whole(c: Winding) {
  const { legs } = c.line;
  return legs[0] >= (legs.length > 1 ? 2 : 3) && legs[legs.length - 1] >= 1;
}

function* smaller(c: Winding): Iterable<Winding> {
  const out: Winding[] = [];
  if (c.cut !== null) out.push({ ...c, cut: null });
  if (c.back !== null) out.push({ ...c, back: null });
  if (c.spots.length) out.push({ ...c, spots: [] });
  if (c.tick !== 0.05) out.push({ ...c, tick: 0.05 });
  for (const wagons of shrinkArray(c.wagons)) out.push({ ...c, wagons });
  const { legs } = c.line;
  const withLegs = (l: number[]) => ({ ...c, line: { ...c.line, legs: l } });
  if (legs.length > 1)
    out.push(withLegs([...legs.slice(0, -2), Math.max(1, legs[legs.length - 2])]));
  for (let i = 0; i < legs.length; i++)
    for (const n of shrinkInt(legs[i])) out.push(withLegs(legs.map((m, j) => (j === i ? n : m))));
  if (c.cut !== null) for (const cut of shrinkInt(c.cut, 4)) out.push({ ...c, cut });
  if (c.back !== null) for (const back of shrinkInt(c.back, 4)) out.push({ ...c, back });
  for (const s of out) if (whole(s)) yield s;
}

/**
 * What a run left: the train, the way the trail it stands on was laid along (tile by tile in the
 * way it now runs), how far along that way the trail starts and how far the head stands.
 */
interface Ran {
  w: SimWorld;
  t: Train;
  path: PathSegment[];
  from: number;
  head: number;
}

/** Runs the fleet with ticks of random length from `seed` while the train moves, `most` at most. */
function roll(w: SimWorld, t: Train, c: Winding, seed: number, most: number | null) {
  const rng = new Rng(seed);
  let now = 0;
  for (let i = 0; i < 20_000 && t.state === 'moving' && (most === null || i < most); i++) {
    const dt = rng.range(0.01, c.tick);
    w.fleet.tick(dt, (now += dt));
  }
}

/**
 * The train of `c` on the second tile of its line, sent to the warehouse at the end and run until
 * it stops there or the run is cut short, and what a head on each edge of its path and just either
 * side of it stands on (`headWrongs`).
 */
function drive(c: Winding) {
  const { w, stop, home, steps } = layDown(c.line.cls, plan(c.line));
  const start = steps[1];
  const t = board(w, stop.id, c.loco, c.wagons, { x: start.x, y: start.y, entry: start.in });
  if (!t) throw new Error(`cannot stand on (${start.x},${start.y})`);
  if (!t.dispatch(w.track, w.builder, w.map)) throw new Error('finds no way to its stop');
  const path = [...inside(t).path!];
  const heads = headWrongs(w, t, path);
  const from = t.pathProgress;
  t.onPathReady({ builder: w.builder });
  roll(w, t, c, c.ticks, c.cut);
  const ran: Ran = { w, t, path, from, head: t.pathProgress };
  return { ran, steps, heads, home: home! };
}

/**
 * The train of a run that reached its stop at the end of its line, sent back to the warehouse by
 * its first tile: it turns round, sets off from the tile its rear end is on, and runs until it
 * stops there or the run is cut short. Its trail is laid along the tiles from where its head
 * stood to where its rear end stood, turned round, and on along the way back.
 */
function turnBack(c: Winding, { w, t, path, head }: Ran, home: Station) {
  const out: string[] = [];
  const rear = tileAt(chordLine(w.track, path).edges, head - t.length);
  t.schedule = [{ ...defaultStop(home.id), waitFull: false, load: 'none' }];
  t.routeIndex = 0;
  t.detour = null;
  if (!t.dispatch(w.track, w.builder, w.map) || !inside(t).path)
    throw new Error('finds no way back');
  const back = [...inside(t).path!];
  if (!same(back[0], turned(path[rear])))
    out.push(`sets off back from ${show(back[0])}, not ${show(turned(path[rear]))}`);
  out.push(...headWrongs(w, t, back));
  const behind = path
    .slice(rear + 1)
    .reverse()
    .map(turned);
  const way = [...behind, ...back];
  t.onPathReady({ builder: w.builder });
  roll(w, t, c, c.ticks ^ 0x5bd1e995, c.back);
  const ran: Ran = {
    w,
    t,
    path: way,
    from: stopArc(w.track, [way[0]]),
    head: chordLine(w.track, way).edges[behind.length] + t.pathProgress,
  };
  return { ran, out };
}

/** The chord line through a path's tiles: its points, the distance to each, and to each edge in. */
function chordLine(track: TrackGraph, path: PathSegment[]) {
  const pts: { x: number; y: number }[] = [];
  const cum: number[] = [];
  /** edges[k]: how far along the line path[k] is entered */
  const edges: number[] = [];
  for (const s of path) {
    edges.push(cum.length ? cum[cum.length - 1] : 0);
    for (const p of track.segGeom(s.x, s.y, s.in, s.out, s.route).pts) {
      const q = { x: s.x + p.x, y: s.y + p.y };
      const last = pts[pts.length - 1];
      if (last && Math.hypot(q.x - last.x, q.y - last.y) < 1e-9) continue;
      cum.push(last ? cum[cum.length - 1] + Math.hypot(q.x - last.x, q.y - last.y) : 0);
      pts.push(q);
    }
  }
  return { pts, cum, edges };
}
type ChordLine = ReturnType<typeof chordLine>;

/** The point `a` along the line. */
function along({ pts, cum }: ChordLine, a: number) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < a) i++;
  const t = (a - cum[i - 1]) / (cum[i] - cum[i - 1]);
  const [p, q] = [pts[i - 1], pts[i]];
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/** How far along a path a head stops: on its last tile's centre, by the chords. */
function stopArc(track: TrackGraph, path: PathSegment[]) {
  const pts = chords(track, path[path.length - 1], true);
  let sum = chordLine(track, path).edges[path.length - 1];
  for (let i = 1; i < pts.length; i++)
    sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return sum;
}

/**
 * The tile of the path a point `a` along it stands on, by the rule both ends of a train follow: a
 * point on an edge, or past it by no more than the slack, stands on the tile before the edge.
 */
function tileAt(edges: number[], a: number) {
  let k = 0;
  while (k + 1 < edges.length && edges[k + 1] + SLACK < a) k++;
  return k;
}

/** Each edge of a path and points just either side of it: within the slack, and beyond it. */
const OFFSETS = [0, 1e-9, -1e-9, 3e-7, -3e-7, 3e-6, -3e-6, 1e-4, -1e-4, 0.01, -0.01];

const same = (a: PathSegment, b: PathSegment) =>
  a.x === b.x && a.y === b.y && a.in === b.in && a.out === b.out;
const turned = (s: PathSegment): PathSegment => ({ x: s.x, y: s.y, in: s.out, out: s.in });
const show = (s: PathSegment) => `(${s.x},${s.y}) ${s.in}>${s.out}`;
const fix = (v: number) => v.toFixed(9);

/** `act` with the train `length` long, wherever its cars are: its rear end that far back. */
function withLength<T>(t: Train, length: number, act: () => T): T {
  Object.defineProperty(t, 'length', { configurable: true, get: () => length });
  try {
    return act();
  } finally {
    delete (t as unknown as { length?: number }).length;
  }
}

/**
 * A head on each edge of the path, or past it within the slack, stands on the tile it is leaving,
 * and anywhere else on the tile it is in (`samplePath`), on the path's chords.
 */
function headWrongs(w: SimWorld, t: Train, path: PathSegment[]): string[] {
  const out: string[] = [];
  const line = chordLine(w.track, path);
  const end = stopArc(w.track, path);
  for (let k = 1; k < path.length; k++)
    for (const d of OFFSETS) {
      const a = line.edges[k] + d;
      if (a > end) continue;
      const got = inside(t).samplePath(a);
      const want = path[d <= SLACK ? k - 1 : k];
      const at = along(line, a);
      if (!same(got.seg, want) || Math.hypot(got.x - at.x, got.y - at.y) > 1e-9)
        out.push(
          `a head ${d} past the edge into ${show(path[k])} is at (${fix(got.x)},${fix(got.y)}) on ${show(got.seg)}, not at (${fix(at.x)},${fix(at.y)}) on ${show(want)}`,
        );
    }
  return out;
}

/**
 * What `onwardTest` is asked at time `now`: the station, with its one platform on `tile`. Each ask
 * needs a time of its own: the states a stop is reached from are kept for the rest of a tick.
 */
const STOP_ID = 999;
function onwardCtx(w: SimWorld, tile: { x: number; y: number }, now: number): TickCtx {
  const stop = { id: STOP_ID } as Station;
  return {
    track: w.track,
    now,
    builder: {
      stationById: (id: number) => (id === STOP_ID ? stop : undefined),
      platformTiles: () => [{ x: tile.x, y: tile.y }],
    },
  } as unknown as TickCtx;
}

/** A distance behind the head to put the rear end at, and the path's tile it then stands on. */
interface Probe {
  back: number;
  k: number;
  own?: boolean;
}

/** The rear end on each edge of the path within `room` behind the head, and just either side. */
function edgeProbes(edges: number[], head: number, room: number): Probe[] {
  const out: Probe[] = [];
  for (let k = 1; k < edges.length; k++)
    for (const d of OFFSETS) {
      const back = head - (edges[k] + d);
      if (back > 1e-3 && back <= room) out.push({ back, k: d <= SLACK ? k - 1 : k });
    }
  return out;
}

/**
 * Turning round twice where it stands leaves a train setting off reversing from the tile it set
 * off from before: with its rear end on each edge behind the head, and just either side of it,
 * the tile `tileAt` puts the rear end on. The train is put back as it stood after each.
 */
function turnTwiceWrongs({ w, t, path, from, head }: Ran): string[] {
  const out: string[] = [];
  const line = chordLine(w.track, path);
  const room = Math.min(head - from, t.length + 1);
  for (const { back, k } of edgeProbes(line.edges, head, room)) {
    const was = { trail: inside(t).trail, trailCum: inside(t).trailCum, reversed: t.reversed };
    const got = withLength(t, back, () => {
      inside(t).reverseConsist();
      inside(t).reverseConsist();
      return inside(t).reversedTrail().trail.at(-1)!.seg;
    });
    Object.assign(inside(t), { trail: was.trail, trailCum: was.trailCum });
    t.reversed = was.reversed;
    t.updatePoses();
    if (!same(got, turned(path[k]))) {
      const rear = along(line, head - back);
      out.push(
        `with the rear end ${fix(back)} behind the head, at (${fix(rear.x)},${fix(rear.y)}), it sets off from ${show(got)} once it has turned round twice, not ${show(turned(path[k]))}`,
      );
    }
  }
  return out;
}

/**
 * Everything wrong with where a train that ran stands, one line each:
 * - the trail it laid runs along the chords of the tiles it ran: each point as far behind the
 *   head along the trail as along the chords, each tile edge a point of it, and each point
 *   carrying the tile it lies on, either tile for a point on an edge;
 * - with its rear end on each tile edge behind the head, and just either side of it, and at a few
 *   more places, it sets off reversing from the tile `tileAt` puts the rear end on, entered the
 *   other way round; and so with its own length;
 * - with `onward` (a train at its stop on a line without loops), `onwardTest` counts the way the
 *   train ran as a way on rear first to a stop on that tile, and not to one on the tile before
 *   it, nearer the head;
 * - turning round moves no car, and turning round again puts the head back on its tile.
 */
function standWrongs({ w, t, path, from, head }: Ran, spots: number[], onward: boolean) {
  const out: string[] = [];
  const line = chordLine(w.track, path);
  const { edges } = line;
  const ran = head - from;
  const { trail, trailCum } = inside(t);
  const total = trailCum[trailCum.length - 1];
  // the trail the run laid and the train keeps
  const laid = Math.min(ran, total - trailCum[0]);
  for (let j = 0; j < trail.length; j++) {
    const back = total - trailCum[j];
    if (back > laid + 1e-9) continue;
    const a = head - back;
    const p = trail[j];
    const q = along(line, a);
    if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-9)
      out.push(
        `the trail ${fix(back)} behind the head is at (${fix(p.x)},${fix(p.y)}); the chords there at (${fix(q.x)},${fix(q.y)})`,
      );
    const edge = edges.findIndex((e, k) => k > 0 && Math.abs(e - a) < 1e-9);
    let k = 0;
    while (k + 1 < edges.length && edges[k + 1] <= a) k++;
    const ok = edge > 0 ? [path[edge - 1], path[edge]] : [path[k]];
    if (!ok.some((s) => same(s, p.seg)))
      out.push(
        `the trail ${fix(back)} behind the head carries ${show(p.seg)}, lying on ${ok.map(show).join(' or ')}`,
      );
  }
  for (let k = 1; k < edges.length; k++) {
    const back = head - edges[k];
    if (back < 1e-9 || back > laid - 1e-9) continue;
    if (!trailCum.some((c) => Math.abs(total - c - back) < 1e-9))
      out.push(
        `the edge into ${show(path[k])}, ${fix(back)} behind the head, is no point of the trail`,
      );
  }

  const room = Math.min(ran, t.length + 1);
  const probes: Probe[] = edgeProbes(edges, head, room);
  for (const s of spots) {
    const back = Math.max(1e-3, s * room);
    if (edges.every((e) => Math.abs(head - back - e - SLACK) > 1e-8))
      probes.push({ back, k: tileAt(edges, head - back) });
  }
  if (t.length <= ran)
    probes.push({ back: t.length, k: tileAt(edges, head - t.length), own: true });
  for (const { back, k, own } of probes) {
    const got = own
      ? inside(t).reversedTrail().trail.at(-1)!.seg
      : withLength(t, back, () => inside(t).reversedTrail().trail.at(-1)!.seg);
    const rear = along(line, head - back);
    if (!same(got, turned(path[k])))
      out.push(
        `with the rear end ${fix(back)} behind the head${own ? ' (its own length)' : ''}, at (${fix(rear.x)},${fix(rear.y)}), it sets off from ${show(got)}, not ${show(turned(path[k]))}`,
      );
  }

  if (onward) {
    // the test is asked of a train standing on the stop, which has a way there, so it is made;
    // it counts back along `path` from its end, where this train's head stands
    const asker = new Train([{ uid: 1, level: 1, def: t.locoDef }]);
    asker.schedule = [defaultStop(STOP_ID)];
    let now = 0;
    for (const { back, k } of probes)
      for (const j of [k, k + 1]) {
        if (j >= path.length - 1) continue;
        asker.spawnAt(w.track, path[j].x, path[j].y, path[j].in);
        const counts = withLength(asker, back, () => {
          const test = inside(asker).onwardTest(onwardCtx(w, path[j], ++now));
          return !!test && test(path);
        });
        if (counts !== (j === k))
          out.push(
            `with the rear end ${fix(back)} behind the head, on (${path[k].x},${path[k].y}), onwardTest ${counts ? 'counts' : 'counts no'} way on rear first to a stop on (${path[j].x},${path[j].y})`,
          );
      }
  }

  if (edges.every((e) => Math.abs(e - head) > 1e-5)) {
    const was = {
      seg: { ...t.headSeg! },
      at: t.headPos!,
      cars: t.poses.map(({ x, y }) => ({ x, y })),
    };
    const moved = () =>
      t.poses.findIndex((p, i) => Math.hypot(p.x - was.cars[i].x, p.y - was.cars[i].y) > 1e-9);
    inside(t).reverseConsist();
    if (moved() >= 0) out.push(`turning round moves car ${moved()}`);
    inside(t).reverseConsist();
    const now = { seg: t.headSeg!, at: t.headPos! };
    if (!same(now.seg, was.seg) || Math.hypot(now.at.x - was.at.x, now.at.y - was.at.y) > 1e-9)
      out.push(`turning round twice puts the head on ${show(now.seg)}, not ${show(was.seg)}`);
    if (moved() >= 0) out.push(`turning round twice moves car ${moved()}`);
  }
  return out;
}

describe('a train that ran to where it stands, wherever its rear end lies', () => {
  it(
    'sets off reversing from the tile its rear end lies on, which onwardTest counts from, on lines winding either way through curves of either gauge',
    { timeout: 300_000 },
    () => {
      forAll(
        winding,
        (c) => {
          const { ran, steps, heads, home } = drive(c);
          const { t } = ran;
          const wrongs = [...heads];
          const line = steps.slice(1);
          if (ran.path.length !== line.length || ran.path.some((s, i) => !same(s, line[i])))
            wrongs.push(`runs ${ran.path.map(show).join(', ')}, not along its line`);
          /** Whether the run reached its stop, and stands on the centre of it if it did. */
          const reached = ({ w, path, head }: Ran, most: number | null) => {
            const arrived = t.state !== 'moving';
            if (most === null && !arrived) wrongs.push(`still ${t.state} after the run`);
            const short = stopArc(w.track, path) - head;
            if (arrived && Math.abs(short) > 1e-9)
              wrongs.push(`${t.state} ${fix(short)} short of its stop's centre`);
            return arrived;
          };
          const there = reached(ran, c.cut);
          wrongs.push(...standWrongs(ran, c.spots, there));
          // back from a rear end on the trail the run laid, short of the warehouse by the first tile
          if (there && c.back !== null && t.length < ran.head - ran.from && !wrongs.length) {
            const back = turnBack(c, ran, home);
            wrongs.push(...back.out.map((s) => `back: ${s}`));
            const returned = reached(back.ran, c.back < 20_000 ? c.back : null);
            wrongs.push(...standWrongs(back.ran, c.spots, returned).map((s) => `back: ${s}`));
          }
          if (wrongs.length)
            throw new Error(`${t.length.toFixed(1)} tiles long:\n${wrongs.join('\n')}`);
        },
        { shrink: smaller, shrinkBudget: 200, seeds: Array.from({ length: 300 }, (_, i) => i + 1) },
      );
    },
  );

  it('sets off reversing from the same tile once it has turned round twice where it stands', () => {
    forAll(
      winding,
      (c) => {
        const { ran } = drive(c);
        const wrongs = turnTwiceWrongs(ran);
        if (wrongs.length)
          throw new Error(`${ran.t.length.toFixed(1)} tiles long:\n${wrongs.join('\n')}`);
      },
      { shrink: smaller, shrinkBudget: 200 },
    );
  });

  it('a Muki with five mine tubs, its rear end on an edge, still sets off from the tile beyond it once it has turned round twice', () => {
    // 4.5 tiles: east along row 30 to the stop on (30, 30), its rear end on the edge between
    // (25, 30) and (26, 30)
    const layout = straight('narrow');
    const { w, stop } = build(layout);
    const { t } = run(w, stop.id, layout, 'muki', Array<string>(5).fill('mine_tub'))!;
    expect(t.length).toBeCloseTo(4.5, 9);
    expect(t.headPos).toEqual({ x: 30, y: 30 });
    const setsOff = () => show(inside(t).reversedTrail().trail.at(-1)!.seg);
    expect(setsOff()).toBe(show({ x: 25, y: 30, in: Dir.E, out: Dir.W }));
    inside(t).reverseConsist();
    inside(t).reverseConsist();
    expect(t.headPos).toEqual({ x: 30, y: 30 });
    expect(setsOff()).toBe(show({ x: 25, y: 30, in: Dir.E, out: Dir.W }));
  });

  it('on a figure of eight, sets off along the crossing the way its rear end ran over it', () => {
    // a narrow figure of eight through a crossing at (0, 0): the train starts on the curve north
    // of it heading south, runs the west loop and over the crossing again eastward, and stops on
    // the curve north-east of it, its rear end on the crossing it ran southward. Its trail holds
    // the crossing both ways, the way the head ran it 1.2 tiles back
    const [N, E, S, W] = [Dir.N, Dir.E, Dir.S, Dir.W];
    const steps: Step[] = [
      { x: 0, y: -1, in: E, out: S },
      { x: 0, y: 0, in: N, out: S },
      { x: 0, y: 1, in: N, out: W },
      { x: -1, y: 1, in: E, out: N },
      { x: -1, y: 0, in: S, out: E },
      { x: 0, y: 0, in: W, out: E },
      { x: 1, y: 0, in: W, out: N },
      { x: 1, y: -1, in: S, out: W },
    ];
    const puts: Put[] = steps
      .filter((s) => s.x || s.y)
      .map((s) => ({ x: s.x, y: s.y, kind: 'curve', rot: turnOf('curve', s.in, s.out) }));
    puts.push({ x: 0, y: 0, kind: 'crossing', rot: 0 });
    const laid = layDown('narrow', { puts, steps, warehouse: { x: 2, y: -1 } });
    const { w, stop } = laid;
    const at = laid.steps[0];
    // 4.8 tiles: the rear end stands on the crossing the way it ran it first
    const wagons = ['mine_tub', 'narrow_box', 'mine_tub', 'narrow_box'];
    const t = board(w, stop.id, 'rocket', wagons, { x: at.x, y: at.y, entry: at.in })!;
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    const path = [...inside(t).path!];
    expect(path.map(show)).toEqual(laid.steps.map(show));
    const heads = headWrongs(w, t, path);
    const from = t.pathProgress;
    t.onPathReady({ builder: w.builder });
    let now = 0;
    for (let i = 0; i < 4000 && t.state === 'moving'; i++) w.fleet.tick(0.05, (now += 0.05));
    expect(t.state).not.toBe('moving');
    expect(t.pathProgress).toBeCloseTo(stopArc(w.track, path), 9);
    expect(show(inside(t).reversedTrail().trail.at(-1)!.seg)).toBe(show(turned(path[1])));
    const spots = Array.from({ length: 19 }, (_, i) => (i + 1) / 20);
    const ran = { w, t, path, from, head: t.pathProgress };
    expect([...heads, ...standWrongs(ran, spots, false)]).toEqual([]);
  });
});
