import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sprite } from 'pixi.js';
import { Builder } from '../sim/build';
import { Economy } from '../sim/economy';
import { roadCost } from '../sim/roads';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { fmtCost } from '../sim/stores';
import { STR } from '../strings';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain } from '../world/tiles';
import { TrackGraph } from '../world/track';
import { Station, resetStationIds } from '../sim/stations';
import { BuildController } from './buildController';
import { storeWith } from '../testing/storeFixtures';

type Tile = { x: number; y: number };
const W = 64;

beforeEach(() => Object.assign(rules, DEFAULT_RULES));
afterEach(() => Object.assign(rules, DEFAULT_RULES));

/**
 * The build controller over a real builder on a grass map whose north-west quarter is owned, with
 * `stone` in its depot. The renderer is faked down to the overlay sprites, each kept with its frame and
 * placed at its tile (`surfacePoint` gives the tile itself); the input is driven frame by frame.
 */
function harness(stone = 100) {
  const map = emptyMap(7, W, W, Terrain.Grass);
  const regions = new RegionState(map);
  regions.load([true, false, false, false]);
  // the depot the builder pays from, in reach of the whole owned quarter
  const { stores, depot: stock } = storeWith({ stone }, { x: 16, y: 16 });
  const builder = new Builder(map, regions, new TrackGraph(W, W), new Economy(), stores);
  const input = {
    wasPressed: () => false,
    clicks: [] as { button: number }[],
    buttons: new Set<number>(),
    buttonPressed: new Set<number>(),
    buttonReleased: new Set<number>(),
    mouseX: 0,
    mouseY: 0,
    overTips: false,
    mouseInside: true,
  };
  const sprites: Sprite[] = [];
  const frames = new Map<Sprite, string>();
  const world = {
    atlas: { has: () => false },
    makeOverlaySprite: (frame: string) => {
      const s = new Sprite();
      frames.set(s, frame);
      sprites.push(s);
      return s;
    },
    setSpriteFrame: (s: Sprite, frame: string) => frames.set(s, frame),
    surfacePoint: (x: number, y: number) => ({ x, y }),
    root: { x: 0, y: 0, scale: { x: 1, y: 1 } },
  };
  let pointer: Tile = { x: 0, y: 0 };
  const b = new BuildController(input as never, builder, world as never, () => pointer);
  const status: string[] = [];
  b.onStatus = (t) => status.push(t);
  /**
   * One frame with the pointer on `t`; `press`, `release` and `click` (a button) happen in it.
   * `active: false` is a frame the field does not take, the pointer over a panel.
   */
  const frame = (
    t: Tile,
    o: { press?: boolean; release?: boolean; click?: number; active?: boolean } = {},
  ) => {
    pointer = t;
    if (o.press) {
      input.buttons.add(0);
      input.buttonPressed.add(0);
    }
    if (o.release) {
      input.buttons.delete(0);
      input.buttonReleased.add(0);
    }
    if (o.click !== undefined) input.clicks.push({ button: o.click });
    b.update(o.active ?? true);
    input.buttonPressed.clear();
    input.buttonReleased.clear();
    input.clicks.length = 0;
  };
  /** The tile diamonds shown now, each with its frame, keyed `x,y`. */
  const marks = () => {
    const out = new Map<string, string>();
    for (const s of sprites)
      if (s.visible && frames.get(s)!.startsWith('terrain/ghost'))
        out.set(`${s.position.x},${s.position.y}`, frames.get(s)!);
    return out;
  };
  /** The door markers shown now (the plain `terrain/select` diamonds), keyed `x,y`. */
  const doorMarks = () => {
    const out: string[] = [];
    for (const s of sprites)
      if (s.visible && frames.get(s) === 'terrain/select')
        out.push(`${s.position.x},${s.position.y}`);
    return out.sort();
  };
  return { b, builder, stock, frame, marks, doorMarks, status };
}

describe('the road tool', () => {
  it('lays the run it was dragged over on release, for the cost its status showed', () => {
    const h = harness();
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 2, y: 2 }, { press: true });
    for (let y = 3; y <= 8; y++) h.frame({ x: 2, y });
    const shown = h.status[h.status.length - 1];
    const cost = { stone: 7 * roadCost().stone };
    expect(shown).toContain(fmtCost(cost));
    expect(h.builder.roads.size, 'nothing is laid while the button is held').toBe(0);
    h.frame({ x: 2, y: 8 }, { release: true, click: 0 });
    for (let y = 2; y <= 8; y++) expect(h.builder.roads.has(2, y), `2,${y}`).toBe(true);
    expect(h.builder.roads.size).toBe(7);
    expect(h.stock.get('stone')).toBe(100 - cost.stone);
  });

  it("marks each tile of the drag with the build preview's diamond, red where it is refused", () => {
    const h = harness();
    h.builder.map.terrain[5 * W + 4] = Terrain.Water;
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 1, y: 5 }, { press: true });
    h.frame({ x: 6, y: 5 });
    const m = h.marks();
    expect([...m.keys()].sort()).toEqual(['1,5', '2,5', '3,5', '4,5', '5,5', '6,5']);
    for (const [at, f] of m)
      expect(f, at).toBe(at === '4,5' ? 'terrain/ghost_bad' : 'terrain/ghost_ok');
    // the refused tile's reason is the builder's
    expect(h.status[h.status.length - 1]).toContain(h.builder.checkRoad(4, 5).reason!);
    h.frame({ x: 6, y: 5 }, { release: true });
    expect(h.builder.roads.has(4, 5)).toBe(false);
    expect(h.builder.roads.size).toBe(5);
  });

  it('lays nothing for a drag let go over a panel, and starts the next drag at its own press', () => {
    const h = harness();
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 2, y: 2 }, { press: true });
    h.frame({ x: 2, y: 6 });
    // the release falls over a panel: the field never sees it
    h.frame({ x: 2, y: 6 }, { release: true, active: false });
    h.frame({ x: 4, y: 6 });
    expect(h.builder.roads.size).toBe(0);
    // a press the field does not see either, let go over the field: no stroke was started
    h.frame({ x: 4, y: 6 }, { press: true, active: false });
    h.frame({ x: 4, y: 9 });
    h.frame({ x: 4, y: 9 }, { release: true });
    expect(h.builder.roads.size).toBe(0);
    // a press the field sees starts the stroke there
    h.frame({ x: 4, y: 6 }, { press: true });
    h.frame({ x: 4, y: 8 }, { release: true });
    expect(h.builder.roads.list()).toEqual([
      { x: 4, y: 6 },
      { x: 4, y: 7 },
      { x: 4, y: 8 },
    ]);
  });

  it('prices or refuses the one tile under the cursor before a press', () => {
    const h = harness();
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 3, y: 3 });
    expect(h.status[h.status.length - 1]).toContain(
      STR.build.cost(fmtCost(h.builder.checkRoad(3, 3).cost)),
    );
    expect([...h.marks().values()]).toEqual(['terrain/ghost_ok']);
    // the uncharted land beyond the owned quarter
    h.frame({ x: 40, y: 3 });
    expect(h.status[h.status.length - 1]).toContain(h.builder.checkRoad(40, 3).reason!);
    expect([...h.marks().values()]).toEqual(['terrain/ghost_bad']);
    expect(h.builder.roads.size).toBe(0);
  });
});

/** Stand a station, as a save loads it: no rule is asked. */
function standStation(h: ReturnType<typeof harness>, x: number, y: number) {
  const s = new Station('station', x, y);
  h.builder.stations.push(s);
  return s;
}
/** The reach tiles of every street door the builder has, sorted, keyed `x,y`. */
const reachKeys = (h: ReturnType<typeof harness>) =>
  [...new Set(h.builder.streetDoors().map((d) => `${d.reach.x},${d.reach.y}`))].sort();

describe('the street door marks', () => {
  function town() {
    resetStationIds(1);
    const h = harness();
    h.builder.free = true;
    expect(h.builder.placeDecor(10, 10, 'townhouse', 0)).not.toBeNull();
    expect(h.builder.placeBuilding(20, 10, 'windmill', 1)).not.toBeNull();
    expect(h.builder.placeDecor(10, 20, 'fuel_stop', 2)).not.toBeNull();
    standStation(h, 20, 20);
    h.builder.free = false;
    return h;
  }

  it('marks the reach tile of every street door with the road tool, beside the picture of the door', () => {
    const h = town();
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 40, y: 3 });
    const want = reachKeys(h);
    expect(want.length).toBeGreaterThanOrEqual(4);
    expect(h.doorMarks()).toEqual(want);
    // never the tile the door is in: that one is refused
    for (const d of h.builder.streetDoors())
      expect(h.builder.checkRoad(d.tile.x, d.tile.y).ok, `${d.tile.x},${d.tile.y}`).toBe(false);
  });

  it('keeps the marks apart from the stroke, so a stroke over a marked tile shows both', () => {
    const h = town();
    const [first] = h.builder.streetDoors().map((d) => d.reach);
    h.b.setTool({ kind: 'road' });
    h.frame({ x: first.x, y: first.y }, { press: true });
    h.frame({ x: first.x, y: first.y + 3 });
    expect(h.marks().get(`${first.x},${first.y}`)).toBe('terrain/ghost_ok');
    expect(h.doorMarks()).toContain(`${first.x},${first.y}`);
  });

  it('shows none with another tool, after Escape, over a panel, or for a map without a place', () => {
    const h = town();
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 3, y: 3 });
    expect(h.doorMarks().length).toBeGreaterThan(0);
    // the pointer over a panel
    h.frame({ x: 3, y: 3 }, { active: false });
    expect(h.doorMarks()).toEqual([]);
    h.frame({ x: 3, y: 3 });
    expect(h.doorMarks().length).toBeGreaterThan(0);
    // another tool
    h.b.setTool({ kind: 'remove' });
    h.frame({ x: 3, y: 3 });
    expect(h.doorMarks()).toEqual([]);
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 3, y: 3 });
    expect(h.doorMarks().length).toBeGreaterThan(0);
    // Escape (the key press, as the keymap reads it)
    const keys = (h.b as unknown as { input: { wasPressed: (k: string) => boolean } }).input;
    keys.wasPressed = (k) => k === 'Escape';
    h.frame({ x: 3, y: 3 });
    expect(h.b.tool.kind).toBe('none');
    expect(h.doorMarks()).toEqual([]);
    // no place, no mark
    const bare = harness();
    bare.b.setTool({ kind: 'road' });
    bare.frame({ x: 3, y: 3 });
    expect(bare.doorMarks()).toEqual([]);
  });

  it('follows a place built or taken up while the tool stays in hand', () => {
    const h = harness();
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 3, y: 3 });
    expect(h.doorMarks()).toEqual([]);
    h.builder.free = true;
    expect(h.builder.placeDecor(10, 10, 'townhouse', 0)).not.toBeNull();
    h.frame({ x: 3, y: 3 });
    expect(h.doorMarks()).toEqual(reachKeys(h));
    expect(h.doorMarks()).toHaveLength(1);
  });
});

describe('a tile on a building', () => {
  it('is refused, with the reason in the status line, hovered or dragged over', () => {
    resetStationIds(1);
    const h = harness();
    h.builder.free = true;
    expect(h.builder.placeDecor(10, 10, 'townhouse', 0)).not.toBeNull();
    expect(h.builder.placeBuilding(20, 10, 'windmill', 1)).not.toBeNull();
    expect(h.builder.placeDecor(10, 20, 'fuel_stop', 2)).not.toBeNull();
    standStation(h, 20, 20);
    h.builder.free = false;
    h.b.setTool({ kind: 'road' });
    for (const t of [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: 20 },
    ]) {
      h.frame(t);
      expect(h.status[h.status.length - 1], `hover ${t.x},${t.y}`).toContain(
        STR.build.roadOnBuilding,
      );
      expect(h.marks().get(`${t.x},${t.y}`)).toBe('terrain/ghost_bad');
      // a drag that crosses it
      h.frame({ x: t.x - 2, y: t.y }, { press: true });
      h.frame({ x: t.x + 2, y: t.y });
      expect(h.status[h.status.length - 1], `drag ${t.x},${t.y}`).toContain(
        STR.build.roadOnBuilding,
      );
      expect(h.marks().get(`${t.x},${t.y}`)).toBe('terrain/ghost_bad');
      h.frame({ x: t.x + 2, y: t.y }, { release: true });
      expect(h.builder.roads.has(t.x, t.y)).toBe(false);
    }
  });
});

describe('removing a road', () => {
  it('takes the road off for its refund, with the Remove tool or a right click', () => {
    const h = harness();
    for (const [x, y] of [
      [4, 4],
      [5, 4],
    ])
      expect(h.builder.placeRoad(x, y)).toBe(true);
    const stone = h.stock.get('stone');
    h.b.setTool({ kind: 'remove' });
    h.frame({ x: 4, y: 4 });
    expect(h.status[h.status.length - 1]).toBe(STR.build.refund(fmtCost(h.builder.roadRefund())));
    h.frame({ x: 4, y: 4 }, { click: 0 });
    expect(h.builder.roads.has(4, 4)).toBe(false);
    expect(h.stock.get('stone')).toBe(stone + (h.builder.roadRefund().stone ?? 0));
    // with the road tool in hand, a right click takes a road off too
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 5, y: 4 }, { click: 2 });
    expect(h.builder.roads.size).toBe(0);
  });

  it('takes a level crossing apart road first, the track staying', () => {
    const h = harness();
    h.builder.free = true;
    expect(h.builder.placeTrack(8, 8, { kind: 'straight', cls: 'regular' }, 1)).toBe(true);
    expect(h.builder.placeRoad(8, 8)).toBe(true);
    h.builder.free = false;
    h.b.setTool({ kind: 'remove' });
    h.frame({ x: 8, y: 8 }, { click: 0 });
    expect(h.builder.roads.has(8, 8)).toBe(false);
    expect(h.builder.track.has(8, 8)).toBe(true);
    h.frame({ x: 8, y: 8 }, { click: 0 });
    expect(h.builder.track.has(8, 8)).toBe(false);
  });
});

describe('a road on a bridge platform', () => {
  /** A river tile with a platform on it, and the road tool's hover and bulldozer over it. */
  function bridge() {
    const h = harness();
    h.builder.map.terrain[6 * W + 6] = Terrain.Water;
    h.builder.free = true;
    expect(h.builder.placeBuilding(6, 6, 'bridge_wood')).not.toBeNull();
    h.builder.free = false;
    return h;
  }
  const STRAIGHT = { kind: 'straight', cls: 'regular' } as const;

  it('shows the ghost, the price and a line for the bridge on a platform with no rail', () => {
    const h = bridge();
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 6, y: 6 });
    expect([...h.marks().values()]).toEqual(['terrain/ghost_ok']);
    const shown = h.status[h.status.length - 1];
    expect(shown).toContain(STR.build.cost(fmtCost(h.builder.checkRoad(6, 6).cost)));
    expect(shown).toContain(STR.build.roadOnBridge);
    // a plain tile says nothing of a bridge
    h.frame({ x: 3, y: 3 });
    expect(h.status[h.status.length - 1]).not.toContain(STR.build.roadOnBridge);
  });

  it('is refused with the bridge reason where the platform carries rail', () => {
    const h = bridge();
    h.builder.free = true;
    expect(h.builder.placeTrack(6, 6, STRAIGHT, 1)).toBe(true);
    h.builder.free = false;
    h.b.setTool({ kind: 'road' });
    h.frame({ x: 6, y: 6 });
    expect([...h.marks().values()]).toEqual(['terrain/ghost_bad']);
    expect(h.status[h.status.length - 1]).toContain(STR.build.bridgeCarriesRail);
    expect(h.status[h.status.length - 1]).not.toContain(STR.build.roadOnBridge);
  });

  it('refuses rail on a platform that carries a road, with the bridge reason', () => {
    const h = bridge();
    expect(h.builder.placeRoad(6, 6)).toBe(true);
    const c = h.builder.checkTrack(6, 6, STRAIGHT, 1);
    expect(c.ok).toBe(false);
    expect(c.reason).toBe(STR.build.bridgeCarriesRoad);
  });

  it('comes off road first with the bulldozer, the platform on the second use', () => {
    const h = bridge();
    expect(h.builder.placeRoad(6, 6)).toBe(true);
    h.b.setTool({ kind: 'remove' });
    h.frame({ x: 6, y: 6 });
    expect(h.status[h.status.length - 1]).toBe(STR.build.refund(fmtCost(h.builder.roadRefund())));
    const stone = h.stock.get('stone');
    h.frame({ x: 6, y: 6 }, { click: 0 });
    expect(h.builder.roads.has(6, 6)).toBe(false);
    expect(h.builder.bridgeAt(6, 6)).toBeTruthy();
    expect(h.stock.get('stone')).toBe(stone + (h.builder.roadRefund().stone ?? 0));
    h.frame({ x: 6, y: 6 }, { click: 0 });
    expect(h.builder.bridgeAt(6, 6)).toBeUndefined();
  });
});
