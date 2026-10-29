import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { findPath } from '../world/pathfinding';
import { Dir } from '../engine/iso';
import { content, validateContent, DEFAULT_CONTENT } from '../data/content';
import { Builder } from './build';
import { Economy } from './economy';
import { Station } from './stations';
import { Train, type TickCtx } from './trains';
import { Fleet } from './fleet';
import { Inventory } from '../gacha/inventory';
import { bridgeSpan, bridgeCapacity, BRIDGE_SLOW_FACTOR, BRIDGE_SLOW_SHARE } from './bridges';
import { Signals } from './signals';
import { tickBuildings, buildingRecipe, type Building } from './buildings';
import { cityTiles } from './city';
import { weekSeconds, daySeconds, rules, DEFAULT_RULES } from './rules';
import { TradeDesk } from './trade';
import { expandSave } from './expand';
import type { SaveGame } from './save';
import { AGE_DEFS } from './ages';
import { referencePath } from './compat';
import { STR } from '../strings';
import { upgradeSeconds } from './upgrade';
import { setSupplyMode } from './supply';
import { storeWith, storesWith } from '../testing/storeFixtures';
import { simWorld, line, station } from '../testing/simWorld';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
/**
 * A grass world with a line along row 30, its builder paying from, and its trains filling up at,
 * the depot stores at the places given (one empty store at the corner by default): `depots`.
 */
function world(at: { x: number; y: number }[] = [{ x: 0, y: 0 }]) {
  const map = emptyMap(4242, 96, 96, Terrain.Grass),
    track = new TrackGraph(96, 96),
    economy = new Economy();
  const { stores, depots } = storesWith(at.map((a) => ({ amounts: {}, at: a })));
  const builder = new Builder(map, new RegionState(map), track, economy, stores);
  builder.free = true;
  const fleet = new Fleet(track, builder, map, new Inventory(), economy);
  for (let x = 2; x < 90; x++) track.place(x, 30, 'straight', 1);
  return { map, track, economy, builder, fleet, depots };
}
function train(id = 'f7') {
  return new Train([{ uid: 1, level: 0, def: content.locomotives.find((d) => d.id === id)! }]);
}
beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  // a world built by hand leaves the mode as the last test set it
  setSupplyMode('simple');
});

describe('weekly food economy and housing', () => {
  it('colors actual weekly store movements, excludes initial goods, and expires old flows', () => {
    const { stores, depot } = storeWith({ stone: 300 });
    depot.capOf = () => 320;
    const s = stores.poolOf(depot);
    expect(s.weeklyFlow('stone')).toEqual({ produced: 0, consumed: 0 });
    stores.tickUpkeep(1, new Map());
    s.add('stone', 50);
    s.spend({ stone: 10 });
    expect(s.weeklyFlow('stone')).toEqual({ produced: 20, consumed: 10 });
    stores.tickUpkeep(weekSeconds(), new Map());
    expect(s.weeklyFlow('stone')).toEqual({ produced: 0, consumed: 0 });
    s.take('stone', 5);
    expect(s.weeklyFlow('stone').consumed).toBe(5);
    stores.beginFlowHistory();
    expect(s.weeklyFlow('stone').consumed).toBe(0);
  });
  it('validates all shipped cargo, recipes and passenger vehicles', () =>
    expect(validateContent(DEFAULT_CONTENT)).toEqual([]));
  it('processes a week at 1:5, improves to 1:11, and never spends inputs into a full output store', () => {
    const { stores, depot } = storeWith({ wheat: 1000 });
    const s = stores.poolOf(depot);
    const b: Building = { id: 'windmill', x: 1, y: 1, acc: 0, active: false, rate: 0 };
    tickBuildings([b], () => s, weekSeconds());
    expect(s.get('food')).toBe(300);
    expect(s.get('wheat')).toBe(940);
    b.level = 4;
    expect(buildingRecipe(b).out.food).toBe(11);
    s.add('food', s.cap('food') - s.get('food'));
    tickBuildings([b], () => s, weekSeconds());
    expect(s.get('wheat')).toBe(940);
  });
  it('grows only into completed, paid-for housing and stops without free upgrades or houses', () => {
    const w = simWorld({ terrain: 'grass', size: 96 });
    line(w, 2, 30, 90);
    const hall = station(w, 'town', 36, 29);
    const store = w.stores.townStore(hall.x, hall.y)!;
    w.builder.free = true;
    const d = w.builder.spawnDecor(40, 29, 'townhouse', 0)!;
    w.houses.finishAll();
    store.add('food', 300);
    for (let i = 0; i < 100; i++) w.houses.tick(daySeconds(), i * daySeconds());
    const h = w.houses.at(d.x, d.y)!;
    expect(h.residents).toBe(20);
    expect(h.level).toBe(1);
    expect(w.houses.houses.size).toBe(1);
    // the player pays for the second level, which the Diesel age opens
    w.builder.free = false;
    store.add('wood', 60);
    store.add('stone', 40);
    const wood = store.get('wood');
    expect(w.houses.upgrade(h)).toBe(false);
    w.economy.setAge(1);
    expect(w.houses.upgrade(h)).toBe(true);
    expect(store.get('wood')).toBe(wood - 60);
    // the work takes its game time; nobody moves in meanwhile
    w.houses.tick(daySeconds() * 100, daySeconds() * 101);
    expect([h.level, h.residents]).toEqual([1, 20]);
    w.houses.tickWorks(upgradeSeconds(2));
    expect(h.level).toBe(2);
    w.houses.tick(daySeconds() * 100, daySeconds() * 200);
    expect(h.residents).toBe(60);
    expect(h.level).toBe(2);
  });
  it("a house grows on its own town's food, not another's, and not at all outside every town", () => {
    // Full mode: in Simple mode two towns on one line are one store
    const w = simWorld({ terrain: 'grass', size: 96, supply: 'full' });
    line(w, 2, 30, 90);
    const hallA = station(w, 'town', 20, 29);
    const hallB = station(w, 'town', 46, 29);
    const storeA = w.stores.townStore(hallA.x, hallA.y)!;
    const storeB = w.stores.townStore(hallB.x, hallB.y)!;
    w.builder.free = true;
    const inA = w.builder.spawnDecor(24, 29, 'townhouse', 0)!;
    const alone = w.builder.spawnDecor(80, 20, 'townhouse', 0)!;
    w.houses.finishAll();
    const [a, b] = [w.houses.at(inA.x, inA.y)!, w.houses.at(alone.x, alone.y)!];
    expect([w.houses.store(a), w.houses.store(b)]).toEqual([storeA, null]);
    const start = [a.residents, b.residents];
    storeB.add('food', 300);
    for (let i = 0; i < 10; i++) w.houses.tick(daySeconds(), i * daySeconds());
    expect(a.residents).toBe(start[0]);
    expect(w.houses.growthDaysLeft(a)).toBeNull();
    // with no store to eat from, nobody moves in (and nobody starves)
    expect(b.residents).toBe(start[1]);
    expect(w.houses.growthDaysLeft(b)).toBeNull();
    // fed from its own town's store, it grows; a famine there stops it again
    storeA.add('food', 300);
    expect(w.houses.growthDaysLeft(a)).not.toBeNull();
    for (let i = 10; i < 20; i++) w.houses.tick(daySeconds(), i * daySeconds());
    expect(a.residents).toBeGreaterThan(start[0]);
    expect(b.residents).toBe(start[1]);
    w.stores.byKey(storeA.key)!.famine = true;
    expect(w.houses.foodOk(a)).toBe(false);
  });
  it('a house upgrade pays from its own town store', () => {
    // Full mode: in Simple mode two towns on one line are one store
    const w = simWorld({ terrain: 'grass', size: 96, supply: 'full' });
    line(w, 2, 30, 90);
    const hallA = station(w, 'town', 20, 29);
    const hallB = station(w, 'town', 46, 29);
    const storeA = w.stores.townStore(hallA.x, hallA.y)!;
    const storeB = w.stores.townStore(hallB.x, hallB.y)!;
    w.builder.free = true;
    const d = w.builder.spawnDecor(24, 29, 'townhouse', 0)!;
    w.houses.finishAll();
    w.builder.free = false;
    w.economy.setAge(1);
    const h = w.houses.at(d.x, d.y)!;
    const cost = w.houses.upgradeCost(h)!;
    expect(Object.keys(cost).length).toBeGreaterThan(0);
    // the other town can pay, its own cannot: refused, with what its own store lacks
    for (const [k, v] of Object.entries(cost)) storeB.add(k, v);
    const refused = w.houses.canUpgrade(h);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe(
      STR.build.needResources(
        Object.entries(cost)
          .map(([k, v]) => `${v} ${k}`)
          .join(', '),
      ),
    );
    expect(w.houses.upgrade(h)).toBe(false);
    // stocked, its own store pays and the other keeps its goods
    for (const [k, v] of Object.entries(cost)) storeA.add(k, v);
    expect(w.houses.upgrade(h)).toBe(true);
    for (const [k, v] of Object.entries(cost)) {
      expect(storeA.get(k), k).toBe(0);
      expect(storeB.get(k), k).toBe(v);
    }
  });
  it('separates passenger stops from the persistent town anchor', () => {
    const town = new Station('town', 2, 2),
      station = new Station('station', 5, 2);
    expect(town.accepts('passengers')).toBe(false);
    expect(town.producedCargo()).toEqual([]);
    expect(station.accepts('passengers')).toBe(true);
    station.tick(weekSeconds());
    expect(station.stored('passengers')).toBe(0);
    station.passengerPopulation = 100;
    station.tick(weekSeconds());
    expect(station.stored('passengers')).toBeGreaterThan(0);
    expect(AGE_DEFS[2].goals).toContainEqual({ kind: 'earned', target: 100000 });
  });
  it('settles and drifts markets weekly', () => {
    const desk = new TradeDesk(),
      { stores, depot: s } = storeWith({}),
      e = new Economy();
    desk.set('food', 10);
    desk.tick(1, stores, e);
    desk.tick(daySeconds() * 6, stores, e);
    expect(s.get('food')).toBe(0);
    expect(desk.fuelMul).toBe(1);
    desk.tick(weekSeconds() + 1, stores, e);
    expect(s.get('food')).toBe(10);
    expect(desk.nextAt).toBe(2 * weekSeconds() + 1);
  });
  it('uses every sliding 6×6 window and never paves water or changes terrain', () => {
    const w = world(),
      h = [
        { x: 9, y: 9, residents: 100, progress: 1, level: 3, grow: 0, full: 0 },
        { x: 14, y: 14, residents: 100, progress: 1, level: 3, grow: 0, full: 0 },
      ];
    w.map.terrain[10 * 96 + 10] = Terrain.Water;
    expect(cityTiles(w.map, h).has(9 * 96 + 9)).toBe(true);
    expect(cityTiles(w.map, h).has(10 * 96 + 10)).toBe(false);
    expect(
      cityTiles(
        w.map,
        h.map((x) => ({ ...x, residents: 99 })),
      ).size,
    ).toBe(0);
    expect(w.map.terrain[9 * 96 + 9]).toBe(Terrain.Grass);
  });
});
describe('bridges, reversing and refuelling', () => {
  it('builds platforms before rails, links spans across classes and protects the deck under track', () => {
    const w = world();
    for (let x = 40; x < 46; x++) w.map.terrain[40 * 96 + x] = Terrain.Water;
    expect(w.builder.placeTrackKind(40, 40, 'straight', 1)).toBe(false);
    for (let x = 40; x < 46; x++) {
      expect(w.builder.placeBuilding(x, 40, 'bridge_wood')).not.toBeNull();
      expect(
        w.builder.placeTrack(
          x,
          40,
          { kind: x === 43 ? 'transition' : 'straight', cls: x > 43 ? 'high_speed' : 'regular' },
          1,
        ),
      ).toBe(true);
    }
    expect(bridgeSpan(w.builder, w.builder.buildingAt(42, 40)!)).toMatchObject({
      length: 6,
      index: 2,
      axis: 1,
    });
    expect(w.track.get(40, 40)!.bridgeCapacity).toBe(180);
    expect(w.builder.removeBuilding(40, 40)).toBe(false);
    w.builder.removeTrack(40, 40);
    expect(w.builder.removeBuilding(40, 40)).toBe(true);
  });
  it('uses whole-consist mass for path access and slows only above 80 percent while the tail crosses', () => {
    const w = world(),
      t = train();
    t.spawnAt(w.track, 40, 30, Dir.W);
    const p = w.track.get(39, 30)!;
    p.bridgeCapacity = t.mass / BRIDGE_SLOW_SHARE;
    expect(t.bridgeSpeed(w.track)).toBe(1);
    p.bridgeCapacity = t.mass / (BRIDGE_SLOW_SHARE + 0.01);
    expect(t.bridgeSpeed(w.track)).toBe(BRIDGE_SLOW_FACTOR);
    p.bridgeCapacity = t.mass - 1;
    expect(
      findPath(w.track, { x: 35, y: 30, in: Dir.W }, (x) => x === 45, 10000, undefined, t.canUse),
    ).toBeNull();
    p.bridgeCapacity = t.mass;
    expect(
      findPath(w.track, { x: 35, y: 30, in: Dir.W }, (x) => x === 45, 10000, undefined, t.canUse),
    ).not.toBeNull();
    expect(bridgeCapacity({ id: 'bridge_stone', x: 0, y: 0, acc: 0, active: false, rate: 0 })).toBe(
      650,
    );
  });
  it('reverses tender segments and wagons without changing positions or interpolating a half-turn', () => {
    const w = world(),
      t = train('mallard');
    t.wagons.push({
      uid: 2,
      def: content.wagons[0],
      level: 0,
      cargo: null,
      origin: null,
      amount: 0,
    });
    t.spawnAt(w.track, 40, 30, Dir.W);
    const target = new Station('quarry', 15, 29);
    w.builder.stations.push(target);
    t.route = [target.id];
    const before = t.vehiclePoses.flatMap((v) =>
      v.segments.map((s) => ({ x: s.x, y: s.y, a: s.angle })),
    );
    expect(t.dispatch(w.track, w.builder, w.map, undefined, 'reverse')).toBe(true);
    expect(t.reversed).toBe(true);
    t.vehiclePoses
      .flatMap((v) => v.segments)
      .forEach((s, i) => {
        expect(s.x).toBeCloseTo(before[i].x, 5);
        expect(s.y).toBeCloseTo(before[i].y, 5);
        expect(Math.cos(s.angle + Math.PI)).toBeCloseTo(Math.cos(before[i].a), 5);
      });
    expect(t.prevVehiclePoses).toBe(t.vehiclePoses);
    const pose = JSON.stringify(t.vehiclePoses);
    expect(t.dispatch(w.track, w.builder, w.map, () => true, 'reverse')).toBe(false);
    expect(JSON.stringify(t.vehiclePoses)).toBe(pose);
  });
  it('enforces the speed limit even on a single platform under a fast train', () => {
    const w = world(),
      t = train();
    t.spawnAt(w.track, 40, 30, Dir.W);
    w.track.get(40, 30)!.bridgeCapacity = t.mass / (BRIDGE_SLOW_SHARE + 0.01);
    const st = new Station('quarry', 80, 29);
    w.builder.stations.push(st);
    t.route = [st.id];
    t.oil = t.oilCap;
    t.speed = t.maxSpeed * t.loadFactor;
    w.fleet.trains.push(t);
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    const ctx = (w.fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1);
    t.onPathReady(ctx);
    t.tick(0.05, ctx);
    expect(t.speed).toBeGreaterThan(0);
    expect(t.speed).toBeLessThanOrEqual(t.maxSpeed * t.loadFactor * BRIDGE_SLOW_FACTOR + 1e-6);
  });
  it('refuels a selected group atomically at twice the materials', () => {
    // both trains stand where the one depot store supplies them
    const w = world([{ x: 45, y: 33 }]),
      a = train(),
      b = train();
    const [depot] = w.depots;
    a.spawnAt(w.track, 40, 30, Dir.W);
    b.spawnAt(w.track, 50, 30, Dir.W);
    w.fleet.trains.push(a, b);
    depot.add('oil', 2 * (a.oilCap + b.oilCap) - 1);
    const have = depot.get('oil');
    expect(w.fleet.refuelAll([a, b])).toBe(false);
    expect(a.oil).toBe(0);
    expect(depot.get('oil')).toBe(have);
    depot.add('oil', 1);
    expect(w.fleet.refuelAll([a, b])).toBe(true);
    expect(a.oil).toBe(a.oilCap);
    expect(b.oil).toBe(b.oilCap);
    expect(depot.get('oil')).toBeCloseTo(0);
  });
  it('refuels each train of a group from the store that supplies it, or none of them', () => {
    // the west store supplies the train at column 10, the east one the train at column 80
    const w = world([
        { x: 10, y: 33 },
        { x: 80, y: 33 },
      ]),
      a = train(),
      b = train();
    const [west, east] = w.depots;
    a.spawnAt(w.track, 10, 30, Dir.W);
    b.spawnAt(w.track, 80, 30, Dir.W);
    w.fleet.trains.push(a, b);
    west.add('oil', 2 * (a.oilCap + b.oilCap));
    expect(w.fleet.refuelAll([a, b]), 'the east store holds nothing').toBe(false);
    expect(a.oil).toBe(0);
    expect(west.get('oil')).toBe(2 * (a.oilCap + b.oilCap));
    east.add('oil', 2 * b.oilCap);
    expect(w.fleet.refuelAll([a, b])).toBe(true);
    expect(a.oil).toBe(a.oilCap);
    expect(b.oil).toBe(b.oilCap);
    expect(west.get('oil')).toBeCloseTo(2 * b.oilCap);
    expect(east.get('oil')).toBeCloseTo(0);
  });
  it.each(['mallard', 'f7', 'dda40x', 'big_boy', 'crocodile', 'gmam'])(
    'keeps %s segments in place when reversing on a curve',
    (id) => {
      const t = train(id),
        pl = referencePath('high_speed', 0.01);
      const points: number[][] = [];
      for (let arc = 0; arc <= 6.4; arc += 0.01) {
        const p = pl.at(arc);
        points.push([p.x, p.y, 0, 0, Dir.W, Dir.E]);
      }
      t.restoreTrail(points, false);
      const before = structuredClone(t.vehiclePoses);
      (t as unknown as { reverseConsist(): void }).reverseConsist();
      t.vehiclePoses.forEach((v, i) =>
        v.segments.forEach((s, k) => {
          const b = before[i].segments[k];
          expect(Math.hypot(s.x - b.x, s.y - b.y)).toBeLessThan(0.002);
          expect(Math.cos(s.angle + Math.PI)).toBeCloseTo(Math.cos(b.angle), 4);
          expect(Math.sin(s.angle + Math.PI)).toBeCloseTo(Math.sin(b.angle), 4);
        }),
      );
      expect(t.prevVehiclePoses).toBe(t.vehiclePoses);
    },
  );
  it('routes low reserves to the nearer reachable rail service and then resumes its destination', () => {
    // a store by each service: both are stocked
    const w = world([
        { x: 30, y: 34 },
        { x: 60, y: 34 },
      ]),
      t = train('mallard');
    t.spawnAt(w.track, 20, 30, Dir.W);
    const st = new Station('quarry', 80, 29);
    w.builder.stations.push(st);
    t.route = [st.id];
    t.coal = t.coalCap * 0.3;
    t.water = t.waterCap * 0.3;
    w.builder.placeDecor(30, 29, 'water_tower', 0);
    w.builder.placeDecor(30, 31, 'fuel_stop', 0);
    w.builder.placeDecor(60, 29, 'water_tower', 0);
    w.builder.placeDecor(60, 31, 'fuel_stop', 0);
    for (const d of w.depots) {
      d.add('coal', 1000);
      d.add('water', 1000);
    }
    w.fleet.trains.push(t);
    const ctx = (w.fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1);
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    expect(t.planFuelDetour(ctx)).toBe(true);
    expect(t.pathAhead().at(-1)?.x).toBeLessThan(35);
    for (let i = 0; i < 4000 && t.water < t.waterCap * 0.9; i++) w.fleet.tick(0.05, i * 0.05);
    expect(t.water).toBeGreaterThan(t.waterCap * 0.9);
    expect(t.coal).toBeGreaterThan(t.coalCap * 0.9);
    expect(t.route).toEqual([st.id]);
  });
  it('visits separate fuel and water services in order of the limiting reserve', () => {
    // one store within reach of both services
    const w = world([{ x: 26, y: 34 }]),
      t = train('mallard');
    t.spawnAt(w.track, 20, 30, Dir.W);
    const st = new Station('quarry', 80, 29);
    w.builder.stations.push(st);
    t.route = [st.id];
    t.mode = 'freight';
    t.coal = t.coalRate * 50;
    t.water = t.waterRate * 35;
    w.builder.placeDecor(23, 29, 'fuel_stop', 0);
    w.builder.placeDecor(30, 29, 'water_tower', 0);
    w.depots[0].add('coal', 1000);
    w.depots[0].add('water', 1000);
    w.fleet.trains.push(t);
    const ctx = (w.fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1);
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    expect(t.planFuelDetour(ctx)).toBe(true);
    expect(t.pathAhead().at(-1)?.x).toBeGreaterThan(25);
    for (let i = 0; i < 6000 && (t.water < t.waterCap * 0.9 || t.coal < t.coalCap * 0.9); i++)
      w.fleet.tick(0.05, i * 0.05);
    expect(t.state).not.toBe('noFuel');
    expect(t.water).toBeGreaterThan(t.waterCap * 0.9);
    expect(t.coal).toBeGreaterThan(t.coalCap * 0.9);
    expect(t.route).toEqual([st.id]);
  });
});
describe('semaphore boundaries and growing worlds', () => {
  it('protects blocks longer than forty tiles and respects direction and caution', () => {
    const w = world(),
      s = new Signals(w.track);
    s.rebuild([
      { id: 'signal', x: 5, y: 30, rot: Dir.E },
      { id: 'signal', x: 65, y: 30, rot: Dir.E },
      { id: 'signal', x: 80, y: 30, rot: Dir.E },
    ]);
    const p = s.postAt(5, 30)!;
    expect(s.blockBeyond(p).tiles).toHaveLength(60);
    expect(s.aspect(p, (x) => x === 60)).toBe('red');
    expect(s.aspect(p, (x) => x === 70)).toBe('yellow');
    expect(s.aspect(p, () => false)).toBe('green');
    expect(s.governs(5, 30, Dir.W)).toBeNull();
    expect(
      s.aspect(p, (x) => x === 60, [
        { x: 5, y: 30, in: Dir.W, out: Dir.E },
        { x: 6, y: 30, in: Dir.W, out: Dir.E },
      ]),
    ).toBe('red');
  });
  it('shifts bridge levels, houses, wires, track classes, car trails, escapes, ways, wanted ways and service stops together during expansion', () => {
    const save = {
      world: { kind: 'generated', seed: 4242, params: { w: 96, h: 96 } },
      track: [[20, 20, 'straight', 1, 'high_speed']],
      stations: [],
      buildings: [[20, 20, 'bridge_stone', 0.5, 3]],
      decor: [[25, 25, 'townhouse', 0]],
      wires: [[20, 20, 'catenary']],
      houses: {
        list: [{ x: 25, y: 25, level: 3, residents: 100, progress: 1 }],
        arrivals: [],
        visited: [],
      },
      trains: [
        {
          head: { x: 20, y: 20 },
          trail: [[20, 20, 20, 20, 3, 1, 1]],
          retreat: {
            path: [
              { x: 20, y: 20, in: 3, out: 1, route: 1 },
              { x: 21, y: 20, in: 3, out: 1 },
            ],
            group: [7],
          },
        },
        {
          head: { x: 22, y: 20 },
          trail: [[22, 20, 22, 20, 3, 1]],
          serviceStop: { x: 24, y: 20, fuel: true, water: false },
          way: {
            path: [
              { x: 22, y: 20, in: 3, out: 1 },
              { x: 23, y: 20, in: 3, out: 1 },
            ],
            left: 1.5,
          },
          want: [
            [22, 20],
            [21, 20],
          ],
        },
      ],
      regions: Array(9).fill(true),
      camera: { x: 12, y: 14, zoomIndex: 2 },
      clock: { time: 500, speedIndex: 2 },
    } as unknown as SaveGame;
    const grown = expandSave(save);
    expect(grown.track[0]).toEqual([52, 52, 'straight', 1, 'high_speed']);
    expect(grown.buildings?.[0]).toEqual([52, 52, 'bridge_stone', 0.5, 3]);
    expect(grown.houses?.list[0]).toMatchObject({ x: 57, y: 57, residents: 100 });
    expect(grown.wires?.[0]).toEqual([52, 52, 'catenary']);
    // a trail point keeps the route it lies on, and a train backing off keeps its escape
    const t = grown.trains[0] as unknown as {
      trail: number[][];
      retreat: { path: unknown[]; group: number[] };
    };
    expect(t.trail[0]).toEqual([52, 52, 52, 52, 3, 1, 1]);
    expect(t.retreat).toEqual({
      path: [
        { x: 52, y: 52, in: 3, out: 1, route: 1 },
        { x: 53, y: 52, in: 3, out: 1 },
      ],
      group: [7],
    });
    // a train heading for a fuel or water service keeps heading for it, along the way it runs,
    // and wants the same way should it wait
    const s = grown.trains[1] as unknown as { serviceStop: unknown; way: unknown; want: unknown };
    expect(s.serviceStop).toEqual({ x: 56, y: 52, fuel: true, water: false });
    expect(s.way).toEqual({
      path: [
        { x: 54, y: 52, in: 3, out: 1 },
        { x: 55, y: 52, in: 3, out: 1 },
      ],
      left: 1.5,
    });
    expect(s.want).toEqual([
      [54, 52],
      [53, 52],
    ]);
    expect(grown.clock.speedIndex).toBe(2);
  });
});
describe('line speed', () => {
  function runFast(cls: 'regular' | 'high_speed') {
    const w = world(),
      t = new Train([
        { uid: 1, level: 1, def: content.locomotives.find((d) => d.id === 'mallard')! },
      ]);
    if (cls === 'high_speed') for (let x = 2; x < 90; x++) w.track.place(x, 30, 'straight', 1, cls);
    for (const l of t.locos) l.inCab = true;
    t.spawnAt(w.track, 40, 30, Dir.E);
    const st = new Station('quarry', 85, 29);
    w.builder.stations.push(st);
    t.route = [st.id];
    t.coal = t.coalCap;
    t.water = t.waterCap;
    t.speed = t.maxSpeed * t.loadFactor;
    w.fleet.trains.push(t);
    expect(t.dispatch(w.track, w.builder, w.map)).toBe(true);
    const ctx = (w.fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1);
    t.onPathReady(ctx);
    for (let i = 0; i < 40; i++) t.tick(0.05, ctx);
    return t;
  }
  it('holds an engine to the regular cap and lets it run free on high-speed track', () => {
    // a cap below what the engine runs at, so the cap is what binds
    rules.lineSpeedRegular = 0.8;
    const reg = runFast('regular');
    expect(reg.speed).toBeLessThanOrEqual(0.8 * rules.trainSpeedMul + 1e-6);
    const hs = runFast('high_speed');
    expect(hs.speed).toBeGreaterThan(0.8 * rules.trainSpeedMul + 0.1);
  });
});
describe('high speed without a quest', () => {
  it('lets a player lay high-speed track from the start', () => {
    const { builder, economy } = world();
    builder.free = false;
    economy.hsUnlocked = false;
    const c = builder.checkTrack(40, 40, { kind: 'straight', cls: 'high_speed' }, 1);
    expect(c.reason ?? '').not.toMatch(/not unlocked/i);
  });
});

describe('a train that mixes gauges', () => {
  const def = (id: string) => content.locomotives.find((d) => d.id === id)!;
  it('says why it stands still when a save brings it back', () => {
    const { track } = world();
    // an old save: the Rocket turned narrow while the rest of its train stayed regular
    const mixed = new Train([
      { uid: 1, level: 0, def: def('rocket') },
      { uid: 2, level: 0, def: def('f7') },
    ]);
    const back = Train.fromJSON(JSON.parse(JSON.stringify(mixed.toJSON())), track);
    expect(back.state).toBe('noRoute');
    expect(back.lastMessage).toBe(STR.fleet.mixedGaugeTrain);
    const plain = Train.fromJSON(JSON.parse(JSON.stringify(train().toJSON())), track);
    expect(plain.lastMessage).not.toBe(STR.fleet.mixedGaugeTrain);
  });
});
