import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sprite } from 'pixi.js';
import { Builder } from '../sim/build';
import { Economy } from '../sim/economy';
import { DEFAULT_RULES, rules } from '../sim/rules';
import { Stockpile } from '../sim/stockpile';
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
 * the Track tool's regular straight in hand. The renderer is faked down to the overlay sprites; the
 * input is driven frame by frame, R included.
 */
function harness() {
  const map = emptyMap(7, W, W, Terrain.Grass);
  const regions = new RegionState(map);
  regions.load([true, false, false, false]);
  const stock = new Stockpile();
  for (const k of ['wood', 'stone', 'iron']) stock.add(k, 1000);
  const track = new TrackGraph(W, W);
  const builder = new Builder(map, regions, track, new Economy(), stock);
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
  const frames = new Map<Sprite, string>();
  const world = {
    atlas: { has: () => false },
    makeOverlaySprite: (frame: string) => {
      const s = new Sprite();
      frames.set(s, frame);
      return s;
    },
    setSpriteFrame: (s: Sprite, frame: string) => frames.set(s, frame),
    surfacePoint: (x: number, y: number) => ({ x, y }),
    root: { x: 0, y: 0, scale: { x: 1, y: 1 } },
  };
  let pointer: Tile = { x: 0, y: 0 };
  const b = new BuildController(input as never, builder, world as never, () => pointer);
  b.setTool({ kind: 'track', item: { kind: 'straight', cls: 'regular' } });
  /** One frame with the pointer on `t`; `active: false` is the pointer over a panel. */
  const frame = (
    t: Tile,
    o: { press?: boolean; release?: boolean; r?: boolean; active?: boolean } = {},
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
    if (o.r) keys.add('KeyR');
    b.update(o.active ?? true);
    input.buttonPressed.clear();
    input.buttonReleased.clear();
    keys.clear();
  };
  /** A press and release on one tile: the one straight the tool lays at its turn. */
  const tap = (t: Tile) => {
    frame(t, { press: true });
    frame(t, { release: true });
  };
  return { track, frame, tap };
}

describe('R while dragging track', () => {
  it('turns the tool again once a drag was let go over a panel, which lays nothing', () => {
    const h = harness();
    h.frame({ x: 5, y: 5 }, { press: true });
    h.frame({ x: 10, y: 5 });
    h.frame({ x: 10, y: 5 }, { release: true, active: false });
    expect(h.track.pieces.size).toBe(0);
    h.frame({ x: 20, y: 20 }, { r: true });
    h.tap({ x: 20, y: 20 });
    expect(h.track.get(20, 20)).toMatchObject({ kind: 'straight', rot: 1 });
  });

  it('turns the tool while the drag has not left its first tile', () => {
    const h = harness();
    h.frame({ x: 5, y: 5 }, { press: true });
    h.frame({ x: 5, y: 5 }, { r: true });
    h.frame({ x: 5, y: 5 }, { release: true });
    expect(h.track.get(5, 5)).toMatchObject({ kind: 'straight', rot: 1 });
  });

  it('swaps which leg runs first once the drag has set off', () => {
    const h = harness();
    h.frame({ x: 5, y: 5 }, { press: true });
    h.frame({ x: 6, y: 5 });
    h.frame({ x: 12, y: 11 });
    h.frame({ x: 12, y: 11 }, { r: true });
    h.frame({ x: 12, y: 11 }, { release: true });
    // down column 5 first, then east along row 11
    expect(h.track.get(5, 8)).toMatchObject({ kind: 'straight', rot: 0 });
    expect(h.track.get(9, 11)).toMatchObject({ kind: 'straight', rot: 1 });
    expect(h.track.get(8, 5)).toBeUndefined();
  });
});
