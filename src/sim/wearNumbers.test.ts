// The numbers of track wear (spec §3), measured on a headless game: when the first piece of a busy
// Steam network turns degraded, and how long an unused line lasts. These do not pin the rules: they
// fail when a change to a rule moves either figure out of its range, which is a balance call.

import { beforeEach, describe, expect, it } from 'vitest';
import { Dir } from '../engine/iso';
import { content } from '../data/content';
import { simWorld, type SimWorld } from '../testing/simWorld';
import { rules, DEFAULT_RULES, daySeconds } from './rules';
import { SimStep } from './step';
import { Station } from './stations';
import { Train, defaultStop, type TickCtx } from './trains';
import { stateOf } from './wear';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

const ROW = 20;
/** The line runs from x 10 to x 40: 31 tiles. */
const WEST = 10;
const EAST = 40;
const TRAINS = 6;
/** The longest run: 2 h at 1x. */
const TWO_HOURS = 2 * 3600;
/**
 * Game seconds per step. The game steps at 0.05; an hour at that takes about 15 s, and 0.25 gives
 * the same first-degraded minute to within 0.2 min here, in a fifth of the time.
 */
const GDT = 0.25;

const locoDef = (id: string) => content.locomotives.find((d) => d.id === id)!;
const wagonDef = (id: string) => content.wagons.find((d) => d.id === id)!;

/**
 * A Branch line of 31 tiles (the Steam age has no Main line) with a platform at x 14 and another at
 * x 36, and six trains of the heaviest weight a Branch Steam engine may haul: a MAV 375 (40 t, hauls
 * 70 t) and a gondola with 24.9 t of iron under that, 110 t in all. They shuttle between the two,
 * all calling at the platform at x 14, and start spread along the line.
 */
function busyNetwork() {
  const w = simWorld({ terrain: 'grass', size: 64 });
  for (let x = WEST; x <= EAST; x++) w.track.place(x, ROW, 'straight', 1, 'branch');
  const platform = new Station('quarry', 14, ROW - 1);
  const far = new Station('quarry', 36, ROW - 1);
  w.builder.stations.push(platform, far);
  // a call: the train stops, loads and unloads nothing, and moves on
  const call = (s: Station) => ({
    ...defaultStop(s.id),
    waitFull: false,
    refuel: false,
    load: 'none' as const,
    unload: 'none' as const,
  });
  const trains: Train[] = [];
  for (let i = 0; i < TRAINS; i++) {
    const t = new Train([{ uid: 1 + i * 10, level: 1, def: locoDef('mav375') }]);
    t.wagons = [
      {
        uid: 2 + i * 10,
        def: wagonDef('bathtub'),
        level: 1,
        cargo: 'iron',
        amount: 24.9,
        origin: null,
      },
    ];
    expect(t.mass).toBeCloseTo(109.76);
    expect(t.spawnAt(w.track, 22 + i * 3, ROW, i % 2 ? Dir.W : Dir.E)).toBe(true);
    t.schedule = [call(platform), call(far)];
    t.oil = t.oilCap;
    t.coal = 1e9;
    t.water = 1e9;
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    t.onPathReady({ builder: w.builder });
    trains.push(t);
  }
  return { w, trains };
}

/**
 * Runs the game from its start and returns the game minute at which the first piece turns
 * degraded, or null if none does in `seconds`. The trains are ticked on their own, not through the
 * fleet: its traffic control claims whole sections, so six trains on one plain line would jam, and a
 * real network needs sidings or signals to run them. Ticked alone, each train has a free road. The
 * passes an hour it counts are the most such a network can make; a real one makes fewer and
 * degrades later.
 */
function firstDegradedMinute(w: SimWorld, trains: Train[], seconds: number): number | null {
  const step = new SimStep(w);
  const seen = { minute: null as number | null };
  w.builder.wear.onFirst = (kind) => {
    if (kind === 'degraded') seen.minute = w.clock.time / 60;
  };
  const ctxOf = w.fleet as unknown as { ctx(now: number, speed: number): TickCtx };
  for (let n = 0; n * GDT < seconds && seen.minute === null; n++) {
    w.clock.time += GDT;
    step.run(GDT, { mode: 'play', weather: false });
    const ctx = ctxOf.ctx(w.clock.time, 1);
    for (const t of trains) t.tick(GDT, ctx);
  }
  return seen.minute;
}

describe('the numbers of track wear', () => {
  it('a six-train Steam network first degrades a piece near the hour, not before half of it', () => {
    const { w, trains } = busyNetwork();
    const minute = firstDegradedMinute(w, trains, TWO_HOURS);
    expect(minute).not.toBeNull();
    expect(minute!).toBeGreaterThan(30);
    expect(minute!).toBeLessThan(90);
  });

  it('an unused line takes about 12 hours to degrade', () => {
    const w = simWorld({ terrain: 'grass', size: 32 });
    w.track.place(5, 5, 'straight', 1, 'branch');
    const piece = w.track.get(5, 5)!;
    // only the time wear: no train runs, a game day at a time
    let days = 0;
    while (stateOf(piece) === 'healthy' && days < 1000) {
      w.builder.wear.daily();
      days++;
    }
    expect(days).toBeGreaterThanOrEqual(173);
    expect(days).toBeLessThanOrEqual(177);
    // 175 days of 4 minutes are 11.7 hours
    const hours = (days * daySeconds()) / 3600;
    expect(hours).toBeGreaterThan(11);
    expect(hours).toBeLessThan(12.5);
  });
});
