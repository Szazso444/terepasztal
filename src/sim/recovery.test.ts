import { describe, expect, it, vi } from 'vitest';
import { Dir } from '../engine/iso';
import { TrackGraph } from '../world/track';
import { blockingGroups, blockingCycles, findRefugePath, RecoveryReservations } from './recovery';
import { Train, type TickCtx } from './trains';
import { content } from '../data/content';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';

vi.mock('../engine/audio', () => ({ sfx: { play: vi.fn() } }));

function line(end = 14) {
  const track = new TrackGraph(24, 24);
  for (let x = 1; x <= end; x++) track.place(x, 5, 'straight', 1);
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
