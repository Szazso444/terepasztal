import { describe, expect, it, vi } from 'vitest';
import { Dir } from '../engine/iso';
import { TrackGraph } from '../world/track';
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
