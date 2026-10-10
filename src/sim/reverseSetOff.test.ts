// Where a train that ran to where it stands sets off reversing (#200): from the tile its rear end
// lies on, which is the tile `Train.onwardTest` counts a way on from. Every locomotive with 0-4
// wagons runs to a warehouse on straight track and through curves, regular and narrow.
import { describe, it, expect, beforeEach } from 'vitest';
import { Dir } from '../engine/iso';
import { simWorld, station, type SimWorld } from '../testing/simWorld';
import { Train, defaultStop } from './trains';
import { Polyline } from './body';
import { locoDef, wagonDef } from '../gacha/items';
import { rules, DEFAULT_RULES } from './rules';
import { setSeasonOffset } from './weather';
import { content } from '../data/content';
import { SUPPLY_KINDS, collectorCeiling } from './catenary';
import type { PathSegment } from '../world/pathfinding';
import type { TrackClass, TrackGraph } from '../world/track';

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
 * The train standing at the start, sent to the warehouse with full tanks (electric stock under a
 * live wire its collector takes, everywhere) and run until it stops, with the path it ran. Null
 * when it never set off.
 */
function run(w: SimWorld, stopId: number, layout: Layout, loco: string, wagons: string[]) {
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
  if (!t.spawnAt(w.track, layout.start.x, layout.start.y, Dir.W)) return null;
  t.oil = t.oilCap;
  t.coal = t.coalCap;
  t.water = t.waterCap;
  t.battery = t.batteryCap;
  t.mode = 'schedule';
  t.schedule = [{ ...defaultStop(stopId), waitFull: false, load: 'none' }];
  w.fleet.trains.push(t);
  if (!t.dispatch(w.track, w.builder, w.map)) return null;
  const path = [...(t as unknown as Peek).path!];
  t.onPathReady({ builder: w.builder });
  let now = 0;
  for (let i = 0; i < 4000 && t.state === 'moving'; i++) w.fleet.tick(0.05, (now += 0.05));
  return { t, path };
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
