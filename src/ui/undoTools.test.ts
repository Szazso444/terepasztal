import { beforeEach, describe, expect, it } from 'vitest';
import { Sprite } from 'pixi.js';
import { Commands } from '../sim/commands';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { line, simWorld, station } from '../testing/simWorld';
import { BuildController } from './buildController';
import type { Tool } from './toolbar';

type Tile = { x: number; y: number };
const ROW = 20;

beforeEach(() => {
  Object.assign(rules, DEFAULT_RULES);
});

/**
 * The build controller over a real world with its actions going through `Commands.act`, as the
 * game wires it: a grass map all owned, deep in the ages, a line along row 20 and a depot with
 * goods. The renderer is faked down to the overlay sprites; the input is driven frame by frame.
 */
function harness() {
  const w = simWorld({ terrain: 'grass', size: 64 });
  for (let i = 0; i < w.regions.unlocked.length; i++) w.regions.own(i);
  w.economy.tier = 5;
  const depot = station(w, 'depot', 30, 10);
  const stock = w.stores.byKey(`st:${depot.id}`)!;
  for (const id of ['wood', 'stone', 'iron']) stock.amounts.set(id, 2000);
  line(w, 10, ROW, 40);
  const commands = new Commands(w);
  const history = commands.history;
  const keys = new Set<string>();
  const input = {
    wasPressed: (k: string) => keys.has(k),
    clicks: [] as { button: number }[],
    buttons: new Set<number>(),
    buttonPressed: new Set<number>(),
    buttonReleased: new Set<number>(),
    mouseX: 0,
    mouseY: 0,
    overTips: false,
    mouseInside: true,
  };
  const world = {
    atlas: { has: () => false },
    makeOverlaySprite: () => new Sprite(),
    setSpriteFrame: () => {},
    surfacePoint: (x: number, y: number) => ({ x, y }),
    root: { x: 0, y: 0, scale: { x: 1, y: 1 } },
  };
  let pointer: Tile = { x: 0, y: 0 };
  const b = new BuildController(input as never, w.builder, world as never, () => pointer);
  b.act = (fn, stroke) => commands.act(fn, stroke);
  const frame = (t: Tile, o: { press?: boolean; release?: boolean; key?: string } = {}) => {
    pointer = t;
    if (o.press) {
      input.buttons.add(0);
      input.buttonPressed.add(0);
    }
    if (o.release) {
      input.buttons.delete(0);
      input.buttonReleased.add(0);
    }
    if (o.key) keys.add(o.key);
    b.update(true);
    input.buttonPressed.clear();
    input.buttonReleased.clear();
    input.clicks.length = 0;
    keys.clear();
  };
  /** A button let go on `t`, as the input reports a click. */
  const click = (t: Tile, button = 0) => {
    input.clicks.push({ button });
    frame(t);
  };
  /** Press on `from`, move to `to` through `mid`, let go: one drag, of three frames and more. */
  const drag = (from: Tile, to: Tile, mid: Tile[] = []) => {
    frame(from, { press: true });
    for (const t of mid) frame(t);
    frame(to);
    frame(to, { release: true });
  };
  /** How many steps can be undone, leaving them undone. */
  const stepsBack = () => {
    let n = 0;
    while (history.undo().ok) n++;
    return n;
  };
  const tool = (t: Tool) => b.setTool(t);
  return { ...w, b, commands, history, frame, click, drag, stepsBack, tool, depot };
}

const tile = (x: number, y: number): Tile => ({ x, y });

describe('one action of the tools, one step', () => {
  it('a dragged run of track', () => {
    const h = harness();
    h.tool({ kind: 'track', item: { kind: 'straight', cls: 'branch' } });
    h.drag(tile(8, 30), tile(12, 30), [tile(9, 30), tile(10, 30)]);
    expect(h.track.has(12, 30)).toBe(true);
    expect(h.history.undoLabel).toBe('Built 5 tiles of Branch Line');
    expect(h.stepsBack()).toBe(1);
    expect(h.track.has(12, 30)).toBe(false);
  });

  it('a run over a line, with the crossing it lays by itself', () => {
    const h = harness();
    h.tool({ kind: 'track', item: { kind: 'straight', cls: 'branch' } });
    h.drag(tile(15, ROW - 2), tile(15, ROW + 2), [tile(15, ROW)]);
    expect(h.track.get(15, ROW)?.kind).toBe('crossing');
    expect(h.stepsBack()).toBe(1);
    expect(h.track.get(15, ROW)?.kind).toBe('straight');
  });

  it('one piece clicked', () => {
    const h = harness();
    h.tool({ kind: 'track', item: { kind: 'curve', cls: 'branch' } });
    h.click(tile(8, 30));
    expect(h.stepsBack()).toBe(1);
    expect(h.track.has(8, 30)).toBe(false);
  });

  it('a station', () => {
    const h = harness();
    h.tool({ kind: 'station', defId: 'farm' });
    h.click(tile(15, ROW - 1));
    expect(h.b.selected?.def.id).toBe('farm');
    expect(h.stepsBack()).toBe(1);
    expect(h.builder.stationAt(15, ROW - 1)).toBeUndefined();
  });

  it('a dragged line of supply', () => {
    const h = harness();
    h.tool({ kind: 'supply', supply: 'catenary' });
    h.drag(tile(12, ROW), tile(16, ROW));
    expect(h.catenary.supplyAt(16, ROW)).toBe('catenary');
    expect(h.stepsBack()).toBe(1);
    expect(h.catenary.supplyAt(16, ROW)).toBeNull();
  });

  it('decor and a works, each click its own step', () => {
    const h = harness();
    h.tool({ kind: 'decor', defId: 'water_tower' });
    h.click(tile(8, 30));
    h.tool({ kind: 'building', defId: 'windmill' });
    h.click(tile(13, 30));
    expect(h.history.undoLabel).toBe('Built Windmill');
    expect(h.stepsBack()).toBe(2);
  });

  it('a dragged road', () => {
    const h = harness();
    h.tool({ kind: 'road' });
    h.drag(tile(8, 30), tile(12, 30));
    expect(h.builder.roads.has(12, 30)).toBe(true);
    expect(h.stepsBack()).toBe(1);
    expect(h.builder.roads.size).toBe(0);
  });

  it('the remove tool, a right click and the Delete key', () => {
    const h = harness();
    h.tool({ kind: 'remove' });
    h.click(tile(12, ROW));
    expect(h.track.has(12, ROW)).toBe(false);
    h.tool({ kind: 'none' });
    h.click(tile(13, ROW), 2);
    expect(h.track.has(13, ROW)).toBe(false);
    h.frame(tile(14, ROW), { key: 'Delete' });
    expect(h.track.has(14, ROW)).toBe(false);
    expect(h.history.undoLabel).toBe('Demolished 1 tile of Branch Line');
    expect(h.stepsBack()).toBe(3);
    expect(h.track.has(12, ROW)).toBe(true);
  });

  it('a click of the remove tool on nothing is no step', () => {
    const h = harness();
    h.tool({ kind: 'remove' });
    h.click(tile(8, 30));
    expect(h.history.canUndo).toBe(false);
  });

  it('an Upgrade drag over many frames, and the next drag on its own', () => {
    const h = harness();
    h.tool({ kind: 'reclass', dir: 'up' });
    h.drag(tile(12, ROW), tile(17, ROW), [tile(13, ROW), tile(14, ROW), tile(15, ROW)]);
    expect(h.track.get(17, ROW)?.cls).toBe('main');
    expect(h.history.undoLabel).toBe('Upgraded 6 tiles to Main Line');
    h.drag(tile(20, ROW), tile(21, ROW));
    expect(h.history.undoLabel).toBe('Upgraded 2 tiles to Main Line');
    expect(h.stepsBack()).toBe(2);
    expect(h.track.get(17, ROW)?.cls).toBe('branch');
  });

  it('a stroke held still makes no steps of its own', () => {
    const h = harness();
    h.tool({ kind: 'reclass', dir: 'up' });
    h.frame(tile(12, ROW), { press: true });
    for (let i = 0; i < 5; i++) h.frame(tile(12, ROW));
    h.frame(tile(12, ROW), { release: true });
    for (let i = 0; i < 5; i++) h.frame(tile(12, ROW));
    expect(h.stepsBack()).toBe(1);
  });
});

describe('after an undo', () => {
  it('forgets a picked station that went, and keeps one that stands', () => {
    const h = harness();
    h.tool({ kind: 'station', defId: 'farm' });
    h.click(tile(15, ROW - 1));
    const farm = h.b.selected;
    expect(farm).not.toBeNull();
    h.b.dropGone();
    expect(h.b.selected).toBe(farm);
    h.history.undo();
    h.b.dropGone();
    expect(h.b.selected).toBeNull();
  });

  it('forgets a picked works and decor that went', () => {
    const h = harness();
    const works = h.commands.act(() => h.builder.placeBuilding(13, 30, 'windmill', 0))!;
    h.b.selectBuilding(works);
    h.history.undo();
    h.b.dropGone();
    expect(h.b.selectedBuilding).toBeNull();
    const tower = h.commands.act(() => h.builder.placeDecor(8, 30, 'water_tower', 0))!;
    h.b.selectDecor(tower);
    h.history.undo();
    h.b.dropGone();
    expect(h.b.selectedDecor).toBeNull();
  });
});

describe('in the level editor', () => {
  it('records nothing the tools do', () => {
    const h = harness();
    h.builder.free = true;
    h.tool({ kind: 'track', item: { kind: 'straight', cls: 'branch' } });
    h.drag(tile(8, 30), tile(12, 30));
    expect(h.track.has(12, 30)).toBe(true);
    expect(h.history.canUndo).toBe(false);
  });
});
