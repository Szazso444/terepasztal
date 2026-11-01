import { describe, expect, it, vi } from 'vitest';
import { Sprite } from 'pixi.js';
import type { Rng } from '../engine/rng';
import { Builder } from '../sim/build';
import { Economy } from '../sim/economy';
import { rules } from '../sim/rules';
import type { Station } from '../sim/stations';
import { storeWith } from '../testing/storeFixtures';
import { forAll, shrinkArray } from '../testing/property';
import { NO_LEVEL, levelAt } from '../world/elevation';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { Terrain, type GameMap } from '../world/tiles';
import { STR } from '../strings';
import { BuildController } from './buildController';
import { fmtMoney } from './numberFormat';

// the build rules play a sound when ground moves
vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

/**
 * One frame of the game: something picked up before it, whether Escape went down in it, and
 * whether the keymap's Escape closed the tooltip stack first (`PlayUi.keys.closeTooltips` calls
 * `takeEscape`, and src/game.ts runs the keys before `BuildController.update`).
 */
interface Frame {
  pick: 'tool' | 'station' | null;
  escape: boolean;
  tooltips: boolean;
}

/** A controller over fakes: the frames here never reach past its Escape, so nothing else is read. */
function controller(pressed: Set<string>) {
  const input = { wasPressed: (code: string) => pressed.has(code) };
  const builder = { map: { w: 8, h: 8 }, stationAt: () => undefined, buildingAt: () => undefined };
  const world = { makeOverlaySprite: () => new Sprite(), surfacePoint: () => ({ x: 0, y: 0 }) };
  return new BuildController(input as never, builder as never, world as never, () => ({
    x: 1,
    y: 1,
  }));
}

const STATION = { x: 2, y: 3 } as Station;

function genFrames(rng: Rng): Frame[] {
  return Array.from({ length: rng.int(1, 30) }, () => {
    const escape = rng.chance(0.5);
    return {
      pick: rng.chance(0.3) ? rng.pick(['tool', 'station'] as const) : null,
      escape,
      tooltips: escape && rng.chance(0.5),
    };
  });
}

describe('Escape between the tooltips and the build controller', () => {
  it('keeps the tool and the selection when Escape closed the tooltips, for that frame only', () => {
    forAll(
      genFrames,
      (frames) => {
        const pressed = new Set<string>();
        const b = controller(pressed);
        // the model: what is in hand and what is picked
        let tool = false;
        let picked = false;
        frames.forEach((f, i) => {
          if (f.pick === 'tool') {
            b.setTool({ kind: 'remove' });
            tool = true;
            picked = false;
          } else if (f.pick === 'station') {
            b.select(STATION);
            picked = true;
          }
          pressed.clear();
          if (f.escape) pressed.add('Escape');
          if (f.tooltips) b.takeEscape();
          // the frame's Escape: the tooltips took it, or it drops the tool, or else the selection
          if (f.escape && !f.tooltips) {
            if (tool) tool = false;
            else picked = false;
          }
          b.update(false);
          expect(b.tool.kind !== 'none', `frame ${i}: a tool in hand`).toBe(tool);
          expect(b.selected !== null, `frame ${i}: a station picked`).toBe(picked);
        });
      },
      { shrink: (frames) => shrinkArray(frames) },
    );
  });
});

describe('the run being dragged', () => {
  /** A straight tool over an empty field, with the left button held on the tile `at` says. */
  function dragging() {
    const at = { x: 1, y: 1 };
    const buttons = new Set<number>();
    const buttonPressed = new Set<number>();
    const buttonReleased = new Set<number>();
    const input = { wasPressed: () => false, buttons, buttonPressed, buttonReleased, clicks: [] };
    const builder = {
      map: { w: 16, h: 16 },
      stationAt: () => undefined,
      buildingAt: () => undefined,
      track: { get: () => undefined },
      checkTrack: () => ({ ok: true, cost: { wood: 2 } }),
      placeTrack: () => true,
    };
    const world = {
      makeOverlaySprite: () => new Sprite(),
      surfacePoint: () => ({ x: 0, y: 0 }),
      setSpriteFrame: () => {},
    };
    const b = new BuildController(input as never, builder as never, world as never, () => at);
    b.setTool({ kind: 'track', item: { kind: 'straight', cls: 'branch' } });
    return { b, at, buttons, buttonPressed, buttonReleased };
  }

  it('is there while a drag covers more than a tile, and gone when it is let go', () => {
    const { b, at, buttons, buttonPressed, buttonReleased } = dragging();
    expect(b.run).toBeNull();
    buttons.add(0);
    buttonPressed.add(0);
    b.update(true);
    expect(b.run).toBeNull();
    buttonPressed.clear();
    at.x = 5;
    b.update(true);
    expect(b.run?.straights).toBe(5);
    expect(b.run?.cost).toEqual({ wood: 10 });
    buttons.clear();
    buttonReleased.add(0);
    b.update(true);
    expect(b.run).toBeNull();
  });

  it('stops with the pointer over a panel', () => {
    const { b, at, buttons, buttonPressed } = dragging();
    buttons.add(0);
    buttonPressed.add(0);
    b.update(true);
    buttonPressed.clear();
    at.x = 5;
    b.update(true);
    expect(b.run).not.toBeNull();
    b.update(false);
    expect(b.run).toBeNull();
  });
});

describe('the Raise and Lower tools', () => {
  const SIZE = 16;
  /** Grass at level 0 with the given tiles set, every region owned, $100,000 in hand. */
  function field(levels: Record<string, number> = {}) {
    const map = emptyMap(7, SIZE, SIZE, Terrain.Grass),
      regions = new RegionState(map);
    for (let i = 0; i < regions.unlocked.length; i++) regions.own(i);
    const economy = new Economy();
    economy.money = 100_000;
    const builder = new Builder(
      map,
      regions,
      new TrackGraph(SIZE, SIZE),
      economy,
      storeWith({}).stores,
    );
    if (Object.keys(levels).length) {
      map.groundLevel = new Uint8Array(SIZE * SIZE);
      for (const [at, v] of Object.entries(levels)) {
        const [x, y] = at.split(',').map(Number);
        map.groundLevel[y * SIZE + x] = v;
      }
    }
    return { map, economy, builder };
  }

  /** The tool in hand over `builder`, with the pointer on `at` and the diamonds it draws kept. */
  function tool(builder: Builder, delta: 1 | -1) {
    const at = { x: 1, y: 1 };
    const buttons = new Set<number>();
    const buttonPressed = new Set<number>();
    const buttonReleased = new Set<number>();
    const input = { wasPressed: () => false, buttons, buttonPressed, buttonReleased, clicks: [] };
    const made: Sprite[] = [];
    const frames = new Map<Sprite, string>();
    const world = {
      makeOverlaySprite: () => made[made.push(new Sprite()) - 1],
      // a sprite's position is the tile it stands on
      surfacePoint: (x: number, y: number) => ({ x, y }),
      setSpriteFrame: (g: Sprite, frame: string) => frames.set(g, frame),
    };
    const b = new BuildController(input as never, builder, world as never, () => at);
    let status = '';
    b.onStatus = (s) => (status = s);
    b.setTool({ kind: 'ground', delta });
    /** One frame with the pointer on (x, y) and the left button as given. */
    const frame = (x: number, y: number, press?: 'down' | 'up') => {
      at.x = x;
      at.y = y;
      buttonPressed.clear();
      buttonReleased.clear();
      if (press === 'down') {
        buttons.add(0);
        buttonPressed.add(0);
      } else if (press === 'up') {
        buttons.delete(0);
        buttonReleased.add(0);
      }
      b.update(true);
    };
    /** The tiles shown with a frame: `ghost_ok` for the ones that move, `ghost_bad` for those that refuse. */
    const shown = (frameName: string) =>
      made
        .filter((g) => g.visible && frames.get(g) === frameName)
        .map((g) => `${g.position.x},${g.position.y}`)
        .sort();
    return { b, frame, shown, status: () => status };
  }

  const level = (map: GameMap, x: number, y: number) => levelAt(map, x, y);

  it('a click raises the tile one level, and a drag acts on each tile of its run', () => {
    const { map, economy, builder } = field();
    const t = tool(builder, 1);
    t.frame(4, 8, 'down');
    t.frame(8, 8);
    t.frame(8, 8, 'up');
    // five tiles, one level each: not five levels on the last
    for (let x = 4; x <= 8; x++) expect(level(map, x, 8), `x ${x}`).toBe(1);
    expect(level(map, 3, 8)).toBe(0);
    expect(level(map, 9, 8)).toBe(0);
    expect(100_000 - economy.money).toBe(5 * rules.groundCost);
    // a press let go where it started is one tile
    t.frame(2, 2, 'down');
    t.frame(2, 2, 'up');
    expect(level(map, 2, 2)).toBe(1);
    expect(level(map, 3, 2)).toBe(0);
  });

  it('lowers the way it raises, tile by tile and a level a step', () => {
    const ridge = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${2 + i},5`, 1]));
    const { map, builder } = field(ridge);
    const t = tool(builder, -1);
    t.frame(4, 5, 'down');
    t.frame(7, 5);
    t.frame(7, 5, 'up');
    for (let x = 4; x <= 7; x++) expect(level(map, x, 5), `x ${x}`).toBe(0);
    expect(level(map, 3, 5)).toBe(1);
    expect(level(map, 8, 5)).toBe(1);
  });

  it('the ghost lists every moved tile and the price, and leaves a tile that stays unmarked', () => {
    // (8, 8) at 1 raised to 2 lifts its three low sides to 1; the fourth is at 1 already
    const { map, economy, builder } = field({ '8,8': 1, '9,8': 1 });
    const t = tool(builder, 1);
    t.frame(8, 8);
    expect(t.shown('terrain/ghost_ok')).toEqual(['7,8', '8,7', '8,8', '8,9']);
    expect(t.shown('terrain/ghost_bad')).toEqual([]);
    expect(t.status()).toBe(STR.build.groundUp(4, fmtMoney(4 * rules.groundCost)));
    // looking moves nothing and costs nothing
    expect(level(map, 8, 8)).toBe(1);
    expect(economy.money).toBe(100_000);
  });

  it('leaves a tile that is only freed to rise unmarked and unpriced', () => {
    // a mountain tile no plane holds reads 1 between the ridge and the flat; the raise frees it to
    // rise, and `moved` keeps it at the level it has
    const { map, builder } = field({ '8,8': 0, '10,8': 1, '9,7': 1, '9,9': 1 });
    map.groundLevel![8 * SIZE + 9] = NO_LEVEL;
    map.terrain[8 * SIZE + 9] = Terrain.Mountain;
    const held = builder.checkGround([{ x: 8, y: 8 }], 1).moved.find((m) => m.x === 9 && m.y === 8);
    expect(held?.to).toBe(level(map, 9, 8));
    const t = tool(builder, 1);
    t.frame(8, 8);
    expect(t.shown('terrain/ghost_ok')).toEqual(['8,8']);
    expect(t.status()).toBe(STR.build.groundUp(1, fmtMoney(rules.groundCost)));
  });

  it('does not judge again while the pointer stays on the tile', () => {
    const { builder } = field();
    const check = vi.spyOn(builder, 'checkGround');
    const t = tool(builder, 1);
    t.frame(5, 5);
    t.frame(5, 5);
    t.frame(5, 5);
    expect(check).toHaveBeenCalledTimes(1);
    t.frame(6, 5);
    expect(check).toHaveBeenCalledTimes(2);
    // a press on the tile looked at is the same look; a drag is judged when its end tile changes
    t.frame(6, 5, 'down');
    t.frame(8, 5);
    t.frame(8, 5);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('shows refused tiles red, says why, and a click moves nothing', () => {
    const { map, economy, builder } = field();
    builder.track.place(9, 8, 'straight', 1);
    const t = tool(builder, 1);
    // a run over the track: the whole action refuses
    t.frame(7, 8, 'down');
    t.frame(10, 8);
    expect(t.shown('terrain/ghost_bad')).toEqual(['9,8']);
    expect(t.status()).toBe(STR.build.groundRefused(1, STR.build.occupied));
    t.frame(10, 8, 'up');
    for (let x = 7; x <= 10; x++) expect(level(map, x, 8), `x ${x}`).toBe(0);
    expect(map.groundLevel).toBeUndefined();
    expect(economy.money).toBe(100_000);
  });

  it('says so when nothing would move, and when the money is short', () => {
    const { economy, builder } = field();
    const lower = tool(builder, -1);
    // sea level is the bottom
    lower.frame(5, 5);
    expect(lower.shown('terrain/ghost_ok')).toEqual([]);
    expect(lower.status()).not.toBe('');
    economy.money = 50;
    const up = tool(builder, 1);
    up.frame(5, 5);
    expect(up.shown('terrain/ghost_ok')).toEqual(['5,5']);
    expect(up.status()).toContain(fmtMoney(rules.groundCost));
    expect(up.status()).toContain(STR.build.funds);
    up.frame(5, 5, 'down');
    up.frame(5, 5, 'up');
    expect(economy.money).toBe(50);
  });
});
