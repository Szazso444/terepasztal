import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  COUPLER_GAP,
  DEFAULT_LATERAL_PLAY,
  DEFAULT_PIVOT,
  FACINGS,
  LARGE_PIVOT,
  OWN_LENGTH,
  Polyline,
  SIZE_LEN,
  poseVehicle,
  vehicleSpec,
  type BodyFields,
  type BodyPlan,
  type BogieKind,
  type SegmentSpec,
  type VehicleSize,
  type VehicleSpec,
} from './body';
import { measure, pieceClassFor, referencePath, verdictOf } from './compat';
import { Train, resetTrainIds } from './trains';
import { Fleet, type GateInfo } from './fleet';
import { Traffic } from './traffic';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { content, type LocoDef, type WagonDef } from '../data/content';
import { STR } from '../strings';
import { locoDef, wagonDef } from '../gacha/items';
import { Crafting, craftPool, craftRarity, craftSize, craftTier } from '../gacha/crafting';
import { Inventory } from '../gacha/inventory';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { findPath, type PathSegment } from '../world/pathfinding';
import { RegionState } from '../world/regions';
import {
  TRACK_CLASSES,
  TRACK_ITEMS,
  TrackGraph,
  pieceLinks,
  rotationCount,
  type SwitchForm,
  type TrackClass,
  type TrackItem,
} from '../world/track';
import { DIR_DX, DIR_DY, DIRS, Dir, opposite, type Vec2 } from '../engine/iso';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { buildTrafficScenario, SCENARIO_GDT } from '../testing/trafficScenario';
import { Rng, hash2, hashString } from '../engine/rng';
import { locoFrame, wagonFrame } from '../art/frames';

// A locomotive is as long on the track as its own model (issue #344): an optional `length` on its
// entry, in tiles over the buffers, wins over its size class's. Here: an entry without one is laid
// out exactly as before; one with a length in range keeps its rigid body at that length through
// curves, its plan's parts in proportion; a consist of them is the sum of its bodies and gaps;
// nothing outside vehicleSpec reads a size class's length; and a save carries no length, so a
// save from before loads with every train where it stood. Then the callers, each at the real
// length: a consist standing through curves of every class either way round, and what it
// occupies; a depot gate letting it out; a junction letting it in; a save made before its model
// had a length, loaded after. Last, what the length leaves alone: every job of the size (plan,
// pivots and bogies by default, drawn bogies, craft price, sprite frames), and the depot gate's
// verdict for any consist a tile long or more, whatever piece the gate is.

// the fleet plays sounds
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds(1);
  resetStationIds(1);
});

/** A test that runs about half a second or more alone carries its own limit, twenty times that. */
const SLOW = { timeout: 20_000 };

const SIZES: VehicleSize[] = ['tiny', 'small', 'medium', 'large'];
const PLANS: BodyPlan[] = ['rigid', 'tender', 'garratt', 'meyer'];

/**
 * `vehicleSpec` as it stood before a body could have a length of its own: every length from the
 * size class, the engine units of a tender engine and a Garratt fixed at 1.25 and 0.8 tiles. The
 * oracle for "an entry without a length gives exactly today's geometry".
 */
function classSpec(def: BodyFields): VehicleSpec {
  const size = def.size ?? 'small';
  const L = SIZE_LEN[size];
  let plan: BodyPlan = def.plan ?? 'rigid';
  if (size === 'small' || size === 'tiny') plan = 'rigid';
  if (size === 'medium' && plan !== 'tender') plan = 'rigid';
  if (size === 'large' && plan === 'tender') plan = 'rigid';
  const pr = def.pivotRatio ?? (size === 'large' ? LARGE_PIVOT : DEFAULT_PIVOT);
  const bogie: BogieKind =
    def.bogieAxles === 4 ? 'bogie4' : def.bogieAxles === 3 ? 'bogie3' : 'bogie';
  const segs: SegmentSpec[] = [];
  const nbRigid = def.bogies ?? (size === 'large' ? 3 : 2);
  if (plan === 'rigid') segs.push({ part: 'body', L, W: pr * L, nb: nbRigid, bogie, front: 0 });
  else if (plan === 'tender') {
    const le = 1.25;
    const lt = L - le;
    segs.push({ part: 'engine', L: le, W: pr * le, nb: 2, bogie, front: 0 });
    segs.push({ part: 'tender', L: lt, W: 0.66 * lt, nb: 2, bogie: 'bogie', front: le });
  } else if (plan === 'garratt') {
    const le = 0.8;
    const lc = L - 2 * le;
    segs.push({ part: 'engine', L: le, W: pr * le, nb: 2, bogie, front: 0 });
    segs.push({
      part: 'cradle',
      L: lc,
      W: Math.max(pr, 0.94) * lc,
      nb: 2,
      bogie: 'bogie',
      front: le,
    });
    segs.push({ part: 'engine', L: le, W: pr * le, nb: 2, bogie, front: le + lc, mirror: true });
  } else {
    const ratio = Math.max(0.5, Math.min(0.75, def.pivotRatio ?? 0.6));
    segs.push({ part: 'frame', L, W: ratio * L, nb: 2, bogie: 'engine_unit', front: 0 });
  }
  return {
    L,
    size,
    plan,
    segments: segs,
    drawBogies: size !== 'small' && size !== 'tiny',
    maxLateralPlay: def.maxLateralPlay ?? DEFAULT_LATERAL_PLAY,
  };
}

/** How long the issue says a body is: its entry's own length, or its size class's without one. */
const specLength = (def: BodyFields) => def.length ?? SIZE_LEN[def.size ?? 'small'];

/** A body of any size and plan, with or without its own pivots, bogies and axles. */
function genBody(rng: Rng): BodyFields {
  const body: BodyFields = { size: rng.pick(SIZES), plan: rng.pick(PLANS) };
  if (rng.chance(0.3)) body.pivotRatio = rng.range(0.4, 0.95);
  if (rng.chance(0.3)) body.bogies = rng.int(2, 3);
  if (rng.chance(0.3)) body.bogieAxles = rng.int(2, 4);
  return body;
}

/** A length in range, now and then one of its ends. */
function genLength(rng: Rng): number {
  if (rng.chance(0.1)) return rng.pick([OWN_LENGTH.min, OWN_LENGTH.max]);
  return rng.range(OWN_LENGTH.min, OWN_LENGTH.max);
}

describe('a body without a length of its own', () => {
  it('is laid out exactly as before, for every shipped vehicle', () => {
    for (const d of [...content.locomotives, ...content.wagons]) {
      // an entry that has been given its model's length is laid out by it, and without it as before
      const own = (d as BodyFields).length;
      if (own === undefined) expect(vehicleSpec(d), d.id).toEqual(classSpec(d));
      else expect(vehicleSpec(d).L, d.id).toBe(own);
      expect(vehicleSpec({ ...d, length: undefined }), d.id).toEqual(classSpec(d));
    }
  });

  it('is laid out exactly as before, for every size, plan, pivot, bogie count and axle count', () => {
    for (const size of SIZES)
      for (const plan of PLANS)
        for (const pivotRatio of [undefined, 0.5, 0.8])
          for (const bogies of [undefined, 2, 3])
            for (const bogieAxles of [undefined, 3, 4]) {
              const def: BodyFields = { size, plan, pivotRatio, bogies, bogieAxles };
              expect(vehicleSpec(def), JSON.stringify(def)).toEqual(classSpec(def));
            }
  });
});

describe('a body with a length of its own', () => {
  it('is that long, with its plan parts, pivots and bogies in the proportions of its size', () => {
    forAll(
      (rng) => ({ body: genBody(rng), length: genLength(rng) }),
      ({ body, length }) => {
        const own = vehicleSpec({ ...body, length });
        const cls = classSpec(body);
        const k = length / cls.L;
        expect(own.L).toBe(length);
        expect({ ...own, L: 0, segments: [] }).toEqual({ ...cls, L: 0, segments: [] });
        expect(own.segments).toHaveLength(cls.segments.length);
        let front = 0;
        own.segments.forEach((s, i) => {
          const c = cls.segments[i];
          expect({ ...s, L: 0, W: 0, front: 0 }).toEqual({ ...c, L: 0, W: 0, front: 0 });
          expect(s.L).toBeCloseTo(c.L * k, 12);
          expect(s.W).toBeCloseTo(c.W * k, 12);
          expect(s.front).toBeCloseTo(front, 12);
          expect(s.L).toBeGreaterThan(0);
          expect(s.W).toBeGreaterThan(0);
          expect(s.W).toBeLessThanOrEqual(s.L + 1e-12);
          front += s.L;
        });
        expect(front).toBeCloseTo(length, 12);
      },
    );
  });

  it('stays rigid through the curves of every track class, its bogies on the rails at their places', () => {
    forAll(
      (rng) => ({ body: genBody(rng), length: genLength(rng), reversed: rng.chance(0.5) }),
      ({ body, length, reversed }) => {
        const spec = vehicleSpec({ ...body, length });
        for (const cls of TRACK_CLASSES) {
          const pl = referencePath(cls);
          for (let front = spec.L; front <= pl.length; front += 0.2) {
            const pose = poseVehicle(pl, front, spec, reversed);
            const mid = pl.at(front - spec.L / 2);
            expect(Math.hypot(pose.x - mid.x, pose.y - mid.y)).toBeLessThan(1e-9);
            expect(pose.segments).toHaveLength(spec.segments.length);
            pose.segments.forEach((p, j) => {
              const s = spec.segments[j];
              // the body is drawn at its own length front to back, whatever the curve
              expect(p.L).toBe(s.L);
              const at = front - (reversed ? spec.L - s.front - s.L : s.front);
              p.bogies.forEach((b, k) => {
                const rail = pl.at(at - (s.L - s.W) / 2 - (s.W / (s.nb - 1)) * k);
                expect(Math.hypot(b.x - rail.x, b.y - rail.y)).toBeLessThan(1e-9);
              });
            });
          }
        }
      },
      { seeds: Array.from({ length: 40 }, (_, i) => i + 1) },
    );
  });
});

const ROW = 10;
const LINE_END = 70;

/** A straight regular line along ROW from x 2 to LINE_END. */
function straightLine() {
  const track = new TrackGraph(80, 24);
  for (let x = 2; x <= LINE_END; x++) track.place(x, ROW, 'straight', 1);
  return track;
}

/** A shipped regular-gauge locomotive with a length of its own. */
function ownLoco(id: string, length: number): LocoDef {
  return { ...locoDef(id), length };
}

const REGULAR_LOCOS = content.locomotives.filter((d) => d.gauge !== 'narrow' && !d.retired);
const REGULAR_WAGONS = content.wagons.filter((d) => d.gauge !== 'narrow' && !d.retired);

describe('a consist of locomotives with lengths of their own', () => {
  it('is as long as its bodies and the gaps between them, and stands so on the line', () => {
    forAll(
      (rng) => ({
        locos: Array.from({ length: rng.int(1, 3) }, () => ({
          id: rng.pick(REGULAR_LOCOS).id,
          length: rng.chance(0.2) ? undefined : genLength(rng),
        })),
        wagons: Array.from({ length: rng.int(0, 4) }, () => rng.pick(REGULAR_WAGONS).id),
      }),
      ({ locos, wagons }) => {
        const t = new Train(
          locos.map((l, i) => ({
            uid: i + 1,
            level: 1,
            def: l.length === undefined ? locoDef(l.id) : ownLoco(l.id, l.length),
          })),
        );
        t.wagons = wagons.map((id, i) => ({
          uid: 100 + i,
          def: wagonDef(id),
          level: 1,
          cargo: null,
          amount: 0,
          origin: null,
        }));
        const lengths = [
          ...locos.map((l) => l.length ?? specLength(locoDef(l.id))),
          ...wagons.map((id) => specLength(wagonDef(id))),
        ];
        expect(t.carLengths).toEqual(lengths);
        const sum = lengths.reduce((a, b) => a + b, 0);
        expect(t.length).toBeCloseTo(sum + (lengths.length - 1) * COUPLER_GAP, 9);

        const track = straightLine();
        expect(t.spawnAt(track, LINE_END - 2, ROW, Dir.W)).toBe(true);
        expect(t.vehiclePoses).toHaveLength(lengths.length);
        // on a straight line each vehicle's middle is half of each body and a coupler gap on from
        // the one before, and the consist reaches from the head's front to the tail's back
        const mids = t.vehiclePoses.map((v) => ({ x: v.x, y: v.y }));
        for (let i = 1; i < mids.length; i++) {
          const d = Math.hypot(mids[i].x - mids[i - 1].x, mids[i].y - mids[i - 1].y);
          expect(d).toBeCloseTo((lengths[i - 1] + lengths[i]) / 2 + COUPLER_GAP, 9);
        }
        const ends = Math.hypot(mids.at(-1)!.x - mids[0].x, mids.at(-1)!.y - mids[0].y);
        expect(ends + (lengths[0] + lengths.at(-1)!) / 2).toBeCloseTo(t.length, 9);
      },
      { seeds: Array.from({ length: 60 }, (_, i) => i + 1) },
    );
  });
});

describe('what reads a vehicle length', () => {
  /** Every non-test TypeScript source under src, comments left out, by its path from src. */
  function sources(): Map<string, string> {
    const dir = new URL('../', import.meta.url);
    const out = new Map<string, string>();
    for (const f of readdirSync(dir, { recursive: true }) as string[]) {
      const path = f.split('\\').join('/');
      if (!path.endsWith('.ts') || path.endsWith('.test.ts') || path.endsWith('.d.ts')) continue;
      const text = readFileSync(new URL(path, dir), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      out.set(path, text);
    }
    return out;
  }

  it('takes a size class length nowhere but in vehicleSpec, as the length of a body without one', () => {
    const src = sources();
    expect(src.size).toBeGreaterThan(50);
    const readers = [...src].filter(([, text]) => /\bSIZE_LEN\b/.test(text)).map(([p]) => p);
    expect(readers).toEqual(['sim/body.ts']);
    const body = src.get('sim/body.ts')!;
    const start = body.indexOf('export function vehicleSpec(');
    const end = body.indexOf('\n}\n', start);
    expect(start).toBeGreaterThan(0);
    const declared = body.indexOf('export const SIZE_LEN') + 'export const '.length;
    const stray = [...body.matchAll(/\bSIZE_LEN\b/g)]
      .map((m) => m.index)
      .filter((i) => i !== declared && !(i > start && i < end));
    expect(stray, 'SIZE_LEN read in body.ts outside vehicleSpec').toEqual([]);
  });

  it('measures track-class access at the length of the model', () => {
    const base = locoDef('f7');
    const own: LocoDef = { ...base, id: 'own_length_probe', length: 3.4 };
    for (const cls of TRACK_CLASSES) {
      expect(verdictOf(own, cls), cls).toEqual(measure(vehicleSpec(own), cls));
      expect(verdictOf(own, cls), cls).not.toEqual(verdictOf(base, cls));
    }
  });

  it('fits a consist out of a depot gate by the length of its model', () => {
    const map = emptyMap(4242, 40, 24, Terrain.Grass);
    const track = new TrackGraph(40, 24);
    const stock = new Stockpile();
    const economy = new Economy();
    const builder = new Builder(map, new RegionState(map), track, economy, stock);
    builder.free = true;
    const depot = new Station('depot', 10, ROW);
    builder.stations.push(depot);
    // a stub three tiles long out of the east gate at (12, ROW), ending in a buffer stop
    for (let x = 12; x <= 14; x++) track.place(x, ROW, 'straight', 1);
    const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);
    const gate = (def: LocoDef) => {
      const t = new Train([{ uid: 1, level: 1, def }]);
      expect(t.access.classes.has('regular'), `${def.id} ${t.length} on regular track`).toBe(true);
      return fleet.gateReport(t, depot).find((g) => g.x === 12 && g.y === ROW)!;
    };
    // the same engine, its size two tiles long: room to spare, then not, by its own length alone
    expect(gate(locoDef('f7')).ok).toBe(true);
    expect(gate(ownLoco('f7', 2.9)).ok).toBe(true);
    const long = gate(ownLoco('f7', 3.1));
    expect(long.ok).toBe(false);
    expect(long.run).toBeCloseTo(3, 9);
  });
});

describe('a save', () => {
  // runs the traffic scenario for up to 1200 ticks: about 0.8 s alone, far longer on a loaded runner
  it('stores no length, and one from before loads with every train where it stood', SLOW, () => {
    const sc = buildTrafficScenario(4);
    let checked = 0;
    for (let i = 0; i < 1200 && !sc.done(); i++) {
      sc.step(SCENARIO_GDT, (i + 1) * SCENARIO_GDT);
      if (i % 100 !== 99) continue;
      for (const t of sc.fleet.trains) {
        const text = JSON.stringify(t.toJSON());
        expect(text).not.toMatch(/"length"/);
        const back = Train.fromJSON(JSON.parse(text) as ReturnType<Train['toJSON']>, sc.track);
        expect(back.carLengths).toEqual(t.carLengths);
        expect(back.length).toBe(t.length);
        expect(back.vehiclePoses, `train ${t.id} after tick ${i}`).toEqual(t.vehiclePoses);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
  });

  it('names each model and keeps no length of it, for every plan', () => {
    for (const id of ['f7', 'k4s', 'gmam', 'big_boy']) {
      const track = straightLine();
      const t = new Train([{ uid: 1, level: 1, def: locoDef(id) }]);
      expect(t.spawnAt(track, LINE_END - 2, ROW, Dir.W), id).toBe(true);
      const saved = t.toJSON();
      // the length comes from the content the load runs on, looked up by the model's id
      expect(Object.keys(saved.locos[0]).sort(), id).toEqual([
        'defId',
        'inCab',
        'level',
        'mode',
        'uid',
      ]);
      const back = Train.fromJSON(JSON.parse(JSON.stringify(saved)) as typeof saved, track);
      expect(back.vehiclePoses, id).toEqual(t.vehiclePoses);
    }
  });
});

// ------------------------------------------------- through the curves, out of a depot, from a save

const NARROW_LOCOS = content.locomotives.filter((d) => d.gauge === 'narrow' && !d.retired);
const NARROW_WAGONS = content.wagons.filter((d) => d.gauge === 'narrow' && !d.retired);

/** A wagon's length: its own, or its size class's without one. */
const wagonLength = (id: string) => specLength(wagonDef(id));
/** Bodies and the gaps between them, summed the slow way. */
const consistLengthOf = (ls: number[]) =>
  ls.reduce((a, b) => a + b, 0) + (ls.length - 1) * COUPLER_GAP;

/** The turn of a straight that runs along `d`. */
function straightTurn(d: Dir): number {
  for (let rot = 0; rot < rotationCount('straight'); rot++)
    if (pieceLinks('straight', rot).some(([a, b]) => a === d || b === d)) return rot;
  throw new Error(`no straight runs along ${d}`);
}

/**
 * Lays on free tiles of `g` a curve of `cls` that a train running along `heading` enters at
 * (x, y) and leaves running along `to`, found by laying each anchor and turn on a scratch graph
 * and following the rails in; returns the tile after it.
 */
function layCurve(g: TrackGraph, x: number, y: number, heading: Dir, to: Dir, cls: TrackClass) {
  for (let ay = y - 2; ay <= y + 2; ay++)
    for (let ax = x - 2; ax <= x + 2; ax++)
      for (let rot = 0; rot < rotationCount('curve'); rot++) {
        const probe = new TrackGraph(g.w, g.h);
        const tiles = probe.place(ax, ay, 'curve', rot, cls);
        if (!tiles.some((t) => t.x === x && t.y === y)) continue;
        if (tiles.some((t) => g.has(t.x, t.y))) continue;
        let cx = x;
        let cy = y;
        let from = opposite(heading);
        for (let i = 0; i < 8; i++) {
          const out = probe.exits(cx, cy, from);
          if (out.length !== 1) break;
          cx += DIR_DX[out[0]];
          cy += DIR_DY[out[0]];
          if (!probe.has(cx, cy)) {
            if (out[0] !== to) break;
            g.place(ax, ay, 'curve', rot, cls);
            return { x: cx, y: cy };
          }
          from = opposite(out[0]);
        }
      }
  throw new Error(`no ${cls} curve turns from ${heading} to ${to} at ${x},${y}`);
}

/** Legs of straight track of one class, turning east, south, east... through curves of it. */
interface Winding {
  cls: TrackClass;
  /** straight tiles in each leg, at least one */
  legs: number[];
}

/** The line laid, its last tile and the edge a train enters that tile by. */
function windingLine({ cls, legs }: Winding) {
  const track = new TrackGraph(64, 64);
  let x = 6;
  let y = 6;
  let heading = Dir.E;
  legs.forEach((n, leg) => {
    for (let i = 0; i < n; i++) {
      track.place(x, y, 'straight', straightTurn(heading), cls);
      x += DIR_DX[heading];
      y += DIR_DY[heading];
    }
    if (leg === legs.length - 1) return;
    const to = heading === Dir.E ? Dir.S : Dir.E;
    ({ x, y } = layCurve(track, x, y, heading, to, cls));
    heading = to;
  });
  return { track, x: x - DIR_DX[heading], y: y - DIR_DY[heading], entry: opposite(heading) };
}

/** A consist on a winding line: locomotives with or without a length of their own, wagons. */
interface Standing {
  line: Winding;
  locos: { id: string; length?: number }[];
  wagons: string[];
  /** turned round where it stands, so the last wagon leads */
  reversed: boolean;
}

function genStanding(rng: Rng): Standing {
  const cls = rng.pick(TRACK_CLASSES);
  const narrow = cls === 'narrow';
  return {
    line: { cls, legs: Array.from({ length: rng.int(2, 6) }, () => rng.int(1, 3)) },
    locos: Array.from({ length: rng.int(1, 3) }, () => ({
      id: rng.pick(narrow ? NARROW_LOCOS : REGULAR_LOCOS).id,
      length: rng.chance(0.2) ? undefined : genLength(rng),
    })),
    wagons: Array.from(
      { length: rng.int(0, 3) },
      () => rng.pick(narrow ? NARROW_WAGONS : REGULAR_WAGONS).id,
    ),
    reversed: rng.chance(0.5),
  };
}

function* shrinkStanding(c: Standing): Iterable<Standing> {
  if (c.reversed) yield { ...c, reversed: false };
  for (const wagons of shrinkArray(c.wagons)) yield { ...c, wagons };
  for (const locos of shrinkArray(c.locos)) if (locos.length) yield { ...c, locos };
  for (const legs of shrinkArray(c.line.legs))
    if (legs.length) yield { ...c, line: { ...c.line, legs } };
  for (let i = 0; i < c.line.legs.length; i++)
    if (c.line.legs[i] > 1) {
      const legs = c.line.legs.map((n, j) => (j === i ? 1 : n));
      yield { ...c, line: { ...c.line, legs } };
    }
}

/** The private member of a train the properties below drive: turning round where it stands. */
const turnRound = (t: Train) => (t as unknown as { reverseConsist(): void }).reverseConsist();

const far = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

describe('a consist of locomotives with lengths of their own, through curves', () => {
  it('stands along its trail by its real lengths, either way round, and occupies all of it', () => {
    let curved = 0;
    forAll(
      genStanding,
      ({ line, locos, wagons, reversed }) => {
        const { track, x, y, entry } = windingLine(line);
        const locoDefs = locos.map((l) =>
          l.length === undefined ? locoDef(l.id) : ownLoco(l.id, l.length),
        );
        const defs: (LocoDef | WagonDef)[] = [...locoDefs, ...wagons.map((id) => wagonDef(id))];
        const t = new Train(locoDefs.map((def, i) => ({ uid: i + 1, level: 1, def })));
        t.wagons = wagons.map((id, i) => ({
          uid: 100 + i,
          def: wagonDef(id),
          level: 1,
          cargo: null,
          amount: 0,
          origin: null,
        }));
        expect(t.spawnAt(track, x, y, entry)).toBe(true);
        if (reversed) turnRound(t);

        // the oracle: each body as long as its entry says, or its size class when it says nothing
        const lengths = [
          ...locos.map((l) => l.length ?? specLength(locoDef(l.id))),
          ...wagons.map(wagonLength),
        ];
        const total = consistLengthOf(lengths);
        expect(t.carLengths).toEqual(lengths);
        expect(t.length).toBeCloseTo(total, 9);

        // the trail the cars stand on, as the save has it; its end is the leading end
        const pl = new Polyline(t.toJSON().trail.map(([px, py]) => ({ x: px, y: py })));
        const head = pl.length;
        // the whole consist stands on its trail (a train turned round has a trail just as long)
        expect(head - total).toBeGreaterThanOrEqual(-1e-9);
        if (reversed) expect(head).toBeCloseTo(total, 9);
        /** Arc along the trail of a place `u` tiles back from the leading locomotive's front. */
        const arc = (u: number) => (reversed ? head - total + u : head - u);

        expect(t.vehiclePoses).toHaveLength(lengths.length);
        const headings: number[] = [];
        let u0 = 0;
        t.vehiclePoses.forEach((v, i) => {
          const spec = vehicleSpec(defs[i]);
          expect(spec.L).toBe(lengths[i]);
          expect(far(v, pl.at(arc(u0 + lengths[i] / 2))), `car ${i} middle`).toBeLessThan(1e-9);
          expect(v.segments).toHaveLength(spec.segments.length);
          v.segments.forEach((p, j) => {
            const s = spec.segments[j];
            expect(p.L, `car ${i} part ${j}`).toBe(s.L);
            headings.push(p.angle);
            // the end of the part that leads, and its bogies back from it at their places
            const lead = reversed ? arc(u0 + s.front + s.L) : arc(u0 + s.front);
            p.bogies.forEach((b, k) => {
              const rail = pl.at(lead - (s.L - s.W) / 2 - (s.W / (s.nb - 1)) * k);
              expect(far(b, rail), `car ${i} part ${j} bogie ${k}`).toBeLessThan(1e-9);
            });
          });
          u0 += lengths[i] + COUPLER_GAP;
        });

        // what the train stands on runs from its leading end to its trailing end
        const occ = t.occupancyPoints();
        expect(far(occ[0], pl.at(head)), 'leading end').toBeLessThan(1e-9);
        expect(far(occ[occ.length - 1], pl.at(head - total)), 'trailing end').toBeLessThan(1e-9);

        // how far its parts turn from the first, wrapped, so a part heading west reads as straight
        const turn = headings.map((a) =>
          Math.atan2(Math.sin(a - headings[0]), Math.cos(a - headings[0])),
        );
        if (Math.max(...turn) - Math.min(...turn) > 0.2) curved++;
      },
      { shrink: shrinkStanding },
    );
    // most cases stand across a curve; the rest are short consists on a long leg
    expect(curved).toBeGreaterThan(50);
  });
});

describe('a depot gate', () => {
  // measures the track-class access of a new model in every case: about half a second alone
  it('lets out a consist exactly when the stub ahead is as long as its bodies and gaps', () => {
    forAll(
      (rng) => ({
        stub: rng.int(2, 6),
        locos: Array.from({ length: rng.int(1, 2) }, () => ({
          id: rng.pick(REGULAR_LOCOS).id,
          length: genLength(rng),
        })),
        wagons: Array.from({ length: rng.int(0, 2) }, () => rng.pick(REGULAR_WAGONS).id),
      }),
      ({ stub, locos, wagons }) => {
        const map = emptyMap(4242, 40, 24, Terrain.Grass);
        const track = new TrackGraph(40, 24);
        const stock = new Stockpile();
        const economy = new Economy();
        const builder = new Builder(map, new RegionState(map), track, economy, stock);
        builder.free = true;
        const depot = new Station('depot', 10, ROW);
        builder.stations.push(depot);
        for (let x = 12; x < 12 + stub; x++) track.place(x, ROW, 'straight', 1);
        const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);
        // a model of its own per length: the track-class access table is kept by model id
        const t = new Train(
          locos.map((l, i) => ({
            uid: i + 1,
            level: 1,
            def: { ...ownLoco(l.id, l.length), id: `${l.id}@${l.length}` },
          })),
        );
        t.wagons = wagons.map((id, i) => ({
          uid: 100 + i,
          def: wagonDef(id),
          level: 1,
          cargo: null,
          amount: 0,
          origin: null,
        }));
        const need = consistLengthOf([...locos.map((l) => l.length), ...wagons.map(wagonLength)]);
        const gate = fleet.gateReport(t, depot).find((g) => g.x === 12 && g.y === ROW)!;
        if (!t.access.classes.has('regular')) {
          // a body too long for the curves of regular track is refused for its class, not for room
          expect(gate.ok).toBe(false);
          expect(gate.run).toBe(0);
          return;
        }
        const why = `${need} tiles of train, ${stub} of stub: ${gate.reason}`;
        expect(gate.ok, why).toBe(need <= stub);
        if (!gate.ok) expect(gate.run, why).toBeCloseTo(stub, 9);
      },
      {
        *shrink(c) {
          for (const stub of shrinkInt(c.stub, 2)) yield { ...c, stub };
          for (const wagons of shrinkArray(c.wagons)) yield { ...c, wagons };
          for (const locos of shrinkArray(c.locos)) if (locos.length) yield { ...c, locos };
          for (let i = 0; i < c.locos.length; i++)
            if (c.locos[i].length !== OWN_LENGTH.min) {
              const locos = c.locos.map((l, j) => (j === i ? { ...l, length: OWN_LENGTH.min } : l));
              yield { ...c, locos };
            }
        },
      },
    );
  }, 20_000);

  /** A depot at (10, ROW), its east gate at (12, ROW), and `stub` straight tiles from the gate on. */
  function gateStub(stub: number) {
    const map = emptyMap(4242, 40, 24, Terrain.Grass);
    const track = new TrackGraph(40, 24);
    const stock = new Stockpile();
    const economy = new Economy();
    const builder = new Builder(map, new RegionState(map), track, economy, stock);
    builder.free = true;
    const depot = new Station('depot', 10, ROW);
    builder.stations.push(depot);
    for (let x = 12; x < 12 + stub; x++) track.place(x, ROW, 'straight', 1);
    const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);
    return { track, depot, fleet };
  }

  /** The private member of a fleet the property below drives: what each tile has standing on it. */
  const seeTrains = (f: Fleet) => (f as unknown as { rebuildOccupancy(): void }).rebuildOccupancy();

  interface GateCase {
    /** straight tiles from the gate on, away from the shed; the gate is the first */
    stub: number;
    /** the tile from the gate on (0 is the gate) where another train stands, its body further on */
    standing: number | null;
    locos: { id: string; length: number }[];
    wagons: string[];
  }

  // measures the track-class access of a new model in every case: about half a second alone
  it('wants a free tile beyond the gate and room for the whole consist, however short the consist', () => {
    const seen = { busy: 0, stub: 0, room: 0, out: 0, shortOut: 0 };
    forAll(
      (rng): GateCase => {
        const stub = rng.int(1, 5);
        // a lone engine of half a tile or less: its walk out of the gate covers it within the gate
        // tile, and must still go on to the tile beyond
        const short = rng.chance(0.4);
        return {
          stub,
          standing: rng.chance(0.4) ? rng.int(0, stub - 1) : null,
          locos: short
            ? [{ id: rng.pick(REGULAR_LOCOS).id, length: rng.range(OWN_LENGTH.min, 0.5) }]
            : Array.from({ length: rng.int(1, 2) }, () => ({
                id: rng.pick(REGULAR_LOCOS).id,
                length: genLength(rng),
              })),
          wagons: short
            ? []
            : Array.from({ length: rng.int(0, 2) }, () => rng.pick(REGULAR_WAGONS).id),
        };
      },
      ({ stub, standing, locos, wagons }) => {
        const { track, depot, fleet } = gateStub(stub);
        const t = new Train(
          locos.map((l, i) => ({
            uid: i + 1,
            level: 1,
            def: { ...ownLoco(l.id, l.length), id: `${l.id}@${l.length}` },
          })),
        );
        t.wagons = wagons.map((id, i) => ({
          uid: 100 + i,
          def: wagonDef(id),
          level: 1,
          cargo: null,
          amount: 0,
          origin: null,
        }));
        const need = consistLengthOf([...locos.map((l) => l.length), ...wagons.map(wagonLength)]);
        expect(t.length).toBeCloseTo(need, 9);

        // the oracle: the tiles from the gate on before the first one another train stands on
        let usable = stub;
        if (standing !== null) {
          const other = new Train([{ uid: 50, level: 1, def: locoDef(REGULAR_LOCOS[0].id) }]);
          expect(other.spawnAt(track, 12 + standing, ROW, Dir.E)).toBe(true);
          fleet.trains.push(other);
          seeTrains(fleet);
          const under = new Set(other.occupancyKeys(track.w));
          const taken = Array.from({ length: stub }, (_, i) => under.has(ROW * track.w + 12 + i));
          usable = taken.includes(true) ? taken.indexOf(true) : stub;
          expect(usable, 'the other train stands from its tile on').toBe(standing);
        }

        const gate = fleet.gateReport(t, depot).find((g) => g.x === 12 && g.y === ROW)!;
        if (!t.access.classes.has('regular')) {
          // a body too long for the curves of regular track is refused for its class first
          expect(gate.ok).toBe(false);
          expect(gate.run).toBe(0);
          return;
        }
        const why = `${need} tiles of train, ${stub} of stub, ${usable} free: ${gate.reason}`;
        if (usable === 0) {
          seen.busy++;
          expect(gate.ok, why).toBe(false);
          expect(gate.reason, why).toBe(STR.compat.gateBusy(12, ROW));
          return;
        }
        if (usable === 1) {
          // nothing usable beyond the gate: a stub, for a consist of any length
          seen.stub++;
          expect(gate.ok, why).toBe(false);
          expect(gate.reason, why).toBe(STR.compat.gateStub(12, ROW));
          return;
        }
        // a consist exactly as long as the free track may go either way on rounding
        if (Math.abs(need - usable) > 1e-9) expect(gate.ok, why).toBe(need <= usable);
        if (gate.ok) {
          seen.out++;
          if (need <= 0.5) seen.shortOut++;
          expect(gate.reason, why).toBeNull();
          expect(gate.run, why).toBeGreaterThanOrEqual(need);
          expect(gate.run, why).toBeLessThanOrEqual(usable + 1e-9);
        } else {
          seen.room++;
          expect(gate.run, why).toBeCloseTo(usable, 9);
          expect(gate.reason, why).toBe(STR.compat.gateRoom(12, ROW, gate.run, t.length));
        }
      },
      {
        format: (c) =>
          `${c.stub}-tile stub, a train on tile ${c.standing ?? '-'}, ` +
          `locos ${c.locos.map((l) => `${l.id}@${l.length}`).join(' ')}, ` +
          `wagons ${c.wagons.join(' ') || '-'}`,
        *shrink(c) {
          if (c.standing !== null) yield { ...c, standing: null };
          for (const stub of shrinkInt(c.stub, 1))
            if (c.standing === null || c.standing < stub) yield { ...c, stub };
          if (c.standing !== null)
            for (const standing of shrinkInt(c.standing, 0)) yield { ...c, standing };
          for (const wagons of shrinkArray(c.wagons)) yield { ...c, wagons };
          for (const locos of shrinkArray(c.locos)) if (locos.length) yield { ...c, locos };
          for (let i = 0; i < c.locos.length; i++)
            if (c.locos[i].length !== OWN_LENGTH.min) {
              const locos = c.locos.map((l, j) => (j === i ? { ...l, length: OWN_LENGTH.min } : l));
              yield { ...c, locos };
            }
        },
      },
    );
    // every answer a gate gives is seen, a lone engine of half a tile or less let out among them
    for (const [k, n] of Object.entries(seen)) expect(n, k).toBeGreaterThan(10);
  }, 20_000);
});

describe('a junction ahead', () => {
  /** The private member of a train the property below drives: the way it runs. */
  const runOn = (t: Train, path: PathSegment[], map: GameMap, track: TrackGraph) =>
    (t as unknown as { setPath(p: PathSegment[], m: GameMap, g: TrackGraph): void }).setPath(
      path,
      map,
      track,
    );

  it('is entered only when the track beyond it holds the whole consist and a tile more', () => {
    let entered = 0;
    let held = 0;
    forAll(
      (rng) => ({
        length: genLength(rng),
        wagons: Array.from({ length: rng.int(0, 1) }, () => rng.pick(NARROW_WAGONS).id),
        parked: rng.int(11, 20),
      }),
      ({ length, wagons, parked }) => {
        // a narrow line along row 5 with a switch at x 10; one train runs east through it from
        // x 9, another stands further on
        const map = emptyMap(4242, 32, 12, Terrain.Grass);
        const track = new TrackGraph(32, 12);
        for (let x = 1; x <= 30; x++) track.place(x, 5, 'straight', 1, 'narrow');
        track.place(10, 5, 'switch', 1, 'narrow');
        const runner = new Train([
          { uid: 1, level: 1, def: { ...ownLoco('rocket', length), id: `rocket@${length}` } },
        ]);
        runner.wagons = wagons.map((id, i) => ({
          uid: 100 + i,
          def: wagonDef(id),
          level: 1,
          cargo: null,
          amount: 0,
          origin: null,
        }));
        expect(runner.spawnAt(track, 9, 5, Dir.W)).toBe(true);
        const path = findPath(track, { x: 9, y: 5, in: Dir.W }, (x, y) => x === 29 && y === 5);
        expect(path).not.toBeNull();
        runOn(runner, path!, map, track);
        runner.state = 'moving';
        const standing = new Train([{ uid: 2, level: 1, def: locoDef('rocket') }]);
        expect(standing.spawnAt(track, parked, 5, Dir.W)).toBe(true);
        standing.state = 'waiting';

        const traffic = new Traffic(track, { stations: [] } as unknown as Builder);
        traffic.assign([runner, standing], 0);
        const into = traffic.claims.get(5 * track.w + 10) === runner.id;
        if (into) entered++;
        else held++;

        const total = consistLengthOf([length, ...wagons.map(wagonLength)]);
        expect(runner.length).toBeCloseTo(total, 9);
        const ahead = runner.pathAhead();
        const at = ahead.findIndex((p) => p.x === 10 && p.y === 5);
        expect(at).toBeGreaterThan(-1);
        const exit = ahead[at].arc;
        const taken = new Set(standing.occupancyKeys(track.w));
        // the first tile beyond the switch the standing train is on, by where it starts
        const first = ahead.slice(at).find((p) => taken.has(p.y * track.w + p.x));
        expect(first).toBeDefined();
        const why = `${total} tiles of train, the other ${first!.arc - exit} on from the switch`;
        // the rear clears the switch with the head a consist length past its far edge: none of
        // that may be taken; with a tile to spare beyond it, nothing holds the train back
        if (into) expect(first!.arc, why).toBeGreaterThan(exit + 1 + total);
        if (first!.arc >= exit + 2 + total) expect(into, why).toBe(true);
      },
      {
        seeds: Array.from({ length: 200 }, (_, i) => i + 1),
        *shrink(c) {
          for (const wagons of shrinkArray(c.wagons)) yield { ...c, wagons };
          for (const parked of shrinkInt(c.parked, 11)) yield { ...c, parked };
        },
      },
    );
    // both ways out are seen
    expect(entered).toBeGreaterThan(40);
    expect(held).toBeGreaterThan(40);
  });
});

describe('a save from before a model had a length', () => {
  const PROBE = 'own_length_save_probe';
  afterEach(() => {
    const i = content.locomotives.findIndex((d) => d.id === PROBE);
    if (i >= 0) content.locomotives.splice(i, 1);
  });

  it('loads every train where it stood, at the length the content now gives the model', () => {
    forAll(
      (rng) => ({
        line: {
          cls: 'regular' as TrackClass,
          legs: Array.from({ length: rng.int(2, 5) }, () => rng.int(1, 3)),
        },
        base: rng.pick(REGULAR_LOCOS).id,
        wagons: Array.from({ length: rng.int(0, 3) }, () => rng.pick(REGULAR_WAGONS).id),
        length: genLength(rng),
      }),
      ({ line, base, wagons, length }) => {
        const probe: LocoDef = { ...locoDef(base), id: PROBE };
        delete probe.length;
        content.locomotives.push(probe);
        try {
          const { track, x, y, entry } = windingLine(line);
          const t = new Train([{ uid: 1, level: 1, def: locoDef(PROBE) }]);
          t.wagons = wagons.map((id, i) => ({
            uid: 100 + i,
            def: wagonDef(id),
            level: 1,
            cargo: null,
            amount: 0,
            origin: null,
          }));
          expect(t.spawnAt(track, x, y, entry)).toBe(true);
          const saved = JSON.parse(JSON.stringify(t.toJSON())) as ReturnType<Train['toJSON']>;
          // the model gains its own length after the save was written
          probe.length = length;
          const back = Train.fromJSON(saved, track);
          const again = back.toJSON();
          expect(again.trail).toEqual(saved.trail);
          expect(again.head).toEqual(saved.head);
          expect(again.locos).toEqual(saved.locos);
          expect(back.carLengths[0]).toBe(length);
          const pl = new Polyline(saved.trail.map(([px, py]) => ({ x: px, y: py })));
          const mid = pl.at(pl.length - length / 2);
          expect(far(back.vehiclePoses[0], mid)).toBeLessThan(1e-9);
        } finally {
          content.locomotives.splice(content.locomotives.indexOf(probe), 1);
        }
      },
      {
        seeds: Array.from({ length: 40 }, (_, i) => i + 1),
        *shrink(c) {
          for (const wagons of shrinkArray(c.wagons)) yield { ...c, wagons };
          for (const legs of shrinkArray(c.line.legs))
            if (legs.length) yield { ...c, line: { ...c.line, legs } };
        },
      },
    );
  });
});

// ------------------------------------------------- what a length leaves alone

describe('a size', () => {
  /**
   * Everything the size of a model decides besides the length of its body, read the way the game
   * reads it: from the entry itself (the body plan, its parts, bogies and drawn bogies), by the
   * model's id from the content (the workshop), and by the frame lookup with `has` as the atlas.
   */
  function sizeJobs(def: LocoDef | WagonDef, loco: boolean, has: (key: string) => boolean) {
    const spec = vehicleSpec(def);
    const workshop = new Crafting(new Rng(1), new Inventory(), new Economy(), new Stockpile());
    const tier = craftTier(def.id);
    return {
      body: {
        size: spec.size,
        plan: spec.plan,
        drawBogies: spec.drawBogies,
        maxLateralPlay: spec.maxLateralPlay,
        parts: spec.segments.map((s) => [s.part, s.nb, s.bogie, s.mirror === true]),
      },
      craft: {
        size: craftSize(def.id),
        tier,
        rarity: craftRarity(def.id),
        cost: workshop.instanceCost(def.id),
        fail: workshop.failChance(def.id),
        inPool: craftPool(loco ? 'loco' : 'wagon', tier).includes(def.id),
      },
      frames: Array.from({ length: FACINGS }, (_, f) =>
        loco
          ? spec.segments.map((s) => locoFrame({ has }, def as LocoDef, f, s.part))
          : [wagonFrame({ has }, def as WagonDef, f)],
      ),
    };
  }

  it('keeps every job it has besides the length, whatever length its model is given', () => {
    forAll(
      (rng) => {
        const table = rng.pick(['locomotives', 'wagons'] as const);
        return {
          table,
          at: rng.int(0, content[table].length - 1),
          length: genLength(rng),
          // an atlas holding about half the frame names, so every fallback of the lookup is taken
          atlas: rng.int(1, 1_000_000),
        };
      },
      ({ table, at, length, atlas }) => {
        // a wagon's entry takes a length through the body fields it shares with a locomotive
        const entry: (LocoDef | WagonDef) & BodyFields = content[table][at];
        const loco = table === 'locomotives';
        const has = (key: string) => hash2(hashString(key), atlas) < 0.5;
        const own = entry.length;
        try {
          delete entry.length;
          const before = sizeJobs(entry, loco, has);
          entry.length = length;
          const after = sizeJobs(entry, loco, has);
          expect(vehicleSpec(entry).L).toBe(length);
          expect(after).toEqual(before);
        } finally {
          if (own === undefined) delete entry.length;
          else entry.length = own;
        }
      },
      { format: (c) => `${c.table}[${c.at}] (${content[c.table][c.at].id}) at ${c.length} tiles` },
    );
  });
});

/**
 * `Fleet.gateReport` as it stood before a consist shorter than half a tile had to look past the
 * gate tile: the walk out stopped as soon as it held the consist and half a tile more, on the gate
 * tile itself too. The oracle for "the fix changes no verdict for a consist of a tile or more".
 */
function gateReportBeforeFix(fleet: Fleet, t: Train, depot: Station): GateInfo[] {
  const out: GateInfo[] = [];
  const need = t.length;
  for (const g of depot.gateTiles()) {
    const piece = fleet.track.get(g.x, g.y);
    const info: GateInfo = {
      x: g.x,
      y: g.y,
      cls: null,
      entry: null,
      run: 0,
      ok: false,
      reason: null,
    };
    out.push(info);
    if (!piece) {
      info.reason = STR.compat.gateNoTrack(g.x, g.y);
      continue;
    }
    const toStation = DIRS.find((d) => depot.covers(g.x + DIR_DX[d], g.y + DIR_DY[d]));
    const entry =
      toStation !== undefined && piece.links.some((l) => l.includes(toStation))
        ? toStation
        : piece.links[0]?.[0];
    if (entry === undefined) {
      info.reason = STR.compat.gateNoTrack(g.x, g.y);
      continue;
    }
    info.entry = entry;
    info.cls = pieceClassFor(piece, entry);
    if (!t.access.classes.has(info.cls)) {
      const who = t.access.blockedBy[info.cls];
      info.reason = STR.compat.gateClass(
        g.x,
        g.y,
        STR.toolbar.trackClass[info.cls],
        who?.name ?? t.name,
        [...t.access.classes].map((c) => STR.toolbar.trackClass[c]).join(' / ') || '?',
      );
      continue;
    }
    if (fleet.occupied(g.x, g.y, t.id)) {
      info.reason = STR.compat.gateBusy(g.x, g.y);
      continue;
    }
    let cx = g.x;
    let cy = g.y;
    let cin = entry;
    let run = 0;
    let tiles = 0;
    for (;;) {
      const exits = fleet.track.exits(cx, cy, cin);
      const out2 = exits.find((e) => e === (cin + 2) % 4) ?? exits[0];
      if (out2 === undefined) break;
      run += fleet.track.segLength(cx, cy, cin, out2);
      tiles++;
      if (run >= need + 0.5) break;
      const nx = cx + DIR_DX[out2];
      const ny = cy + DIR_DY[out2];
      if (!fleet.track.connected(cx, cy, out2)) break;
      const np = fleet.track.get(nx, ny)!;
      if (!t.access.classes.has(pieceClassFor(np, (out2 + 2) % 4))) break;
      if (fleet.occupied(nx, ny, t.id)) break;
      cx = nx;
      cy = ny;
      cin = (out2 + 2) % 4;
    }
    info.run = run;
    if (tiles < 2) {
      info.reason = STR.compat.gateStub(g.x, g.y);
      continue;
    }
    if (run < need) {
      info.reason = STR.compat.gateRoom(g.x, g.y, run, need);
      continue;
    }
    info.ok = true;
  }
  return out;
}

describe('a depot gate, before and after a short consist had to look past it', () => {
  /** The gate the pieces are laid on: east of a depot at (10, ROW), which covers two by two. */
  const GATE = { x: 12, y: ROW };

  interface GateLayout {
    item: TrackItem;
    rot: number;
    form: SwitchForm;
    /** the member of the piece that lies on the gate tile */
    member: number;
    /** every other tile around the gate a crossing of this class, straight on either way; or bare */
    fill: TrackClass | null;
  }

  /** The ways a switch may be laid; any other piece is laid the first way. */
  const FORMS: SwitchForm[] = ['turn', 'parallel'];

  /** The tiles of a piece laid with its anchor at (20, 12), in member order. */
  const membersOf = ({ item, rot, form }: Pick<GateLayout, 'item' | 'rot' | 'form'>) =>
    new TrackGraph(40, 24).place(20, 12, item.kind, rot, item.cls, item.cls2, form);

  /** Every piece of every class, turn and form, each of its tiles on the gate, the depot left clear. */
  function gateLayouts(covers: (x: number, y: number) => boolean): GateLayout[] {
    const out: GateLayout[] = [];
    for (const item of TRACK_ITEMS)
      for (let rot = 0; rot < rotationCount(item.kind); rot++)
        for (const form of item.kind === 'switch' ? FORMS : FORMS.slice(0, 1)) {
          const tiles = membersOf({ item, rot, form });
          tiles.forEach((m, member) => {
            const at = tiles.map((p) => ({ x: p.x - m.x + GATE.x, y: p.y - m.y + GATE.y }));
            if (at.some((p) => covers(p.x, p.y))) return;
            for (const fill of [null, ...new Set([item.cls, item.cls2 ?? item.cls])])
              out.push({ item, rot, form, member, fill });
          });
        }
    return out;
  }

  /** Lay `layout` on an emptied track: the crossings first, then the piece over them. */
  function lay(track: TrackGraph, layout: GateLayout, covers: (x: number, y: number) => boolean) {
    for (const t of [...track.tiles()]) track.removeAt(t.x, t.y);
    if (layout.fill)
      for (let y = GATE.y - 6; y <= GATE.y + 7; y++)
        for (let x = GATE.x - 4; x <= GATE.x + 8; x++)
          if (!covers(x, y)) track.place(x, y, 'crossing', 0, layout.fill, layout.fill);
    const { item, rot, form, member } = layout;
    const m = membersOf(layout)[member];
    track.place(20 - m.x + GATE.x, 12 - m.y + GATE.y, item.kind, rot, item.cls, item.cls2, form);
    expect(track.get(GATE.x, GATE.y)?.kind).toBe(item.kind);
  }

  // some two hundred layouts of the gate, each for two dozen consists through both walks: up to
  // 1.2 s alone
  it(
    'gives a consist of a tile or more the verdict it gave before, whatever piece the gate is',
    { timeout: 30_000 },
    () => {
      const map = emptyMap(4242, 40, 24, Terrain.Grass);
      const track = new TrackGraph(40, 24);
      const stock = new Stockpile();
      const economy = new Economy();
      const builder = new Builder(map, new RegionState(map), track, economy, stock);
      builder.free = true;
      const depot = new Station('depot', 10, ROW);
      builder.stations.push(depot);
      const covers = (x: number, y: number) => depot.covers(x, y);
      const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);

      // the shortest shipped model that may use each class of track, as shipped and at lengths of
      // its own either side of a tile; the shortest regular one also with wagons behind it
      const lone = (def: LocoDef) => new Train([{ uid: 1, level: 1, def }]);
      const shortest = (cls: TrackClass) =>
        [...REGULAR_LOCOS, ...NARROW_LOCOS]
          .filter((d) => lone(d).access.classes.has(cls))
          .sort((a, b) => vehicleSpec(a).L - vehicleSpec(b).L)[0];
      const bases = TRACK_CLASSES.map(shortest);
      const trains: Train[] = [];
      for (const base of bases) {
        trains.push(lone(base));
        for (const length of [OWN_LENGTH.min, 0.5, 0.7, 0.99, 1, 1.01])
          trains.push(lone({ ...ownLoco(base.id, length), id: `${base.id}@${length}` }));
      }
      const withWagons = lone(bases[0]);
      withWagons.wagons = REGULAR_WAGONS.slice(0, 2).map((d, i) => ({
        uid: 100 + i,
        def: d,
        level: 1,
        cargo: null,
        amount: 0,
        origin: null,
      }));
      trains.push(withWagons);
      // shortest first, so the first failure is the shortest consist that fails
      trains.sort((a, b) => a.length - b.length);
      expect(trains[0].length).toBe(OWN_LENGTH.min);

      const layouts = gateLayouts(covers);
      const seen = { ok: 0, stub: 0, room: 0, refused: 0, changed: 0 };
      for (const layout of layouts) {
        lay(track, layout, covers);
        for (const t of trains) {
          const now = fleet.gateReport(t, depot);
          const before = gateReportBeforeFix(fleet, t, depot);
          const at =
            `${layout.item.kind} ${layout.item.cls}/${layout.item.cls2 ?? '-'} turn ${layout.rot} ` +
            `${layout.form}, member ${layout.member} on the gate, ${layout.fill ?? 'no'} crossings ` +
            `around it; ${t.name}, ${t.length} tiles`;
          if (t.length >= 1) {
            expect(now, at).toEqual(before);
            const g = now.find((r) => r.x === GATE.x && r.y === GATE.y)!;
            if (g.ok) seen.ok++;
            else if (g.reason === STR.compat.gateStub(GATE.x, GATE.y)) seen.stub++;
            else if (g.run > 0) seen.room++;
            else seen.refused++;
            continue;
          }
          // shorter than a tile: a gate may answer otherwise only where the walk before stopped on
          // the gate tile alone, which already held the consist and half a tile more
          now.forEach((g, i) => {
            const was = before[i];
            if (JSON.stringify(g) === JSON.stringify(was)) return;
            seen.changed++;
            expect(was.reason, `${at}, gate (${g.x}, ${g.y})`).toBe(STR.compat.gateStub(g.x, g.y));
            expect(was.run, `${at}, gate (${g.x}, ${g.y})`).toBeGreaterThanOrEqual(t.length + 0.5);
          });
        }
      }
      // every piece of every class has a way onto the gate, and every answer is seen
      for (const item of TRACK_ITEMS)
        expect(
          layouts.some((l) => l.item === item),
          `${item.kind} ${item.cls}`,
        ).toBe(true);
      for (const [k, n] of Object.entries(seen)) expect(n, k).toBeGreaterThan(10);
    },
  );
});
