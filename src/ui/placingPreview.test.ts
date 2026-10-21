import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sprite } from 'pixi.js';
import { HALF_H, tileToWorld } from '../engine/iso';
import { DECOR_DEFS } from '../sim/build';
import { BUILDING_DEFS } from '../sim/buildings';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { STATION_DEFS, harvestBreakdown, type Station } from '../sim/stations';
import { fmtCost } from '../sim/stockpile';
import { seasonOf, setSeasonOffset } from '../sim/weather';
import { line, simWorld, station as placeStation, type SimWorld } from '../testing/simWorld';
import { STR } from '../strings';
import { TRACK_ITEMS } from '../world/track';
import { BuildController } from './buildController';
import { placingTip, yieldLabel } from './placingTooltip';
import type { Tool } from './toolbar';
import { blockText, type TipDoc } from './tooltipDoc';
import { toolRotations } from './toolRotation';
import {
  HOLD_MS,
  ROOT_DELAY_MS,
  ROOT_LEAVE_MS,
  TooltipStack,
  UPDATE_MS,
  type Point,
  type TipView,
} from './tooltipStack';

const HARVESTERS = STATION_DEFS.filter((d) => d.terrain);
const FRAME = 16;
type Tile = { x: number; y: number };

/** What the stack shows, level by level: the documents themselves. */
class DocView implements TipView<TipDoc> {
  shown: TipDoc[] = [];
  open(level: number, content: TipDoc) {
    this.shown[level] = content;
  }
  move() {}
  refresh(level: number, content: TipDoc) {
    this.shown[level] = content;
    return true;
  }
  lock() {}
  close(level: number) {
    this.shown.length = level;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(rules, DEFAULT_RULES);
  setSeasonOffset(0);
});
afterEach(() => {
  vi.useRealTimers();
  Object.assign(rules, DEFAULT_RULES);
  setSeasonOffset(0);
});

/**
 * The build controller over a real world, the renderer faked down to what a ghost and the label
 * ask of it, with a real tooltip stack on fake timers. The builder is free, so a tile is refused
 * for its ground, its track or what stands on it, not for the price.
 */
function harness(w: SimWorld) {
  w.builder.free = true;
  const input = {
    wasPressed: () => false,
    clicks: [] as { button: number }[],
    buttons: new Set<number>(),
    buttonPressed: new Set<number>(),
    mouseX: 0,
    mouseY: 0,
    overUi: false,
    overTips: false,
    mouseInside: true,
  };
  // every other column's top face a step up, and a camera that is neither at 0 nor at zoom 1
  const surface = (x: number, y: number) => {
    const p = tileToWorld(x, y);
    return { x: p.x, y: p.y - (x % 2) * 10 };
  };
  const root = { x: 37, y: -11, scale: { x: 1.5, y: 1.5 } };
  const world = {
    atlas: { has: () => false },
    makeOverlaySprite: () => new Sprite(),
    setSpriteFrame: () => {},
    surfacePoint: surface,
    root,
  };
  let pointer: Tile = { x: 0, y: 0 };
  const b = new BuildController(input as never, w.builder, world as never, () => pointer);
  const view = new DocView();
  const stack = new TooltipStack<TipDoc>(view, {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  });
  const label: { text: string | null; corner: Point | null } = { text: null, corner: null };
  const status: string[] = [];
  b.onStatus = (t) => status.push(t);
  b.placing = {
    stack,
    content: (doc) => doc,
    label: (text, corner) => Object.assign(label, { text, corner }),
    season: () => seasonOf(w.clock.day),
  };
  /** The game's frames over `ms`, the pointer on `t` (over the field when `active`). */
  const frames = (t: Tile, ms: number, active = true) => {
    pointer = t;
    input.mouseX = 100 + t.x * 7;
    input.mouseY = 100 + t.y * 5;
    for (let e = 0; e < ms; e += FRAME) {
      b.update(active);
      vi.advanceTimersByTime(Math.min(FRAME, ms - e));
    }
  };
  /** Where a tile's top corner is on the screen. */
  const corner = (t: Tile): Point => {
    const p = surface(t.x, t.y);
    return { x: root.x + p.x * root.scale.x, y: root.y + (p.y - HALF_H) * root.scale.y };
  };
  return { b, input, view, stack, label, status, frames, corner };
}

/** Spread-out tiles to try: track goes in beside each, so a station can stand on it. */
function* tiles() {
  for (let y = 3; y < 45; y += 6) for (let x = 3; x < 45; x += 7) yield { x, y };
}

/** Tiles of `w` where a `defId` can stand once track runs beside them, track laid. */
function sites(w: SimWorld, defId: string, want = 4): Tile[] {
  const out: Tile[] = [];
  for (const at of tiles()) {
    if (out.length === want) break;
    try {
      line(w, at.x, at.y + 1, at.x);
    } catch {
      continue;
    }
    if (w.builder.checkStation(at.x, at.y, defId, 0).ok) out.push(at);
  }
  return out;
}

/** What the yield label says for a level 1 `defId` on `t`, from its breakdown. */
function labelFor(w: SimWorld, t: Tile, defId: string) {
  const b = harvestBreakdown(w.map, t.x, t.y, defId, 1, seasonOf(w.clock.day), rules);
  return yieldLabel(b!.perWeek);
}

const said = (doc: TipDoc | undefined) => (doc ?? []).map(blockText);

describe("a harvest station's tool", () => {
  // slow because it builds 8 worlds and places up to 56 stations through the builder
  it('labels the tile with what a level 1 station placed there makes, and keeps the status line to the price and R', () => {
    const placed = new Map<string, number>();
    for (const productionMul of [1, 2])
      for (const offset of [0, 2]) {
        Object.assign(rules, DEFAULT_RULES, { productionMul });
        setSeasonOffset(offset);
        for (const def of HARVESTERS) {
          const w = simWorld({ seed: 4242, size: 48 });
          const h = harness(w);
          const tool: Tool = { kind: 'station', defId: def.id };
          h.b.setTool(tool);
          for (const at of sites(w, def.id)) {
            const what = `${def.id} at ${at.x},${at.y}, productionMul ${productionMul}, offset ${offset}`;
            h.frames(at, FRAME);
            const check = w.builder.checkStation(at.x, at.y, def.id, 0);
            const parts = [STR.build.cost(fmtCost(check.cost))];
            if (toolRotations(tool) > 1) parts.push(STR.build.rotate);
            expect(h.status.at(-1), `${what}: the status line`).toBe(parts.join('   '));
            expect(h.label.text, `${what}: the label`).toBe(labelFor(w, at, def.id));
            expect(h.label.corner, `${what}: over the tile's top corner`).toEqual(h.corner(at));
            const s: Station = placeStation(w, def.id, at.x, at.y);
            placed.set(def.id, (placed.get(def.id) ?? 0) + 1);
            // what it makes a week once placed: its rate, times its season and biome
            const made = Math.round(s.productionPerWeek * s.productionMul);
            expect(h.label.text, `${what}: what it makes`).toBe(STR.placing.label(made));
          }
        }
      }
    for (const def of HARVESTERS) expect(placed.get(def.id), `${def.id} placed`).toBeGreaterThan(0);
  }, 20_000);

  it('says only why, in red, where the station cannot stand, and puts up no label', () => {
    const w = simWorld({ seed: 4242, size: 48 });
    for (const def of HARVESTERS) {
      const h = harness(w);
      h.b.setTool({ kind: 'station', defId: def.id });
      // no track beside it, or water, rock or something standing there
      const at = [...tiles()].find((t) => !w.builder.checkStation(t.x, t.y, def.id, 0).ok)!;
      expect(at, `${def.id}: a tile it cannot stand on`).toBeDefined();
      h.frames(at, ROOT_DELAY_MS + FRAME);
      const reason = w.builder.checkStation(at.x, at.y, def.id, 0).reason!;
      expect(h.view.shown[0], `${def.id}: the root`).toEqual([
        { kind: 'title', parts: [STR.placing.title(def.name)] },
        { kind: 'text', parts: [reason], tone: 'bad' },
      ]);
      expect(h.label.text).toBeNull();
      expect(h.status.at(-1)).toContain(reason);
    }
  });

  it('keeps a locked tooltip, its label and its lit tiles on the locked tile while the pointer moves on', () => {
    const w = simWorld({ seed: 4242, size: 48 });
    const h = harness(w);
    h.b.setTool({ kind: 'station', defId: 'farm' });
    const [a, b] = sites(w, 'farm', 2);
    expect(b, 'two farm sites').toBeDefined();
    const docOf = (t: Tile) =>
      said(
        placingTip({
          name: STATION_DEFS.find((d) => d.id === 'farm')!.name,
          refusal: null,
          breakdown: harvestBreakdown(w.map, t.x, t.y, 'farm', 1, seasonOf(w.clock.day), rules),
          cargo: ['wheat'],
          weeklyAtLevel1: 0,
        }),
      );
    h.frames(a, ROOT_DELAY_MS + HOLD_MS + FRAME);
    expect(h.stack.isLocked(0)).toBe(true);
    expect(said(h.view.shown[0])).toEqual(docOf(a));
    // on to another tile: the outline's tile is b, everything else stays on a
    h.frames(b, 3 * FRAME);
    expect(h.b.placingAt(b)).toMatchObject(a);
    expect(h.label).toEqual({ text: labelFor(w, a, 'farm'), corner: h.corner(a) });
    expect(said(h.view.shown[0])).toEqual(docOf(a));
    // into the locked tooltip itself: off the field, and still on a
    h.input.overTips = true;
    h.stack.tipEnter(0);
    h.frames(b, UPDATE_MS + FRAME, false);
    expect(h.b.placingAt(null)).toMatchObject(a);
    expect(h.label).toEqual({ text: labelFor(w, a, 'farm'), corner: h.corner(a) });
    expect(said(h.view.shown[0]), 'refreshed from the locked tile').toEqual(docOf(a));
    // back on the field, it closes after its time, and all of it follows the pointer again
    h.input.overTips = false;
    h.stack.tipLeave(0, null);
    h.frames(b, ROOT_LEAVE_MS + 2 * FRAME);
    expect(h.stack.depth).toBe(0);
    expect(h.b.placingAt(b)).toBe(b);
    expect(h.label).toEqual({ text: labelFor(w, b, 'farm'), corner: h.corner(b) });
  });

  it('lets its tooltip and its label go when the pointer leaves the window, a locked one after its time', () => {
    const w = simWorld({ seed: 4242, size: 48 });
    const h = harness(w);
    h.b.setTool({ kind: 'station', defId: 'farm' });
    const [a, b] = sites(w, 'farm', 2);
    expect(b, 'two farm sites').toBeDefined();
    // out of the window the field stays active and the pointer's last place stays on the tile
    h.frames(a, ROOT_DELAY_MS + FRAME);
    expect(h.stack.depth).toBe(1);
    expect(h.label.text).toBe(labelFor(w, a, 'farm'));
    h.input.mouseInside = false;
    h.frames(a, FRAME);
    expect(h.stack.depth, 'an open root goes at once').toBe(0);
    expect(h.label).toEqual({ text: null, corner: null });
    h.frames(a, ROOT_DELAY_MS + HOLD_MS);
    expect(h.stack.depth, 'nothing opens while it is out').toBe(0);
    expect(h.label.text).toBeNull();
    // back in, a root locks on another tile, and out again: it keeps its label for its time
    h.input.mouseInside = true;
    h.frames(b, ROOT_DELAY_MS + HOLD_MS + FRAME);
    expect(h.stack.isLocked(0)).toBe(true);
    h.input.mouseInside = false;
    h.frames(b, FRAME);
    expect(h.stack.depth).toBe(1);
    expect(h.label).toEqual({ text: labelFor(w, b, 'farm'), corner: h.corner(b) });
    h.frames(b, ROOT_LEAVE_MS + FRAME);
    expect(h.stack.depth, 'the locked root closes').toBe(0);
    expect(h.label).toEqual({ text: null, corner: null });
    expect(h.b.placingAt(null)).toBeNull();
  });

  it('says what the tuning makes of it while it is up', () => {
    const w = simWorld({ seed: 4242, size: 48 });
    const h = harness(w);
    h.b.setTool({ kind: 'station', defId: 'farm' });
    const [a] = sites(w, 'farm', 1);
    h.frames(a, ROOT_DELAY_MS + FRAME);
    const before = said(h.view.shown[0]);
    rules.productionMul = 3;
    h.frames(a, UPDATE_MS + FRAME);
    const after = said(h.view.shown[0]);
    expect(after).not.toEqual(before);
    const b = harvestBreakdown(w.map, a.x, a.y, 'farm', 1, seasonOf(w.clock.day), rules)!;
    expect(after.at(-2), 'the total').toContain(b.perWeek.toFixed(1));
    expect(h.label.text).toBe(yieldLabel(b.perWeek));
  });

  it('takes its tooltip and its label down with it when it is put down', () => {
    const w = simWorld({ seed: 4242, size: 48 });
    const h = harness(w);
    h.b.setTool({ kind: 'station', defId: 'farm' });
    const [a, b] = sites(w, 'farm', 2);
    h.frames(a, ROOT_DELAY_MS + HOLD_MS + FRAME);
    expect(h.stack.isLocked(0)).toBe(true);
    h.b.setTool({ kind: 'none' });
    expect(h.stack.depth).toBe(0);
    expect(h.label.text).toBeNull();
    expect(h.b.placingAt(b)).toBe(b);
  });
});

describe('any other tool', () => {
  it('puts up no tooltip and no label', () => {
    const w = simWorld({ seed: 4242, size: 48 });
    w.builder.free = true;
    const [at] = sites(w, 'farm', 1);
    expect(at, 'a tile a harvest station could stand on').toBeDefined();
    const tools: Tool[] = [
      ...STATION_DEFS.filter((d) => !d.terrain).map(
        (d) => ({ kind: 'station', defId: d.id }) as Tool,
      ),
      ...DECOR_DEFS.map((d) => ({ kind: 'decor', defId: d.id }) as Tool),
      ...BUILDING_DEFS.map((d) => ({ kind: 'building', defId: d.id }) as Tool),
      { kind: 'track', item: TRACK_ITEMS[0] },
      { kind: 'remove' },
      { kind: 'none' },
    ];
    for (const tool of tools) {
      const h = harness(w);
      h.b.setTool(tool);
      h.frames(at, ROOT_DELAY_MS + HOLD_MS);
      expect(h.stack.depth, JSON.stringify(tool)).toBe(0);
      expect(h.label.text, JSON.stringify(tool)).toBeNull();
      expect(h.b.placingAt(at)).toBe(at);
    }
  });
});
