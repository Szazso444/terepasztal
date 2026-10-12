import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  COUPLER_GAP,
  DEFAULT_LATERAL_PLAY,
  DEFAULT_PIVOT,
  LARGE_PIVOT,
  OWN_LENGTH,
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
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station, resetStationIds } from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, DEFAULT_SUPPLY } from './supply';
import { content, type LocoDef } from '../data/content';
import { locoDef, wagonDef } from '../gacha/items';
import { Inventory } from '../gacha/inventory';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TRACK_CLASSES, TrackGraph } from '../world/track';
import { Dir } from '../engine/iso';
import { forAll } from '../testing/property';
import { buildTrafficScenario, SCENARIO_GDT } from '../testing/trafficScenario';
import type { Rng } from '../engine/rng';

// A locomotive is as long on the track as its own model (issue #344): an optional `length` on its
// entry, in tiles over the buffers, wins over its size class's. Here: an entry without one is laid
// out exactly as before; one with a length in range keeps its rigid body at that length through
// curves, its plan's parts in proportion; a consist of them is the sum of its bodies and gaps;
// nothing outside vehicleSpec reads a size class's length; and a save carries no length, so a
// save from before loads with every train where it stood.

// the fleet plays sounds
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  resetTrainIds(1);
  resetStationIds(1);
});

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
  it('stores no length, and one from before loads with every train where it stood', () => {
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
