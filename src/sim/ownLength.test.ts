import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  COUPLER_GAP,
  DEFAULT_LATERAL_PLAY,
  DEFAULT_PIVOT,
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
import { measure, referencePath, verdictOf } from './compat';
import { Train, resetTrainIds } from './trains';
import { Fleet } from './fleet';
import { Traffic } from './traffic';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { content, type LocoDef, type WagonDef } from '../data/content';
import { locoDef, wagonDef } from '../gacha/items';
import { Inventory } from '../gacha/inventory';
import { emptyMap } from '../world/mapgen';
import { Terrain, type GameMap } from '../world/tiles';
import { findPath, type PathSegment } from '../world/pathfinding';
import { RegionState } from '../world/regions';
import {
  TRACK_CLASSES,
  TrackGraph,
  pieceLinks,
  rotationCount,
  type TrackClass,
} from '../world/track';
import { DIR_DX, DIR_DY, Dir, opposite, type Vec2 } from '../engine/iso';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import { buildTrafficScenario, SCENARIO_GDT } from '../testing/trafficScenario';
import type { Rng } from '../engine/rng';

// A locomotive is as long on the track as its own model (issue #344): an optional `length` on its
// entry, in tiles over the buffers, wins over its size class's. Here: an entry without one is laid
// out exactly as before; one with a length in range keeps its rigid body at that length through
// curves, its plan's parts in proportion; a consist of them is the sum of its bodies and gaps;
// nothing outside vehicleSpec reads a size class's length; and a save carries no length, so a
// save from before loads with every train where it stood. Then the callers, each at the real
// length: a consist standing through curves of every class either way round, and what it
// occupies; a depot gate letting it out; a junction letting it in; a save made before its model
// had a length, loaded after.

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
      expect((d as BodyFields).length, d.id).toBeUndefined();
      expect(vehicleSpec(d), d.id).toEqual(classSpec(d));
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
          ...locos.map((l) => l.length ?? SIZE_LEN[locoDef(l.id).size ?? 'small']),
          ...wagons.map((id) => SIZE_LEN[wagonDef(id).size ?? 'small']),
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

/** A wagon's length: its size class's, since no wagon has one of its own. */
const wagonLength = (id: string) => SIZE_LEN[wagonDef(id).size ?? 'small'];
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
          ...locos.map((l) => l.length ?? SIZE_LEN[locoDef(l.id).size ?? 'small']),
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
  });
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
