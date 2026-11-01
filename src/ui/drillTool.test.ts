import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sprite } from 'pixi.js';
import { Builder } from '../sim/build';
import { Economy } from '../sim/economy';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { storeWith } from '../testing/storeFixtures';
import { STR } from '../strings';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain } from '../world/tiles';
import { TrackGraph, type TrackItem } from '../world/track';
import { BuildBar, buildCatalog, controlsHint, shownItems, type Tool } from './buildBar';
import { BuildController } from './buildController';
import { fmtMoney } from './numberFormat';

// the build rules play a sound when something is dug
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

beforeEach(() => Object.assign(rules, DEFAULT_RULES));
afterEach(() => Object.assign(rules, DEFAULT_RULES));

type Tile = { x: number; y: number };
const W = 48;
const MID = 24;

/**
 * The build controller over a real builder, on grass with one hill of 6 in the middle of the map:
 * on the middle row level 0 ends at x 18 and at x 30, and rail + 3 runs from x 21 to x 27. The
 * renderer is faked down to the overlay sprites and what the glass was told.
 */
function harness(o: { store?: boolean } = {}) {
  const map = emptyMap(7, W, W, Terrain.Grass);
  const regions = new RegionState(map);
  for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
  map.groundLevel = new Uint8Array(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++)
      map.groundLevel[y * W + x] = Math.max(0, 6 - Math.max(Math.abs(x - MID), Math.abs(y - MID)));
  const { stores } =
    o.store === false
      ? { stores: storeWithout() }
      : storeWith({ stone: 500, wood: 500, iron: 500 }, { x: 24, y: 24 });
  const economy = new Economy();
  economy.money = 1_000_000;
  economy.tier = 1;
  const builder = new Builder(map, regions, new TrackGraph(W, W), economy, stores);
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
  const frames = new Map<Sprite, string>(),
    sprites: Sprite[] = [],
    glass: { on: boolean; preview: readonly Tile[] }[] = [];
  const world = {
    atlas: { has: () => false },
    makeOverlaySprite: (frame: string) => {
      const s = new Sprite();
      frames.set(s, frame);
      sprites.push(s);
      return s;
    },
    setSpriteFrame: (s: Sprite, frame: string) => frames.set(s, frame),
    surfacePoint: (x: number, y: number) => ({ x: x + 0.25, y }),
    floorPoint: (x: number, y: number) => ({ x, y }),
    root: { x: 0, y: 0, scale: { x: 1, y: 1 } },
    setGlass: (on: boolean, preview: readonly Tile[] = []) => glass.push({ on, preview }),
  };
  let pointer: Tile = { x: 0, y: 0 };
  const b = new BuildController(input as never, builder, world as never, () => pointer);
  const status: string[] = [];
  b.onStatus = (t) => status.push(t);
  const frame = (
    t: Tile,
    f: { press?: boolean; release?: boolean; click?: number; active?: boolean } = {},
  ) => {
    pointer = t;
    if (f.press) {
      input.buttons.add(0);
      input.buttonPressed.add(0);
    }
    if (f.release) {
      input.buttons.delete(0);
      input.buttonReleased.add(0);
    }
    if (f.click !== undefined) input.clicks.push({ button: f.click });
    b.update(f.active ?? true);
    input.buttonPressed.clear();
    input.buttonReleased.clear();
    input.clicks.length = 0;
  };
  const drag = (from: Tile, to: Tile) => {
    frame(from, { press: true });
    frame(to);
    frame(to, { release: true });
  };
  /** The marks shown now, as `x,y` on the floor, with their frame and tint. */
  const marks = () =>
    sprites
      .filter((s) => s.visible && frames.get(s)!.startsWith('terrain/'))
      .map((s) => ({ at: `${s.position.x},${s.position.y}`, frame: frames.get(s)!, tint: s.tint }));
  return { b, builder, under: builder.underground, economy, frame, drag, marks, status, glass };
}

/** Stores with none in them: nothing takes stone in. */
function storeWithout() {
  return Object.assign(storeWith({}, { x: 8, y: 8 }).stores, {
    supplierFor: () => undefined,
    nearest: () => [],
  });
}

const row = (from: number, to: number) => ({
  from: { x: from, y: MID },
  to: { x: to, y: MID },
});
const glassNow = (h: ReturnType<typeof harness>) => h.glass[h.glass.length - 1]?.on ?? false;
const STRAIGHT: TrackItem = { kind: 'straight', cls: 'branch' };

describe('the Drill in the Track menu', () => {
  const bar = (tier: number) => {
    let at = tier;
    const tools: Tool[] = [];
    const b = new BuildBar(
      buildCatalog(
        () => true,
        () => at,
      ),
      () => at,
      (t) => tools.push(t),
      () => {},
    );
    return { b, tools, reach: (t: number) => (at = t) };
  };
  const listed = (c: BuildBar, group: string) =>
    shownItems(c.category('track'), group).some((i) => i.key === 'drill');

  it('the Drill is hidden before the diesel age', () => {
    const { b, reach } = bar(0);
    expect(listed(b, 'branch')).toBe(false);
    reach(1);
    expect(listed(b, 'branch')).toBe(true);
  });

  it('is on the lists of narrow gauge, branch, main and trunk line only', () => {
    const { b } = bar(1);
    for (const g of ['narrow', 'branch', 'main', 'trunk']) expect(listed(b, g), g).toBe(true);
    for (const g of ['maglev', 'hyperloop', 'bridges']) expect(listed(b, g), g).toBe(false);
  });

  it('is not in the editor', () => {
    const { b } = bar(1);
    b.setEditor(true);
    expect(listed(b, 'branch')).toBe(false);
  });

  it('keeps the line open that it was picked on, and goes off on its own tile', () => {
    const { b, tools } = bar(1);
    b.openCategory('track');
    b.setGroup('main');
    b.select({ kind: 'drill' });
    expect(b.openGroup()).toBe('main');
    b.select({ kind: 'drill' });
    expect(tools[tools.length - 1]).toEqual({ kind: 'none' });
  });

  it('tells how it is used', () => {
    const { b } = bar(1);
    expect(controlsHint(b.item({ kind: 'drill' })!)).toContain(STR.toolbar.foot.dig);
  });
});

describe('the Drill', () => {
  it('Drill on turns glass on, off turns it off, and any other menu turns it off', () => {
    const h = harness();
    h.b.setTool({ kind: 'drill' });
    expect(glassNow(h)).toBe(true);
    expect(h.b.drilling).toBe(true);
    expect(h.builder.insideMode).toBe(true);
    h.b.setTool({ kind: 'none' });
    expect(glassNow(h)).toBe(false);
    expect(h.builder.insideMode).toBe(false);
    for (const other of [
      { kind: 'station', defId: 'depot' },
      { kind: 'road' },
      { kind: 'ground', delta: 1 },
      { kind: 'building', defId: 'bridge_wood' },
      { kind: 'supply', supply: 'third_rail' },
      { kind: 'reclass', dir: 'up' },
    ] as Tool[]) {
      h.b.setTool({ kind: 'drill' });
      h.b.setTool(other);
      expect(glassNow(h), other.kind).toBe(false);
      expect(h.builder.insideMode).toBe(false);
    }
  });

  it('stays on for what works inside: track, a signal, Demolish', () => {
    const h = harness();
    h.b.setTool({ kind: 'drill' });
    for (const t of [
      { kind: 'track', item: STRAIGHT },
      { kind: 'decor', defId: 'signal' },
      { kind: 'remove' },
    ] as Tool[]) {
      h.b.setTool(t);
      expect(h.b.drilling, t.kind).toBe(true);
      expect(glassNow(h)).toBe(true);
    }
  });

  it('does not turn on by itself with track in hand', () => {
    const h = harness();
    h.b.setTool({ kind: 'track', item: STRAIGHT });
    expect(h.b.drilling).toBe(false);
    expect(h.glass).toEqual([]);
  });

  it('hands the whole drag to the plan at the release, in one go', () => {
    const h = harness();
    const dig = vi.spyOn(h.builder, 'dig');
    h.b.setTool({ kind: 'drill' });
    h.frame({ x: 18, y: MID }, { press: true });
    h.frame({ x: 20, y: MID });
    h.frame({ x: 25, y: MID + 1 });
    h.frame({ x: 30, y: MID });
    expect(dig).not.toHaveBeenCalled();
    h.frame({ x: 30, y: MID }, { release: true });
    expect(dig).toHaveBeenCalledTimes(1);
    const tiles = dig.mock.calls[0][0];
    expect(tiles.map((t) => t.x)).toEqual(Array.from({ length: 13 }, (_, i) => 18 + i));
    expect(tiles.every((t) => t.y === MID)).toBe(true);
    expect(
      h.under
        .portals()
        .map((p) => p.face)
        .sort(),
    ).toEqual(['E', 'W']);
    expect([h.under.isCut(19, MID), h.under.isCut(29, MID)]).toEqual([true, true]);
    expect(h.under.isDug(24, MID)).toBe(true);
  });

  it('gives the plan a clean path through a turn, each tile touching the last by a side', () => {
    const h = harness();
    const dig = vi.spyOn(h.builder, 'dig');
    h.b.setTool({ kind: 'drill' });
    h.frame({ x: 21, y: MID }, { press: true });
    h.frame({ x: 24, y: MID });
    h.frame({ x: 24, y: MID + 2 }, {});
    h.frame({ x: 24, y: MID + 2 }, { release: true });
    const tiles = dig.mock.calls[0][0];
    expect(tiles).toHaveLength(6);
    for (let i = 1; i < tiles.length; i++)
      expect(Math.abs(tiles[i].x - tiles[i - 1].x) + Math.abs(tiles[i].y - tiles[i - 1].y)).toBe(1);
    expect(new Set(tiles.map((t) => `${t.x},${t.y}`)).size).toBe(6);
  });

  it('digs nothing for a drag let go over a panel', () => {
    const h = harness();
    h.b.setTool({ kind: 'drill' });
    h.frame({ x: 22, y: MID }, { press: true });
    h.frame({ x: 26, y: MID }, { release: true, active: false });
    h.frame({ x: 26, y: MID });
    expect(h.under.empty).toBe(true);
  });

  it('one stroke of the Drill is one step, and the back-fill another', () => {
    const h = harness();
    const acts: number[] = [];
    h.b.act = (fn, stroke) => {
      acts.push(stroke ?? 0);
      return fn();
    };
    const { from, to } = row(18, 30);
    h.b.setTool({ kind: 'drill' });
    h.drag(from, to);
    expect(acts).toHaveLength(1);
    h.b.setTool({ kind: 'remove' });
    h.frame({ x: 24, y: MID }, { click: 0 });
    expect(acts).toHaveLength(2);
  });

  it('the ghost shows dig, raise and price', () => {
    const h = harness();
    // a saddle: two hills of 6 with a low tile between them
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const hill = (px: number) => 6 - Math.max(Math.abs(x - px), Math.abs(y - MID));
        h.builder.map.groundLevel![y * W + x] = Math.max(0, hill(18), hill(28));
      }
    h.b.setTool({ kind: 'drill' });
    h.frame({ x: 19, y: MID }, { press: true });
    h.frame({ x: 27, y: MID });
    const plan = h.builder.checkDig(Array.from({ length: 9 }, (_, i) => ({ x: 19 + i, y: MID })));
    const raised = plan.raise.filter((m) => m.to > h.builder.map.groundLevel![m.y * W + m.x]);
    expect(plan.ok).toBe(true);
    expect(raised.length).toBeGreaterThan(0);
    expect(h.status[h.status.length - 1]).toContain(
      STR.build.digPlan(
        plan.dig.length,
        plan.cut.length,
        raised.length,
        plan.portals.length,
        fmtMoney(plan.cost.money!),
      ),
    );
    expect(h.status[h.status.length - 1]).toContain(STR.build.digStone(plan.stone));
    const shown = h.marks();
    for (const t of plan.dig)
      expect(shown.find((m) => m.at === `${t.x},${t.y}`)?.frame).toBe('terrain/ghost_ok');
    for (const m of raised)
      if (!plan.dig.some((t) => t.x === m.x && t.y === m.y))
        expect(shown.find((s) => s.at === `${m.x},${m.y}`)?.frame).toBe('terrain/select');
    expect(h.glass[h.glass.length - 1].preview).toEqual([...plan.dig, ...plan.cut]);
  });

  it('shows a cut and a portal apart from a dug tile', () => {
    const h = harness();
    const { from, to } = row(18, 30);
    h.b.setTool({ kind: 'drill' });
    h.frame(from, { press: true });
    h.frame(to);
    const at = (x: number) => h.marks().find((m) => m.at === `${x},${MID}`);
    expect(at(19)!.tint).not.toBe(at(24)!.tint);
    expect(at(21)!.tint).not.toBe(at(24)!.tint);
    expect(at(21)!.tint).not.toBe(at(19)!.tint);
  });

  it('asks the plan again only when the tile changes', () => {
    const h = harness();
    const check = vi.spyOn(h.builder, 'checkDig');
    h.b.setTool({ kind: 'drill' });
    for (let i = 0; i < 5; i++) h.frame({ x: 24, y: MID });
    expect(check).toHaveBeenCalledTimes(1);
    h.frame({ x: 25, y: MID });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('says when no store takes the stone', () => {
    const h = harness({ store: false });
    h.b.setTool({ kind: 'drill' });
    h.frame({ x: 24, y: MID });
    expect(h.status[h.status.length - 1]).toContain(STR.build.stoneLost);
    expect(h.builder.checkDig([{ x: 24, y: MID }]).ok).toBe(true);
  });

  it('says what refuses, and marks it, and nothing is dug', () => {
    const h = harness();
    h.builder.track.place(24, MID, 'straight', 1);
    const { from, to } = row(21, 27);
    h.b.setTool({ kind: 'drill' });
    h.frame(from, { press: true });
    h.frame(to);
    expect(h.status[h.status.length - 1]).toBe(STR.build.digRefused(1, STR.build.occupied));
    expect(h.marks().find((m) => m.at === `24,${MID}`)?.frame).toBe('terrain/ghost_bad');
    h.frame(to, { release: true });
    expect(h.under.empty).toBe(true);
  });

  it('says so over a tile dug already', () => {
    const h = harness();
    h.b.setTool({ kind: 'drill' });
    h.frame({ x: 24, y: MID }, { press: true });
    h.frame({ x: 24, y: MID }, { release: true });
    expect(h.under.isDug(24, MID)).toBe(true);
    h.frame({ x: 24, y: MID });
    h.frame({ x: 24, y: MID });
    expect(h.status[h.status.length - 1]).toBe(STR.build.digNothing);
  });

  it('shows the plan short of money, with the reason', () => {
    const h = harness();
    h.economy.money = 0;
    h.b.setTool({ kind: 'drill' });
    h.frame({ x: 24, y: MID });
    expect(h.status[h.status.length - 1]).toContain(STR.build.funds);
    expect(h.status[h.status.length - 1]).toContain('dig 1');
  });

  it('with the Drill on, track tools lay inside only', () => {
    const h = harness();
    const { from, to } = row(18, 30);
    h.b.setTool({ kind: 'drill' });
    h.drag(from, to);
    h.b.setTool({ kind: 'track', item: STRAIGHT });
    const free = { x: 10, y: 10 };
    expect(h.builder.checkTrack(free.x, free.y, STRAIGHT, 1).reason).toBe(STR.build.notDug);
    expect(h.builder.checkTrack(24, MID, STRAIGHT, 1).ok).toBe(true);
    // a cut, and the open tile a portal looks at when the portal stands on a cliff
    expect(h.builder.checkTrack(19, MID, STRAIGHT, 1).ok).toBe(true);
    // the whole line from cut to cut lies down in one drag
    h.drag({ x: 19, y: MID }, { x: 29, y: MID });
    for (let x = 19; x <= 29; x++) expect(h.builder.track.has(x, MID), `x ${x}`).toBe(true);
  });

  it('with the Drill off, track stays out of what is dug', () => {
    const h = harness();
    const { from, to } = row(18, 30);
    h.b.setTool({ kind: 'drill' });
    h.drag(from, to);
    h.b.setTool({ kind: 'none' });
    expect(h.builder.checkTrack(24, MID, STRAIGHT, 1).reason).toBe(STR.build.overTunnel);
  });

  it('a line through a cut is straight: a turn on one stops the run', () => {
    const h = harness();
    const { from, to } = row(18, 30);
    h.b.setTool({ kind: 'drill' });
    h.drag(from, to);
    h.b.setTool({ kind: 'track', item: STRAIGHT });
    h.frame({ x: 23, y: MID }, { press: true });
    h.frame({ x: 20, y: MID });
    h.frame({ x: 19, y: MID + 4 });
    h.frame({ x: 19, y: MID + 4 }, { release: true });
    expect(h.builder.track.get(19, MID)?.kind ?? 'none').not.toBe('curve');
    expect(h.builder.track.has(19, MID + 3)).toBe(false);
  });

  it('shows track on the floor it picks on', () => {
    const h = harness();
    h.b.setTool({ kind: 'drill' });
    h.b.setTool({ kind: 'track', item: STRAIGHT });
    h.frame({ x: 24, y: MID });
    const spots = h.marks().map((m) => m.at);
    expect(spots).toContain(`24,${MID}`);
  });
});

describe('back-fill', () => {
  /** A tunnel from x 21 to x 27, its cuts on both sides, the Drill on and Demolish in hand. */
  function tunnel() {
    const h = harness();
    const { from, to } = row(18, 30);
    h.b.setTool({ kind: 'drill' });
    h.drag(from, to);
    h.b.setTool({ kind: 'remove' });
    return h;
  }

  it('Remove back-fills a dug tile with no track', () => {
    const h = tunnel(),
      money = h.economy.money;
    h.frame({ x: 24, y: MID });
    const back = rules.drillCost * rules.refundRate;
    expect(h.status[h.status.length - 1]).toBe(STR.build.backFill(fmtMoney(back)));
    h.frame({ x: 24, y: MID }, { click: 0 });
    expect(h.under.isDug(24, MID)).toBe(false);
    expect(h.economy.money).toBe(money + back);
  });

  it('takes the track first, and the tile on the next use', () => {
    const h = tunnel();
    h.builder.track.place(24, MID, 'straight', 1);
    h.frame({ x: 24, y: MID }, { click: 0 });
    expect(h.builder.track.has(24, MID)).toBe(false);
    expect(h.under.isDug(24, MID)).toBe(true);
    h.frame({ x: 24, y: MID }, { click: 0 });
    expect(h.under.isDug(24, MID)).toBe(false);
  });

  it('with the Drill off leaves alone what lies inside the hill the pointer is on', () => {
    const h = tunnel();
    h.builder.track.place(24, MID, 'straight', 1);
    h.b.setTool({ kind: 'none' });
    h.b.setTool({ kind: 'remove' });
    expect(h.b.drilling).toBe(false);
    h.frame({ x: 24, y: MID }, { click: 0 });
    h.frame({ x: 25, y: MID }, { click: 2 });
    expect(h.builder.track.has(24, MID)).toBe(true);
    expect(h.under.isDug(25, MID)).toBe(true);
    // a cut lies open, for any Demolish; the right click put the tool down
    h.b.setTool({ kind: 'remove' });
    h.frame({ x: 19, y: MID }, { click: 0 });
    expect(h.under.isCut(19, MID)).toBe(false);
  });
});
