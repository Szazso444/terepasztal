import { DESCENT_SPEED } from '../world/railProfile';
import { walkSpeed } from './people';
import { consistPhysics, type TrainState } from './trains';

/**
 * Level crossings walkers wait at (#404). A crossing is closed while a car of any train stands on
 * it, while a train with its way set could reach it along that way within CROSSING_HORIZON game
 * seconds, running or standing on it and setting off at once, and for CROSSING_HOLD game seconds
 * after the watch first sees it clear of both. A train with no way set (loading or waiting at a
 * platform, idle, with no route) closes only the tiles under its cars. Walkers stop at the edge of
 * a closed crossing (`clearAhead` in people.ts), and walk round one that only trains standing out
 * of fuel or power hold closed (`detour`, #447); trains never wait for walkers, and nothing here
 * changes a train.
 */

/** Game seconds a crossing stays closed once no car is on it and no train is coming. */
export const CROSSING_HOLD = 1.5;
/** Game seconds on top of the longest a walker is on a crossing tile (CROSSING_WALK). */
export const CROSSING_MARGIN = 2;
/**
 * The longest a walker is on a crossing tile, in game seconds: its longest way over a tile,
 * corner to corner through the centre (a walk runs from tile centre to tile centre, so √2 tiles),
 * at the slowest pace a walker has there, off a road and not boarding (`walkSpeed`, WALK_SPEED).
 * 7.07 s at 0.2 tiles a second.
 */
export const CROSSING_WALK = Math.SQRT2 / walkSpeed({ transient: false }, false);
/**
 * How far ahead in game seconds a train with its way set closes a crossing: CROSSING_WALK and
 * CROSSING_MARGIN, 9.07 s at 0.2 tiles a second. A walker that set foot on a crossing while it was
 * open is off it before any train that then had its way set can reach it, running or setting off.
 */
export const CROSSING_HORIZON = CROSSING_WALK + CROSSING_MARGIN;
/**
 * Tiles before the arc `pathAhead` gives a tile at which a train counts as reaching it. That arc
 * is the tile's first point past the edge it shares with the tile before (an eighth of a tile in on
 * a plain straight, which a crossing is), so a train is counted a little early, never late.
 */
export const CROSSING_LEAD = 0.5;
/**
 * The states in which a train has its way set and runs along it as soon as it may: `moving`, which
 * covers a train under way and one standing on its way (held at a signal or behind another train,
 * or just given a way out of a station or round traffic, as `setPath` leaves it at a standstill),
 * and the stops for fuel, power or pull (`noFuel`, `noPower`, `overweight`), from which a train
 * goes on along the way it kept. A train in any other state stands still with no way it will run:
 * loading or waiting at a platform, idle, yielding on a siding, with no route, stranded.
 */
export const ROUTED_STATES: ReadonlySet<TrainState> = new Set<TrainState>([
  'moving',
  'noFuel',
  'noPower',
  'overweight',
]);
/**
 * The states in which a train stands on its way with no telling when it goes on: out of fuel or
 * water (`noFuel`), or an electric engine out of power (`noPower`). Walkers walk round a crossing
 * only such trains hold closed (`CrossingWatch.detour`), rather than wait in front of it for ever.
 * A train passing, held at a signal or behind another train (`moving`), or stopped for its pull
 * (`overweight`) keeps them waiting.
 */
export const DETOUR_STATES: ReadonlySet<TrainState> = new Set<TrainState>(['noFuel', 'noPower']);
/** Seconds of hold within which a crossing counts as open, against rounding in the sums. */
const HOLD_EPS = 1e-9;

/** What the watch reads of a train (`Train` in trains.ts), so a test can pass a plain object. */
export interface CrossingTrain {
  /** what it is doing: only a train in ROUTED_STATES runs along its path */
  readonly state: TrainState;
  /** tiles a second now */
  readonly speed: number;
  /** arc of the head along its path */
  readonly pathProgress: number;
  /** keys (`y * w + x`) of the tiles under its cars */
  occupancyKeys(w: number): readonly number[];
  /** the tiles of its path from the head on, in order, with the arc each starts at */
  pathAhead(): readonly { x: number; y: number; arc: number }[];
  /** tiles/s² it gains speed at now; without it the train is taken to keep its speed */
  readonly acceleration?: number;
  /** its top speed on level track in tiles a second; without it, its speed now */
  readonly maxSpeed?: number;
  /**
   * its units and wagons (`Train.locos`, `Train.wagons`): with them the watch counts on the most
   * any of its units could pull, as light as a run may leave the consist (`crossingPull`), not
   * only on what pulls now
   */
  readonly locos?: Parameters<typeof consistPhysics>[0];
  readonly wagons?: Parameters<typeof consistPhysics>[1];
}

/**
 * The hardest a train could gain speed in the horizon, tiles/s²: what pulls now (`acceleration`),
 * or, given its units and wagons, the most `consistPhysics` gives them with any of its units
 * pulling, as fuel, water, the wire and the standby rule may leave them (`Train.refreshModes`),
 * and as light as its run may leave them (`drained`). A train stopped for fuel or power has no
 * unit pulling while it waits, and sets off with them.
 */
export function crossingPull(train: CrossingTrain): number {
  let best = Math.max(0, train.acceleration ?? 0);
  const { locos } = train;
  if (!locos?.length || !train.wagons) return best;
  const wagons = drained(locos, train.wagons);
  for (let set = 1; set < 1 << locos.length; set++) {
    const on = locos.map((l, i) => ({ ...l, engaged: ((set >> i) & 1) === 1 }));
    best = Math.max(best, consistPhysics(on, wagons).acceleration);
  }
  return best;
}

/**
 * The wagons as light as a run may leave them. A steam train tops its boiler up from its tank
 * wagons of water as it runs (`Train.drawTankerWater`), and the boiler's water weighs nothing in
 * `consistPhysics`, so with a steam unit aboard, pulling or not, any water a tank wagon carries
 * may be gone, and the consist the lighter for it. Nothing else a train carries leaves it under
 * way: it unloads only at a stop.
 */
function drained(
  locos: NonNullable<CrossingTrain['locos']>,
  wagons: NonNullable<CrossingTrain['wagons']>,
): NonNullable<CrossingTrain['wagons']> {
  if (!locos.some((l) => l.def.type === 'steam')) return wagons;
  return wagons.map((w) =>
    w.def.body === 'tank' && w.cargo === 'water' ? { ...w, cargo: null, amount: 0 } : w,
  );
}

/**
 * The furthest a train could run in `t` game seconds from its speed now, 0 for one standing: gaining
 * speed at the hardest it could (`crossingPull`) up to the most a line lets it run (its top speed
 * downhill, DESCENT_SPEED), or its speed now if that is more. A train given neither keeps its
 * speed. A train that brakes runs less, never more.
 */
export function crossingReach(train: CrossingTrain, t: number): number {
  const v = Math.max(0, train.speed);
  const a = crossingPull(train);
  const top = Math.max(v, (train.maxSpeed ?? 0) * DESCENT_SPEED);
  if (!(a > 0) || top <= v) return v * t;
  const rising = Math.min(t, (top - v) / a);
  return v * rising + (a * rising * rising) / 2 + top * (t - rising);
}

/**
 * Which level crossings are closed to walkers now. `update` moves it on by one step from where the
 * trains stand, before the walkers move; `closed` is what they ask, and `detour` and `occupied`
 * what one held at a closed crossing asks to walk round it. Nothing of it is saved: after a load
 * the trains close the crossings again on the first step.
 */
export class CrossingWatch {
  /**
   * Each closed crossing by its key: the game seconds since the watch first saw it clear, or -1
   * while a car is on it or a train is coming. An open crossing has no entry.
   */
  private readonly clear = new Map<number, number>();
  /**
   * The keys of the crossings closed now only by trains standing out of fuel or power
   * (DETOUR_STATES): a car of one on it, or it within the reach of one, and of no other train.
   */
  private readonly dry = new Set<number>();
  /** The keys of every tile a car stands on now, crossing or not. */
  private readonly cars = new Set<number>();

  /** `w` is the width of the map the keys are of (`y * w + x`). */
  constructor(readonly w: number) {}

  /**
   * One step of `gdt` game seconds, the trains where they stand now and `crossingKeys` the level
   * crossings of the map (`Roads.crossingKeys`). A crossing a car stands on, or that a train with
   * its way set could reach within CROSSING_HORIZON, closes; one closed that is neither stays
   * closed until CROSSING_HOLD game seconds after the step that first saw it so, and a tile that is
   * no longer a crossing opens.
   */
  update(trains: Iterable<CrossingTrain>, crossingKeys: ReadonlySet<number>, gdt: number): void {
    const busy = this.busy(trains, crossingKeys);
    for (const [k, since] of this.clear) {
      if (busy.has(k)) continue;
      const clear = since < 0 ? 0 : since + gdt;
      if (!crossingKeys.has(k) || clear >= CROSSING_HOLD - HOLD_EPS) this.clear.delete(k);
      else this.clear.set(k, clear);
    }
    for (const k of busy) this.clear.set(k, -1);
  }

  /** The level crossing on (x, y) is closed; false for any other tile. */
  readonly closed = (x: number, y: number): boolean =>
    x >= 0 && x < this.w && y >= 0 && this.clear.has(y * this.w + x);

  /**
   * The level crossing on (x, y) is closed, and only trains standing out of fuel or power
   * (DETOUR_STATES) hold it so: a car of one stands on it or it lies within the reach of one, and
   * no other train's car is on it nor any other train coming. Walkers walk round it (#447). False
   * for a crossing open, in its CROSSING_HOLD, or closed by any other train as well, and for any
   * other tile.
   */
  readonly detour = (x: number, y: number): boolean =>
    x >= 0 && x < this.w && y >= 0 && this.dry.has(y * this.w + x);

  /**
   * A car of a train stands on (x, y), any tile, as the last `update` read the trains while the map
   * had a level crossing; with none, the watch reads no train and holds no car.
   */
  readonly occupied = (x: number, y: number): boolean =>
    x >= 0 && x < this.w && y >= 0 && this.cars.has(y * this.w + x);

  /** How many crossings are closed now. */
  get size() {
    return this.clear.size;
  }

  /**
   * The crossings a car stands on, or that a train with its way set (ROUTED_STATES) could reach
   * along it within CROSSING_HORIZON, running on from its speed now or setting off from a
   * standstill. Any other train runs nowhere, whatever speed it was left with. On the way it notes
   * the tiles under every car, and which of those crossings only trains standing out of fuel or
   * power close; it reads the trains for nothing else.
   */
  private busy(trains: Iterable<CrossingTrain>, crossingKeys: ReadonlySet<number>): Set<number> {
    const out = new Set<number>();
    this.cars.clear();
    this.dry.clear();
    if (!crossingKeys.size) return out;
    // the crossings a train not standing out of fuel or power closes
    const firm = new Set<number>();
    for (const t of trains) {
      const dry = DETOUR_STATES.has(t.state);
      const close = (k: number) => {
        out.add(k);
        if (!dry) firm.add(k);
      };
      for (const k of t.occupancyKeys(this.w)) {
        this.cars.add(k);
        if (crossingKeys.has(k)) close(k);
      }
      if (!ROUTED_STATES.has(t.state)) continue;
      const far = crossingReach(t, CROSSING_HORIZON) + CROSSING_LEAD;
      for (const s of t.pathAhead()) {
        if (s.arc - t.pathProgress > far) break;
        const k = s.y * this.w + s.x;
        if (crossingKeys.has(k)) close(k);
      }
    }
    for (const k of out) if (!firm.has(k)) this.dry.add(k);
    return out;
  }
}
