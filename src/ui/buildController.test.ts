import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { Terrain } from '../world/tiles';
import { RegionState } from '../world/regions';
import { TrackGraph } from '../world/track';
import { railProfile } from '../world/railProfile';
import { Builder } from '../sim/build';
import { Stockpile } from '../sim/stockpile';
import { Economy } from '../sim/economy';
import { rules, DEFAULT_RULES } from '../sim/rules';
import { Camera } from '../engine/camera';
import type { Input, ClickEvent } from '../engine/input';
import type { WorldRenderer } from '../render/worldRenderer';
import { BuildController } from './buildController';
import { STR } from '../strings';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

const W = 64,
  ROW = 20;
/** A build controller over a real Builder, with the mouse and the renderer stood in for. */
function controller() {
  const map = emptyMap(4242, W, W, Terrain.Grass),
    track = new TrackGraph(W, W),
    builder = new Builder(map, new RegionState(map), track, new Economy(), new Stockpile());
  builder.free = true;
  builder.autoDeck = (x, y) =>
    railProfile(map, track, (px, py) => builder.bridgeAt(px, py)).get(y * W + x)?.level;
  const sprite = () => ({
      visible: false,
      alpha: 1,
      tint: 0,
      position: { set() {} },
      destroy() {},
    }),
    world = {
      atlas: { has: () => true },
      makeOverlaySprite: sprite,
      setSpriteFrame() {},
      surfacePoint: (x: number, y: number) => ({ x, y }),
      setBridgeGhost: vi.fn(),
    } as unknown as WorldRenderer,
    input = {
      mouseX: 0,
      mouseY: 0,
      clicks: [] as ClickEvent[],
      buttons: new Set<number>(),
      buttonPressed: new Set<number>(),
      buttonReleased: new Set<number>(),
      wasPressed: () => false,
    },
    camera = new Camera(),
    pointer = { x: 30, y: ROW };
  camera.setMapSize(W, W);
  camera.centerOn(0, 600);
  let status = '';
  const build = new BuildController(
    input as unknown as Input,
    builder,
    world,
    () => pointer,
    camera,
  );
  build.onStatus = (t) => (status = t);
  /** One frame with the given mouse buttons released on it (0 left, 2 right). */
  const frame = (...buttons: number[]) => {
    input.clicks = buttons.map((button) => ({ x: 0, y: 0, button, shift: false, ctrl: false }));
    build.update(true);
    input.clicks = [];
    return status;
  };
  /** Move the pointer: the tile under it, and where it is on screen. */
  const point = (x: number, y: number, mouseX = x * 40, mouseY = y * 40) => {
    Object.assign(pointer, { x, y });
    Object.assign(input, { mouseX, mouseY });
  };
  point(30, ROW);
  return {
    map,
    track,
    builder,
    build,
    input,
    camera,
    frame,
    point,
    at: (x: number, y = ROW) => builder.bridgeAt(x, y),
  };
}

describe('bridge tool: click raises, right-click lowers', () => {
  let now = 1000;
  beforeEach(() => {
    Object.assign(rules, DEFAULT_RULES);
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it('places on a free tile, then moves the deck one height per click', () => {
    const c = controller();
    c.build.setTool({ kind: 'building', defId: 'bridge_stone' });
    expect(c.frame()).toMatch(/^Cost/);
    c.frame(0);
    expect(c.at(30)).toMatchObject({ id: 'bridge_stone' });
    expect(c.at(30)!.deck).toBeUndefined();
    expect(c.frame()).toBe(
      [STR.build.deckAt(0, 0, false, true), STR.build.deckRaise, STR.build.deckRemove].join('   '),
    );
    for (const height of [1, 2, 3]) {
      c.frame(0);
      expect(c.builder.deckLevel(c.at(30)!)).toBe(height);
    }
    expect(c.frame()).toBe(
      [STR.build.deckAt(3, 3, false, false), STR.build.deckRaise, STR.build.deckLower].join('   '),
    );
    c.frame(2);
    expect(c.builder.deckLevel(c.at(30)!)).toBe(2);
    // Two clicks in one frame are two heights.
    c.frame(2, 2);
    expect(c.builder.deckLevel(c.at(30)!)).toBe(0);
    expect(c.at(30)).toBeDefined();
  });

  it('works with either bridge tool on either material, and over water', () => {
    const c = controller();
    c.map.terrain[ROW * W + 30] = Terrain.Water;
    c.build.setTool({ kind: 'building', defId: 'bridge_wood' });
    c.frame(0);
    c.build.setTool({ kind: 'building', defId: 'bridge_stone' });
    c.frame(0);
    c.frame(0);
    expect(c.at(30)).toMatchObject({ id: 'bridge_wood', deck: 2 });
    expect(c.frame()).toMatch(/^Deck height 2 \(2 above the water\)/);
    c.frame(2);
    expect(c.at(30)!.deck).toBe(1);
  });

  it('keeps a refusal on the status line for a moment, then shows the readout again', () => {
    const c = controller();
    c.build.setTool({ kind: 'building', defId: 'bridge_stone' });
    for (let i = 0; i < 5; i++) c.frame(0);
    expect(c.at(30)!.deck).toBe(4);
    const refused = STR.build.deckRefused(true, STR.build.deck.highest);
    expect(c.frame(0)).toBe(refused);
    now += 1500;
    expect(c.frame()).toBe(refused);
    now += 1000;
    expect(c.frame()).toMatch(/^Deck height 4/);
  });

  it('does not take the bridge apart with the click after the deck reached its floor', () => {
    const c = controller();
    c.build.setTool({ kind: 'building', defId: 'bridge_stone' });
    c.frame(0);
    c.frame(0);
    c.frame(2);
    expect(c.builder.deckLevel(c.at(30)!)).toBe(0);
    // More right clicks in a hurry: the platform stays and the status says why.
    for (let i = 0; i < 3; i++) {
      now += 300;
      expect(c.frame(2)).toBe(STR.build.deckRefused(false, STR.build.deck.lowest(false)));
      expect(c.at(30)).toBeDefined();
    }
    // A little pointer jitter changes nothing.
    c.point(30, ROW, 30 * 40 + 5, ROW * 40 - 4);
    now += 300;
    c.frame(2);
    expect(c.at(30)).toBeDefined();
    // After a pause the click removes again, as the status line says it will.
    now += 3000;
    expect(c.frame()).toMatch(new RegExp(`${STR.build.deckRemove}$`));
    c.frame(2);
    expect(c.at(30)).toBeUndefined();
    expect(c.build.tool.kind).toBe('building');
  });

  it('removes with a fresh right click on a platform that rests at its floor, rail first', () => {
    const c = controller();
    c.builder.placeBuilding(30, ROW, 'bridge_stone');
    c.builder.placeTrackKind(30, ROW, 'straight', 1);
    c.build.setTool({ kind: 'building', defId: 'bridge_stone' });
    c.frame(2);
    expect(c.track.has(30, ROW)).toBe(false);
    expect(c.at(30)).toBeDefined();
    c.frame(2);
    expect(c.at(30)).toBeUndefined();
    // On an empty tile a right click still puts the tool away.
    c.frame(2);
    expect(c.build.tool.kind).toBe('none');
  });

  it('holds the platform it moved while the pointer rests, and lets go when it leaves or the view moves', () => {
    const c = controller();
    c.build.setTool({ kind: 'building', defId: 'bridge_stone' });
    c.frame(0);
    c.frame(0);
    // The deck rose from under the pointer: the tile behind is under it now.
    c.point(29, ROW - 1, 30 * 40, ROW * 40);
    expect(c.build.deckHeld()).toEqual({ x: 30, y: ROW });
    c.frame(0);
    expect(c.at(30)!.deck).toBe(2);
    expect(c.builder.bridgeAt(29, ROW - 1)).toBeUndefined();
    // The pointer leaves by more than half a tile: the tile under it counts again.
    c.point(29, ROW - 1, 30 * 40 + 40, ROW * 40);
    expect(c.build.deckHeld()).toBeNull();
    c.frame(0);
    expect(c.builder.bridgeAt(29, ROW - 1)).toBeDefined();
    expect(c.at(30)!.deck).toBe(2);
    // A pan or zoom lets go as well.
    c.point(30, ROW);
    c.frame(0);
    expect(c.build.deckHeld()).toEqual({ x: 30, y: ROW });
    c.camera.pan(12, 0);
    expect(c.build.deckHeld()).toBeNull();
  });

  it('refuses with the rule, and never removes instead', () => {
    const c = controller();
    for (const x of [29, 30, 31]) c.builder.placeBuilding(x, ROW, 'bridge_stone');
    for (let x = 27; x <= 33; x++) c.builder.placeTrackKind(x, ROW, 'straight', 1);
    c.build.setTool({ kind: 'building', defId: 'bridge_stone' });
    c.frame(0);
    expect([29, 30, 31].map((x) => c.at(x)!.deck)).toEqual([0, 1, 0]);
    expect(c.frame(0)).toBe(STR.build.deckRefused(true, STR.build.deck.steep));
    expect(c.at(30)!.deck).toBe(1);
    // Lowering an end span out of its neighbour's reach is refused too: rail and platform stay.
    c.builder.changeDeck(c.at(29)!, 1);
    c.builder.changeDeck(c.at(31)!, 1);
    c.builder.changeDeck(c.at(30)!, 1);
    expect([29, 30, 31].map((x) => c.at(x)!.deck)).toEqual([1, 2, 1]);
    c.point(29, ROW);
    expect(c.frame(2)).toBe(STR.build.deckRefused(false, STR.build.deck.steep));
    expect(c.frame(2)).toBe(STR.build.deckRefused(false, STR.build.deck.steep));
    expect(c.at(29)!.deck).toBe(1);
    expect(c.track.has(29, ROW)).toBe(true);
  });

  it('leaves every other tool as it was', () => {
    const c = controller();
    c.builder.placeBuilding(30, ROW, 'bridge_stone');
    c.builder.changeDeck(c.at(30)!, 1);
    // No tool: a left click selects the platform, a right click removes it.
    c.build.setTool({ kind: 'none' });
    c.frame(0);
    expect(c.build.selectedBuilding).toBe(c.at(30));
    expect(c.at(30)!.deck).toBe(1);
    c.frame(2);
    expect(c.at(30)).toBeUndefined();
    // A works building tool on a platform: occupied, nothing raised.
    c.builder.placeBuilding(30, ROW, 'bridge_stone');
    c.build.setTool({ kind: 'building', defId: 'windmill' });
    expect(c.frame(0)).toBe(STR.build.occupied);
    expect(c.at(30)!.deck).toBeUndefined();
    // The Remove tool removes with a left click.
    c.build.setTool({ kind: 'remove' });
    c.frame(0);
    expect(c.at(30)).toBeUndefined();
  });
});
