import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sprite } from 'pixi.js';
import { Builder } from '../sim/build';
import { Economy } from '../sim/economy';
import { roadCost } from '../sim/roads';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { Stockpile, fmtCost } from '../sim/stockpile';
import { STR } from '../strings';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain } from '../world/tiles';
import { TrackGraph } from '../world/track';
import { BuildController } from './buildController';

type Tile = { x: number; y: number };
const W = 64;

beforeEach(() => Object.assign(rules, DEFAULT_RULES));
afterEach(() => Object.assign(rules, DEFAULT_RULES));

/**
 * The build controller over a real builder on a grass map whose north-west quarter is owned, with
 * `stone` in stock. The renderer is faked down to the overlay sprites, each kept with its frame and
 * placed at its tile (`surfacePoint` gives the tile itself); the input is driven frame by frame.
 */
function harness(stone = 100) {
  const map = emptyMap(7, W, W, Terrain.Grass);
  const regions = new RegionState(map);
  regions.load([true, false, false, false]);
  const stock = new Stockpile();
  stock.add('stone', stone);
  const builder = new Builder(map, regions, new TrackGraph(W, W), new Economy(), stock);
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
  /** One frame with the pointer on `t`; `press`, `release` and `click` (a button) happen in it. */
  const frame = (t: Tile, o: { press?: boolean; release?: boolean; click?: number } = {}) => {
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
    b.update(true);
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
  return { b, builder, stock, frame, marks, status };
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
