import { beforeEach, describe, expect, it } from 'vitest';
import { Dir } from '../engine/iso';
import { locoDef, wagonDef } from '../gacha/items';
import { STR } from '../strings';
import { line, simWorld, station, type SimWorldOptions } from '../testing/simWorld';
import { layRun, planRun } from '../ui/autoCrossing';
import { buildingToJSON } from './buildings';
import { Commands, TRAIN_NAME_MAX } from './commands';
import type { Contract } from './contracts';
import { DEFAULT_RULES, rules } from './rules';
import type { Station } from './stations';
import { TRAIN_COLOURS } from './trainColours';
import { Train, defaultStop } from './trains';
import type { PropInstance } from '../world/tiles';
import type { TrackItem } from '../world/track';

type Tile = { x: number; y: number };

const ROW = 20;
const STRAIGHT: TrackItem = { kind: 'straight', cls: 'branch' };
const NS = 0;
const EW = 1;
const GOODS = { wood: 2000, stone: 2000, iron: 2000 };

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
});

/**
 * A grass map the player owns all of, deep in the ages, with a depot on row 10 full of goods and
 * the commands over it.
 */
function game(opts: SimWorldOptions = {}) {
  const w = simWorld({ terrain: 'grass', size: 64, ...opts });
  for (let i = 0; i < w.regions.unlocked.length; i++) w.regions.own(i);
  w.economy.tier = 5;
  const depot = station(w, 'depot', 30, 10);
  const stock = w.stores.byKey(`st:${depot.id}`)!;
  for (const [id, n] of Object.entries(GOODS)) stock.amounts.set(id, n);
  const commands = new Commands(w);
  return { ...w, depot, stock, commands, history: commands.history };
}
type Game = ReturnType<typeof game>;

const sorted = (list: unknown[]) => list.map((x) => JSON.stringify(x)).sort();

/**
 * The world as a save holds it (`Game.snapshot`), in an order that does not depend on when a thing
 * went up: track, roads, decor and works sit in maps and sets in the order they were laid, and
 * laying one again after an undo puts it last. Stations and towns keep their lists' order, which
 * an undo has to keep too. A good held at nothing is the same as one never held.
 */
function state(g: Game) {
  return {
    track: sorted(
      [...g.track.anchors()].map((t) => [
        t.x,
        t.y,
        t.piece.kind,
        t.piece.rot,
        t.piece.cls,
        t.piece.cls2,
      ]),
    ),
    stations: g.builder.stations.map((s) => s.toJSON()),
    decor: sorted([...g.builder.decor.values()].map((d) => [d.x, d.y, d.id, d.rot])),
    wires: sorted(g.catenary.toJSON()),
    buildings: sorted([...g.builder.buildings.values()].map(buildingToJSON)),
    roads: sorted(g.builder.roads.toJSON()),
    stores: sorted(
      g.stores.toJSON().map((s) => ({
        key: s.key,
        amounts: Object.entries(s.amounts)
          .filter(([, n]) => n !== 0)
          .sort(),
        famine: s.famine,
      })),
    ),
    towns: g.towns.toJSON(),
    houses: sorted(g.houses.toJSON().list),
  };
}

/** Do `act` as one action, then undo, redo and undo and redo it again, each landing exactly. */
function roundTrip(g: Game, act: () => unknown) {
  const before = state(g);
  g.commands.act(act);
  const after = state(g);
  expect(after).not.toEqual(before);
  for (let i = 0; i < 2; i++) {
    expect(g.history.undo()).toEqual({ ok: true });
    expect(state(g)).toEqual(before);
    expect(g.history.redo()).toEqual({ ok: true });
    expect(state(g)).toEqual(after);
  }
  return { before, after };
}

/** One action: a run of straights along row `y` from `x0` to `x1`, crossings and all. */
function run(g: Game, x0: number, x1: number, y = ROW) {
  const tiles = [];
  for (let x = x0; x <= x1; x++) tiles.push({ x, y, rot: EW });
  layRun(g.builder, planRun(g.builder, tiles, STRAIGHT));
}

/** A diesel standing on the row at `x`, in the fleet. */
function train(g: Game, x: number, y = ROW) {
  const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
  t.wagons = [];
  expect(t.spawnAt(g.track, x, y, Dir.W)).not.toBe(false);
  g.fleet.trains.push(t);
  return t;
}

/** The whole action refused: the same world, the same stacks, and this reason. */
function expectRefused(
  g: Game,
  way: 'undo' | 'redo',
  message: string,
  labels = { undo: g.history.undoLabel, redo: g.history.redoLabel },
) {
  const before = state(g);
  expect(g.history[way]()).toEqual({ ok: false, message });
  expect(state(g)).toEqual(before);
  expect({ undo: g.history.undoLabel, redo: g.history.redoLabel }).toEqual(labels);
}

describe('building, one action one step', () => {
  it('a dragged run', () => {
    const g = game();
    roundTrip(g, () => run(g, 10, 22));
    expect(g.history.undoLabel).toBe('Built 13 tiles of Branch Line');
  });

  it('a run with the crossing it lays by itself', () => {
    const g = game();
    g.commands.act(() => {
      for (let y = ROW - 3; y <= ROW + 3; y++) g.builder.placeTrack(15, y, STRAIGHT, NS);
    });
    const { before } = roundTrip(g, () => run(g, 10, 20));
    // a crossing stands where the two lines meet, and only while the run stands
    expect(g.track.get(15, ROW)?.kind).toBe('crossing');
    g.history.undo();
    expect(state(g)).toEqual(before);
    expect(g.track.get(15, ROW)).toMatchObject({ kind: 'straight', rot: NS });
    g.history.undo();
    expect(g.history.canUndo).toBe(false);
  });

  it('a one-tile piece laid over another', () => {
    const g = game();
    g.commands.act(() => g.builder.placeTrack(10, ROW, STRAIGHT, EW));
    roundTrip(g, () =>
      g.builder.placeTrack(10, ROW, { kind: 'crossing', cls: 'branch', cls2: 'branch' }, 0),
    );
  });

  it('a curve and a switch, all their tiles', () => {
    const g = game();
    roundTrip(g, () => g.builder.placeTrack(10, ROW, { kind: 'curve', cls: 'branch' }, 0));
    roundTrip(g, () => g.builder.placeTrack(20, ROW, { kind: 'switch', cls: 'branch' }, 0));
    expect(g.history.undoLabel).toBe('Built 4 tiles of Branch Line');
  });

  it('a switch takes the form its neighbours gave it again', () => {
    const g = game();
    g.commands.act(() => g.builder.placeTrack(20, ROW, { kind: 'switch', cls: 'branch' }, 0));
    const exit = g.track.switchExit(20, ROW, 0, 'branch', 'parallel');
    const form = () => g.track.get(20, ROW)?.form ?? 'turn';
    expect(form()).toBe('turn');
    g.commands.act(() =>
      g.builder.placeTrack(exit.x, exit.y, STRAIGHT, exit.out === 0 || exit.out === 2 ? NS : EW),
    );
    expect(form()).toBe('parallel');
    g.history.undo();
    expect(form()).toBe('turn');
    g.history.redo();
    expect(form()).toBe('parallel');
  });

  it('a station, with the spur to the roads it got for free', () => {
    const g = game();
    line(g, 10, ROW, 30);
    // a road two tiles north of the door: the farm's spur crosses the gap
    g.commands.act(() =>
      g.builder.placeRoads(
        [
          { x: 14, y: ROW - 4 },
          { x: 15, y: ROW - 4 },
        ],
        { x: 14, y: ROW - 4 },
      ),
    );
    const roads = g.builder.roads.size;
    const { after } = roundTrip(g, () => g.builder.placeStation(15, ROW - 1, 'farm'));
    expect(g.builder.roads.size).toBeGreaterThan(roads);
    expect(after.stations).toHaveLength(2);
    expect(g.history.undoLabel).toBe('Built Farm Halt');
    g.history.undo();
    expect(g.builder.roads.size).toBe(roads);
  });

  it('a depot, whose store comes and goes with it', () => {
    const g = game();
    roundTrip(g, () => g.builder.placeStation(44, 40, 'narrow_depot'));
  });

  it('decor, turned as it was placed', () => {
    const g = game();
    const { after } = roundTrip(g, () => g.builder.placeDecor(12, ROW + 5, 'water_tower', 0));
    expect(after.decor).toHaveLength(1);
    expect(g.history.undoLabel).toBe('Built Water Tower');
  });

  it('a works', () => {
    const g = game();
    roundTrip(g, () => g.builder.placeBuilding(12, ROW + 5, 'windmill', 1));
    expect(g.history.undoLabel).toBe('Built Windmill');
  });

  it('a bridge platform with the rail on it', () => {
    const g = game();
    roundTrip(g, () =>
      g.builder.placeLine([
        { kind: 'platform', x: 12, y: ROW, defId: 'bridge_wood' },
        { kind: 'track', x: 12, y: ROW, item: STRAIGHT, rot: EW },
      ]),
    );
    expect(g.track.get(12, ROW)?.bridgeCapacity).toBeGreaterThan(0);
    g.history.undo();
    expect(g.builder.buildingAt(12, ROW)).toBeUndefined();
  });

  it('a line of supply, and a kind laid over another', () => {
    const g = game();
    line(g, 10, ROW, 20);
    roundTrip(g, () => {
      for (let x = 10; x <= 15; x++) g.builder.placeSupply(x, ROW, 'catenary');
    });
    expect(g.history.undoLabel).toBe(`Built 6 tiles of ${STR.toolbar.supply.catenary}`);
    roundTrip(g, () => g.builder.placeSupply(12, ROW, 'hv_catenary'));
  });

  it('a dragged road', () => {
    const g = game();
    roundTrip(g, () =>
      g.builder.placeRoads(
        Array.from({ length: 6 }, (_, i) => ({ x: 10 + i, y: ROW })),
        { x: 10, y: ROW },
      ),
    );
    expect(g.history.undoLabel).toBe('Built 6 tiles of road');
  });

  it('a road laid near a door, with the spur it brings', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const farm = g.builder.placeStation(15, ROW - 1, 'farm');
    expect(farm).not.toBeNull();
    const roads = g.builder.roads.size;
    roundTrip(g, () =>
      g.builder.placeRoads(
        [
          { x: 15, y: ROW - 5 },
          { x: 16, y: ROW - 5 },
        ],
        { x: 15, y: ROW - 5 },
      ),
    );
    expect(g.history.undoLabel).toBe(`Built ${g.builder.roads.size - roads} tiles of road`);
    g.history.undo();
    expect(g.builder.roads.size).toBe(roads);
  });
});

describe('demolishing', () => {
  it('track, with the signal and the wire that went with it', () => {
    const g = game();
    run(g, 10, 20);
    g.builder.placeSupply(14, ROW, 'catenary');
    g.builder.placeDecor(14, ROW, 'signal', 2);
    const { after } = roundTrip(g, () => g.builder.removeTrack(14, ROW));
    expect(after.decor).toHaveLength(0);
    expect(after.wires).toHaveLength(0);
    expect(g.history.undoLabel).toBe('Demolished 1 tile of Branch Line');
    g.history.undo();
    expect(g.builder.decorAt(14, ROW)?.rot).toBe(2);
    expect(g.catenary.supplyAt(14, ROW)).toBe('catenary');
  });

  it('a whole curve, from any of its tiles', () => {
    const g = game();
    g.builder.placeTrack(10, ROW, { kind: 'curve', cls: 'branch' }, 0);
    const [, member] = g.track.unitTiles(10, ROW);
    roundTrip(g, () => g.builder.removeTrack(member.x, member.y));
  });

  it('a road, and the level crossing it was', () => {
    const g = game();
    run(g, 10, 20);
    g.builder.placeRoad(15, ROW);
    expect(g.builder.roads.isCrossing(15, ROW)).toBe(true);
    roundTrip(g, () => g.builder.removeRoad(15, ROW));
    expect(g.history.undoLabel).toBe('Demolished 1 tile of road');
    g.history.undo();
    expect(g.builder.roads.isCrossing(15, ROW)).toBe(true);
  });

  it('a station with its level, name, goods and market', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const s = g.builder.placeStation(15, ROW - 1, 'farm')!;
    s.level = 3;
    s.name = 'Old Mill';
    s.storage.set('wheat', 17.5);
    s.market.set('coal', 0.25);
    s.rot = 0;
    roundTrip(g, () => g.builder.removeStation(s));
    expect(g.history.undoLabel).toBe('Demolished Old Mill');
    g.history.undo();
    expect(g.builder.stationById(s.id)).toBe(s);
    expect(s.level).toBe(3);
    expect(s.stored('wheat')).toBe(17.5);
  });

  it('keeps the order of the stations', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const a = g.builder.placeStation(12, ROW - 1, 'farm')!;
    const b = g.builder.placeStation(16, ROW - 1, 'farm')!;
    const c = g.builder.placeStation(20, ROW - 1, 'farm')!;
    g.commands.act(() => g.builder.removeStation(b));
    g.history.undo();
    expect(g.builder.stations.slice(-3)).toEqual([a, b, c]);
  });

  it('a station in the middle of its upgrade: the work goes on from where it stood', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const s = g.builder.placeStation(15, ROW - 1, 'farm')!;
    g.builder.upgradeStation(s);
    g.builder.tickWorks(1);
    const left = s.work!.left;
    roundTrip(g, () => g.builder.removeStation(s));
    g.history.undo();
    expect(s.work?.left).toBe(left);
  });

  it('a depot with goods in it: they go back from the store that took them over', () => {
    const g = game();
    const other = station(g, 'depot', 40, 30);
    const store = g.stores.byKey(`st:${other.id}`)!;
    store.amounts.set('wood', 111);
    store.amounts.set('coal', 7.5);
    const { after } = roundTrip(g, () => g.builder.removeStation(other));
    expect(after.stations).toHaveLength(1);
    g.history.undo();
    expect(g.stores.byKey(`st:${other.id}`)!.get('wood')).toBe(111);
    expect(g.stores.byKey(`st:${other.id}`)!.get('coal')).toBe(7.5);
  });

  it('goods of no round amount, all of what the store that took them over holds', () => {
    const g = game();
    const other = station(g, 'depot', 40, 30);
    for (const n of [52 / 3, 7 / 3, 0.1 + 0.2]) {
      // the store is a new one each time: it went with its depot and came back with it
      g.stores.byKey(`st:${other.id}`)!.amounts.set('coal', n);
      g.commands.act(() => g.builder.removeStation(other));
      expect(g.stock.get('coal')).toBe(n);
      expect(g.history.undo()).toEqual({ ok: true });
      expect(g.stores.byKey(`st:${other.id}`)!.get('coal')).toBeCloseTo(n, 6);
      expect(g.stock.get('coal')).toBeCloseTo(0, 6);
    }
  });

  it('a Townhouse: the town comes back as it was, with its name, colour and store', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const hall = g.builder.placeStation(15, ROW - 1, 'town')!;
    expect(hall).not.toBeNull();
    const town = g.towns.byStation(hall.id)!;
    g.towns.rename(town, 'Kisvár');
    town.color = 3;
    g.stores.byKey(`town:${town.id}`)!.amounts.set('food', 40);
    g.stores.byKey(`town:${town.id}`)!.amounts.set('wood', 60);
    g.builder.placeDecor(13, ROW - 3, 'townhouse', 1);
    const { after } = roundTrip(g, () => g.builder.removeStation(hall));
    expect(after.towns).toEqual([]);
    expect(g.history.undoLabel).toBe(`Demolished ${hall.name}`);
    g.history.undo();
    expect(g.towns.byStation(hall.id)).toBe(town);
    expect(g.stores.byKey(`town:${town.id}`)!.get('food')).toBe(40);
  });

  it('undoing a Townhouse built takes back a warehouse it swallowed', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const w = g.builder.placeStation(20, ROW - 1, 'warehouse')!;
    g.stores.byKey(`st:${w.id}`)!.amounts.set('coal', 50);
    const { after } = roundTrip(g, () => g.builder.placeStation(15, ROW - 1, 'town'));
    expect(after.towns).toHaveLength(1);
    g.history.undo();
    expect(g.stores.byKey(`st:${w.id}`)!.get('coal')).toBe(50);
  });

  it('a works with its level, its turn and what it has made', () => {
    const g = game();
    const b = g.builder.placeBuilding(12, ROW + 5, 'windmill', 1)!;
    b.level = 3;
    b.acc = 0.5;
    b.made = { food: 12 };
    roundTrip(g, () => g.builder.removeBuilding(12, ROW + 5));
    g.history.undo();
    expect(g.builder.buildingAt(12, ROW + 5)).toBe(b);
    expect(b.made).toEqual({ food: 12 });
  });

  it('a works in the middle of its upgrade', () => {
    const g = game();
    const b = g.builder.placeBuilding(12, ROW + 5, 'windmill', 0)!;
    g.builder.upgradeBuilding(b);
    expect(b.work).toBeDefined();
    roundTrip(g, () => g.builder.removeBuilding(12, ROW + 5));
    g.history.undo();
    expect(b.work).toBeDefined();
  });

  it('decor with its turn, and a house with the people in it', () => {
    const g = game();
    g.builder.placeDecor(12, ROW + 5, 'water_tower', 0);
    roundTrip(g, () => g.builder.removeDecor(12, ROW + 5));
    const d = g.builder.placeDecor(14, ROW + 5, 'townhouse', 3)!;
    const h = g.houses.at(14, ROW + 5)!;
    Object.assign(h, { progress: 1, level: 2, residents: 9, grow: 0.5, full: 1 });
    h.work = { to: 3, left: 5, total: 9 };
    roundTrip(g, () => g.builder.removeDecor(14, ROW + 5));
    g.history.undo();
    expect(g.builder.decorAt(14, ROW + 5)).toBe(d);
    expect(g.houses.at(14, ROW + 5)).toMatchObject({ level: 2, residents: 9 });
    expect(g.houses.at(14, ROW + 5)?.work?.left).toBe(5);
  });

  it('a bare bridge platform, its rail gone in the step before', () => {
    const g = game();
    g.builder.placeBuilding(12, ROW, 'bridge_wood', 0);
    g.builder.placeTrack(12, ROW, STRAIGHT, EW);
    g.commands.act(() => g.builder.removeTrack(12, ROW));
    g.commands.act(() => g.builder.removeBuilding(12, ROW));
    g.history.undo();
    g.history.undo();
    expect(g.track.get(12, ROW)?.bridgeCapacity).toBeGreaterThan(0);
  });
});

describe('Upgrade and Downgrade', () => {
  const stroke = (g: Game, dir: 'up' | 'down', id: number, from: number, to: number) => {
    for (let x = from; x <= to; x++)
      g.commands.act(() => g.builder.reclassTrack([{ x, y: ROW }], dir), id);
  };

  it('one stroke over many frames is one step', () => {
    const g = game();
    run(g, 10, 20);
    const before = state(g);
    stroke(g, 'up', 1, 10, 12);
    stroke(g, 'up', 1, 13, 15);
    const after = state(g);
    expect(after).not.toEqual(before);
    expect(g.history.undoLabel).toBe('Upgraded 6 tiles to Main Line');
    g.history.undo();
    expect(state(g)).toEqual(before);
    expect(g.history.canUndo).toBe(false);
    g.history.redo();
    expect(state(g)).toEqual(after);
  });

  it('the next stroke is a step of its own', () => {
    const g = game();
    run(g, 10, 20);
    stroke(g, 'up', 1, 10, 12);
    stroke(g, 'up', 2, 13, 14);
    expect(g.history.undoLabel).toBe('Upgraded 2 tiles to Main Line');
    g.history.undo();
    expect(g.history.undoLabel).toBe('Upgraded 3 tiles to Main Line');
  });

  it('a tile the stroke goes over twice comes back to what it was', () => {
    const g = game();
    run(g, 10, 12);
    const before = state(g);
    stroke(g, 'up', 1, 10, 12);
    stroke(g, 'up', 1, 10, 10);
    expect(g.track.get(10, ROW)?.cls).toBe('trunk');
    expect(g.history.undoLabel).toBe(STR.history.upgradedTrack);
    g.history.undo();
    expect(state(g)).toEqual(before);
  });

  it('a downgrade, free both ways', () => {
    const g = game();
    run(g, 10, 20);
    stroke(g, 'up', 1, 10, 20);
    const before = state(g);
    stroke(g, 'down', 2, 10, 15);
    expect(g.history.undoLabel).toBe('Downgraded 6 tiles to Branch Line');
    expect(state(g).stores).toEqual(before.stores);
    g.history.undo();
    expect(state(g)).toEqual(before);
  });

  it('nothing converted, nothing to undo', () => {
    const g = game();
    g.commands.act(() => g.builder.reclassTrack([{ x: 3, y: 3 }], 'up'), 1);
    expect(g.history.canUndo).toBe(false);
  });

  it('the same line back after a curve is relaid', () => {
    const g = game();
    g.builder.placeTrack(10, ROW, { kind: 'curve', cls: 'main' }, 0);
    g.builder.placeTrack(20, ROW, { kind: 'switch', cls: 'main' }, 0);
    const before = state(g);
    g.commands.act(() => g.builder.reclassTrack([{ x: 20, y: ROW }], 'up'));
    g.commands.act(() => g.builder.reclassTrack([{ x: 10, y: ROW }], 'up'));
    g.history.undo();
    g.history.undo();
    expect(state(g)).toEqual(before);
  });
});

describe('levels and names', () => {
  it("a station's upgrade under way", () => {
    const g = game();
    line(g, 10, ROW, 30);
    const s = g.builder.placeStation(15, ROW - 1, 'farm')!;
    roundTrip(g, () => g.builder.upgradeStation(s));
    expect(s.work).not.toBeNull();
    expect(g.history.undoLabel).toBe('Upgraded Farm Halt to level 2');
    g.history.undo();
    expect(s.work).toBeNull();
    expect(s.level).toBe(1);
  });

  it('an upgrade finished since: the level goes down, the goods come back', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const s = g.builder.placeStation(15, ROW - 1, 'farm')!;
    const before = state(g);
    g.commands.act(() => g.builder.upgradeStation(s));
    g.builder.tickWorks(1e6);
    expect(s.level).toBe(2);
    const after = state(g);
    g.history.undo();
    expect(state(g)).toEqual(before);
    g.history.redo();
    expect(state(g)).toEqual(after);
  });

  it("a depot's upgrade, which takes no time", () => {
    const g = game();
    roundTrip(g, () => g.builder.upgradeStation(g.depot));
    expect(g.depot.level).toBe(2);
  });

  it('a level down', () => {
    const g = game();
    g.depot.level = 3;
    const was = state(g);
    // only the editor lowers a level today; this is what a play tool doing it would record
    g.commands.act(() => {
      g.builder.free = true;
      g.builder.downgradeStation(g.depot);
      g.builder.free = false;
    });
    expect(g.depot.level).toBe(2);
    expect(g.history.undoLabel).toBe(`Downgraded ${g.depot.name} to level 2`);
    g.history.undo();
    expect(state(g)).toEqual(was);
  });

  it("a works' upgrade, and a bridge's, which changes what the rail may carry", () => {
    const g = game();
    const b = g.builder.placeBuilding(12, ROW + 5, 'windmill', 0)!;
    roundTrip(g, () => g.builder.upgradeBuilding(b));
    expect(g.history.undoLabel).toBe('Upgraded Windmill to level 2');

    rules.upgradeTimeMul = 0;
    const bridge = g.builder.placeBuilding(20, ROW, 'bridge_wood', 0)!;
    g.builder.placeTrack(20, ROW, STRAIGHT, EW);
    const first = g.track.get(20, ROW)?.bridgeCapacity;
    roundTrip(g, () => g.builder.upgradeBuilding(bridge));
    const raised = g.track.get(20, ROW)?.bridgeCapacity;
    expect(raised).toBeGreaterThan(first!);
    g.history.undo();
    expect(g.track.get(20, ROW)?.bridgeCapacity).toBe(first);
  });

  it('a station renamed, through its command', () => {
    const g = game();
    const was = g.depot.name;
    expect(g.commands.renameStation(g.depot, '  Keleti  ')).toEqual({ ok: true });
    expect(g.history.undoLabel).toBe(`Renamed ${was} to Keleti`);
    g.history.undo();
    expect(g.depot.name).toBe(was);
    g.history.redo();
    expect(g.depot.name).toBe('Keleti');
  });

  it('a name refused, or the same name again, is no step', () => {
    const g = game();
    expect(g.commands.renameStation(g.depot, '   ').ok).toBe(false);
    expect(g.commands.renameStation(g.depot, g.depot.name)).toEqual({ ok: true });
    expect(g.history.canUndo).toBe(false);
  });
});

describe('materials', () => {
  it('gives back all that was paid, not what a demolish would', () => {
    const g = game();
    const wood = g.stock.get('wood');
    g.commands.act(() => run(g, 10, 15));
    const paid = wood - g.stock.get('wood');
    expect(paid).toBeGreaterThan(0);
    g.history.undo();
    expect(g.stock.get('wood')).toBe(wood);
  });

  it('gives back to the store that paid, not the one nearest to the work', () => {
    const g = game();
    const near = station(g, 'depot', 12, 30);
    const nearStock = g.stores.byKey(`st:${near.id}`)!;
    // too little to pay: the depot further off pays
    nearStock.amounts.set('wood', 1);
    const wood = g.stock.get('wood');
    g.commands.act(() => g.builder.placeBuilding(14, 26, 'windmill', 0));
    expect(g.stock.get('wood')).toBeLessThan(wood);
    expect(nearStock.get('wood')).toBe(1);
    g.history.undo();
    expect(g.stock.get('wood')).toBe(wood);
    expect(nearStock.get('wood')).toBe(1);
  });

  it('takes back what a demolish refunded, from the store that took it', () => {
    const g = game();
    g.builder.placeBuilding(12, ROW + 5, 'windmill', 0);
    const wood = g.stock.get('wood');
    g.commands.act(() => g.builder.removeBuilding(12, ROW + 5));
    expect(g.stock.get('wood')).toBeGreaterThan(wood);
    g.history.undo();
    expect(g.stock.get('wood')).toBe(wood);
    g.history.redo();
    expect(g.stock.get('wood')).toBeGreaterThan(wood);
  });

  it('only what the refund really added: a full store took less', () => {
    const g = game();
    g.builder.placeBuilding(12, ROW + 5, 'windmill', 0);
    g.stock.amounts.set('wood', rules.depotCap - 3);
    g.commands.act(() => g.builder.removeBuilding(12, ROW + 5));
    expect(g.stock.get('wood')).toBe(rules.depotCap);
    g.history.undo();
    expect(g.stock.get('wood')).toBe(rules.depotCap - 3);
  });

  it('gives back past the cap: the goods were paid', () => {
    const g = game();
    g.commands.act(() => g.builder.placeBuilding(12, ROW + 5, 'windmill', 0));
    g.stock.amounts.set('wood', rules.depotCap);
    g.history.undo();
    expect(g.stock.get('wood')).toBeGreaterThan(rules.depotCap);
  });

  it('a network of stores gets back what each of them paid', () => {
    const g = game();
    const far = station(g, 'depot', 40, 10);
    const stock = g.stores.byKey(`st:${far.id}`)!;
    line(g, 20, 10, 50);
    g.stock.amounts.set('wood', 5);
    stock.amounts.set('wood', 500);
    expect(g.stores.poolOf(g.stock).get('wood')).toBe(505);
    g.commands.act(() => g.builder.placeBuilding(28, 14, 'windmill', 0));
    expect(g.stock.get('wood')).toBe(0);
    expect(stock.get('wood')).toBeLessThan(500);
    g.history.undo();
    expect(g.stock.get('wood')).toBe(5);
    expect(stock.get('wood')).toBe(500);
  });

  it('takes back from a network as one place, wherever the goods went', () => {
    const g = game();
    const far = station(g, 'depot', 40, 10);
    const stock = g.stores.byKey(`st:${far.id}`)!;
    line(g, 20, 10, 50);
    g.builder.placeBuilding(28, 14, 'windmill', 0);
    const held = g.stock.get('wood') + stock.get('wood');
    g.commands.act(() => g.builder.removeBuilding(28, 14));
    const total = g.stock.get('wood') + stock.get('wood');
    expect(total).toBeGreaterThan(held);
    // a train hauled it all to the other end of the network
    stock.amounts.set('wood', total);
    g.stock.amounts.set('wood', 0);
    expect(g.history.undo()).toEqual({ ok: true });
    expect(stock.get('wood') + g.stock.get('wood')).toBe(held);
  });

  it('newcomers an industry brought leave with it, and come again', () => {
    const g = game();
    line(g, 10, ROW, 30);
    g.builder.placeStation(15, ROW - 1, 'town');
    g.builder.placeDecor(13, ROW - 3, 'townhouse', 0);
    const h = g.houses.at(13, ROW - 3)!;
    Object.assign(h, { progress: 1, residents: 1 });
    const { after } = roundTrip(g, () => g.builder.placeBuilding(17, ROW - 4, 'windmill', 0));
    expect(after.houses).not.toEqual([]);
    expect(h.residents).toBeGreaterThan(1);
    g.history.undo();
    expect(h.residents).toBe(1);
  });
});

describe('refusal', () => {
  it('a train on the track refuses, until it has gone', () => {
    const g = game();
    g.commands.act(() => run(g, 10, 22));
    const t = train(g, 22);
    expectRefused(g, 'undo', STR.history.trainOn(t.name));
    g.fleet.trains.pop();
    expect(g.history.undo()).toEqual({ ok: true });
    expect(g.track.get(10, ROW)).toBeUndefined();
  });

  it('a train on one piece of a run stops the whole run', () => {
    const g = game();
    g.commands.act(() => run(g, 10, 22));
    const before = state(g);
    train(g, 16);
    expect(g.history.undo().ok).toBe(false);
    expect(state(g)).toEqual(before);
  });

  it('a train on a piece the undo would only change refuses too', () => {
    const g = game();
    run(g, 10, 20);
    g.commands.act(() => g.builder.reclassTrack([{ x: 15, y: ROW }], 'up'));
    const t = train(g, 15);
    expectRefused(g, 'undo', STR.history.trainOn(t.name));
  });

  it('a train on the way of a redo refuses it too', () => {
    const g = game();
    run(g, 10, 20);
    g.commands.act(() => g.builder.reclassTrack([{ x: 15, y: ROW }], 'up'));
    g.history.undo();
    const t = train(g, 15);
    expectRefused(g, 'redo', STR.history.trainOn(t.name));
  });

  it('something built where the step would put a thing back', () => {
    const g = game();
    g.builder.placeDecor(12, ROW + 5, 'water_tower', 0);
    g.commands.act(() => g.builder.removeDecor(12, ROW + 5));
    // past the history, as nothing the player does is
    g.builder.placeDecor(12, ROW + 5, 'townhouse', 0);
    expectRefused(g, 'undo', STR.history.builtOver);
  });

  it('something built on the track a redo would lay', () => {
    const g = game();
    g.commands.act(() => run(g, 10, 12));
    g.history.undo();
    g.builder.placeDecor(11, ROW, 'water_tower', 0);
    expectRefused(g, 'redo', STR.history.builtOver);
  });

  it('something else standing in the place of a piece the undo would lift', () => {
    const g = game();
    g.commands.act(() => g.builder.placeRoads([{ x: 10, y: ROW }], { x: 10, y: ROW }));
    g.builder.removeRoad(10, ROW);
    g.builder.placeDecor(10, ROW, 'water_tower', 0);
    expectRefused(g, 'undo', STR.history.builtOver);
  });

  it('a station gone past the history cannot get its level back', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const s = g.builder.placeStation(15, ROW - 1, 'farm')!;
    g.commands.act(() => g.builder.upgradeStation(s));
    g.builder.removeStation(s);
    expectRefused(g, 'undo', STR.history.builtOver);
  });

  it('a station to remove with a train routed to it says which', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const s = g.commands.act(() => g.builder.placeStation(15, ROW - 1, 'farm'))!;
    const t = train(g, 28);
    const schedule = [defaultStop(s.id), defaultStop(g.depot.id)];
    t.schedule = schedule;
    expectRefused(g, 'undo', STR.history.routedTo(t.name, s.name));
    // the schedule is not touched
    expect(t.schedule).toBe(schedule);
    expect(t.schedule.map((p) => p.stationId)).toEqual([s.id, g.depot.id]);
  });

  it('a contract job or a train at the platform holds a station too', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const s = g.commands.act(() => g.builder.placeStation(15, ROW - 1, 'farm'))!;
    const t = train(g, 28);
    t.jobs = [{ contractId: 1, originId: s.id, destId: g.depot.id } as (typeof t.jobs)[number]];
    expectRefused(g, 'undo', STR.history.routedTo(t.name, s.name));
    t.jobs = [];
    s.occupants.add(t.id);
    expectRefused(g, 'undo', STR.history.routedTo(t.name, s.name));
    s.occupants.clear();
    expect(g.history.undo()).toEqual({ ok: true });
  });

  it('a redone demolish asks the same', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const s = g.builder.placeStation(15, ROW - 1, 'farm')!;
    g.commands.act(() => g.builder.removeStation(s));
    g.history.undo();
    const t = train(g, 28);
    t.schedule = [defaultStop(s.id), defaultStop(g.depot.id)];
    expectRefused(g, 'redo', STR.history.routedTo(t.name, s.name));
  });

  it('short goods refuse an undo, naming what is short', () => {
    const g = game();
    g.builder.placeBuilding(12, ROW + 5, 'windmill', 0);
    g.commands.act(() => g.builder.removeBuilding(12, ROW + 5));
    const refund = g.stock.get('wood') - (GOODS.wood - 45);
    expect(refund).toBeGreaterThan(0);
    g.stock.amounts.set('wood', 2);
    expectRefused(
      g,
      'undo',
      STR.history.short(g.stores.label(g.stores.poolOf(g.stock)), `${refund - 2} wood`),
    );
    g.stock.amounts.set('wood', refund);
    expect(g.history.undo()).toEqual({ ok: true });
    expect(g.stock.get('wood')).toBe(0);
  });

  it('short goods refuse a redo that has to pay again', () => {
    const g = game();
    g.commands.act(() => g.builder.placeBuilding(12, ROW + 5, 'windmill', 0));
    g.history.undo();
    g.stock.amounts.set('wood', 3);
    g.stock.amounts.set('stone', 4);
    const label = g.stores.label(g.stores.poolOf(g.stock));
    const before = state(g);
    const r = g.history.redo();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain(label);
      expect(r.message).toContain('42 wood');
      expect(r.message).toContain('21 stone');
    }
    expect(state(g)).toEqual(before);
    expect(g.history.canRedo).toBe(true);
  });

  it('a store short on one good moves none of the others', () => {
    const g = game();
    g.builder.placeBuilding(12, ROW + 5, 'windmill', 0);
    g.commands.act(() => g.builder.removeBuilding(12, ROW + 5));
    g.stock.amounts.set('stone', 0);
    const before = state(g);
    expect(g.history.undo().ok).toBe(false);
    expect(state(g)).toEqual(before);
  });

  it('adds up what a step asks of one network', () => {
    const g = game();
    const far = station(g, 'depot', 40, 10);
    const stock = g.stores.byKey(`st:${far.id}`)!;
    line(g, 20, 10, 50);
    // the near depot paid some and the far depot the rest: a redo asks of both, which are one place
    g.stock.amounts.set('wood', 5);
    stock.amounts.set('wood', 500);
    g.commands.act(() => g.builder.placeBuilding(28, 14, 'windmill', 0));
    g.history.undo();
    g.stock.amounts.set('wood', 20);
    stock.amounts.set('wood', 20);
    expect(g.history.redo().ok).toBe(false);
    expect(g.history.canRedo).toBe(true);
  });

  it('a refused step can be tried again once the reason has gone', () => {
    const g = game();
    g.commands.act(() => run(g, 10, 12));
    const t = train(g, 11);
    expect(g.history.undo().ok).toBe(false);
    g.fleet.trains.splice(g.fleet.trains.indexOf(t), 1);
    expect(g.history.undo()).toEqual({ ok: true });
  });
});

describe('the session', () => {
  it('a new action clears redo', () => {
    const g = game();
    g.commands.act(() => run(g, 10, 12));
    g.history.undo();
    expect(g.history.canRedo).toBe(true);
    g.commands.act(() => run(g, 20, 22));
    expect(g.history.canRedo).toBe(false);
  });

  it('after a load there is nothing to undo', () => {
    const g = game();
    g.commands.act(() => run(g, 10, 12));
    const before = state(g);
    g.history.clear();
    expect(g.history.undo()).toEqual({ ok: false, message: STR.history.nothingToUndo });
    expect(state(g)).toEqual(before);
  });

  it('the cap of 100 steps', () => {
    const g = game();
    for (let i = 0; i < 105; i++) g.commands.renameStation(g.depot, `Stop ${i}`);
    let n = 0;
    while (g.history.undo().ok) n++;
    expect(n).toBe(100);
    expect(g.depot.name).toBe('Stop 4');
  });

  it('nothing is recorded outside a transaction', () => {
    const g = game();
    run(g, 10, 12);
    g.builder.placeDecor(12, ROW + 5, 'water_tower', 0);
    g.builder.removeDecor(12, ROW + 5);
    expect(g.history.canUndo).toBe(false);
    expect(g.builder.log).toBeNull();
  });

  it('an action that changes nothing makes no step', () => {
    const g = game();
    expect(g.commands.act(() => g.builder.placeDecor(12, ROW, 'signal', 0))).toBeNull();
    expect(g.history.canUndo).toBe(false);
  });

  it('nothing is recorded in the level editor', () => {
    const g = game();
    g.builder.free = true;
    g.commands.act(() => run(g, 10, 12));
    g.commands.renameStation(g.depot, 'Keleti');
    expect(g.depot.name).toBe('Keleti');
    expect(g.history.canUndo).toBe(false);
    expect(g.builder.log).toBeNull();
  });

  it('an action inside an action is part of it', () => {
    const g = game();
    g.commands.act(() => {
      g.commands.act(() => run(g, 10, 12));
      g.commands.renameStation(g.depot, 'Keleti');
    });
    g.history.undo();
    expect(g.history.canUndo).toBe(false);
    expect(g.track.has(10, ROW)).toBe(false);
  });

  it('a throw in an action leaves no transaction open and keeps what was done', () => {
    const g = game();
    expect(() =>
      g.commands.act(() => {
        run(g, 10, 12);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(g.builder.log).toBeNull();
    g.history.undo();
    expect(g.track.has(10, ROW)).toBe(false);
  });

  it('a chain of steps undoes back to the start and forward to the end', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const before = state(g);
    let s = null as ReturnType<typeof g.builder.placeStation>;
    g.commands.act(() => (s = g.builder.placeStation(15, ROW - 1, 'farm')));
    g.commands.act(() => g.builder.upgradeStation(s!));
    g.commands.renameStation(s!, 'Rét');
    g.commands.act(() => g.builder.placeDecor(15, ROW - 2, 'water_tower', 0));
    g.commands.act(() => g.builder.removeStation(s!));
    const after = state(g);
    for (let i = 0; i < 5; i++) expect(g.history.undo()).toEqual({ ok: true });
    expect(state(g)).toEqual(before);
    for (let i = 0; i < 5; i++) expect(g.history.redo()).toEqual({ ok: true });
    expect(state(g)).toEqual(after);
  });

  it('the world goes on after an undo: the same stations in the same stores', () => {
    const g = game();
    line(g, 10, ROW, 30);
    const s = g.commands.act(() => g.builder.placeStation(44, 40, 'narrow_depot'))!;
    g.history.undo();
    g.history.redo();
    expect(g.builder.stationById(s.id)).toBe(s);
    expect(g.stores.dockOf(s)).not.toBeNull();
    expect(s.dock).not.toBeNull();
  });
});

describe('what a step is called', () => {
  it('a run of two lines has a plain label', () => {
    const g = game();
    g.commands.act(() => {
      g.builder.placeTrack(10, ROW, STRAIGHT, EW);
      g.builder.placeTrack(11, ROW, { kind: 'straight', cls: 'main' }, EW);
    });
    expect(g.history.undoLabel).toBe(STR.history.built(STR.history.track));
  });

  it('a crossing counts as a tile of the run that laid it', () => {
    const g = game();
    run(g, 10, 20);
    g.commands.act(() => {
      for (let y = ROW - 2; y <= ROW + 2; y++) {
        const tiles = [{ x: 15, y, rot: NS }];
        layRun(g.builder, planRun(g.builder, tiles, { kind: 'straight', cls: 'main' }));
      }
    });
    expect(g.history.undoLabel).toBe('Built 5 tiles of Main Line');
  });

  it('a platform and the rail on it is a built track', () => {
    const g = game();
    g.commands.act(() =>
      g.builder.placeLine([
        { kind: 'platform', x: 12, y: ROW, defId: 'bridge_wood' },
        { kind: 'track', x: 12, y: ROW, item: STRAIGHT, rot: EW },
      ]),
    );
    expect(g.history.undoLabel).toBe('Built 1 tile of Branch Line');
  });
});

describe('a contract on a station that leaves', () => {
  /** A diesel with a hopper, full tanks and a program, standing on the row at `x`. */
  function hauler(g: Game, x: number, stops: Station[]) {
    const t = new Train([{ uid: 1, level: 1, def: locoDef('f7') }]);
    t.wagons = [
      { uid: 2, def: wagonDef('wood_hopper'), level: 1, cargo: null, amount: 0, origin: null },
    ];
    expect(t.spawnAt(g.track, x, ROW, Dir.W)).not.toBe(false);
    t.oil = t.oilCap;
    t.schedule = stops.map((s) => defaultStop(s.id));
    g.fleet.trains.push(t);
    return t;
  }
  /**
   * Three farms along the row, a train running the two outer ones, and an active contract from
   * the first farm to the middle one, handed to the train.
   */
  function scene() {
    const g = game();
    line(g, 10, ROW, 40);
    const a = g.builder.placeStation(14, ROW - 1, 'farm')!;
    const b = g.builder.placeStation(22, ROW - 1, 'farm')!;
    const home = g.builder.placeStation(36, ROW - 1, 'farm')!;
    const t = hauler(g, 18, [a, home]);
    const c: Contract = {
      id: 1,
      templateId: 'haul',
      name: 'Stone run',
      rarity: 'common',
      cargo: 'stone',
      amount: 100,
      delivered: 30,
      originId: a.id,
      destId: b.id,
      payout: 500,
      tickets: 0,
      duration: 5000,
      expires: g.clock.time + 5000,
      acceptedAt: g.clock.time,
      status: 'active',
      trainId: null,
    };
    g.contracts.contracts.push(c);
    expect(g.contractJobs.assign(c)).toBe(t);
    return { g, a, b, home, t, c };
  }
  const jobs = (t: Train) => (t.job ? [t.job, ...t.jobs] : t.jobs).map((j) => j.contractId);
  /** The train runs until `done` says so, or the test gives up on it. */
  function runUntil(g: Game, done: () => boolean) {
    for (let i = 0; i < 20000 && !done(); i++) {
      g.clock.time += 0.1;
      g.fleet.tick(0.1, g.clock.time);
    }
    expect(done()).toBe(true);
  }

  it('the contract lapsing lets go of the train, which goes back to its program', () => {
    const { g, b, t, c } = scene();
    // the job taken up: the train has set its program aside for the contract
    runUntil(g, () => t.job !== null);
    g.commands.act(() => g.builder.removeStation(b));
    g.contracts.tick(g.clock.time);
    expect(c.status).toBe('expired');
    expect(jobs(t)).toEqual([]);
    const program = t.program;
    runUntil(g, () => t.schedule === program);
  });

  it('a lapse with no undo in sight lets go of a queued job too', () => {
    const { g, b, t } = scene();
    expect(jobs(t)).toEqual([1]);
    g.builder.removeStation(b);
    g.contracts.tick(g.clock.time);
    expect(jobs(t)).toEqual([]);
  });

  it('an undo brings it back whole, with a train on it, its deadline and deliveries as they were', () => {
    const { g, b, t, c } = scene();
    const { expires } = c;
    g.commands.act(() => g.builder.removeStation(b));
    g.contracts.tick(g.clock.time);
    expect(g.history.undo()).toEqual({ ok: true });
    expect(g.builder.stationById(b.id)).toBe(b);
    expect(c).toMatchObject({ status: 'active', trainId: t.id, delivered: 30, expires });
    expect(jobs(t)).toEqual([1]);
    // and the board goes on with it: the station it needs stands
    g.contracts.tick(g.clock.time);
    expect(c.status).toBe('active');
  });

  it('an undo before the board has looked finds nothing lapsed and adds no second job', () => {
    const { g, b, t, c } = scene();
    g.commands.act(() => g.builder.removeStation(b));
    expect(g.history.undo()).toEqual({ ok: true });
    expect(c.status).toBe('active');
    expect(jobs(t)).toEqual([1]);
  });

  it('a train still at work when the undo comes takes up the job from the start', () => {
    const { g, b, t, c } = scene();
    runUntil(g, () => t.job !== null);
    g.commands.act(() => g.builder.removeStation(b));
    g.contracts.tick(g.clock.time);
    expect(g.history.undo()).toEqual({ ok: true });
    expect(c.status).toBe('active');
    runUntil(g, () => t.job?.contractId === c.id);
  });

  it('past its deadline the contract stays over, and the station still comes back', () => {
    const { g, b, t, c } = scene();
    g.commands.act(() => g.builder.removeStation(b));
    g.contracts.tick(g.clock.time);
    g.clock.time = c.expires + 1;
    const money = g.economy.money;
    expect(g.history.undo()).toEqual({ ok: true });
    expect(g.builder.stationById(b.id)).toBe(b);
    expect(c.status).toBe('expired');
    expect(jobs(t)).toEqual([]);
    g.contracts.tick(g.clock.time);
    expect(g.economy.money).toBe(money);
  });

  it('with no train to take it up the undo is refused, naming the contract', () => {
    const { g, b, t, c } = scene();
    g.commands.act(() => g.builder.removeStation(b));
    g.contracts.tick(g.clock.time);
    g.fleet.trains.pop();
    expectRefused(g, 'undo', STR.history.contractNoTrain(c.name));
    expect(c.status).toBe('expired');
    g.fleet.trains.push(t);
    expect(g.history.undo()).toEqual({ ok: true });
    expect(c.status).toBe('active');
  });

  it('one that never had a train comes back without one', () => {
    const { g, b, t, c } = scene();
    g.contractJobs.release(c);
    c.trainId = null;
    g.commands.act(() => g.builder.removeStation(b));
    g.contracts.tick(g.clock.time);
    g.fleet.trains.pop();
    expect(g.history.undo()).toEqual({ ok: true });
    expect(c).toMatchObject({ status: 'active', trainId: null });
    expect(jobs(t)).toEqual([]);
  });

  it('an offer comes back an offer', () => {
    const { g, b, c } = scene();
    g.contractJobs.release(c);
    c.status = 'offer';
    g.commands.act(() => g.builder.removeStation(b));
    g.contracts.tick(g.clock.time);
    expect(c.status).toBe('expired');
    g.history.undo();
    expect(c.status).toBe('offer');
  });

  it('waits for its other end: with both ends gone the second undo brings it back', () => {
    const { g, a, b, t, c } = scene();
    g.commands.act(() => g.builder.removeStation(b));
    g.commands.act(() => g.builder.removeStation(a));
    g.contracts.tick(g.clock.time);
    g.history.undo();
    expect(c.status).toBe('expired');
    g.history.undo();
    expect(c.status).toBe('active');
    expect(jobs(t)).toEqual([1]);
  });

  it('a contract pruned off the board in the meantime goes back on it', () => {
    const { g, b, c } = scene();
    g.commands.act(() => g.builder.removeStation(b));
    g.contracts.tick(g.clock.time);
    g.contracts.contracts = [];
    g.history.undo();
    expect(g.contracts.byId(c.id)).toBe(c);
  });

  it('an undone build a contract lapsed on comes back with the redo', () => {
    const { g, c } = scene();
    g.contractJobs.release(c);
    c.trainId = null;
    const late = g.commands.act(() => g.builder.placeStation(26, ROW - 1, 'farm'))!;
    c.destId = late.id;
    g.history.undo();
    g.contracts.tick(g.clock.time);
    expect(c.status).toBe('expired');
    g.history.redo();
    expect(c.status).toBe('active');
  });
});

describe('what a step leaves around it', () => {
  it('a house has grown since: the newcomers fill it no further than it holds', () => {
    const g = game();
    line(g, 10, ROW, 30);
    g.builder.placeStation(15, ROW - 1, 'town');
    g.builder.placeDecor(13, ROW - 3, 'townhouse', 0);
    const h = g.houses.at(13, ROW - 3)!;
    Object.assign(h, { progress: 1, residents: 1 });
    g.commands.act(() => g.builder.placeBuilding(17, ROW - 4, 'windmill', 0));
    g.history.undo();
    const full = g.houses.capacity(h);
    h.residents = full;
    g.history.redo();
    expect(h.residents).toBe(full);
    // no newcomer came, so none leaves
    g.history.undo();
    expect(h.residents).toBe(full);
  });

  it('a house has emptied since: nobody leaves it, and nobody comes from nothing', () => {
    const g = game();
    line(g, 10, ROW, 30);
    g.builder.placeStation(15, ROW - 1, 'town');
    g.builder.placeDecor(13, ROW - 3, 'townhouse', 0);
    const h = g.houses.at(13, ROW - 3)!;
    Object.assign(h, { progress: 1, residents: 1 });
    g.commands.act(() => g.builder.placeBuilding(17, ROW - 4, 'windmill', 0));
    expect(h.residents).toBeGreaterThan(1);
    h.residents = 0;
    g.history.undo();
    expect(h.residents).toBe(0);
    g.history.redo();
    expect(h.residents).toBe(0);
  });

  /** The warnings the builder raised and took down, as the game hears them. */
  function warnings(g: Game) {
    const heard: boolean[] = [];
    g.builder.onStationOrphaned = (_s, orphaned) => heard.push(orphaned);
    return heard;
  }

  it('a depot with no rails gets no warning from a redone build, as it got none when built', () => {
    const g = game();
    const heard = warnings(g);
    g.commands.act(() => g.builder.placeStation(44, 40, 'narrow_depot'));
    g.history.undo();
    g.history.redo();
    expect(heard).toEqual([]);
  });

  it('a station that left has its warning again from an undo', () => {
    const g = game();
    line(g, 40, 41, 46);
    const far = station(g, 'farm', 44, 40);
    g.builder.removeTrack(44, 41);
    const heard = warnings(g);
    g.commands.act(() => g.builder.removeStation(far));
    g.history.undo();
    expect(heard).toEqual([true]);
  });

  /** Laying track takes a tile's props off the map for good, as the renderer does. */
  function clearsProps(g: Game) {
    const told: Tile[] = [];
    const tell = g.builder.onTrackChanged;
    g.builder.onTrackChanged = (x, y) => {
      tell?.(x, y);
      if (g.track.get(x, y)) g.map.props.delete(y * g.map.w + x);
    };
    g.builder.onPropsBack = (x, y) => told.push({ x, y });
    return told;
  }

  it('a deposit a curve cleared is back on the map, and the renderer is told', () => {
    const g = game();
    const told = clearsProps(g);
    const k = ROW * g.map.w + 10;
    g.map.props.set(k, [{ kind: 'oil', variant: 0, ox: 0, oy: 0 }]);
    g.commands.act(() => g.builder.placeTrack(10, ROW, { kind: 'curve', cls: 'branch' }, 0));
    expect(g.builder.hasDeposit(10, ROW, 'oil')).toBe(false);
    g.history.undo();
    expect(g.builder.hasDeposit(10, ROW, 'oil')).toBe(true);
    expect(told).toContainEqual({ x: 10, y: ROW });
    // and the redo clears it again, the way laying it did
    g.history.redo();
    expect(g.builder.hasDeposit(10, ROW, 'oil')).toBe(false);
  });

  it('trees pushed aside are back where they stood', () => {
    const g = game();
    const k = ROW * g.map.w + 10;
    const tree = { kind: 'oak', variant: 0, ox: 0.1, oy: 0.2 } as PropInstance;
    g.map.props.set(k, [tree]);
    g.commands.act(() => {
      g.builder.placeTrack(10, ROW, STRAIGHT, EW);
      tree.oy = 0.4;
    });
    g.history.undo();
    expect(g.map.props.get(k)).toEqual([{ kind: 'oak', variant: 0, ox: 0.1, oy: 0.2 }]);
  });
});

describe('a train renamed or recoloured, a step of its own', () => {
  it('a rename goes back and comes again, under a label that names it', () => {
    const g = game();
    run(g, 10, 22);
    const t = train(g, 12);
    t.name = 'Rocket 1';
    expect(g.commands.renameTrain(t, '  Coal run  ')).toEqual({ ok: true });
    expect(t.name).toBe('Coal run');
    expect(g.history.undoLabel).toBe(STR.history.renamed('Rocket 1', 'Coal run'));
    expect(g.history.undo()).toEqual({ ok: true });
    expect(t.name).toBe('Rocket 1');
    expect(g.history.redo()).toEqual({ ok: true });
    expect(t.name).toBe('Coal run');
  });

  it('a recolour goes back and comes again, and each click is a step', () => {
    const g = game();
    run(g, 10, 22);
    const t = train(g, 12);
    expect(t.colour).toBe(0);
    g.commands.recolourTrain(t, 1);
    g.commands.recolourTrain(t, 2);
    expect(g.history.undoLabel).toBe(STR.history.recoloured(t.name, STR.train.colour[2]));
    g.history.undo();
    expect(t.colour).toBe(1);
    g.history.undo();
    expect(t.colour).toBe(0);
    g.history.redo();
    g.history.redo();
    expect(t.colour).toBe(2);
  });

  it('does not join the step before it, and clears what could be redone', () => {
    const g = game();
    run(g, 10, 22);
    const t = train(g, 12);
    g.commands.act(() => run(g, 10, 22, ROW + 2), 7);
    g.commands.recolourTrain(t, 3);
    g.history.undo();
    expect(g.history.undoLabel).not.toBeNull();
    expect(t.colour).toBe(0);
    expect(g.history.canRedo).toBe(true);
    g.commands.renameTrain(t, 'New name');
    expect(g.history.canRedo).toBe(false);
  });

  it('nothing changed makes no step', () => {
    const g = game();
    run(g, 10, 22);
    const t = train(g, 12);
    const label = g.history.undoLabel;
    expect(g.commands.renameTrain(t, ` ${t.name} `)).toEqual({ ok: true });
    expect(g.commands.recolourTrain(t, t.colour)).toEqual({ ok: true });
    expect(g.history.undoLabel).toBe(label);
  });

  it('refuses an empty name and a colour that is none, and makes no step', () => {
    const g = game();
    run(g, 10, 22);
    const t = train(g, 12);
    const label = g.history.undoLabel;
    expect(g.commands.renameTrain(t, '   ')).toEqual({ ok: false, message: STR.train.nameEmpty });
    for (const c of [-1, 1.5, TRAIN_COLOURS.length])
      expect(g.commands.recolourTrain(t, c)).toEqual({ ok: false, message: STR.train.noColour });
    expect(g.history.undoLabel).toBe(label);
  });

  it('cuts a long name to the longest a train may carry', () => {
    const g = game();
    run(g, 10, 22);
    const t = train(g, 12);
    g.commands.renameTrain(t, 'x'.repeat(TRAIN_NAME_MAX + 9));
    expect(t.name).toHaveLength(TRAIN_NAME_MAX);
  });

  it('a train recalled since does not stand in the way of the steps under it', () => {
    const g = game();
    g.commands.act(() => run(g, 10, 22));
    const t = train(g, 12);
    const built = g.history.undoLabel;
    expect(built).not.toBeNull();
    g.commands.recolourTrain(t, 4);
    g.commands.renameTrain(t, 'Short lived');
    g.fleet.recall(t);
    expect(g.history.undo()).toEqual({ ok: true });
    expect(g.history.undo()).toEqual({ ok: true });
    expect(g.history.undoLabel).toBe(built);
    expect(g.history.undo()).toEqual({ ok: true });
  });

  it('a train recalled can no longer be renamed or recoloured', () => {
    const g = game();
    run(g, 10, 22);
    const t = train(g, 12);
    g.fleet.recall(t);
    expect(g.commands.renameTrain(t, 'Again')).toEqual({ ok: false, message: STR.train.gone });
    expect(g.commands.recolourTrain(t, 1)).toEqual({ ok: false, message: STR.train.gone });
  });

  it('the level editor records nothing', () => {
    const g = game();
    run(g, 10, 22);
    const t = train(g, 12);
    const label = g.history.undoLabel;
    g.builder.free = true;
    g.commands.renameTrain(t, 'Editor test');
    g.commands.recolourTrain(t, 2);
    expect(t.name).toBe('Editor test');
    expect(t.colour).toBe(2);
    expect(g.history.undoLabel).toBe(label);
  });
});
