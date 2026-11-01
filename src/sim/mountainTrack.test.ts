import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyMap, generateMap } from '../world/mapgen';
import { Terrain, TERRAIN_NAMES, type GameMap } from '../world/tiles';
import { RegionState } from '../world/regions';
import {
  TRACK_ITEMS,
  TrackGraph,
  footprintOf,
  pieceCost,
  portClass,
  rotationCount,
  type TrackClass,
  type TrackItem,
} from '../world/track';
import { levelAt, tileLevels } from '../world/elevation';
import { groundAllowsOn } from '../world/slope';
import { lineSpans, railProfile, CLIMB_SPEED } from '../world/railProfile';
import { Dir, DIR_DX, DIR_DY, opposite } from '../engine/iso';
import { Rng } from '../engine/rng';
import { content, type Cost } from '../data/content';
import trackData from '../data/track.json';
import { forAll } from '../testing/property';
import { BIOME_DEFS } from './biomes';
import { Builder, DECOR_DEFS, type LinePiece } from './build';
import { BUILDING_DEFS } from './buildings';
import { Catenary } from './catenary';
import { Economy } from './economy';
import { Fleet } from './fleet';
import { STATION_DEFS, Station, resetStationIds } from './stations';
import { Train, resetTrainIds, type TickCtx } from './trains';
import { setSupplyMode } from './supply';
import { Inventory } from '../gacha/inventory';
import { rules, DEFAULT_RULES } from './rules';
import { STR } from '../strings';
import { applyTileRepairs, repairBuiltTiles, type BuiltObjects } from '../engine/loadRepair';
import { onRails } from './mountainTrack';
import { storeWith } from '../testing/storeFixtures';

/** An economy in the Electric Age: Main and Trunk Line are open. */
const electricAge = () => Object.assign(new Economy(), { tier: 2 });

// Track on rock and mountain (#322): a piece goes there only as the continuation of a line, the
// slope rule of the ground decides the rest as anywhere, and it is priced at the terrain's price
// times the biome's. Ground is asked through the simulation's own slope rule (`groundAllowsOn`).

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));
beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
  setSupplyMode('simple');
  resetStationIds(1);
  resetTrainIds(1);
});

/** The Mountain biome's id: appended after Lake 6, River 7 and Beach 8. */
const MOUNTAIN_BIOME = 9;
const RES = ['wood', 'stone', 'iron'];
const SIZE = 40;
const STONE = [Terrain.Rock, Terrain.Mountain] as const;
const name = (t: Terrain) => TERRAIN_NAMES[t];

/**
 * Grass with a stone field in the Mountain biome: Rock from 8 to 31 on both axes, Mountain from 10
 * to 29 inside it. Rock is level 0; the Mountain rises a level a tile from 1 at its rim to 4 three
 * tiles in, so its sides are banks and 14 to 25 on both axes is a level-4 plateau. Every chunk is
 * owned and the stock is ample; the ground is asked through the slope rule.
 */
function field(free = false) {
  const map = emptyMap(4242, SIZE, SIZE, Terrain.Grass),
    track = new TrackGraph(SIZE, SIZE),
    { stores, depot: stock } = storeWith({}, { x: SIZE / 2, y: SIZE / 2 });
  for (let y = 8; y < 32; y++)
    for (let x = 8; x < 32; x++) {
      const inner = x >= 10 && x < 30 && y >= 10 && y < 30;
      map.terrain[y * SIZE + x] = inner ? Terrain.Mountain : Terrain.Rock;
      map.biome[y * SIZE + x] = MOUNTAIN_BIOME;
    }
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  const builder = new Builder(map, regions, track, electricAge(), stores);
  builder.free = free;
  builder.groundCheck = (x, y, need) => groundAllowsOn(map, x, y, need);
  for (const k of RES) stock.amounts.set(k, 1e6);
  return { map, track, builder, stock };
}
type Field = ReturnType<typeof field>;

/** A rock tile, level ground; a rock tile at the foot of the mountain; a mountain bank; a plateau. */
const ROCK = { x: 8, y: 20 };
const FOOT = { x: 9, y: 20 };
const BANK = { x: 11, y: 20 };
const PLATEAU = { x: 20, y: 20 };

/** A straight's turn along an axis: 1 runs east-west, 0 north-south. */
const along = (d: Dir) => (d === Dir.E || d === Dir.W ? 1 : 0);
const ew = (x: number, y: number, cls: TrackClass = 'branch'): LinePiece => ({
  kind: 'track',
  x,
  y,
  item: { kind: 'straight', cls },
  rot: 1,
});
/** East-west straights from x0 to x1 on row y, in that order (x1 may be below x0). */
const run = (x0: number, x1: number, y: number) =>
  Array.from({ length: Math.abs(x1 - x0) + 1 }, (_, i) => ew(x0 + i * Math.sign(x1 - x0 || 1), y));

/** Each open end of a piece: the footprint tile it leaves, the way out, the class it presents. */
function ports(x: number, y: number, item: TrackItem, rot: number) {
  const probe = new TrackGraph(SIZE, SIZE);
  probe.place(x, y, item.kind, rot, item.cls, item.cls2);
  const tiles = footprintOf(x, y, item.kind, rot, item.cls);
  const inside = (px: number, py: number) => tiles.some((t) => t.x === px && t.y === py);
  const out: { x: number; y: number; d: Dir; cls: TrackClass }[] = [];
  for (const t of tiles) {
    const p = probe.get(t.x, t.y)!;
    for (const link of p.links)
      for (const d of link)
        if (!inside(t.x + DIR_DX[d], t.y + DIR_DY[d]))
          out.push({ x: t.x, y: t.y, d, cls: portClass(p, d) });
  }
  return out;
}
/**
 * Stand a straight of the port's class on the tile beyond every open end of the piece, running
 * into it, so that every end joins a line (set straight into the graph: no rule asked).
 */
function joinEveryEnd(w: Field, x: number, y: number, item: TrackItem, rot: number) {
  for (const p of ports(x, y, item, rot)) {
    const nx = p.x + DIR_DX[p.d],
      ny = p.y + DIR_DY[p.d];
    if (w.track.has(nx, ny)) continue;
    w.track.place(nx, ny, 'straight', along(p.d), p.cls);
  }
}
/** Every piece of the palette (`TRACK_ITEMS`, which has no bridge piece), at every turn. */
const PIECES = TRACK_ITEMS.flatMap((item) =>
  Array.from({ length: rotationCount(item.kind) }, (_, rot) => ({ item, rot })),
);
const what = (item: TrackItem, rot: number) =>
  `${item.kind} ${item.cls}${item.cls2 ? `/${item.cls2}` : ''} turned ${rot}`;

/** The list price × terrain × biome × build cost, each resource rounded up, in whole hundredths. */
function priceIn(list: Cost, terrain: number, biome: number): Cost {
  const h = (v: number) => Math.round(v * 100);
  const out: Cost = {};
  for (const [k, v] of Object.entries(list))
    out[k] = Math.ceil((v * h(terrain) * h(biome) * h(rules.buildCostMul)) / 1e6);
  return out;
}

describe('the fixture', () => {
  it('has level rock, a bank and a plateau where the tests use them', () => {
    const { map } = field();
    expect(levelAt(map, ROCK.x, ROCK.y)).toBe(0);
    expect(groundAllowsOn(map, ROCK.x, ROCK.y, 'level')).toBe(true);
    // the bank: its four sides at three levels
    const sides = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].map(([dx, dy]) => levelAt(map, BANK.x + dx, BANK.y + dy));
    expect(new Set(sides).size).toBeGreaterThan(1);
    expect(groundAllowsOn(map, BANK.x, BANK.y, 'level')).toBe(false);
    for (let y = 14; y <= 25; y++)
      for (let x = 14; x <= 25; x++) {
        expect(levelAt(map, x, y)).toBe(4);
        expect(groundAllowsOn(map, x, y, 'level'), `${x},${y}`).toBe(true);
      }
  });
});

describe('a piece on rock or a mountain', () => {
  it('is refused with the mountain reason when none of its ends joins a line', () => {
    expect(STR.build.mountainLine).toBe('Mountain track must continue an existing line');
    // the editor too: it skips prices and locks, not this rule
    for (const free of [false, true])
      for (const at of [ROCK, FOOT, BANK, PLATEAU])
        for (const { item, rot } of PIECES) {
          const w = field(free);
          const c = w.builder.checkTrack(at.x, at.y, item, rot);
          const where = `${what(item, rot)} at ${at.x},${at.y}${free ? ' in the editor' : ''}`;
          expect(c, where).toMatchObject({ ok: false, reason: STR.build.mountainLine });
          expect(w.builder.placeTrack(at.x, at.y, item, rot), where).toBe(false);
          expect(w.track.pieces.size, where).toBe(0);
        }
  });

  it('is a wide piece with any of its tiles on stone, wherever its anchor stands', () => {
    let met = 0;
    for (const { item, rot } of PIECES) {
      const tilesAt = (x: number) => footprintOf(x, ROCK.y, item.kind, rot, item.cls);
      // the anchor on the grass west of the rock field, the rest of the piece reaching onto it
      const ax = [4, 5, 6, 7].find((x) => tilesAt(x).some((t) => t.x >= ROCK.x));
      if (ax === undefined || tilesAt(ax).length === 1) continue;
      const where = `${what(item, rot)} at ${ax},${ROCK.y}`;
      const w = field(true);
      expect(w.map.terrain[ROCK.y * SIZE + ax], where).toBe(Terrain.Grass);
      expect(tilesAt(ax).some((t) => w.map.terrain[t.y * SIZE + t.x] === Terrain.Rock)).toBe(true);
      expect(w.builder.checkTrack(ax, ROCK.y, item, rot), where).toMatchObject({
        ok: false,
        reason: STR.build.mountainLine,
      });
      // continuing a line, it is laid
      joinEveryEnd(w, ax, ROCK.y, item, rot);
      const c = w.builder.checkTrack(ax, ROCK.y, item, rot);
      expect(c.ok, `${where}: ${c.reason}`).toBe(true);
      met++;
    }
    // the Branch Line curves and switches, in their turns
    expect(met).toBeGreaterThan(8);
  });

  it('is refused beside track that runs past it: a neighbour must open back toward it', () => {
    for (const t of STONE)
      for (const cls of ['branch', 'narrow'] as const) {
        const w = field();
        const at = t === Terrain.Rock ? FOOT : PLATEAU;
        expect(w.map.terrain[at.y * SIZE + at.x]).toBe(t);
        // a north-south straight west of it, and an east-west straight north of it, both of the
        // class: each touches the tile, neither opens toward an end of an east-west straight
        w.track.place(at.x - 1, at.y, 'straight', 0, cls);
        w.track.place(at.x, at.y - 1, 'straight', 1, cls);
        expect(w.builder.hasAdjacentTrack(at.x, at.y)).toBe(true);
        const item: TrackItem = { kind: 'straight', cls };
        const c = w.builder.checkTrack(at.x, at.y, item, 1);
        expect(c, `${cls} on ${name(t)}`).toMatchObject({
          ok: false,
          reason: STR.build.mountainLine,
        });
        // and a north-south straight there meets the east-west one north of it side on: refused
        expect(w.builder.checkTrack(at.x, at.y, item, 0).reason).toBe(STR.build.mountainLine);
        // with a straight running into it, it joins
        w.track.place(at.x + 1, at.y, 'straight', 1, cls);
        expect(w.builder.checkTrack(at.x, at.y, item, 1).ok, `${cls} on ${name(t)}`).toBe(true);
      }
  });

  it('continuing a straight, costs the list price × the terrain × the biome, never 0', () => {
    const terrainCost = trackData.terrainCost as Record<string, number>;
    // the author's prices (#322) and the Mountain biome's multiplier (#352)
    expect(terrainCost.rock).toBe(1.35);
    expect(terrainCost.mountain).toBe(1.65);
    expect(BIOME_DEFS[MOUNTAIN_BIOME].id).toBe('mountain');
    expect(BIOME_DEFS[MOUNTAIN_BIOME].trackCostMul).toBe(1.5);
    for (const buildCost of [1, 0.35, 2.5])
      for (const cls of ['branch', 'narrow'] as const)
        for (const [t, at] of [
          [Terrain.Rock, FOOT],
          [Terrain.Mountain, PLATEAU],
        ] as const) {
          Object.assign(rules, DEFAULT_RULES, { buildCostMul: buildCost });
          const w = field();
          w.track.place(at.x - 1, at.y, 'straight', 1, cls);
          const item: TrackItem = { kind: 'straight', cls };
          const list = pieceCost('straight', cls);
          const c = w.builder.checkTrack(at.x, at.y, item, 1);
          const where = `${cls} on ${name(t)}, build cost ×${buildCost}`;
          expect(c.ok, `${where}: ${c.reason}`).toBe(true);
          expect(c.cost, where).toEqual(priceIn(list, terrainCost[name(t)], 1.5));
          for (const k of Object.keys(list)) expect(c.cost[k], `${where}: ${k}`).toBeGreaterThan(0);
          // outside the Mountain biome, the terrain's price alone
          w.map.biome[at.y * SIZE + at.x] = 0;
          expect(w.builder.checkTrack(at.x, at.y, item, 1).cost, where).toEqual(
            priceIn(list, terrainCost[name(t)], 1),
          );
        }
    // a Branch Line straight at the default build cost, in numbers: wood 2, stone 2, iron 1 listed
    Object.assign(rules, DEFAULT_RULES);
    const w = field();
    w.track.place(FOOT.x - 1, FOOT.y, 'straight', 1);
    w.track.place(PLATEAU.x - 1, PLATEAU.y, 'straight', 1);
    const straight: TrackItem = { kind: 'straight', cls: 'branch' };
    expect(pieceCost('straight')).toEqual({ wood: 2, stone: 2, iron: 1 });
    // 2 × 1.35 × 1.5 = 4.05, 1 × 2.025; 2 × 1.65 × 1.5 = 4.95, 1 × 2.475: rounded up
    expect(w.builder.checkTrack(FOOT.x, FOOT.y, straight, 1).cost).toEqual({
      wood: 5,
      stone: 5,
      iron: 3,
    });
    expect(w.builder.checkTrack(PLATEAU.x, PLATEAU.y, straight, 1).cost).toEqual({
      wood: 5,
      stone: 5,
      iron: 3,
    });
  });

  it('with every end joined, takes every piece where the ground takes it, at the stone price', () => {
    const terrainCost = trackData.terrainCost as Record<string, number>;
    let level = 0,
      bank = 0;
    for (const at of [ROCK, BANK, PLATEAU])
      for (const { item, rot } of PIECES) {
        const w = field();
        joinEveryEnd(w, at.x, at.y, item, rot);
        const tiles = footprintOf(at.x, at.y, item.kind, rot, item.cls);
        const c = w.builder.checkTrack(at.x, at.y, item, rot);
        const where = `${what(item, rot)} at ${at.x},${at.y}`;
        const climbs = item.kind === 'straight' || item.kind === 'crossing';
        const levelGround = tiles.every((t) => groundAllowsOn(w.map, t.x, t.y, 'level'));
        if (climbs || levelGround) {
          expect(c.ok, `${where}: ${c.reason}`).toBe(true);
          const mul = Math.max(
            ...tiles.map((t) => terrainCost[name(w.map.terrain[t.y * SIZE + t.x] as Terrain)]),
          );
          expect(c.cost, where).toEqual(
            priceIn(pieceCost(item.kind, item.cls, item.cls2), mul, 1.5),
          );
          level++;
        } else {
          // curves and switches on a bank: the ground's refusal, as on a hill
          expect(c, where).toMatchObject({ ok: false, reason: STR.build.notSmooth });
          bank++;
        }
      }
    expect(level).toBeGreaterThan(30);
    expect(bank).toBeGreaterThan(10);
  });

  it('a curve or switch of every class: refused on a bank, taken on the plateau', () => {
    for (const { item, rot } of PIECES) {
      if (item.kind !== 'curve' && item.kind !== 'switch') continue;
      const bank = field();
      joinEveryEnd(bank, BANK.x, BANK.y, item, rot);
      expect(bank.builder.checkTrack(BANK.x, BANK.y, item, rot), what(item, rot)).toMatchObject({
        ok: false,
        reason: STR.build.notSmooth,
      });
      const plateau = field();
      joinEveryEnd(plateau, PLATEAU.x, PLATEAU.y, item, rot);
      const c = plateau.builder.checkTrack(PLATEAU.x, PLATEAU.y, item, rot);
      expect(c.ok, `${what(item, rot)}: ${c.reason}`).toBe(true);
      expect(plateau.builder.placeTrack(PLATEAU.x, PLATEAU.y, item, rot), what(item, rot)).toBe(
        true,
      );
    }
  });
});

describe('a line onto the mountain', () => {
  /** The world a line may change, by value. */
  const snapshot = (w: Field) =>
    JSON.stringify({
      track: [...w.track.pieces.entries()],
      stock: RES.map((k) => w.stock.get(k)),
    });

  it('drawn from a line end, lays all five mountain pieces; from the far end, none', () => {
    for (const cls of ['branch', 'narrow'] as const) {
      const w = field();
      // up from the grass to the end of a line on the rock at the mountain's foot
      const foot = run(4, 9, 20).map(
        (p) => ({ ...p, item: { kind: 'straight', cls } }) as LinePiece,
      );
      expect(w.builder.placeLine(foot), cls).toBe(true);
      // five mountain tiles, climbing a level each: 1, 2, 3, 4, 4
      const up = run(10, 14, 20).map(
        (p) => ({ ...p, item: { kind: 'straight', cls } }) as LinePiece,
      );
      expect(up.map((p) => levelAt(w.map, p.x, p.y))).toEqual([1, 2, 3, 4, 4]);
      for (const p of up) expect(w.map.terrain[p.y * SIZE + p.x]).toBe(Terrain.Mountain);
      const down = [...up].reverse();

      // the far end first: its first piece joins nothing, so nothing is laid or paid
      const before = snapshot(w);
      const refused = w.builder.checkLine(down);
      expect(refused, cls).toMatchObject({ ok: false, at: 0, reason: STR.build.mountainLine });
      expect(w.builder.placeLine(down)).toBe(false);
      expect(snapshot(w)).toBe(before);

      // from the line end: every piece joins the one before it
      const c = w.builder.checkLine(up);
      expect(c.ok, `${cls}: ${c.reason}`).toBe(true);
      expect(c.steps.every((s) => s.ok && !s.skip)).toBe(true);
      const sum: Cost = {};
      for (const s of c.steps)
        for (const [k, v] of Object.entries(s.cost)) sum[k] = (sum[k] ?? 0) + v;
      expect(c.cost).toEqual(sum);
      const held = RES.map((k) => w.stock.get(k));
      expect(w.builder.placeLine(up)).toBe(true);
      for (const p of up) expect(w.track.get(p.x, p.y)?.kind, `${cls} at ${p.x}`).toBe('straight');
      expect(RES.map((k, i) => held[i] - w.stock.get(k))).toEqual(RES.map((k) => sum[k] ?? 0));
      // and the far end, drawn again now that the line stands, is laid already: skipped, free
      expect(w.builder.checkLine(down)).toMatchObject({ ok: true, cost: {} });
    }
  });

  it('from the grass, a line may run on across rock and up the mountain', () => {
    const w = field();
    const line = run(2, 16, 20);
    const c = w.builder.checkLine(line);
    expect(c.ok, c.reason).toBe(true);
    expect(w.builder.placeLine(line)).toBe(true);
    expect(w.track.pieces.size).toBe(15);
  });
});

describe('what stays off rock and mountain', () => {
  it('the bridge piece, platforms, stations, decor off the track, works and power poles', () => {
    for (const t of STONE) {
      const at = t === Terrain.Rock ? FOOT : PLATEAU;
      const named = STR.build.nothingOn[name(t) as 'rock' | 'mountain'];
      const w = field(true);
      // a joined line runs over the tile
      w.track.place(at.x - 1, at.y, 'straight', 1);
      const bridgePiece = w.builder.checkTrack(at.x, at.y, { kind: 'bridge', cls: 'branch' }, 1);
      expect(bridgePiece, `bridge piece on ${name(t)}`).toMatchObject({
        ok: false,
        reason: STR.build.bridgeOnWater,
      });
      // beside the line: every station, works, platform and decor off the track
      const beside = { x: at.x, y: at.y + 1 };
      for (const d of STATION_DEFS)
        expect(w.builder.checkStation(beside.x, beside.y, d.id).reason, d.id).toBe(named);
      for (const d of BUILDING_DEFS)
        expect(w.builder.checkBuilding(beside.x, beside.y, d.id).reason, d.id).toBe(named);
      for (const d of DECOR_DEFS)
        if (!d.onTrack || d.anyTile)
          expect(w.builder.checkDecor(beside.x, beside.y, d.id).reason, d.id).toBe(named);
      // on the line itself: platforms and power poles still not
      expect(w.builder.placeTrack(at.x, at.y, { kind: 'straight', cls: 'branch' }, 1)).toBe(true);
      for (const d of BUILDING_DEFS.filter((b) => b.bridge))
        expect(w.builder.checkBuilding(at.x, at.y, d.id).reason, `${d.id} under the rail`).toBe(
          named,
        );
      expect(w.builder.checkDecor(at.x, at.y, 'power_line').reason).toBe(named);
    }
  });

  it('signals and electrification stand on mountain track, as on any track', () => {
    for (const t of STONE) {
      const at = t === Terrain.Rock ? FOOT : PLATEAU;
      const w = field(true);
      w.builder.catenary = new Catenary(w.map);
      w.track.place(at.x - 1, at.y, 'straight', 1);
      expect(w.builder.placeTrack(at.x, at.y, { kind: 'straight', cls: 'branch' }, 1)).toBe(true);
      expect(w.builder.checkDecor(at.x, at.y, 'signal'), name(t)).toMatchObject({ ok: true });
      expect(w.builder.placeDecor(at.x, at.y, 'signal', 1), name(t)).not.toBeNull();
      expect(w.builder.checkSupply(at.x, at.y, 'catenary'), name(t)).toMatchObject({ ok: true });
      expect(w.builder.placeSupply(at.x, at.y, 'catenary'), name(t)).toBe(true);
    }
  });
});

describe('a load', () => {
  /** What the builder holds, as a save holds it. */
  const builtOf = (w: Field): BuiltObjects => ({
    track: [...w.track.anchors()].map(({ x, y, piece: p }) => [x, y, p.kind, p.rot, p.cls, p.cls2]),
    stations: [],
    decor: [...w.builder.decor.values()].map((d) => [d.x, d.y, d.id, d.rot]),
    buildings: [],
  });
  /** Repair the field as a load does: the answer, then the terrain and the levels after it. */
  const load = (w: Field) => {
    const repairs = repairBuiltTiles(w.map, builtOf(w));
    applyTileRepairs(w.map, repairs);
    return { repairs, terrain: [...w.map.terrain], levels: [...tileLevels(w.map)] };
  };

  it('keeps the rock and mountain under a line the builder laid, and a signal on it', () => {
    const w = field(true);
    expect(w.builder.placeLine(run(4, 16, 20))).toBe(true);
    // a signal on the rock at the mountain's foot and one on the plateau
    for (const x of [FOOT.x, 15])
      expect(w.builder.placeDecor(x, 20, 'signal', 1), `signal at ${x}`).not.toBeNull();
    const terrain = [...w.map.terrain],
      levels = [...tileLevels(w.map)];
    expect(load(w)).toEqual({ repairs: [], terrain, levels });
    for (let x = 8; x <= 16; x++) expect(STONE).toContain(w.map.terrain[20 * SIZE + x]);
  });

  it('keeps it under a piece left alone when the track around it goes', () => {
    const w = field(true);
    expect(w.builder.placeLine(run(4, 16, 20))).toBe(true);
    // the bank's piece, with its neighbours gone: one the builder would not lay there again
    expect(w.builder.removeTrack(BANK.x - 1, BANK.y)).toBe(true);
    expect(w.builder.removeTrack(BANK.x + 1, BANK.y)).toBe(true);
    expect(w.track.get(BANK.x, BANK.y)?.kind).toBe('straight');
    expect(
      w.builder.checkTrack(BANK.x, BANK.y, { kind: 'straight', cls: 'branch' }, 1).reason,
    ).toBe(STR.build.mountainLine);
    const terrain = [...w.map.terrain],
      levels = [...tileLevels(w.map)];
    expect(load(w)).toEqual({ repairs: [], terrain, levels });
    expect(w.map.terrain[BANK.y * SIZE + BANK.x]).toBe(Terrain.Mountain);
  });
});

describe('decor on the rails', () => {
  it('is the decor that needs track under it and asks nothing of the ground', () => {
    for (const d of DECOR_DEFS) expect(onRails(d.id), d.id).toBe(d.onTrack && !d.anyTile);
    expect(onRails('signal')).toBe(true);
    expect(onRails('no such decor')).toBe(false);
  });
});

// ---------------------------------------------------------------- generated mountains

/** A track piece of a line (the lines here have no platforms). */
type LineRail = Extract<LinePiece, { kind: 'track' }>;

interface LineCase {
  seed: number;
  size: number;
  rockLevel: number;
  /** the stream the lines are picked from */
  pick: number;
}
const genLineCase = (rng: Rng): LineCase => ({
  seed: rng.int(0, 2 ** 31 - 1),
  size: rng.int(48, 96),
  // low rock levels make big stone fields
  rockLevel: rng.int(50, 62) / 100,
  pick: rng.int(0, 2 ** 31 - 1),
});
function* shrinkLineCase(c: LineCase): Iterable<LineCase> {
  if (c.size > 48) yield { ...c, size: 48 };
  if (c.rockLevel !== 0.5) yield { ...c, rockLevel: 0.5 };
}

describe('mountain lines on generated maps', () => {
  const tally = { accepted: 0, climbing: 0, refused: 0, maps: 0 };

  /**
   * Lines drawn up a generated map's mountains: from the first tile off the stone below a mountain
   * tile, or now and then from a stone tile, straight on for 2 to 14 tiles. Each is laid when the
   * builder takes it, so later lines meet earlier ones.
   */
  function lines(map: GameMap, rng: Rng) {
    const mountains: number[] = [];
    for (let i = 0; i < map.w * map.h; i++)
      if (map.terrain[i] === Terrain.Mountain) mountains.push(i);
    const out: LineRail[][] = [];
    if (!mountains.length) return out;
    const stone = (x: number, y: number) =>
      x >= 0 &&
      y >= 0 &&
      x < map.w &&
      y < map.h &&
      STONE.includes(map.terrain[y * map.w + x] as never);
    for (let n = 0; n < 24; n++) {
      const m = rng.pick(mountains),
        d = rng.pick([Dir.N, Dir.E, Dir.S, Dir.W]);
      let x = m % map.w,
        y = Math.floor(m / map.w);
      // walk back down to the foot, or stop on the stone
      if (!rng.chance(0.25))
        while (stone(x, y)) {
          x -= DIR_DX[d];
          y -= DIR_DY[d];
        }
      const pieces: LineRail[] = [];
      for (let i = rng.int(2, 14); i > 0; i--, x += DIR_DX[d], y += DIR_DY[d])
        if (x >= 0 && y >= 0 && x < map.w && y < map.h)
          pieces.push({
            kind: 'track',
            x,
            y,
            item: { kind: 'straight', cls: 'branch' },
            rot: along(d),
          });
      out.push(pieces);
    }
    return out;
  }

  it('lays only lines whose stone pieces continue a line, climbing at most a level a tile', () => {
    forAll(
      genLineCase,
      (c) => {
        const map = generateMap(c.seed, { w: c.size, h: c.size, rockLevel: c.rockLevel });
        // one store, in reach of the whole map
        rules.buildReach = map.w;
        const track = new TrackGraph(map.w, map.h),
          { stores, depot: stock } = storeWith({}),
          regions = new RegionState(map);
        for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
        const builder = new Builder(map, regions, track, electricAge(), stores);
        builder.groundCheck = (x, y, need) => groundAllowsOn(map, x, y, need);
        for (const k of RES) stock.amounts.set(k, 1e9);
        const rng = new Rng(c.pick);
        const onStone = (p: LinePiece) => STONE.includes(map.terrain[p.y * map.w + p.x] as never);
        let any = false;
        for (const line of lines(map, rng)) {
          if (!line.some(onStone)) continue;
          any = true;
          const first = line[0];
          // the first piece on the stone joins track standing before the line, or nothing does
          const joinedBefore =
            onStone(first) &&
            [Dir.N, Dir.E, Dir.S, Dir.W].some(
              (d) =>
                along(d) === first.rot &&
                track.opensTo(first.x + DIR_DX[d], first.y + DIR_DY[d], opposite(d)),
            );
          const check = builder.checkLine(line);
          if (!check.ok) {
            if (onStone(first) && !joinedBefore && !track.has(first.x, first.y))
              expect(check, 'a line starting on the stone, joining nothing').toMatchObject({
                at: 0,
                reason: STR.build.mountainLine,
              });
            if (check.reason === STR.build.mountainLine) {
              expect(check.at, 'only a first piece can join nothing').toBe(0);
              tally.refused++;
            }
            continue;
          }
          // a line that starts on the stone joined a line end there
          if (onStone(first) && !track.has(first.x, first.y)) expect(joinedBefore).toBe(true);
          expect(builder.placeLine(line)).toBe(true);
          tally.accepted++;
          const levels = line.map((p) => levelAt(map, p.x, p.y));
          for (let i = 1; i < levels.length; i++)
            expect(
              Math.abs(levels[i] - levels[i - 1]),
              `tile ${i} of the line`,
            ).toBeLessThanOrEqual(1);
          if (new Set(levels).size > 1) tally.climbing++;
          // the line's profile: no span changes more than a level per tile it covers
          for (const s of lineSpans(levels).spans)
            expect(Math.abs(s.b - s.a), JSON.stringify(s)).toBeLessThanOrEqual(
              s.to - s.from + 1e-9,
            );
        }
        // and the profile the game draws and runs on, over all the track laid
        for (const bed of railProfile(map, track).values())
          for (const s of [...bed.spans, ...(bed.cross?.spans ?? [])])
            expect(Math.abs(s.b - s.a), JSON.stringify(s)).toBeLessThanOrEqual(
              s.to - s.from + 1e-9,
            );
        if (any) tally.maps++;
      },
      { seeds: Array.from({ length: 30 }, (_, i) => i + 1), shrink: shrinkLineCase },
    );
    // not vacuous: mountains were met, lines were laid up them and climbed, and some were refused
    // (the 30 seeds give 29 maps with mountains, about 300 lines laid, 200 climbing, 300 refused)
    expect(tally.maps).toBeGreaterThan(20);
    expect(tally.accepted).toBeGreaterThan(150);
    expect(tally.climbing).toBeGreaterThan(100);
    expect(tally.refused).toBeGreaterThan(150);
  }, 60_000);
});

// ---------------------------------------------------------------- cliffs

describe('rail on the steps of generated ground', () => {
  /**
   * A generated level plane on grass: level 0 west of column 20 and `high` from it on, as
   * tileLevels settles it, the slope rule asked and nothing to pay. Rows 2 to 37 stand clear of
   * the map's border.
   */
  function cliff(high: number) {
    const map = emptyMap(4242, SIZE, SIZE, Terrain.Grass),
      raw = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < raw.length; i++) raw[i] = i % SIZE >= 20 ? high : 0;
    map.generatedLevel = tileLevels({ ...map, generatedLevel: raw });
    const track = new TrackGraph(SIZE, SIZE),
      regions = new RegionState(map);
    const builder = new Builder(map, regions, track, electricAge(), storeWith({}).stores);
    builder.free = true;
    builder.groundCheck = (x, y, need) => groundAllowsOn(map, x, y, need);
    expect(levelAt(map, 19, 20)).toBe(0);
    expect(levelAt(map, 20, 20)).toBe(high);
    return { map, track, builder };
  }
  const STRAIGHT: TrackItem = { kind: 'straight', cls: 'branch' };
  /** A north-south straight, as the cliff runs. */
  const ns = (x: number, y: number): LinePiece => ({
    kind: 'track',
    x,
    y,
    item: STRAIGHT,
    rot: 0,
  });

  it('a link across a step of 2 refuses, from either side', () => {
    const { builder } = cliff(2);
    expect(builder.placeTrack(19, 20, STRAIGHT, 1)).toBe(true);
    expect(builder.checkTrack(20, 20, STRAIGHT, 1)).toMatchObject({
      ok: false,
      reason: STR.build.tooSteep,
    });
    expect(builder.placeTrack(20, 22, STRAIGHT, 1)).toBe(true);
    expect(builder.checkTrack(19, 22, STRAIGHT, 1)).toMatchObject({
      ok: false,
      reason: STR.build.tooSteep,
    });
    expect(builder.placeTrack(19, 22, STRAIGHT, 1)).toBe(false);
  });

  it('a line stops on the first tile past the edge', () => {
    const { builder } = cliff(4);
    expect(builder.checkLine(run(16, 24, 20))).toMatchObject({
      ok: false,
      reason: STR.build.tooSteep,
      at: 4,
    });
    expect(builder.placeLine(run(16, 24, 20))).toBe(false);
    expect(builder.track.pieces.size).toBe(0);
  });

  it('a step of 1 is laid', () => {
    const { builder } = cliff(1);
    expect(builder.placeLine(run(16, 24, 20))).toBe(true);
  });

  it('a straight along a cliff is laid', () => {
    const { builder } = cliff(4);
    for (const x of [19, 20]) {
      const line = Array.from({ length: 8 }, (_, i) => ns(x, 16 + i));
      expect(builder.placeLine(line), `column ${x}`).toBe(true);
    }
  });

  it('a line may end at the foot or the top of a cliff, facing it', () => {
    const { builder } = cliff(4);
    expect(builder.placeLine(run(16, 19, 20))).toBe(true);
    expect(builder.placeLine(run(23, 20, 21))).toBe(true);
  });

  it('a link into a dug or cut tile ignores the step', () => {
    const { builder } = cliff(4);
    expect(builder.placeTrack(19, 20, STRAIGHT, 1)).toBe(true);
    builder.underground.dig(20, 20, 0);
    expect(builder.checkTrack(20, 20, STRAIGHT, 1).ok).toBe(true);
    expect(builder.placeTrack(19, 22, STRAIGHT, 1)).toBe(true);
    builder.underground.cut(20, 22);
    expect(builder.checkTrack(20, 22, STRAIGHT, 1).ok).toBe(true);
    // and from the other side, with the piece on the dug or cut tile down first
    expect(builder.placeTrack(20, 24, STRAIGHT, 1)).toBe(true);
    builder.underground.cut(20, 24);
    expect(builder.checkTrack(19, 24, STRAIGHT, 1).ok).toBe(true);
    // a line's probe reads the same store
    builder.underground.dig(20, 26, 0);
    expect(builder.checkLine(run(18, 20, 26)).ok).toBe(true);
    expect(builder.checkLine(run(18, 20, 28)).ok).toBe(false);
  });

  it('refuses new links only: track that crosses a step stays, and can be relaid', () => {
    const { track, builder } = cliff(4);
    track.place(19, 20, 'straight', 1);
    track.place(20, 20, 'straight', 1);
    const main: TrackItem = { kind: 'straight', cls: 'main' };
    expect(builder.checkTrack(20, 20, main, 1).ok).toBe(true);
    expect(builder.checkTrack(19, 20, main, 1).ok).toBe(true);
  });

  it('asks nothing of a builder with no slope rule: that ground counts as level', () => {
    const { builder } = cliff(4);
    builder.groundCheck = null;
    expect(builder.placeLine(run(16, 24, 20))).toBe(true);
  });
});

// ---------------------------------------------------------------- speed

describe('a train on mountain track', () => {
  /**
   * The speed a lone diesel would run at as it sets off west along row 30, its head on a tile of
   * the given biome, the ground under it painted Mountain by `paint` (given the head tile).
   */
  function freeSpeed(biome: number, paint: (map: GameMap, hx: number, hy: number) => void) {
    const map = emptyMap(4242, 96, 96, Terrain.Grass),
      track = new TrackGraph(96, 96),
      economy = electricAge();
    const builder = new Builder(map, new RegionState(map), track, economy, storeWith({}).stores);
    builder.free = true;
    const fleet = new Fleet(track, builder, map, new Inventory(), economy);
    for (let x = 2; x < 90; x++) track.place(x, 30, 'straight', 1);
    const t = new Train([
      { uid: 1, level: 0, def: content.locomotives.find((d) => d.id === 'f7')! },
    ]);
    t.spawnAt(track, 60, 30, Dir.W);
    const st = new Station('quarry', 6, 29);
    builder.stations.push(st);
    t.route = [st.id];
    t.oil = t.oilCap;
    fleet.trains.push(t);
    expect(t.dispatch(track, builder, map)).toBe(true);
    const ctx = (fleet as unknown as { ctx(n: number, s: number): TickCtx }).ctx(0, 1);
    t.onPathReady(ctx);
    // the ground and the biome under the head as it sets off, and the rail laid over that ground
    const head = t.headTile!;
    paint(map, head.x, head.y);
    map.biome[head.y * map.w + head.x] = biome;
    fleet.railBeds = railProfile(map, track);
    t.tick(0.05, ctx);
    expect(t.headTile).toEqual(head);
    return t.freeSpeed;
  }
  /** Mountain from 12 tiles west of the head to the head: it climbs off the grass east of it. */
  const climb = (map: GameMap, hx: number, hy: number) => {
    for (let y = hy - 8; y <= hy + 8; y++)
      for (let x = hx - 12; x <= hx; x++) map.terrain[y * map.w + x] = Terrain.Mountain;
  };
  /** Mountain for 8 tiles all round the head: it stands on the plateau. */
  const plateau = (map: GameMap, hx: number, hy: number) => {
    for (let y = hy - 8; y <= hy + 8; y++)
      for (let x = hx - 8; x <= hx + 8; x++) map.terrain[y * map.w + x] = Terrain.Mountain;
  };
  const grass = () => {};

  it('climbs at 0.5 × 0.9 = 0.45 and runs level at 0.9 of its plains speed', () => {
    const flat = freeSpeed(0, grass);
    expect(flat).toBeGreaterThan(0);
    expect(BIOME_DEFS[MOUNTAIN_BIOME].speedMul).toBe(0.9);
    expect(CLIMB_SPEED).toBe(0.5);
    // the ground: the head climbs the mountain's flank, or stands on its level top
    expect(freeSpeed(0, climb)).toBeCloseTo(flat * 0.5, 9);
    expect(freeSpeed(0, plateau)).toBeCloseTo(flat, 9);
    // in the Mountain biome
    expect(freeSpeed(MOUNTAIN_BIOME, climb)).toBeCloseTo(flat * 0.45, 9);
    expect(freeSpeed(MOUNTAIN_BIOME, plateau)).toBeCloseTo(flat * 0.9, 9);
    expect(freeSpeed(MOUNTAIN_BIOME, grass)).toBeCloseTo(flat * 0.9, 9);
  });
});
