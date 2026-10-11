import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { levelAt } from '../world/elevation';
import { railProfile } from '../world/railProfile';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { findPath } from '../world/pathfinding';
import { Dir } from '../engine/iso';
import { content, validateContent, DEFAULT_CONTENT } from '../data/content';
import { Builder } from './build';
import { Stockpile } from './stockpile';
import { Economy } from './economy';
import { Station } from './stations';
import { Train, type TickCtx } from './trains';
import { Fleet } from './fleet';
import { Inventory } from '../gacha/inventory';
import { bridgeSpan, bridgeCapacity } from './bridges';
import { Signals } from './signals';
import { tickBuildings, buildingRecipe, type Building } from './buildings';
import { HouseRegistry } from './houses';
import { TownRegistry } from './towns';
import { cityTiles } from './city';
import { weekSeconds, daySeconds, rules, DEFAULT_RULES } from './rules';
import { TradeDesk } from './trade';
import { expandSave } from './expand';
import type { SaveGame } from './save';
import { AGE_DEFS } from './ages';
import { referencePath } from './compat';
import { STR } from '../strings';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
function world() {
  const map = emptyMap(4242, 96, 96, Terrain.Grass),
    track = new TrackGraph(96, 96),
    stock = new Stockpile(),
    economy = new Economy();
  const builder = new Builder(map, new RegionState(map), track, economy, stock);
  builder.free = true;
  const fleet = new Fleet(track, builder, map, new Inventory(), economy, stock);
  for (let x = 2; x < 90; x++) track.place(x, 30, 'straight', 1);
  return { map, track, stock, economy, builder, fleet };
}
function train(id = 'f7') {
  return new Train([{ uid: 1, level: 0, def: content.locomotives.find((d) => d.id === id)! }]);
}
beforeEach(() => Object.assign(rules, DEFAULT_RULES));

describe('weekly food economy and housing', () => {
  it('colors actual weekly stock movements, excludes initial stock, and expires old flows', () => {
    const s = new Stockpile();
    s.add('stone', 300);
    expect(s.weeklyFlow('stone')).toEqual({ produced: 0, consumed: 0 });
    s.tick(1);
    s.add('stone', 50, 320);
    s.spend({ stone: 10 });
    expect(s.weeklyFlow('stone')).toEqual({ produced: 20, consumed: 10 });
    s.tick(weekSeconds());
    expect(s.weeklyFlow('stone')).toEqual({ produced: 0, consumed: 0 });
    s.take('stone', 5);
    expect(s.weeklyFlow('stone').consumed).toBe(5);
    s.load(s.toJSON());
    expect(s.weeklyFlow('stone').consumed).toBe(0);
  });
  it('validates all shipped cargo, recipes and passenger vehicles', () =>
    expect(validateContent(DEFAULT_CONTENT)).toEqual([]));
  it('eats food once per weekly rate and leaves wheat for the mill', () => {
    const s = new Stockpile();
    s.population = 20;
    s.workforce = 4;
    s.add('food', 100);
    s.add('wheat', 20);
    for (let i = 0; i < 7; i++) s.tick(daySeconds());
    expect(s.get('food')).toBeCloseTo(76);
    expect(s.get('wheat')).toBe(20);
  });
  it('processes a week at 1:5, improves to 1:11, and never spends inputs into a full output store', () => {
    const s = new Stockpile();
    s.add('wheat', 1000);
    const b: Building = { id: 'windmill', x: 1, y: 1, acc: 0, active: false, rate: 0 };
    tickBuildings([b], s, weekSeconds(), false, 0, 0);
    expect(s.get('food')).toBe(300);
    expect(s.get('wheat')).toBe(940);
    b.level = 4;
    expect(buildingRecipe(b).out.food).toBe(11);
    s.add('food', 1000 - s.get('food'));
    tickBuildings([b], s, weekSeconds(), false, 0, 0);
    expect(s.get('wheat')).toBe(940);
  });
  it('grows only into completed, paid-for housing and stops without free upgrades or houses', () => {
    const w = world(),
      towns = new TownRegistry(w.builder),
      houses = new HouseRegistry(w.builder, towns, w.stock);
    const d = w.builder.spawnDecor(40, 29, 'townhouse', 0)!;
    houses.sync(d, false);
    houses.finishAll();
    w.stock.add('food', 1000);
    for (let i = 0; i < 100; i++) houses.tick(daySeconds(), i * daySeconds());
    const h = houses.at(40, 29)!;
    expect(h.residents).toBe(20);
    expect(h.level).toBe(1);
    expect(houses.houses.size).toBe(1);
    expect(houses.upgrade(h)).toBe(true);
    houses.tick(daySeconds() * 100, daySeconds() * 200);
    expect(h.residents).toBe(60);
    expect(h.level).toBe(2);
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
      s = new Stockpile(),
      e = new Economy();
    desk.set('food', 10);
    desk.tick(1, s, e, () => 1000);
    desk.tick(daySeconds() * 6, s, e, () => 1000);
    expect(s.get('food')).toBe(0);
    expect(desk.fuelMul).toBe(1);
    desk.tick(weekSeconds() + 1, s, e, () => 1000);
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
    p.bridgeCapacity = t.mass / 0.8;
    expect(t.bridgeSpeed(w.track)).toBe(1);
    p.bridgeCapacity = t.mass / 0.81;
    expect(t.bridgeSpeed(w.track)).toBe(0.5);
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
    w.track.get(40, 30)!.bridgeCapacity = t.mass / 0.81;
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
    expect(t.speed).toBeLessThanOrEqual(t.maxSpeed * t.loadFactor * 0.5 + 1e-6);
  });
  it('refuels a selected group atomically at twice the materials', () => {
    const w = world(),
      a = train(),
      b = train();
    w.fleet.trains.push(a, b);
    w.stock.add('oil', 2 * (a.oilCap + b.oilCap) - 1);
    const have = w.stock.get('oil');
    expect(w.fleet.refuelAll([a, b])).toBe(false);
    expect(a.oil).toBe(0);
    expect(w.stock.get('oil')).toBe(have);
    w.stock.add('oil', 1);
    expect(w.fleet.refuelAll([a, b])).toBe(true);
    expect(a.oil).toBe(a.oilCap);
    expect(b.oil).toBe(b.oilCap);
    expect(w.stock.get('oil')).toBeCloseTo(0);
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
    const w = world(),
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
    w.stock.add('coal', 1000);
    w.stock.add('water', 1000);
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
    const w = world(),
      t = train('mallard');
    t.spawnAt(w.track, 20, 30, Dir.W);
    const st = new Station('quarry', 80, 29);
    w.builder.stations.push(st);
    t.route = [st.id];
    t.mode = 'production';
    t.coal = t.coalRate * 50;
    t.water = t.waterRate * 35;
    w.builder.placeDecor(23, 29, 'fuel_stop', 0);
    w.builder.placeDecor(30, 29, 'water_tower', 0);
    w.stock.add('coal', 1000);
    w.stock.add('water', 1000);
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
  it('shifts bridge levels, houses, wires, track classes and car trails together during expansion', () => {
    const save = {
      world: { kind: 'generated', seed: 4242, params: { w: 96, h: 96 } },
      track: [[20, 20, 'straight', 1, 'high_speed']],
      stations: [],
      buildings: [
        [20, 20, 'bridge_stone', 0.5, 3],
        [21, 20, 'bridge_wood', 0, 1, 2],
      ],
      decor: [[25, 25, 'townhouse', 0]],
      wires: [[20, 20, 'catenary']],
      houses: {
        list: [{ x: 25, y: 25, level: 3, residents: 100, progress: 1 }],
        arrivals: [],
        visited: [],
      },
      trains: [{ head: { x: 20, y: 20 }, trail: [[20, 20, 20, 20, 3, 1]] }],
      regions: Array(9).fill(true),
      camera: { x: 12, y: 14, zoomIndex: 2 },
      clock: { time: 500, speedIndex: 2 },
    } as unknown as SaveGame;
    const grown = expandSave(save);
    expect(grown.track[0]).toEqual([52, 52, 'straight', 1, 'high_speed']);
    expect(grown.buildings?.[0]).toEqual([52, 52, 'bridge_stone', 0.5, 3]);
    // A deck height set by hand (the sixth element) moves with its platform.
    expect(grown.buildings?.[1]).toEqual([53, 52, 'bridge_wood', 0, 1, 2]);
    expect(grown.houses?.list[0]).toMatchObject({ x: 57, y: 57, residents: 100 });
    expect(grown.wires?.[0]).toEqual([52, 52, 'catenary']);
    expect(grown.clock.speedIndex).toBe(2);
  });
});
describe('bridge deck heights', () => {
  const ROW = 44,
    why = STR.build.deck;
  /** A builder that reads automatic deck levels from the rail profile, as the game does. */
  function decks() {
    const w = world();
    w.builder.autoDeck = (x, y) =>
      railProfile(w.map, w.track, (px, py) => w.builder.bridgeAt(px, py)).get(y * 96 + x)?.level;
    const platform = (x: number, y = ROW, id = 'bridge_stone') =>
        w.builder.placeBuilding(x, y, id)!,
      rail = (x: number, y = ROW) => w.builder.placeTrackKind(x, y, 'straight', 1),
      at = (x: number, y = ROW) => w.builder.bridgeAt(x, y)!,
      heights = (from: number, to: number) => {
        const out: number[] = [];
        for (let x = from; x <= to; x++) out.push(w.builder.deckLevel(at(x)));
        return out;
      };
    return { ...w, platform, rail, at, heights };
  }
  /** Platforms on x 40..44 with straight track from 38 to 46: a bridge on flat land. */
  function bridge() {
    const w = decks();
    for (let x = 40; x <= 44; x++) w.platform(x);
    for (let x = 38; x <= 46; x++) expect(w.rail(x)).toBe(true);
    return w;
  }

  it('stands between the ground under it and the highest level', () => {
    const w = decks(),
      b = w.platform(40);
    expect(w.builder.deckLevel(b)).toBe(0);
    expect(w.builder.checkDeck(b, -1)).toMatchObject({ ok: false, reason: why.lowest(false) });
    expect(w.builder.changeDeck(b, -1)).toBe(false);
    expect(b.deck).toBeUndefined();
    for (let level = 1; level <= 4; level++) {
      expect(w.builder.changeDeck(b, 1)).toBe(true);
      expect(b.deck).toBe(level);
    }
    expect(w.builder.checkDeck(b, 1)).toMatchObject({ ok: false, reason: why.highest });
    expect(w.builder.changeDeck(b, 1)).toBe(false);
    expect(b.deck).toBe(4);
    // Over water the floor is the waterline; on a hill, the hill.
    w.map.terrain[ROW * 96 + 50] = Terrain.Water;
    expect(w.builder.checkDeck(w.platform(50), -1).reason).toBe(why.lowest(true));
    for (let y = ROW - 4; y <= ROW + 4; y++)
      for (let x = 56; x <= 64; x++) w.map.terrain[y * 96 + x] = Terrain.Hill;
    const high = w.platform(60);
    expect(w.builder.deckLevel(high)).toBe(2);
    expect(w.builder.checkDeck(high, -1).ok).toBe(false);
    expect(w.builder.changeDeck(high, 1)).toBe(true);
    expect(high.deck).toBe(3);
    expect(w.builder.changeDeck(high, -1)).toBe(true);
    expect(w.builder.checkDeck(high, -1)).toMatchObject({ ok: false, limit: 'floor' });
    expect(w.builder.changeDeck(high, -1)).toBe(false);
    expect(w.builder.deckLevel(high)).toBe(2);
    expect(w.builder.checkDeck(b, 1)).toMatchObject({ ok: false, limit: 'ceiling' });
  });

  it('is automatic again once a bare platform is back on the ground, and stays set under rail', () => {
    const w = decks(),
      bare = w.platform(40);
    w.builder.changeDeck(bare, 1);
    w.builder.changeDeck(bare, 1);
    expect(bare.deck).toBe(2);
    w.builder.changeDeck(bare, -1);
    expect(bare.deck).toBe(1);
    // Lowered onto the ground before any rail: as it was placed, it follows the rail laid later.
    w.builder.changeDeck(bare, -1);
    expect(bare.deck).toBeUndefined();
    expect(w.builder.deckLevel(bare)).toBe(0);
    // With rail on it the height the player gave it stays, on the ground as well.
    const railed = bridge();
    expect(railed.builder.changeDeck(railed.at(42), 1)).toBe(true);
    expect(railed.builder.changeDeck(railed.at(42), -1)).toBe(true);
    expect(railed.at(42).deck).toBe(0);
    expect(railed.heights(40, 44)).toEqual([0, 0, 0, 0, 0]);
  });

  it('moves one tile per click: the first click fixes the rest of the railed bridge where it is', () => {
    const w = bridge();
    expect(w.heights(40, 44)).toEqual([0, 0, 0, 0, 0]);
    expect([40, 41, 42, 43, 44].map((x) => w.at(x).deck)).toEqual(Array(5).fill(undefined));
    expect(w.builder.changeDeck(w.at(42), 1)).toBe(true);
    expect([40, 41, 42, 43, 44].map((x) => w.at(x).deck)).toEqual([0, 0, 1, 0, 0]);
    expect(w.heights(40, 44)).toEqual([0, 0, 1, 0, 0]);
  });

  it('leaves platforms without track automatic: they take the level of the rail laid later', () => {
    const w = decks();
    for (let x = 60; x <= 62; x++) w.platform(x);
    expect(w.builder.changeDeck(w.at(61), 1)).toBe(true);
    expect([60, 61, 62].map((x) => w.at(x).deck)).toEqual([undefined, 1, undefined]);
    for (let x = 58; x <= 64; x++) expect(w.rail(x)).toBe(true);
    // The automatic spans follow the set deck beside them, the ground tiles stay on the ground.
    expect(w.heights(60, 62)).toEqual([1, 1, 1]);
  });

  it('refuses a step of more than one level to the rail beside it', () => {
    const w = bridge();
    expect(w.builder.changeDeck(w.at(42), 1)).toBe(true);
    expect(w.builder.checkDeck(w.at(42), 1)).toMatchObject({ ok: false, reason: why.steep });
    expect(w.builder.changeDeck(w.at(42), 1)).toBe(false);
    expect(w.at(42).deck).toBe(1);
    // With its neighbours raised first the middle can go on: a ramp, one level per tile.
    expect(w.builder.changeDeck(w.at(41), 1)).toBe(true);
    expect(w.builder.changeDeck(w.at(43), 1)).toBe(true);
    expect(w.builder.changeDeck(w.at(42), 1)).toBe(true);
    expect(w.heights(40, 44)).toEqual([0, 1, 2, 1, 0]);
    // The end span meets rail on the ground: it may stand one level above it, not two.
    expect(w.builder.changeDeck(w.at(40), 1)).toBe(true);
    expect(w.builder.checkDeck(w.at(40), 1).reason).toBe(why.steep);
    // Lowering is held to the same rule.
    expect(w.builder.checkDeck(w.at(41), -1).reason).toBe(why.steep);
  });

  it('keeps a deck under a crossing, a curve or a station platform where it is', () => {
    const w = decks();
    w.platform(40);
    expect(w.builder.placeTrackKind(40, ROW, 'crossing', 0)).toBe(true);
    expect(w.builder.checkDeck(w.at(40), 1)).toMatchObject({ ok: false, reason: why.fixed });
    w.platform(50);
    expect(w.builder.placeTrack(50, ROW, { kind: 'curve', cls: 'narrow' }, 0)).toBe(true);
    expect(w.builder.checkDeck(w.at(50), 1).reason).toBe(why.fixed);
    // A station beside the rail: that tile is its platform.
    w.platform(60);
    expect(w.rail(60)).toBe(true);
    const st = new Station('quarry', 60, ROW - 1);
    w.builder.stations.push(st);
    expect(st.gateTiles()).toContainEqual({ x: 60, y: ROW });
    expect(w.builder.checkDeck(w.at(60), 1).reason).toBe(why.station);
  });

  it('moves nothing under a train, nor beside one', () => {
    const w = bridge();
    w.builder.busy = (x) => x === 41;
    expect(w.builder.checkDeck(w.at(41), 1).reason).toBe(why.train);
    // The rail bends on the tiles either side of the step as well.
    expect(w.builder.checkDeck(w.at(40), 1).reason).toBe(why.train);
    expect(w.builder.checkDeck(w.at(42), 1).reason).toBe(why.train);
    expect(w.builder.checkDeck(w.at(43), 1).ok).toBe(true);
  });

  it('continues a new platform at the height of the set deck beside it', () => {
    const w = decks(),
      first = w.platform(40);
    w.builder.changeDeck(first, 1);
    w.builder.changeDeck(first, 1);
    expect(w.platform(41).deck).toBe(2);
    expect(w.platform(41, ROW + 1).deck).toBe(2);
    // Away from any set deck a platform is automatic, as before.
    expect(w.platform(50).deck).toBeUndefined();
    expect(w.platform(51).deck).toBeUndefined();
    // Never below its own ground.
    for (let y = ROW - 4; y <= ROW + 4; y++)
      for (let x = 66; x <= 74; x++) w.map.terrain[y * 96 + x] = Terrain.Hill;
    const low = w.platform(65);
    expect(w.builder.deckLevel(low)).toBe(0);
    w.builder.changeDeck(low, 1);
    expect([66, 67].map((x) => levelAt(w.map, x, ROW))).toEqual([1, 2]);
    expect(w.platform(66).deck).toBe(1);
    expect(w.platform(67).deck).toBe(2);
  });

  it('refuses rail that would step more than a level onto or off a set deck', () => {
    const w = decks(),
      b = w.platform(40);
    w.builder.changeDeck(b, 1);
    w.builder.changeDeck(b, 1);
    const item = { kind: 'straight', cls: 'regular' } as const;
    // Rail on the ground first, then onto the deck two levels up.
    expect(w.rail(39)).toBe(true);
    expect(w.builder.checkTrack(40, ROW, item, 1)).toMatchObject({
      ok: false,
      reason: STR.build.tooSteep,
    });
    // The other way round: rail on the deck first, then the ground beside it.
    expect(w.builder.removeTrack(39, ROW)).toBe(true);
    expect(w.rail(40)).toBe(true);
    expect(w.builder.checkTrack(39, ROW, item, 1).reason).toBe(STR.build.tooSteep);
    expect(w.builder.checkTrack(41, ROW, item, 1).reason).toBe(STR.build.tooSteep);
    // One level is a climb the rail can make.
    w.builder.removeTrack(40, ROW);
    w.builder.changeDeck(b, -1);
    expect(w.rail(40)).toBe(true);
    expect(w.rail(39)).toBe(true);
    // An automatic platform takes the level of the higher rail it meets: between a deck at 1
    // and one at 3 it would stand two levels above the first.
    for (let x = 50; x <= 52; x++) w.platform(x);
    w.builder.changeDeck(w.at(50), 1);
    for (let i = 0; i < 3; i++) w.builder.changeDeck(w.at(52), 1);
    expect([50, 51, 52].map((x) => w.at(x).deck)).toEqual([1, undefined, 3]);
    expect(w.rail(50)).toBe(true);
    expect(w.rail(52)).toBe(true);
    expect(w.builder.checkTrack(51, ROW, item, 1).reason).toBe(STR.build.tooSteep);
  });

  it('previews a dragged run as it will be laid, a step onto a set deck included', () => {
    const item = { kind: 'straight', cls: 'regular', cls2: 'regular' } as const;
    /** Bare platforms from x 40 on, then each clicked up to its height (0: left automatic). */
    const bare = (heights: readonly number[], row = ROW) => {
      const w = decks(),
        placed = heights.map((_, i) => w.platform(40 + i, row));
      heights.forEach((h, i) => {
        for (let k = 0; k < h; k++) w.builder.changeDeck(placed[i], 1);
      });
      return w;
    };
    // A run dragged from x 38 to 46 over five platforms: what the ghosts say is what gets laid.
    for (const heights of [
      [0, 3, 0, 0, 0],
      [1, 2, 3, 2, 1],
      [0, 2, 0, 0, 4],
      [1, 1, 3, 3, 1],
      [0, 0, 0, 0, 0],
    ]) {
      const w = bare(heights),
        run = Array.from({ length: 9 }, (_, i) => ({ x: 38 + i, y: ROW, rot: 1 })),
        preview = w.builder.checkTrackRun(run, item).map((c) => c.ok),
        laid = run.map((t) => w.builder.placeTrack(t.x, t.y, item, t.rot));
      expect(preview, heights.join(' ')).toEqual(laid);
    }
    // The step itself: rail on the ground and on the first deck, none onto the deck three up.
    const w = bare([0, 3, 0]),
      run = [39, 40, 41, 42, 43].map((x) => ({ x, y: ROW, rot: 1 })),
      checks = w.builder.checkTrackRun(run, item);
    expect([40, 41, 42].map((x) => w.at(x).deck)).toEqual([undefined, 3, undefined]);
    expect(checks.map((c) => c.ok)).toEqual([true, true, false, true, true]);
    expect(checks[2].reason).toBe(STR.build.tooSteep);
  });

  it('refuses a curve on the ground beside rail on a raised deck', () => {
    const w = decks(),
      b = w.platform(40),
      straight = { kind: 'straight', cls: 'narrow' } as const,
      curve = { kind: 'curve', cls: 'narrow' } as const;
    w.builder.changeDeck(b, 1);
    expect(w.builder.placeTrack(40, ROW, straight, 1)).toBe(true);
    // The curve opens east onto the deck's rail, which stands a level above the ground.
    expect(w.builder.checkTrack(39, ROW, curve, 0)).toMatchObject({
      ok: false,
      reason: STR.build.deckMeets,
    });
    // The same curve on a platform set at that height fits (its other end meets a deck at that
    // height too); one set lower does not.
    const seat = w.platform(39);
    expect(seat.deck).toBe(1);
    expect(w.platform(39, ROW - 1).deck).toBe(1);
    expect(w.builder.checkTrack(39, ROW, curve, 0).ok).toBe(true);
    seat.deck = 0;
    expect(w.builder.checkTrack(39, ROW, curve, 0).ok).toBe(false);
    // On level ground with the deck on the ground too, nothing is in the way.
    w.builder.removeBuilding(39, ROW);
    w.builder.removeBuilding(39, ROW - 1);
    w.builder.removeTrack(40, ROW);
    w.builder.changeDeck(b, -1);
    expect(w.builder.placeTrack(40, ROW, straight, 1)).toBe(true);
    expect(w.builder.checkTrack(39, ROW, curve, 0).ok).toBe(true);
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
