import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMap } from '../world/mapgen';
import { RegionState } from '../world/regions';
import { Terrain } from '../world/tiles';
import { TrackGraph } from '../world/track';
import { Builder } from './build';
import { MAX_DECK_HEIGHT, RAISE_SHARE, connectedPlatforms, spanLevel } from './bridges';
import { buildingDef, buildingFromJSON, buildingToJSON, type Building } from './buildings';
import { Economy } from './economy';
import { DEFAULT_RULES, rules } from './rules';
import { SAVE_VERSION } from './save';
import { STR } from '../strings';
import { storeWith } from '../testing/storeFixtures';

vi.mock('../engine/audio', () => ({ sfx: vi.fn() }));

const SIDE = 24;
const ROW = 10;
function world(terrain = Terrain.Grass) {
  const map = emptyMap(5, SIDE, SIDE, terrain);
  const track = new TrackGraph(SIDE, SIDE);
  const builder = new Builder(
    map,
    new RegionState(map),
    track,
    new Economy(),
    storeWith({}).stores,
  );
  builder.free = true;
  return { map, track, builder };
}
function platform(builder: Builder, x: number, y = ROW, id = 'bridge_wood'): Building {
  const b: Building = { id, x, y, acc: 0, active: false, rate: 0, rot: 0 };
  builder.buildings.set(y * SIDE + x, b);
  return b;
}
const deckOf = (builder: Builder, x: number, y = ROW) => builder.bridgeAt(x, y)?.deck;

beforeEach(() => Object.assign(rules, DEFAULT_RULES));

describe('raising a span', () => {
  it('lifts the whole connected bridge one height a click, in any direction it joins', () => {
    const { builder } = world();
    for (const x of [8, 9, 10]) platform(builder, x);
    platform(builder, 10, ROW + 1);
    platform(builder, 14);
    expect(builder.raiseSpan(9, ROW)).toBe(true);
    expect(builder.raiseSpan(8, ROW)).toBe(true);
    for (const [x, y] of [
      [8, ROW],
      [9, ROW],
      [10, ROW],
      [10, ROW + 1],
    ])
      expect(deckOf(builder, x, y), `${x},${y}`).toBe(2);
    expect(deckOf(builder, 14), 'a separate bridge').toBeUndefined();
  });

  it('is refused at the greatest height, with a reason, and leaves the bridge there', () => {
    const { builder } = world();
    platform(builder, 9);
    for (let i = 1; i <= MAX_DECK_HEIGHT; i++) expect(builder.raiseSpan(9, ROW)).toBe(true);
    expect(builder.checkRaise(9, ROW)).toMatchObject({
      ok: false,
      reason: STR.build.raise.highest,
    });
    expect(builder.raiseSpan(9, ROW)).toBe(false);
    expect(deckOf(builder, 9)).toBe(MAX_DECK_HEIGHT);
  });

  it('counts from the level the span stands at: the rail it meets, the water under it', () => {
    const { builder, map, track } = world();
    const hill = 2;
    for (let x = 3; x <= 7; x++) map.terrain[ROW * SIDE + x] = Terrain.Hill;
    platform(builder, 8);
    track.place(8, ROW, 'straight', 1, 'branch');
    track.place(7, ROW, 'straight', 1, 'branch');
    const b = builder.bridgeAt(8, ROW)!;
    expect(spanLevel(builder, connectedPlatforms(builder, b))).toBeGreaterThanOrEqual(1);
    expect(spanLevel(builder, [b])).toBeLessThanOrEqual(hill);

    const raised = world(Terrain.Water);
    raised.map.waterSurface = new Uint8Array(SIDE * SIDE).fill(2);
    platform(raised.builder, 9);
    expect(raised.builder.raiseSpan(9, ROW)).toBe(true);
    expect(deckOf(raised.builder, 9)).toBe(3);
  });

  it('leaves the capacity level alone', () => {
    const { builder } = world();
    const b = platform(builder, 9);
    b.level = 3;
    builder.raiseSpan(9, ROW);
    expect(b.level).toBe(3);
    expect(b.deck).toBe(1);
  });

  it('charges half a platform per platform, and refuses what the stock cannot pay', () => {
    const { builder } = world();
    builder.free = false;
    for (const x of [8, 9]) platform(builder, x);
    const wood = buildingDef('bridge_wood').cost.wood;
    expect(builder.checkRaise(9, ROW).cost.wood).toBeCloseTo(
      2 * wood * RAISE_SHARE * rules.buildCostMul,
    );
    expect(builder.raiseSpan(9, ROW)).toBe(false);
    expect(deckOf(builder, 9)).toBeUndefined();
  });

  it('refuses a ramp that would climb under a curve, and a piece laid on a ramp', () => {
    const { builder, track } = world();
    platform(builder, 9);
    for (let x = 8; x <= 12; x++) track.place(x, ROW, 'straight', 1, 'narrow');
    track.place(7, ROW, 'curve', 0, 'narrow');
    // the curve may stand where the ramp has reached the ground
    expect(builder.raiseSpan(9, ROW)).toBe(true);
    expect(builder.raiseSpan(9, ROW)).toBe(true);
    const c = builder.checkRaise(9, ROW);
    expect(track.get(7, ROW)!.links.flat()).toContain(1);
    expect(c).toMatchObject({ ok: false, reason: STR.build.raise.ramp });
  });

  it('refuses a level piece where a ramp climbs', () => {
    const { builder, track } = world();
    rules.narrowUnlocked = 1;
    platform(builder, 9).deck = 3;
    for (let x = 6; x <= 9; x++) track.place(x, ROW, 'straight', 1, 'narrow');
    expect(builder.checkTrack(7, ROW, { kind: 'crossing', cls: 'narrow' }, 0)).toMatchObject({
      ok: false,
      reason: STR.build.onRamp,
    });
  });

  it('refuses a span with a road on it, or a train on it', () => {
    const { builder } = world();
    platform(builder, 9);
    builder.busy = (x) => x === 9;
    expect(builder.checkRaise(9, ROW).reason).toBe(STR.build.raise.train);
    builder.busy = null;
    builder.roads.add(9, ROW);
    expect(builder.checkRaise(9, ROW).reason).toBe(STR.build.raise.road);
  });

  it('carries a raised bridge on at its height when a platform joins it', () => {
    const { builder } = world();
    platform(builder, 9).deck = 3;
    builder.placeBuilding(10, ROW, 'bridge_wood');
    expect(deckOf(builder, 10)).toBe(3);
    builder.placeBuilding(14, ROW, 'bridge_wood');
    expect(deckOf(builder, 14)).toBeUndefined();
  });
});

describe('the stored deck in a save', () => {
  it('keeps a raised deck, and an automatic one stays automatic', () => {
    const { builder } = world();
    const b = platform(builder, 9);
    expect(buildingToJSON(b)[7]).toBeNull();
    expect(buildingFromJSON(buildingToJSON(b)).deck).toBeUndefined();
    b.deck = 2;
    expect(buildingFromJSON(buildingToJSON(b)).deck).toBe(2);
  });

  it('is a version the migration chain reaches', () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(25);
  });
});
