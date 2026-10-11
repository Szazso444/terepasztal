import { describe, it, expect } from 'vitest';
import { TrackGraph } from '../world/track';
import { Traffic } from './traffic';
import type { Builder } from './build';
import type { Train } from './trains';
import { Dir, DIR_DX, DIR_DY } from '../engine/iso';
import type { Rng } from '../engine/rng';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';

/** Traffic only reads `stations` off the builder, to find platform tiles. */
function trafficOn(
  track: TrackGraph,
  stations: { gateTiles(): { x: number; y: number }[] }[] = [],
) {
  const t = new Traffic(track, { stations } as unknown as Builder);
  t.rebuildSections();
  return t;
}

/** E–W straights along row `y`, x0 to x1 inclusive. */
function line(
  g: TrackGraph,
  y: number,
  x0: number,
  x1: number,
  cls: 'regular' | 'narrow' = 'regular',
) {
  for (let x = x0; x <= x1; x++) g.place(x, y, 'straight', 1, cls);
}

const key = (g: TrackGraph, x: number, y: number) => y * g.w + x;

describe('sections', () => {
  it('chains plain track between its dead ends', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    const t = trafficOn(g);

    // Both ends have a single connection, so they stand alone as nodes.
    expect(t.sectionOf(1, 5)).toBeLessThan(0);
    expect(t.sectionOf(8, 5)).toBeLessThan(0);

    const id = t.sectionOf(4, 5);
    expect(id).toBeGreaterThan(0);
    for (let x = 2; x <= 7; x++) expect(t.sectionOf(x, 5)).toBe(id);
    expect(t.tilesOfSection(id).sort((a, b) => a - b)).toEqual(
      [2, 3, 4, 5, 6, 7].map((x) => key(g, x, 5)),
    );
    expect(t.sectionLength(4, 5)).toBe(6);
    expect(t.sectionLength(1, 5)).toBe(1);
  });

  it('cuts the chain at a switch', () => {
    const g = new TrackGraph(16, 16);
    // One-tile switches are narrow gauge: the whole line is narrow.
    line(g, 5, 1, 8, 'narrow');
    // Rotation 1 puts the through road E–W, so the line stays joined across it.
    g.place(5, 5, 'switch', 1, 'narrow');
    const t = trafficOn(g);

    expect(t.sectionOf(5, 5)).toBeLessThan(0);
    const left = t.sectionOf(3, 5);
    const right = t.sectionOf(6, 5);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(left).not.toBe(right);
    expect(t.tilesOfSection(left)).toHaveLength(3); // 2, 3, 4
    expect(t.tilesOfSection(right)).toHaveLength(2); // 6, 7
  });

  it('stands a platform tile on its own', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    const t = trafficOn(g, [{ gateTiles: () => [{ x: 4, y: 5 }] }]);

    expect(t.sectionOf(4, 5)).toBeLessThan(0);
    expect(t.sectionOf(3, 5)).not.toBe(t.sectionOf(5, 5));
    expect(t.sectionOf(3, 5)).toBeGreaterThan(0);
    expect(t.sectionOf(5, 5)).toBeGreaterThan(0);
  });

  it('ignores a station gate with no track under it', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    const t = trafficOn(g, [{ gateTiles: () => [{ x: 4, y: 9 }] }]);
    expect(t.sectionOf(4, 5)).toBe(t.sectionOf(3, 5));
  });

  it('keeps two lines that never touch apart', () => {
    const g = new TrackGraph(16, 16);
    line(g, 2, 1, 6);
    line(g, 9, 1, 6);
    const t = trafficOn(g);
    expect(t.sectionOf(3, 2)).not.toBe(t.sectionOf(3, 9));
  });

  it('gives every member of a multi-tile switch its own node id', () => {
    const g = new TrackGraph(16, 16);
    const tiles = g.place(6, 6, 'switch', 0, 'regular');
    const t = trafficOn(g);
    for (const tile of tiles) expect(t.sectionOf(tile.x, tile.y)).toBeLessThan(0);
  });

  it('chains a 2×2 curve into the single line it sits on', () => {
    for (const cls of ['regular', 'high_speed'] as const) {
      const g = new TrackGraph(24, 24);
      const tiles = g.place(10, 10, 'curve', 0, cls);
      const inUnit = (x: number, y: number) => tiles.some((m) => m.x === x && m.y === y);
      // the curve's two open ends, each continued by three straights
      const ends: { x: number; y: number }[] = [];
      for (const m of tiles)
        for (const d of g.get(m.x, m.y)!.links.flat() as Dir[]) {
          const nx = m.x + DIR_DX[d],
            ny = m.y + DIR_DY[d];
          if (inUnit(nx, ny)) continue;
          for (let i = 0; i < 3; i++)
            g.place(
              nx + DIR_DX[d] * i,
              ny + DIR_DY[d] * i,
              'straight',
              d === Dir.N || d === Dir.S ? 0 : 1,
              cls,
            );
          ends.push({ x: nx, y: ny });
          expect(g.connected(m.x, m.y, d)).toBe(true);
        }
      expect(ends).toHaveLength(2);
      const t = trafficOn(g);
      const id = t.sectionOf(ends[0].x, ends[0].y);
      // one block from one side of the curve to the other: opposing trains cannot both enter
      expect(id).toBeGreaterThan(0);
      expect(t.sectionOf(ends[1].x, ends[1].y)).toBe(id);
      for (const m of tiles)
        if (g.get(m.x, m.y)!.links.length) expect(t.sectionOf(m.x, m.y)).toBe(id);
    }
  });

  it('answers for bare tiles that carry no track at all', () => {
    const g = new TrackGraph(16, 16);
    const t = trafficOn(g);
    expect(t.sectionOf(3, 3)).toBe(-(key(g, 3, 3) + 1));
    expect(t.sectionLength(3, 3)).toBe(1);
    expect(t.tilesOfSection(t.sectionOf(3, 3))).toEqual([]);
  });

  it('rebuilds after the track changes', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    const t = trafficOn(g);
    const before = t.tilesOfSection(t.sectionOf(4, 5)).length;

    g.removeAt(5, 5);
    t.rebuildSections();
    const after = t.tilesOfSection(t.sectionOf(3, 5)).length;
    expect(before).toBe(6);
    // 2 and 3 remain plain; 4 became a dead end.
    expect(after).toBe(2);
    expect(t.sectionOf(4, 5)).toBeLessThan(0);
  });
});

describe('claims', () => {
  it('reports a tile as claimed only for other trains', () => {
    const g = new TrackGraph(16, 16);
    line(g, 5, 1, 8);
    const t = trafficOn(g);

    expect(t.claimedBy(3, 5, 1)).toBeNull();
    t.claims.set(key(g, 3, 5), 1);
    expect(t.claimedBy(3, 5, 1)).toBeNull();
    expect(t.claimedBy(3, 5, 2)).toBe(1);
  });
});

/** Minimal moving train: these tests exercise interlocking independently of propulsion. */
function moving(id: number, xs: number[], occupied: number[], w: number, y = 5): Train {
  const east = xs.at(-1)! > xs[0];
  const path = xs.map((x, i) => ({
    x,
    y,
    in: east ? Dir.W : Dir.E,
    out: east ? Dir.E : Dir.W,
    arc: i,
  }));
  return {
    id,
    name: `Train ${id}`,
    state: 'moving',
    poses: [{ x: xs[0], y }],
    holding: false,
    pathProgress: 0,
    length: 2,
    yieldCount: 0,
    weight: 10,
    claimLimit: Infinity,
    claimBlocker: null,
    pathAhead: () => path,
    occupancyKeys: () => occupied.map((x) => y * w + x),
    // built here, not loaded from a save: nothing to resume
    resumeAfterLoad: () => {},
    cancelRetreat(this: Train) {
      this.holding = false;
      this.state = 'yielding';
    },
  } as unknown as Train;
}

describe('interlocking and recovery ownership', () => {
  it('closes a stuck episode when normal small simulation steps add up to movement', () => {
    const g = new TrackGraph(24, 24);
    line(g, 5, 1, 14);
    const traffic = trafficOn(g);
    const t = moving(1, [5, 6], [5], g.w);
    traffic.observe([t], 0, 0);
    traffic.observe([t], 31, 31);
    expect(traffic.stuckTrains(31)).toHaveLength(1);
    for (let i = 1; i <= 7; i++) {
      t.poses[0].x += 0.1;
      traffic.observe([t], 31 + i, 1);
    }
    expect(traffic.stuckTrains(38)).toHaveLength(0);
    expect(traffic.episodes.filter((e) => e.kind === 'unstuck')).toHaveLength(1);
  });
  it('grants the gap to only one train when both already stand inside the same section', () => {
    const g = new TrackGraph(24, 24);
    line(g, 5, 1, 14);
    const traffic = trafficOn(g);
    const east = moving(1, [5, 6, 7, 8], [5], g.w);
    const west = moving(2, [7, 6, 5, 4], [7], g.w);
    traffic.assign([east, west], 0);
    expect(traffic.claimedBy(6, 5, 2)).toBe(1);
    expect(west.claimLimit).toBe(1);
  });
  it('sees every physical train before assigning any forward claims', () => {
    const g = new TrackGraph(24, 24);
    line(g, 5, 1, 14);
    const traffic = trafficOn(g);
    const east = moving(1, [1, 2, 3, 4, 5, 6, 7], [1], g.w);
    const west = moving(2, [7, 6, 5, 4, 3, 2, 1], [7], g.w);
    traffic.assign([east, west], 0);
    expect(east.claimBlocker).toBe(2);
    expect(east.claimLimit).toBe(1);
    expect(traffic.claims.get(key(g, 2, 5))).not.toBe(1);
    expect(traffic.claims.get(key(g, 7, 5))).toBe(2);
  });

  it('holds before a junction when the exit cannot fit the consist', () => {
    const g = new TrackGraph(24, 24);
    line(g, 5, 1, 14, 'narrow');
    g.place(5, 5, 'switch', 1, 'narrow');
    const traffic = trafficOn(g);
    const east = moving(1, [4, 5, 6, 7, 8, 9], [4], g.w);
    const parked = moving(2, [7, 8], [7], g.w);
    parked.state = 'waiting';
    traffic.assign([east, parked], 0);
    expect(east.claimBlocker).toBe(2);
    expect(east.claimLimit).toBe(1);
    expect(traffic.claims.has(key(g, 5, 5))).toBe(false);
    parked.state = 'moving';
    traffic.assign([east, parked], 1);
    expect(east.claimLimit).toBe(1);
    expect(traffic.claims.has(key(g, 5, 5))).toBe(false);
  });

  it('reserves an escape atomically, rejects occupied routes, and protects it from a second group', () => {
    const g = new TrackGraph(24, 24);
    line(g, 5, 1, 14);
    const traffic = trafficOn(g);
    const first = moving(1, [4, 3, 2, 1], [4], g.w);
    const second = moving(2, [8, 7, 6, 5], [8], g.w);
    traffic.assign([first, second], 0);
    const path = first.pathAhead();
    expect(traffic.reserveRecovery(second, path, [1, 2], [first, second], 0)).toBe(false);
    expect(traffic.reserveRecovery(first, path, [1, 2], [first, second], 0)).toBe(true);
    first.holding = true;
    expect(traffic.reserveRecovery(second, path.slice(1), [2, 3], [first, second], 0)).toBe(false);
    traffic.assign([first, second], 1);
    expect(traffic.claimedBy(2, 5, 2)).toBe(1);
    expect(first.claimLimit).toBe(Infinity);
    traffic.assign([first, second], 32);
    expect(first.holding).toBe(false);
    expect(traffic.recoveries.active.size).toBe(0);
    expect(traffic.claimedBy(2, 5, 2)).toBeNull();
    expect(traffic.claimedBy(4, 5, 2)).toBe(1);
  });

  it('leases both legs of a shunt whole, keeps the second until the turn, and counts the turn as progress', () => {
    const g = new TrackGraph(24, 24);
    line(g, 5, 1, 14);
    const traffic = trafficOn(g);
    // the first leg runs west from x 8 to 4, where the train turns and runs east from x 6 to 10
    const shunter = moving(1, [8, 7, 6, 5, 4], [8, 9], g.w);
    const out = shunter.pathAhead();
    const back = [6, 7, 8, 9, 10].map((x) => ({ x, y: 5, in: Dir.W, out: Dir.E }));
    const behind = moving(2, [13, 12, 11], [13], g.w);
    const stand = moving(3, [11, 10], [10], g.w);
    stand.state = 'waiting';
    // a train standing on the second leg: nothing is leased, nothing claimed
    expect(traffic.reserveRecovery(shunter, [...out, ...back], [1, 2], [shunter, stand], 0)).toBe(
      false,
    );
    expect(traffic.recoveries.active.size).toBe(0);
    expect(traffic.claims.size).toBe(0);
    expect(traffic.reserveRecovery(shunter, [...out, ...back], [1, 2], [shunter, behind], 0)).toBe(
      true,
    );
    shunter.holding = true;
    for (const x of [4, 5, 6, 7, 8, 9, 10]) expect(traffic.claimedBy(x, 5, 2), `x ${x}`).toBe(1);
    // where the train stands (`cars`) and the tiles its path runs on over (`ahead`, one a tile)
    const at = (progress: number, cars: number[], ahead: number[]) =>
      Object.assign(shunter, {
        pathProgress: progress,
        occupancyKeys: () => cars.map((x) => 5 * g.w + x),
        pathAhead: () =>
          ahead.map((x, i) => {
            const east = ahead.length < 2 || ahead[1] > ahead[0];
            return { x, y: 5, in: east ? Dir.W : Dir.E, out: east ? Dir.E : Dir.W, arc: i };
          }),
      });
    // on its first leg, past x 7 and 8: the tiles it comes back over stay its own
    at(3, [5, 6], [5, 4]);
    traffic.assign([shunter, behind], 20);
    for (const x of [7, 8, 9, 10]) expect(traffic.claimedBy(x, 5, 2), `x ${x}`).toBe(1);
    // turned at x 4 (its path starts afresh): the turn is progress, and what it leaves is let go
    at(0.2, [4, 5, 6], [6, 7, 8, 9, 10]);
    traffic.assign([shunter, behind], 20.05);
    at(2.5, [7, 8], [8, 9, 10]);
    traffic.assign([shunter, behind], 45);
    expect(traffic.claimedBy(4, 5, 2)).toBeNull();
    expect(traffic.claimedBy(9, 5, 2)).toBe(1);
    // 31 s past the last gain on the first leg, but 6 s past one on the second: not stalled
    traffic.assign([shunter, behind], 51);
    expect(shunter.holding).toBe(true);
    expect(traffic.recoveries.active.has(1)).toBe(true);
  });

  it('leases a shunt on generated lines whole or not at all, and lets go of nothing still to run', () => {
    // a single line along y 5 from x 1 to LINE; the shunter (#1, `len` tiles long) heads west from
    // x `from` for `out` tiles, turns where it stands wholly on them and runs east from its rear
    // end's tile for `back` tiles. Other trains stand about, some in its group, some of them
    // claiming tiles, and another group may hold an escape of its own
    const LINE = 30;
    interface Other {
      cars: number[];
      inGroup: boolean;
      claims: number[];
    }
    interface LeaseCase {
      from: number;
      out: number;
      len: number;
      back: number;
      others: Other[];
      escape: number[];
    }
    const gen = (rng: Rng): LeaseCase => {
      const len = rng.int(1, 4);
      const out = rng.int(len + 1, 12);
      const from = rng.int(out + 1, LINE - len);
      const back = rng.int(len, LINE - (from - out + len));
      const tiles = () => {
        const a = rng.int(1, LINE);
        return Array.from({ length: rng.int(1, 3) }, (_, i) => a + i).filter((x) => x <= LINE);
      };
      const others = Array.from({ length: rng.int(0, 3) }, () => ({
        cars: rng.chance(0.4) ? tiles() : [],
        inGroup: rng.chance(0.5),
        claims: rng.chance(0.5) ? tiles() : [],
      }));
      return { from, out, len, back, others, escape: rng.chance(0.3) ? tiles() : [] };
    };
    const leased = { yes: 0, no: 0 };
    forAll(
      gen,
      (c) => {
        const g = new TrackGraph(40, 12);
        line(g, 5, 1, LINE);
        const traffic = trafficOn(g);
        const k = (x: number) => key(g, x, 5);
        const xsOut = Array.from({ length: c.out }, (_, i) => c.from - i);
        const rearX = xsOut[c.out - c.len];
        const xsBack = Array.from({ length: c.back }, (_, i) => rearX + i);
        const way = [
          ...xsOut.map((x) => ({ x, y: 5, in: Dir.E, out: Dir.W })),
          ...xsBack.map((x) => ({ x, y: 5, in: Dir.W, out: Dir.E })),
        ];
        // the shunter's cars, its head on x `from`
        const at = { cars: Array.from({ length: c.len }, (_, i) => c.from + i), ahead: way };
        const shunter = Object.assign(moving(1, [c.from], [], g.w), {
          occupancyKeys: () => at.cars.map(k),
          pathAhead: () => at.ahead.map((s, i) => ({ ...s, arc: i })),
        });
        const others = c.others.map((o, i) => {
          const t = moving(2 + i, o.cars.length ? o.cars : [LINE], o.cars, g.w);
          t.state = 'waiting';
          return t;
        });
        const trains = [shunter, ...others];
        const group = [1, ...others.filter((_, i) => c.others[i].inGroup).map((t) => t.id)];
        c.others.forEach((o, i) => o.claims.forEach((x) => traffic.claims.set(k(x), 2 + i)));
        // another group's escape, owned by #9 for #9 and #10
        if (c.escape.length)
          expect(traffic.recoveries.reserve(9, [9, 10], new Set(c.escape.map(k)), 0, 0)).toBe(true);
        const tiles = new Set(way.map((s) => k(s.x)));
        // the oracle: no train outside the shunter stands on the way, no train outside its group
        // claims a tile of it, and no other escape holds one
        const standing = others.some((o) => o.occupancyKeys(g.w).some((t) => tiles.has(t)));
        const claimed = [...tiles].some((t) => {
          const owner = traffic.claims.get(t);
          return owner !== undefined && !group.includes(owner);
        });
        const escaped = c.escape.some((x) => tiles.has(k(x)));
        const want = !standing && !claimed && !escaped;
        const before = JSON.stringify({
          claims: [...traffic.claims],
          active: [...traffic.recoveries.active.keys()],
        });
        const got = traffic.reserveRecovery(shunter, way, group, trains, 0);
        expect(got, `standing ${standing}, claimed ${claimed}, escaped ${escaped}`).toBe(want);
        leased[got ? 'yes' : 'no']++;
        if (!got) {
          // nothing changed: no tile claimed, no lease
          expect(
            JSON.stringify({
              claims: [...traffic.claims],
              active: [...traffic.recoveries.active.keys()],
            }),
          ).toBe(before);
          return;
        }
        const plan = traffic.recoveries.active.get(1)!;
        for (const t of tiles) expect(traffic.claims.get(t), `tile ${t % g.w}`).toBe(1);
        expect([...plan.tiles].sort((a, b) => a - b)).toEqual([...tiles].sort((a, b) => a - b));
        expect([...plan.rest].sort((a, b) => a - b)).toEqual(
          [...new Set(xsBack.map(k))].sort((a, b) => a - b),
        );
        // run it: every tile still to run (the rest of the leg, and the second leg until the
        // turn) stays the shunter's at every step, and it is never released as stalled
        shunter.holding = true;
        // the others stand still and claim nothing more: keep them out of the way of the run
        const run = [shunter];
        const still = (now: number, rest: { x: number; y: number }[], where: string) => {
          traffic.assign(run, now);
          expect(shunter.holding, where).toBe(true);
          for (const s of rest)
            expect(traffic.claims.get(k(s.x)), `${where}: x ${s.x} still to run`).toBe(1);
        };
        let now = 0;
        for (let h = 0; h < c.out; h++) {
          at.cars = Array.from({ length: c.len }, (_, i) => xsOut[h] + i);
          at.ahead = way.slice(h, c.out);
          Object.assign(shunter, { pathProgress: h + 0.5 });
          now += 2;
          still(now, [...way.slice(h, c.out), ...way.slice(c.out)], `first leg at x ${xsOut[h]}`);
        }
        // turned where it stands: the path starts afresh, the second leg ahead
        for (let h = 0; h < c.back; h++) {
          at.cars = Array.from({ length: c.len }, (_, i) => xsBack[h] - i);
          at.ahead = way.slice(c.out + h);
          Object.assign(shunter, { pathProgress: h + 0.3 });
          now += 2;
          still(now, way.slice(c.out + h), `second leg at x ${xsBack[h]}`);
          // what lies behind it on neither leg's rest is let go
          for (let x = 1; x <= LINE; x++) {
            const behind = x < xsBack[h] - c.len + 1 || (x > xsBack[h] && !xsBack.includes(x));
            if (
              behind &&
              traffic.claims.get(k(x)) === 1 &&
              !c.others.some((o) => o.cars.includes(x))
            )
              expect.fail(`second leg at x ${xsBack[h]}: x ${x} behind it is still claimed`);
          }
        }
      },
      {
        seeds: Array.from({ length: 300 }, (_, i) => i + 1),
        shrink: function* (c) {
          for (const others of shrinkArray(c.others)) yield { ...c, others };
          if (c.escape.length) yield { ...c, escape: [] };
          for (const back of shrinkInt(c.back, c.len)) yield { ...c, back };
        },
      },
    );
    // both outcomes are drawn often
    expect(leased.yes).toBeGreaterThan(50);
    expect(leased.no).toBeGreaterThan(50);
  });

  it('keeps the escape owner subject to a newly occupied route', () => {
    const g = new TrackGraph(24, 24);
    line(g, 5, 1, 14);
    const traffic = trafficOn(g);
    const first = moving(1, [4, 3, 2, 1], [4], g.w);
    expect(traffic.reserveRecovery(first, first.pathAhead(), [1, 2], [first], 0)).toBe(true);
    first.holding = true;
    const intruder = moving(3, [2, 3], [2], g.w);
    intruder.state = 'waiting';
    traffic.assign([first, intruder], 1);
    expect(first.claimBlocker).toBe(3);
    expect(first.claimLimit).toBeLessThan(Infinity);
  });
});
