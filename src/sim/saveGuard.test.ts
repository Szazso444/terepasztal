import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SAVE_KEY,
  SAVE_MIN_VERSION,
  SAVE_VERSION,
  SLOTS_KEY,
  DEFAULT_SETTINGS,
  buildSave,
  continueMeta,
  firstNonFinite,
  importSave,
  listSlots,
  readSaveText,
  readSlot,
  writeSave,
  writeSlot,
  type SaveGame,
  type SaveParts,
  type SlotMeta,
} from './save';
import {
  STATION_DEFS,
  Station,
  resetStationIds,
  stationFootprint,
  type StationJSON,
} from './stations';
import { rules, DEFAULT_RULES } from './rules';
import { setSupplyMode, supplyMode, DEFAULT_SUPPLY } from './supply';
import { getSeasonOffset, setSeasonOffset } from './weather';
import { buildingToJSON } from './buildings';
import { resetTrainIds } from './trains';
import { SimStep, startStock, type StepContext } from './step';
import { Terrain, terrainAt } from '../world/tiles';
import { simWorld, line, station, mapParams, type SimWorld } from '../testing/simWorld';
import { forAll, shrinkArray, shrinkInt } from '../testing/property';
import type { Rng } from '../engine/rng';

// ------------------------------------------------------------------ helpers

/** A value as it reads back from JSON. */
const asStored = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** An in-memory `localStorage` that counts its writes, so a test can see nothing was written. */
class MemoryStorage {
  items = new Map<string, string>();
  writes = 0;
  /** storage that is full or blocked: every write throws and keeps what it held */
  refuses = false;
  getItem(k: string) {
    return this.items.has(k) ? this.items.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    if (this.refuses) throw new Error('QuotaExceededError');
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.writes++;
    if (this.refuses) throw new Error('QuotaExceededError');
    this.items.delete(k);
  }
}
/** A fresh in-memory localStorage holding `items`, in place of the real one. */
function stubStorage(items: Record<string, string> = {}) {
  const store = new MemoryStorage();
  for (const [k, v] of Object.entries(items)) store.items.set(k, v);
  vi.stubGlobal('localStorage', store);
  return store;
}

/** One step of a path into a value: a key of an object or a position in a list. */
type Step = string | number;
/** A path as `firstNonFinite` writes it: keys joined by dots, list positions in brackets. */
function pathText(path: readonly Step[]): string {
  let out = '';
  for (const s of path) out += typeof s === 'number' ? `[${s}]` : out ? `.${s}` : s;
  return out;
}
/** The value at the end of a path written as `firstNonFinite` writes one, from the top. */
function follow(value: unknown, path: string): unknown {
  const re = /\[(\d+)\]|\.?([^.[\]]+)/y;
  let at = value;
  while (re.lastIndex < path.length) {
    const from = re.lastIndex;
    const m = re.exec(path);
    if (!m) throw new Error(`no step at ${from} of ${path}`);
    at =
      m[1] !== undefined ? (at as unknown[])[Number(m[1])] : (at as Record<string, unknown>)[m[2]];
  }
  return at;
}
/** The value at `path` set to `to` in place. */
function setAt(value: unknown, path: readonly Step[], to: unknown) {
  let at = value as Record<Step, unknown>;
  for (const s of path.slice(0, -1)) at = at[s] as Record<Step, unknown>;
  at[path[path.length - 1]] = to;
}

/**
 * Every number in `value` with its path, in the order `JSON.stringify` visits them: found by
 * `JSON.stringify` itself, whose replacer is called for each value it writes, in order, with the
 * object or list it sits in. This is the oracle for the order, apart from the code under test.
 */
function numbersInOrder(value: unknown): { path: Step[]; n: number }[] {
  const out: { path: Step[]; n: number }[] = [];
  const paths = new Map<object, Step[]>();
  JSON.stringify(value, function (this: unknown, key: string, v: unknown) {
    const holder = this as object;
    const base = paths.get(holder);
    const path: Step[] = base === undefined ? [] : [...base, Array.isArray(holder) ? +key : key];
    if (typeof v === 'number') out.push({ path, n: v });
    else if (typeof v === 'object' && v !== null) paths.set(v, path);
    return v;
  });
  return out;
}

/** The numbers JSON cannot hold. */
const NON_FINITE = [Number.NaN, Infinity, -Infinity];
const sameNumber = (a: unknown, b: number) => typeof a === 'number' && Object.is(a, b);

// ------------------------------------------------------------------ a game as the game saves it

/**
 * The first corner, scanning from the top, whose tiles x - 1 .. x + 22 on rows y - 9 .. y + 9
 * all take buildings: room for what `build` places.
 */
function findSite(w: SimWorld): { x: number; y: number } {
  const ok = (x: number, y: number) => {
    const t = terrainAt(w.map, x, y);
    return t !== Terrain.Water && t !== Terrain.Rock && t !== Terrain.Mountain;
  };
  for (let y = 10; y < w.map.h - 10; y++)
    for (let x = 2; x + 24 < w.map.w; x++) {
      let fits = true;
      for (let dy = -9; dy <= 9 && fits; dy++)
        for (let dx = -1; dx <= 22 && fits; dx++) fits = ok(x + dx, y + dy);
      if (fits) return { x, y };
    }
  throw new Error(`seed ${w.seed}: no site`);
}

/**
 * A game under way: a new game's stock, a depot with a line east of it, a quarry and a warehouse
 * with a train between them, a passenger station among houses, the Diesel age reached and the
 * quarry's upgrade to level 2 under way (paid and started through the builder, as the player
 * starts one).
 */
function build(w: SimWorld) {
  const { x, y } = findSite(w);
  for (const [id, n] of Object.entries(startStock()))
    w.stock.add(id, Math.round(n * rules.startStock));
  const depot = station(w, 'depot', x, y);
  line(w, x + 2, y, x + 20);
  const quarry = station(w, 'quarry', x + 8, y - 1);
  const warehouse = station(w, 'warehouse', x + 18, y - 1);
  station(w, 'station', x + 12, y + 1, 1);
  quarry.store('stone', 40);
  for (let i = 0; i < 6; i++) {
    const hx = x + 6 + i * 2;
    const hy = y + 3 + (i % 3) * 2;
    w.houses.sync({ id: 'townhouse', x: hx, y: hy, rot: 0 }, false);
    Object.assign(w.houses.at(hx, hy)!, { progress: i < 4 ? 1 : 0.3, residents: i < 4 ? 8 : 0 });
  }
  const loco = w.inventory.add('adler', 0);
  const hopper = w.inventory.add('wood_hopper', 0);
  const train = w.fleet.create([loco.uid], [hopper.uid], [quarry.id, warehouse.id]);
  if (typeof train === 'string') throw new Error(`seed ${w.seed}: fleet.create: ${train}`);
  w.economy.setAge(1);
  for (const [id, n] of Object.entries(quarry.upgradeCost())) w.stock.add(id, n);
  w.economy.money += 1e5;
  if (!w.builder.upgradeStation(quarry)) throw new Error(`seed ${w.seed}: no upgrade`);
  if (!quarry.work) throw new Error(`seed ${w.seed}: the upgrade took no time`);
  return { train, quarry, depot };
}

/**
 * The parts `Game.snapshot` saves, taken from the fixture's domains the way that method takes
 * them from Game's (it cannot load under Node); the camera is where the player looks.
 */
function partsOf(w: SimWorld, step: SimStep, camera: SaveParts['camera']): SaveParts {
  const track: SaveParts['track'] = [];
  for (const t of w.track.anchors())
    track.push([t.x, t.y, t.piece.kind, t.piece.rot, t.piece.cls, t.piece.cls2]);
  return {
    seed: w.seed,
    clock: { time: w.clock.time, speedIndex: w.clock.speedIndex },
    economy: w.economy.toJSON(),
    track,
    stations: w.builder.stations.map((st) => st.toJSON()),
    trains: w.fleet.trains.map((t) => t.toJSON()),
    contracts: w.contracts.toJSON(),
    trade: w.trade.toJSON(),
    inventory: w.inventory.toJSON(),
    gacha: w.gacha.toJSON(),
    crafting: w.crafting.toJSON(),
    camera,
    lastDay: step.lastDay,
    decor: [...w.builder.decor.values()].map((d) => [d.x, d.y, d.id, d.rot]),
    weather: w.weather.toJSON(),
    world: { kind: 'generated', seed: w.seed, params: mapParams(w.map.w) },
    supply: supplyMode(),
    rules: { ...rules },
    stockpile: w.stock.toJSON(),
    regions: w.regions.toJSON(),
    seasonOffset: getSeasonOffset(),
    towns: w.towns.toJSON(),
    buildings: [...w.builder.buildings.values()].map(buildingToJSON),
    wires: w.catenary.toJSON(),
    houses: w.houses.toJSON(),
    people: w.people.toJSON(),
  };
}

/** Play mode with the weather setting as given and Game's storage cap. */
function context(w: SimWorld, weather: boolean): StepContext {
  return {
    mode: 'play',
    weather,
    stockCap: (id) => w.stock.cap(id, w.builder.depotCount(), w.builder.plantCount()),
  };
}

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  setSeasonOffset(0);
  resetTrainIds(1);
  resetStationIds(1);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A save of a game under way, as plain JSON: a small world built as `build` builds one and run a
 * game minute, its train on the line and the quarry's upgrade still under way. Built once.
 */
let fullSave: SaveGame | null = null;
function fullSaveOnce(): SaveGame {
  if (fullSave) return asStored(fullSave) as SaveGame;
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode(DEFAULT_SUPPLY);
  setSeasonOffset(0);
  const w = simWorld({ seed: 11, size: 64, terrain: 'grass' });
  const built = build(w);
  const step = new SimStep(w);
  for (let i = 0; i < 400; i++) w.clock.run((gdt) => step.run(gdt, context(w, true)));
  if (!built.quarry.work) throw new Error('the upgrade ended before the save was taken');
  const save = buildSave(partsOf(w, step, { x: 640, y: 320, zoomIndex: 2 }), {}, 1_700_000_000_000);
  fullSave = asStored(save) as SaveGame;
  return asStored(fullSave) as SaveGame;
}

/** The parts of a save a broken number is put in, by where it is; '' is anywhere at all. */
const AREAS = [
  'clock',
  'economy',
  'camera',
  'track',
  'stations',
  'trains',
  'rules',
  'people',
  '',
] as const;
/** The numeric positions of `save` in an area, in the order `JSON.stringify` visits them. */
function positionsIn(save: unknown, area: string): Step[][] {
  return numbersInOrder(save)
    .map((p) => p.path)
    .filter((p) => area === '' || p[0] === area);
}

/** A non-finite number at one or two numeric positions of the full save. */
interface Broken {
  area: string;
  at: number;
  value: number;
  /** a second position and value, anywhere in the save */
  also?: { at: number; value: number };
}
function genBroken(rng: Rng): Broken {
  const save = fullSaveOnce();
  const area = rng.pick(AREAS);
  const c: Broken = {
    area,
    at: rng.int(0, positionsIn(save, area).length - 1),
    value: rng.pick(NON_FINITE),
  };
  if (rng.chance(0.3))
    c.also = { at: rng.int(0, positionsIn(save, '').length - 1), value: rng.pick(NON_FINITE) };
  return c;
}
/** The full save with the case's numbers put in, and the paths they went to. */
function broken(c: Broken): { save: SaveGame; paths: Step[][] } {
  const save = fullSaveOnce();
  const path = positionsIn(save, c.area)[c.at];
  const paths = [path];
  if (c.also) paths.push(positionsIn(save, '')[c.also.at]);
  setAt(save, path, c.value);
  if (c.also) setAt(save, paths[1], c.also.value);
  return { save, paths };
}
function* shrinkBroken(c: Broken): Iterable<Broken> {
  if (c.also) yield { area: c.area, at: c.at, value: c.value };
  if (c.area !== '') {
    const save = fullSaveOnce();
    const path = pathText(positionsIn(save, c.area)[c.at]);
    const anywhere = positionsIn(save, '').findIndex((p) => pathText(p) === path);
    yield { ...c, area: '', at: anywhere };
  }
  for (const at of shrinkInt(c.at)) yield { ...c, at };
}

// ------------------------------------------------------------------ firstNonFinite

describe('firstNonFinite', () => {
  it('has a position to break in every part of the full save', () => {
    const save = fullSaveOnce();
    for (const area of AREAS)
      expect(positionsIn(save, area).length, `numbers in ${area || 'the save'}`).toBeGreaterThan(0);
    // a track tuple and a station's storage are lists and objects within lists
    expect(positionsIn(save, 'track').some((p) => p.length === 3)).toBe(true);
    expect(positionsIn(save, 'stations').some((p) => p.length >= 3)).toBe(true);
    expect(firstNonFinite(save)).toBeNull();
  });

  it('finds a non-finite number anywhere, by the path to the first in the order JSON writes', () => {
    forAll(
      genBroken,
      (c) => {
        const { save, paths } = broken(c);
        const copy = structuredClone(save);
        const found = firstNonFinite(save);
        // the oracle: the first number JSON.stringify meets that it cannot write
        const first = numbersInOrder(save).find((p) => !Number.isFinite(p.n));
        expect(first, 'a number was put in').toBeDefined();
        expect(paths.map(pathText), 'the first is one of those put in').toContain(
          pathText(first!.path),
        );
        expect(found).toBe(pathText(first!.path));
        expect(sameNumber(follow(save, found!), first!.n), `${found} leads to it`).toBe(true);
        expect(save, 'the save is not changed').toEqual(copy);
        // with the numbers finite again there is none
        for (const p of paths) setAt(save, p, 7);
        expect(firstNonFinite(save)).toBeNull();
      },
      { shrink: shrinkBroken },
    );
  });

  it('writes keys joined by dots and list positions in brackets, nested lists included', () => {
    const save = fullSaveOnce();
    save.economy.money = Number.NaN;
    expect(firstNonFinite(save)).toBe('economy.money');
    save.economy.money = 5;
    (save.stations[2] as unknown as Record<string, unknown>).level = Infinity;
    expect(firstNonFinite(save)).toBe('stations[2].level');
    save.track[3][1] = -Infinity;
    expect(firstNonFinite(save)).toBe('track[3][1]');
    expect(firstNonFinite([[1, [2, Number.NaN]]])).toBe('[0][1][1]');
    expect(firstNonFinite({ a: { b: [{ c: Infinity }] } })).toBe('a.b[0].c');
    expect(firstNonFinite(Number.NaN)).toBe('');
    for (const v of [0, -0, 1e308, -5e-324, 'NaN', null, undefined, true, {}, [], { a: [] }])
      expect(firstNonFinite(v), String(v)).toBeNull();
  });

  it('reads what JSON writes: an object by its toJSON, and nothing JSON leaves out', () => {
    const s = new Station('farm', 3, 4, 'Alder');
    s.loadBoost = Number.NaN;
    s.terrainFactor = Infinity;
    // neither is written, so neither is a reason to refuse
    expect(firstNonFinite({ stations: [s] })).toBeNull();
    s.level = Number.NaN;
    expect(firstNonFinite({ stations: [s] })).toBe('stations[0].level');
    expect(firstNonFinite({ a: () => Number.NaN, b: Symbol('x'), c: undefined })).toBeNull();
    expect(firstNonFinite({ boxed: Object(Infinity) as unknown })).toBe('boxed');
    // a cycle is not followed (JSON refuses it, so it is never written)
    const loop: Record<string, unknown> = { n: 1 };
    loop.self = loop;
    expect(firstNonFinite(loop)).toBeNull();
    loop.m = Number.NaN;
    expect(firstNonFinite(loop)).toBe('m');
  });
});

// ------------------------------------------------------------------ the write side

/** Where a save is written: as the game Continue loads, or under a name new or already taken. */
type Target = 'continue' | 'newSlot' | 'existingSlot';
const TARGETS: readonly Target[] = ['continue', 'newSlot', 'existingSlot'];
/** Saves already stored: a good game for Continue and two named ones. */
function storedBefore(): Record<string, string> {
  const good = (day: number) => JSON.stringify({ ...fullSaveOnce(), lastDay: day });
  return {
    [SAVE_KEY]: good(3),
    [SLOTS_KEY]: JSON.stringify({ Alpha: good(1), Beta: good(2) }),
    'terepasztal.settings': JSON.stringify({ ...DEFAULT_SETTINGS, music: 0.7 }),
  };
}
/** Write `save` to `target`; what the module answered. */
function writeTo(target: Target, save: SaveGame): boolean {
  if (target === 'continue') return writeSave(save);
  return writeSlot(target === 'newSlot' ? 'Gamma' : 'Beta', save);
}

describe('writeSave and writeSlot', () => {
  it('write nothing for a save that holds a non-finite number, wherever it would go', () => {
    forAll(
      (rng) => ({ broken: genBroken(rng), target: rng.pick(TARGETS) }),
      (c) => {
        const { save } = broken(c.broken);
        const store = stubStorage(storedBefore());
        const before = new Map(store.items);
        expect(writeTo(c.target, save), 'stored').toBe(false);
        expect(store.writes, 'storage writes').toBe(0);
        expect(store.items, 'what storage holds').toEqual(before);
      },
      {
        shrink: function* (c) {
          for (const b of shrinkBroken(c.broken)) yield { ...c, broken: b };
        },
      },
    );
  });

  it('store a finite save with the text JSON gives it, in one write', () => {
    for (const target of TARGETS) {
      const save = fullSaveOnce();
      const store = stubStorage(storedBefore());
      const before = new Map(store.items);
      expect(writeTo(target, save), target).toBe(true);
      expect(store.writes, target).toBe(1);
      const text = JSON.stringify(save);
      const want = new Map(before);
      if (target === 'continue') want.set(SAVE_KEY, text);
      else {
        const slots = JSON.parse(before.get(SLOTS_KEY)!) as Record<string, string>;
        slots[target === 'newSlot' ? 'Gamma' : 'Beta'] = text;
        want.set(SLOTS_KEY, JSON.stringify(slots));
      }
      expect(store.items, target).toEqual(want);
    }
  });

  it('answer false when storage throws, and storage keeps what it held', () => {
    for (const target of TARGETS) {
      const store = stubStorage(storedBefore());
      store.refuses = true;
      const before = new Map(store.items);
      expect(writeTo(target, fullSaveOnce()), target).toBe(false);
      expect(store.items, target).toEqual(before);
    }
  });
});

// ------------------------------------------------------------------ the read side

/** Overflowing number literals: JSON.parse reads each as Infinity or -Infinity. */
const OVERFLOWS = ['1e999', '-1e999', '2e308', '-9e999', '1E400'];
/** Station kinds a file may hold, the long narrow depot among them. */
const DEF_IDS = STATION_DEFS.map((d) => d.id);
/** Turns a file may hold for a station: whole ones in range and out, and values no build wrote. */
const ODD_TURNS: readonly unknown[] = [
  0,
  1,
  2,
  3,
  -1,
  -4,
  5,
  7,
  12,
  0.5,
  1.5,
  -2.5,
  '1',
  '0',
  '',
  true,
  false,
  null,
  {},
  [],
  [1],
];

/** A station as some build or a hand-edited file could hold it. */
function genStation(rng: Rng, i: number): Record<string, unknown> {
  const s: Record<string, unknown> = {
    id: i + 1,
    defId: rng.pick(DEF_IDS),
    name: rng.pick(['Town Station 2', 'Alder']),
    x: rng.int(0, 60),
    y: rng.int(0, 60),
    level: rng.int(1, 6),
    storage: { passengers: rng.int(0, 40), wheat: rng.int(0, 40) },
  };
  if (rng.chance(0.85)) s.rot = rng.chance(0.7) ? rng.pick(ODD_TURNS) : rng.int(-9, 12);
  if (rng.chance(0.3)) s.market = { wheat: rng.next() };
  if (rng.chance(0.3)) s.work = { to: (s.level as number) + 1, left: 20, total: 60 };
  return s;
}

/**
 * A file of any format version (none, the oldest to this one, a newer build's, or one no build
 * wrote), every v1 field well formed and deeper data such as no step trips on, each later field
 * there or not. Stations that are no record come only with versions that have no step to read
 * them.
 */
function genFile(rng: Rng): Record<string, unknown> {
  const list = <T>(max: number, item: (i: number) => T) =>
    Array.from({ length: rng.int(0, max) }, (_, i) => item(i));
  const file: Record<string, unknown> = {};
  const v = rng.next();
  if (v < 0.75) file.version = rng.int(SAVE_MIN_VERSION, SAVE_VERSION);
  else if (v < 0.85) file.version = SAVE_VERSION + rng.int(1, 3);
  else if (v < 0.95) file.version = rng.pick([0, -3, 2.5, '13', null]);
  Object.assign(file, {
    seed: rng.int(0, 2 ** 31),
    savedAt: rng.int(0, 2 ** 41),
    clock: { time: rng.range(0, 1e5), speedIndex: rng.int(0, 3) },
    economy: {
      money: rng.int(-500, 1e6),
      tickets: rng.int(0, 50),
      tier: rng.int(0, 5),
      granted: list(3, (i) => i),
      ...(rng.chance(0.5) ? { earned: rng.int(0, 1e5) } : {}),
      ...(rng.chance(0.3) ? { reputation: rng.int(0, 99) } : {}),
    },
    track: list(4, () => {
      const t: unknown[] = [rng.int(0, 63), rng.int(0, 63), 'straight', rng.int(0, 3)];
      if (rng.chance(0.5)) t.push('regular');
      return t;
    }),
    stations: list(4, (i) => genStation(rng, i)),
    trains: list(3, (i) => ({
      id: i + 1,
      speed: rng.range(0, 2),
      distance: rng.range(0, 500),
      stateTime: rng.range(0, 30),
      tanks: { coal: rng.int(0, 90), oil: 0, water: rng.int(0, 90) },
    })),
    contracts: {
      contracts: list(2, (i) => ({
        id: i + 1,
        cargo: rng.pick(['wood', 'coal']),
        status: rng.pick(['offer', 'active', 'done']),
        reward: rng.int(10, 900),
        ...(rng.chance(0.5) ? { reputation: rng.int(1, 5) } : {}),
      })),
    },
    inventory: { items: [], nextUid: 1 },
    gacha: {},
    camera: { x: rng.range(-1e4, 1e4), y: rng.range(-1e4, 1e4), zoomIndex: rng.int(0, 5) },
    lastDay: rng.int(0, 5000),
  });
  const later: Record<string, () => unknown> = {
    rules: () => ({
      contractOfferCount: 1,
      buildCostMul: rng.pick([0.5, 1, 2]),
      tradeCycleDays: 7,
    }),
    trade: () => ({ deals: {}, nextAt: rng.int(1, 99), fuelMul: 1, driftDay: rng.int(0, 99) }),
    people: () => ({ rng: rng.int(0, 0xffffffff) }),
    weather: () => ({ kind: 'clear', intensity: 0, nextChangeAt: rng.int(1, 500), rng: 9 }),
    stockpile: () => ({ amounts: { coal: rng.int(0, 99), food: 600 }, famine: false }),
    settings: () => ({ ...DEFAULT_SETTINGS, music: rng.next() }),
    somethingNewer: () => ({ a: rng.int(0, 9) }),
  };
  for (const [key, make] of Object.entries(later)) if (rng.chance(0.5)) file[key] = make();
  if (fromOf(file.version) >= 12 && rng.chance(0.3))
    (file.stations as unknown[]).splice(
      rng.int(0, (file.stations as unknown[]).length),
      0,
      rng.pick([null, 5, 'x', [1, 2], true]),
    );
  return file;
}
/** The version a file is migrated from: its own when the chain can count up from it, else v1. */
const fromOf = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= SAVE_MIN_VERSION ? v : SAVE_MIN_VERSION;

/**
 * A numeric position of a file, and whether a non-finite number there is still in the save the
 * file loads as, for the version the file is read from: written from the steps' own rules, apart
 * from the loader. The version itself, a station's turn, and the fields the steps drop or give a
 * value of their own are not; everything else is carried through.
 */
interface Position {
  path: Step[];
  stays: (from: number) => boolean;
}
function positionsOf(file: Record<string, unknown>): Position[] {
  const always = () => true;
  const out: Position[] = [];
  const add = (path: Step[], stays: (from: number) => boolean = always) =>
    out.push({ path, stays });
  if (typeof file.version === 'number') add(['version'], () => false);
  add(['seed']);
  add(['savedAt']);
  add(['clock', 'time']);
  add(['clock', 'speedIndex']);
  add(['economy', 'money']);
  add(['economy', 'tickets']);
  // the step from v8 makes the tier an age from 0 to 2, and drops the reputation
  add(['economy', 'tier'], (from) => from > 8);
  const economy = file.economy as Record<string, unknown>;
  if ('reputation' in economy) add(['economy', 'reputation'], (from) => from > 8);
  if ('earned' in economy) add(['economy', 'earned']);
  (economy.granted as unknown[]).forEach((_, i) => add(['economy', 'granted', i]));
  for (const k of ['x', 'y', 'zoomIndex']) add(['camera', k]);
  add(['lastDay']);
  (file.track as unknown[]).forEach((_, i) => {
    for (const k of [0, 1, 3]) add(['track', i, k]);
  });
  (file.stations as unknown[]).forEach((s, i) => {
    if (!isObject(s)) return;
    for (const k of ['id', 'x', 'y', 'level']) add(['stations', i, k]);
    // the turn is repaired on every read
    if ('rot' in s) add(['stations', i, 'rot'], () => false);
    // the step from v11 empties a town's passengers
    add(['stations', i, 'storage', 'passengers'], (from) => s.defId !== 'town' || from > 11);
    add(['stations', i, 'storage', 'wheat']);
    if (isObject(s.market)) add(['stations', i, 'market', 'wheat']);
    if (isObject(s.work)) for (const k of ['to', 'left', 'total']) add(['stations', i, 'work', k]);
  });
  (file.trains as unknown[]).forEach((_, i) => {
    for (const k of ['speed', 'distance', 'stateTime']) add(['trains', i, k]);
    add(['trains', i, 'tanks', 'coal']);
  });
  const book = file.contracts as { contracts: Record<string, unknown>[] };
  book.contracts.forEach((c, i) => {
    add(['contracts', 'contracts', i, 'reward']);
    // the step from v8 drops a contract's reputation
    if ('reputation' in c) add(['contracts', 'contracts', i, 'reputation'], (from) => from > 8);
  });
  if (isObject(file.rules)) {
    add(['rules', 'contractOfferCount']);
    add(['rules', 'buildCostMul']);
    // the step from v11 sets the trade cycle
    add(['rules', 'tradeCycleDays'], (from) => from > 11);
  }
  if (isObject(file.trade)) {
    // the step from v11 restarts the desk's cycle; a week of drift stays as many weeks
    add(['trade', 'nextAt'], (from) => from > 11);
    add(['trade', 'driftDay']);
  }
  if (isObject(file.people)) add(['people', 'rng']);
  if (isObject(file.weather)) add(['weather', 'nextChangeAt']);
  if (isObject(file.stockpile)) add(['stockpile', 'amounts', 'coal']);
  if (isObject(file.settings)) add(['settings', 'music']);
  return out;
}

/** A file with overflowing literals at some of its numeric positions, maybe in a bundle. */
interface Overflowed {
  file: Record<string, unknown>;
  /** indices into `positionsOf(file)`, and the literal written at each */
  at: { i: number; literal: string }[];
  inBundle: boolean;
}
function genOverflowed(rng: Rng): Overflowed {
  const file = genFile(rng);
  const positions = positionsOf(file);
  // a file read from v1 meets the step from v11, which reads every station entry as a record
  const records = (file.stations as unknown[]).every(isObject);
  const all = positions
    .map((_, i) => i)
    .filter((i) => records || positions[i].path[0] !== 'version');
  // half the numbers go where the read drops them, so a text with one is loaded too
  const dropped = all.filter((i) => !positions[i].stays(fromOf(file.version)));
  const count = rng.chance(0.2) ? 0 : rng.int(1, 3);
  const at = Array.from({ length: count }, () => ({
    i: dropped.length && rng.chance(0.5) ? rng.pick(dropped) : rng.pick(all),
    literal: rng.pick(OVERFLOWS),
  }));
  return { file, at, inBundle: rng.chance(0.2) };
}
/** The text of the case: the file, its chosen numbers written as the overflowing literals. */
function textOf(c: Overflowed): string {
  const file = asStored(c.file);
  const positions = positionsOf(c.file);
  c.at.forEach(({ i }, k) => setAt(file, positions[i].path, `#overflow${k}#`));
  const value = c.inBundle
    ? { diagnostics: 1, saveVersion: SAVE_VERSION, at: '2026-10-11T00:00:00.000Z', save: file }
    : file;
  let text = JSON.stringify(value);
  c.at.forEach(({ literal }, k) => (text = text.replace(`"#overflow${k}#"`, literal)));
  return text;
}
/** Is the save the case's text loads as to hold a non-finite number, by the steps' own rules? */
function stillHolds(c: Overflowed): boolean {
  const positions = positionsOf(c.file);
  const versionGone = c.at.some(({ i }) => positions[i].path[0] === 'version');
  const from = versionGone ? SAVE_MIN_VERSION : fromOf(c.file.version);
  return c.at.some(({ i }) => positions[i].stays(from));
}
function* shrinkOverflowed(c: Overflowed): Iterable<Overflowed> {
  if (c.inBundle) yield { ...c, inBundle: false };
  for (const at of shrinkArray(c.at)) yield { ...c, at };
  for (const key of ['stations', 'trains', 'track'])
    if ((c.file[key] as unknown[]).length > 0 && c.at.length === 0)
      yield { ...c, file: { ...c.file, [key]: [] } };
}
/** Every number a list shows of a save is finite. */
function expectFiniteMeta(meta: SlotMeta, label: string) {
  for (const k of ['savedAt', 'version', 'seed', 'day', 'age', 'money'] as const)
    expect(Number.isFinite(meta[k]), `${label}: ${k} is ${meta[k]}`).toBe(true);
}

describe('readSaveText, for a file with overflowing number literals', () => {
  it('refuses as damaged exactly the texts whose save would hold one, and the rest can be stored', () => {
    forAll(
      genOverflowed,
      (c) => {
        const text = textOf(c);
        const read = readSaveText(text);
        const refused = stillHolds(c);
        if (refused) {
          expect(read).toEqual({ error: 'damaged' });
          return;
        }
        if (!('save' in read)) throw new Error(`refused as ${read.error}`);
        expect(firstNonFinite(read.save)).toBeNull();
        const store = stubStorage();
        expect(writeSave(read.save), 'stored again').toBe(true);
        const again = readSaveText(store.items.get(SAVE_KEY)!);
        expect('save' in again && asStored(again.save), 'read back').toEqual(asStored(read.save));
      },
      { shrink: shrinkOverflowed },
    );
  });

  it('is imported only when it loads: a refused one is damaged, stores nothing and asks no storage', () => {
    forAll(
      genOverflowed,
      (c) => {
        const text = textOf(c);
        const store = stubStorage(storedBefore());
        const before = new Map(store.items);
        const r = importSave(text);
        if (stillHolds(c)) {
          expect(r).toEqual({ ok: false, error: 'damaged' });
          expect(store.writes).toBe(0);
          expect(store.items).toEqual(before);
        } else {
          expect(r.ok).toBe(true);
          expect(store.writes).toBe(1);
        }
      },
      { shrink: shrinkOverflowed },
    );
  });

  it('is listed as a damaged named save, and Continue offers none, every number shown finite', () => {
    forAll(
      genOverflowed,
      (c) => {
        const text = textOf(c);
        const refused = stillHolds(c);
        const store = stubStorage({
          [SAVE_KEY]: text,
          [SLOTS_KEY]: JSON.stringify({ kept: text }),
        });
        const meta = continueMeta();
        expect(meta === null, 'Continue offers none').toBe(refused);
        if (meta) expectFiniteMeta(meta, 'Continue');
        const listed = listSlots();
        expect(
          listed.map((m) => m.name),
          'listed, so it can be deleted',
        ).toEqual(['kept']);
        expectFiniteMeta(listed[0], 'the list');
        expect(readSlot('kept') === null, 'loads').toBe(refused);
        expect(store.writes).toBe(0);
      },
      { shrink: shrinkOverflowed },
    );
  });
});

// ------------------------------------------------------------------ station turns

describe('station turns, repaired on read', () => {
  it('are one of the four, the turn the station loaded at, on the tiles it stands on', () => {
    forAll(
      (rng) => ({ file: genFile(rng), inBundle: rng.chance(0.2) }),
      ({ file, inBundle }) => {
        const before = asStored(file) as Record<string, unknown>;
        const text = JSON.stringify(
          inBundle ? { diagnostics: 1, saveVersion: SAVE_VERSION, save: file } : file,
        );
        const read = readSaveText(text);
        if (!('save' in read)) throw new Error(`refused as ${read.error}`);
        const was = before.stations as unknown[];
        const now = read.save.stations as unknown[];
        expect(now).toHaveLength(was.length);
        now.forEach((s, i) => {
          const label = `station ${i}: ${JSON.stringify(was[i])}`;
          if (!isObject(was[i])) {
            expect(s, `${label}: no record, left as it was`).toEqual(was[i]);
            return;
          }
          const held = was[i] as unknown as StationJSON;
          const record = s as StationJSON;
          const loaded = Station.fromJSON(asStored(held) as StationJSON);
          expect(Number.isInteger(record.rot), label).toBe(true);
          expect([0, 1, 2, 3], label).toContain(record.rot);
          expect(record.rot, `${label}: the turn it loaded at`).toBe(loaded.rot);
          const tiles = (list: { x: number; y: number }[]) =>
            list.map((t) => `${t.x},${t.y}`).sort();
          expect(
            tiles(stationFootprint(held.defId, held.x, held.y, record.rot!)),
            `${label}: the ground cleared is the ground it stands on`,
          ).toEqual(tiles(loaded.footprint()));
          expect(tiles(Station.fromJSON(asStored(record) as StationJSON).footprint())).toEqual(
            tiles(loaded.footprint()),
          );
        });
        // read again from what the first read gave, nothing changes
        const again = readSaveText(JSON.stringify(read.save));
        expect('save' in again && asStored(again.save), 'read again').toEqual(asStored(read.save));
      },
      {
        shrink: function* (c) {
          if (c.inBundle) yield { ...c, inBundle: false };
          for (const stations of shrinkArray(c.file.stations as unknown[]))
            yield { ...c, file: { ...c.file, stations } };
        },
      },
    );
  });

  it('cover what the station covers, for every kind and any turn a file holds', () => {
    // The issue's own list, each in a file of this version and of the oldest.
    const held: unknown[] = [0.5, '1', true, null, -1, 5, undefined, 0, 1, 2, 3, 1.5, '3', 4];
    for (const version of [SAVE_MIN_VERSION, 7, SAVE_VERSION])
      for (const def of STATION_DEFS)
        for (const rot of held) {
          const label = `v${version} ${def.id} turned ${JSON.stringify(rot)}`;
          const s: Record<string, unknown> = {
            id: 1,
            defId: def.id,
            name: 'A',
            x: 5,
            y: 6,
            level: 1,
            storage: {},
          };
          if (rot !== undefined) s.rot = rot;
          const file = {
            ...(asStored(fullSaveOnce()) as Record<string, unknown>),
            version,
            stations: [s],
          };
          const read = readSaveText(JSON.stringify(file));
          if (!('save' in read)) throw new Error(`${label}: refused as ${read.error}`);
          const record = read.save.stations[0];
          const loaded = Station.fromJSON(asStored(s) as StationJSON);
          expect(record.rot, label).toBe(loaded.rot);
          expect(stationFootprint(def.id, 5, 6, record.rot!), label).toEqual(loaded.footprint());
        }
  });
});

describe('a save the game wrote', () => {
  it('reads back exactly as it was written', () => {
    // stations from Station.toJSON at any turn, level and work; the rest as the full save has it
    forAll(
      (rng) =>
        Array.from({ length: rng.int(0, 5) }, () => ({
          defId: rng.pick(DEF_IDS),
          x: rng.int(0, 60),
          y: rng.int(0, 60),
          rot: rng.int(0, 3),
          level: rng.int(1, 6),
          working: rng.chance(0.4),
        })),
      (list) => {
        const stations = list.map((c) => {
          const s = new Station(c.defId, c.x, c.y);
          s.rot = c.rot;
          s.level = c.level;
          if (c.working && c.level < 6 && !s.def.depot)
            s.work = { to: c.level + 1, left: 12.5, total: 60 };
          return s.toJSON();
        });
        const parts = { ...(fullSaveOnce() as unknown as SaveParts), stations };
        const text = JSON.stringify(buildSave(parts, { modData: { a: 1 } }, 5000));
        expect(readSaveText(text)).toEqual({ save: JSON.parse(text) as SaveGame });
      },
      { shrink: (list) => shrinkArray(list) },
    );
  });
});

// ------------------------------------------------------------------ a real game

describe("a real game's save", () => {
  it(
    'is never refused for a broken number while the game runs, and reads back as written',
    { timeout: 120_000 },
    () => {
      forAll(
        (rng) => ({
          seed: rng.int(1, 2 ** 31 - 2),
          daySeconds: rng.pick([240, rng.int(20, 120)]),
          weather: rng.chance(0.7),
          steps: rng.int(600, 1500),
          speeds: Array.from({ length: rng.int(1, 6) }, () => rng.int(1, 3)),
        }),
        (c) => {
          Object.assign(rules, DEFAULT_RULES);
          rules.daySeconds = c.daySeconds;
          setSeasonOffset(0);
          const w = simWorld({ seed: c.seed });
          const { train, depot } = build(w);
          const step = new SimStep(w);
          const ctx = context(w, c.weather);
          const camera = { x: depot.x * 32, y: depot.y * 16, zoomIndex: 2 };
          let done = 0;
          let upgrading = 0;
          let checks = 0;
          const store = stubStorage();
          for (let tick = 0; done < c.steps; tick++) {
            w.clock.setSpeed(Math.min(c.speeds[tick % c.speeds.length], c.steps - done));
            w.clock.run((gdt) => {
              step.run(gdt, ctx);
              done++;
            });
            if (tick % 40 !== 0 && done < c.steps) continue;
            const save = buildSave(partsOf(w, step, camera), {}, 1_700_000_000_000 + done);
            const label = `seed ${c.seed}, step ${done}`;
            expect(firstNonFinite(save), label).toBeNull();
            expect(writeSave(save), `${label}: stored`).toBe(true);
            const text = store.items.get(SAVE_KEY)!;
            expect(text, label).toBe(JSON.stringify(save));
            expect(readSaveText(text), `${label}: read back`).toEqual({ save: JSON.parse(text) });
            checks++;
            if (w.builder.stations.some((s) => s.work)) upgrading++;
          }
          // not vacuous: the train ran and some saves were taken with the upgrade under way
          expect(train.distance, `seed ${c.seed}: tiles run`).toBeGreaterThan(0);
          expect(upgrading, `seed ${c.seed}: saves with an upgrade under way`).toBeGreaterThan(0);
          expect(checks).toBeGreaterThan(5);
        },
        {
          seeds: [1, 2, 3, 4],
          shrink: (c) => [...shrinkInt(c.steps, 1)].map((steps) => ({ ...c, steps })),
        },
      );
    },
  );
});
