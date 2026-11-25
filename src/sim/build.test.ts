import { describe, it, expect, beforeEach } from 'vitest';
import { simWorld, line, station } from '../testing/simWorld';
import { rules, DEFAULT_RULES } from './rules';
import type { Station } from './stations';
import { STR } from '../strings';
import { landmarkDef } from '../data/content';
import { footprintOf } from '../world/track';
import { LandmarkRegistry } from './landmarks';
import type { Builder, PlacementCheck } from './build';

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

/** A flat world with a long line on row 30, every chunk owned so the builder may pay anywhere. */
function world() {
  const w = simWorld({ terrain: 'grass', size: 96 });
  w.regions.unlocked.fill(true);
  line(w, 2, 30, 90);
  return w;
}

/** The store of a depot the builder placed. */
function storeOf(w: ReturnType<typeof world>, depot: Station) {
  return w.stores.byKey(`st:${depot.id}`)!;
}

describe('paying from stores', () => {
  it('a station pays from the nearest store that holds its cost', () => {
    const w = world();
    // the farm goes at (40, 29): depot A is 5 tiles off, depot B 12
    const a = storeOf(w, station(w, 'depot', 40, 24));
    const b = storeOf(w, station(w, 'depot', 52, 24));
    a.add('wood', 10);
    a.add('stone', 100);
    b.add('wood', 100);
    b.add('stone', 100);
    const check = w.builder.checkStation(40, 29, 'farm');
    expect(check).toMatchObject({ ok: true, cost: { wood: 30, stone: 10 }, payer: b.key });
    expect(w.builder.payerAt(check.cost, 40, 29)!.key).toBe(b.key);
    expect(w.builder.placeStation(40, 29, 'farm')).not.toBeNull();
    expect([b.get('wood'), b.get('stone')]).toEqual([70, 90]);
    expect([a.get('wood'), a.get('stone')]).toEqual([10, 100]);
  });

  it('nothing in reach: refused with the reach in the reason', () => {
    const w = world();
    const far = storeOf(w, station(w, 'depot', 70, 24));
    far.add('wood', 1000);
    far.add('stone', 1000);
    const check = w.builder.checkStation(40, 29, 'farm');
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(STR.build.noStoreInReach(24, '30 wood, 10 stone'));
    expect(w.builder.placeStation(40, 29, 'farm')).toBeNull();
    expect(far.get('wood')).toBe(1000);
  });

  it('two stores together are not enough', () => {
    const w = world();
    const a = storeOf(w, station(w, 'depot', 40, 24));
    const b = storeOf(w, station(w, 'depot', 52, 24));
    for (const s of [a, b]) {
      s.add('wood', 20);
      s.add('stone', 100);
    }
    const check = w.builder.checkStation(40, 29, 'farm');
    expect(check.ok).toBe(false);
    // the shortfall named is the nearest store's, not the two summed
    expect(check.reason).toBe(STR.build.noStoreInReach(24, '10 wood'));
    expect(w.builder.placeStation(40, 29, 'farm')).toBeNull();
    expect([a.get('wood'), b.get('wood')]).toEqual([20, 20]);
  });

  it('a removed station refunds to the nearest store', () => {
    const w = world();
    const a = storeOf(w, station(w, 'depot', 40, 24));
    const b = storeOf(w, station(w, 'depot', 52, 24));
    a.add('wood', 30);
    a.add('stone', 10);
    const farm = w.builder.placeStation(40, 29, 'farm')!;
    expect([a.get('wood'), a.get('stone')]).toEqual([0, 0]);
    expect(w.builder.removeStation(farm)).toBe(true);
    // half the list price comes back, to A and not to B
    expect([a.get('wood'), a.get('stone')]).toEqual([15, 5]);
    expect([b.get('wood'), b.get('stone')]).toEqual([0, 0]);
  });

  it('free mode pays nothing', () => {
    const w = world();
    const a = storeOf(w, station(w, 'depot', 40, 24));
    a.add('wood', 30);
    a.add('stone', 10);
    w.builder.free = true;
    const farm = w.builder.placeStation(40, 29, 'farm')!;
    expect(farm).not.toBeNull();
    expect([a.get('wood'), a.get('stone')]).toEqual([30, 10]);
    // nor does it need a store in reach
    expect(w.builder.placeStation(80, 29, 'farm')).not.toBeNull();
    w.builder.removeStation(farm);
    expect([a.get('wood'), a.get('stone')]).toEqual([30, 10]);
  });
});

describe('landmark tiles block building', () => {
  const item = { kind: 'straight', cls: 'branch', cls2: 'branch' } as const;
  /** One landmark in the registry the builder asks, its footprint reaching down to row 29. */
  function withLandmark(def: string) {
    const w = world();
    w.builder.free = true;
    const reg = new LandmarkRegistry({
      clock: w.clock,
      economy: w.economy,
      stores: w.stores,
      windLevel: () => 'calm',
    });
    const d = landmarkDef(def)!;
    const x = 40;
    const y = 30 - d.d;
    reg.addPlacements([{ id: def, x, y, cx: 1, cy: 1 }]);
    w.builder.landmarks = reg;
    const inside = [];
    for (let i = 0; i < d.w; i++) for (let j = 0; j < d.d; j++) inside.push({ x: x + i, y: y + j });
    return { w, inside, outside: { x: x + d.w + 1, y: 29 } };
  }
  /** Every tool, as a check of its own on one tile. */
  const tools: Record<string, (b: Builder, x: number, y: number) => PlacementCheck> = {
    track: (b, x, y) => b.checkTrack(x, y, item, 0),
    line: (b, x, y) => {
      const c = b.checkLine([{ kind: 'track', x, y, item, rot: 0 }]);
      return { ok: c.ok, cost: c.cost, reason: c.reason };
    },
    station: (b, x, y) => b.checkStation(x, y, 'farm'),
    building: (b, x, y) => b.checkBuilding(x, y, 'windmill'),
    decor: (b, x, y) => b.checkDecor(x, y, 'townhouse'),
    road: (b, x, y) => b.checkRoad(x, y),
  };

  for (const def of ['bellkeepers_refuge', 'house_between_seasons']) {
    for (const [name, check] of Object.entries(tools)) {
      it(`${name} is refused on every tile of ${def}, allowed one tile outside`, () => {
        const { w, inside, outside } = withLandmark(def);
        for (const t of inside) {
          const c = check(w.builder, t.x, t.y);
          expect(c.ok, `${t.x},${t.y}`).toBe(false);
          expect(c.reason).toBe(STR.build.landmark);
        }
        expect(check(w.builder, outside.x, outside.y)).toMatchObject({ ok: true });
      });
    }
  }

  it('placing refuses too, and a stroke of road leaves the landmark tiles out', () => {
    const { w, inside, outside } = withLandmark('house_between_seasons');
    const t = inside[0];
    expect(w.builder.placeTrack(t.x, t.y, item, 0)).toBe(false);
    expect(w.builder.placeStation(t.x, t.y, 'farm')).toBeNull();
    expect(w.builder.placeBuilding(t.x, t.y, 'windmill')).toBeNull();
    expect(w.builder.placeDecor(t.x, t.y, 'townhouse', 0)).toBeNull();
    const laid = w.builder.placeRoads([t, outside], t);
    expect(laid).toEqual([outside]);
  });

  it('a clear member of a curve may not cover a landmark tile either', () => {
    const { w, inside } = withLandmark('house_between_seasons');
    const curve = { kind: 'curve', cls: 'branch', cls2: 'branch' } as const;
    // anchored just outside, its footprint reaches in
    for (let rot = 0; rot < 4; rot++)
      for (let dx = -3; dx <= 0; dx++)
        for (let dy = -3; dy <= 0; dy++) {
          const c = w.builder.checkTrack(inside[0].x + dx, inside[0].y + dy, curve, rot);
          const covers = footprintOf(
            inside[0].x + dx,
            inside[0].y + dy,
            'curve',
            rot,
            'branch',
          ).some((f) => w.builder.landmarks!.occupies(f.x, f.y));
          if (covers) expect(c.ok).toBe(false);
        }
  });
});
