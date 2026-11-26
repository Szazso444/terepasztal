import { Container } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Biome, Terrain, type GameMap } from '../world/tiles';
import { Puddles, nextWetness, puddleAt, ringAt, ringCount } from './puddles';
import { rainVelocity, streakRotation } from './fx';

const SIZE = 64;

beforeEach(() => {
  const context = new Proxy(
    { createLinearGradient: () => ({ addColorStop: () => undefined }) },
    {
      get: (t, k) => (t as Record<string | symbol, unknown>)[k] ?? (() => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function field(biome = Biome.Plains, terrain = Terrain.Grass): GameMap {
  const n = SIZE * SIZE;
  return {
    w: SIZE,
    h: SIZE,
    originX: 0,
    originY: 0,
    terrain: new Uint8Array(n).fill(terrain),
    biome: new Uint8Array(n).fill(biome),
    level: new Int8Array(n),
    props: new Map(),
  } as unknown as GameMap;
}

function sites(map: GameMap) {
  const out = [];
  for (let y = 1; y < SIZE - 1; y++)
    for (let x = 1; x < SIZE - 1; x++) {
      const p = puddleAt(map, x, y);
      if (p) out.push(p);
    }
  return out;
}

describe('where a puddle lies', () => {
  it('is on some of the grass, in the same place every rain', () => {
    const map = field();
    const found = sites(map);
    expect(found.length).toBeGreaterThan(SIZE * SIZE * 0.05);
    expect(found.length).toBeLessThan(SIZE * SIZE * 0.3);
    expect(sites(map)).toEqual(found);
  });

  it('lies in groups: some hollows hold several, most of the land holds none', () => {
    const counts = new Map<string, number>();
    for (const p of sites(field())) {
      const k = `${Math.floor(p.x / 5)},${Math.floor(p.y / 5)}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeGreaterThan(3);
    expect(counts.size).toBeLessThan(((SIZE - 2) / 5) ** 2 * 0.7);
  });

  it('is not on sand, rock, water, in a desert or a swamp', () => {
    expect(sites(field(Biome.Plains, Terrain.Sand))).toEqual([]);
    expect(sites(field(Biome.Plains, Terrain.Rock))).toEqual([]);
    expect(sites(field(Biome.Ocean, Terrain.Water))).toEqual([]);
    expect(sites(field(Biome.Desert))).toEqual([]);
    expect(sites(field(Biome.Swamp))).toEqual([]);
  });

  it('is not on a tile with a tree on it, or on a slope', () => {
    const map = field();
    const [p] = sites(map);
    (map.props as Map<number, unknown>).set(p.y * SIZE + p.x, []);
    expect(puddleAt(map, p.x, p.y)).toBeNull();
    const sloped = field();
    const [q] = sites(sloped);
    (sloped as unknown as { terrain: Uint8Array }).terrain[q.y * SIZE + q.x + 1] = Terrain.Mountain;
    expect(puddleAt(sloped, q.x, q.y)).toBeNull();
  });
});

describe('the wet ground', () => {
  it('wets in the rain, more in harder rain, and dries slowly after it', () => {
    let wet = 0;
    for (let i = 0; i < 300; i++) wet = nextWetness(wet, 0.8, 1);
    expect(wet).toBeGreaterThan(0.9);
    let light = 0;
    for (let i = 0; i < 300; i++) light = nextWetness(light, 0.3, 1);
    expect(light).toBeLessThan(wet);
    const soaked = wet;
    wet = nextWetness(wet, 0, 30);
    expect(wet).toBeLessThan(soaked);
    expect(wet).toBeGreaterThan(soaked * 0.6);
    for (let i = 0; i < 1000; i++) wet = nextWetness(wet, 0, 1);
    expect(wet).toBe(0);
  });

  it('stays dry in a drizzle too thin to wet it', () => {
    expect(nextWetness(0, 0.05, 100)).toBe(0);
  });
});

describe('the puddles on the map', () => {
  const VIEW = { x: -400, y: 0, w: 800, h: 600 };

  const setup = (free = (_x: number, _y: number) => true) => {
    const layer = new Container();
    const puddles = new Puddles(field(), layer, () => ({ x: 0, y: 0 }), free);
    return { layer, puddles };
  };

  it('draws nothing on dry ground', () => {
    const { layer, puddles } = setup();
    puddles.update(1, 0, VIEW);
    expect(layer.children).toHaveLength(0);
  });

  it('gather in the rain, in view only, and are gone when the ground is dry', () => {
    const { layer, puddles } = setup();
    for (let i = 0; i < 30; i++) puddles.update(1, 0.9, VIEW);
    expect(layer.children.length).toBeGreaterThan(0);
    expect(layer.children.length).toBeLessThan(((SIZE / 8) * SIZE) / 8 + 1);
    for (let i = 0; i < 800; i++) puddles.update(1, 0, VIEW);
    expect(layer.children.filter((c) => c.visible)).toHaveLength(0);
  });

  it('leave a tile something stands on, and find a cell anew when it changes', () => {
    const busy = new Set<number>();
    const { layer, puddles } = setup((x, y) => !busy.has(y * SIZE + x));
    for (let i = 0; i < 30; i++) puddles.update(1, 0.9, VIEW);
    const count = () =>
      layer.children.slice(1).reduce((sum, c) => sum + (c as Container).children.length, 0);
    const before = count();
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) busy.add(y * SIZE + x);
    for (let y = 0; y < SIZE; y += 8) for (let x = 0; x < SIZE; x += 8) puddles.invalidate(x, y);
    puddles.update(1, 0.9, VIEW);
    expect(before).toBeGreaterThan(0);
    expect(count()).toBe(0);
  });
});

describe('rings on the water', () => {
  it('scale with the view, within bounds', () => {
    expect(ringCount(1000)).toBe(40);
    expect(ringCount(1400 * 1000)).toBeGreaterThan(40);
    expect(ringCount(1e9)).toBe(300);
  });

  it('stay in the view, fade out as they grow, and move on each time round', () => {
    const places = new Set<string>();
    for (let t = 0; t < 30; t += 0.21) {
      const r = ringAt(5, t);
      expect(r.u).toBeGreaterThanOrEqual(0);
      expect(r.u).toBeLessThan(1);
      expect(r.age).toBeLessThan(1);
      expect(r.alpha).toBeLessThanOrEqual(1);
      places.add(`${r.u},${r.v}`);
    }
    expect(places.size).toBeGreaterThan(5);
  });

  it('are none on a map without water, and none when the rain stops', () => {
    const layer = new Container();
    const puddles = new Puddles(
      field(),
      layer,
      () => ({ x: 0, y: 0 }),
      () => false,
    );
    puddles.update(0.1, 0.9, { x: -400, y: 0, w: 800, h: 600 });
    const rings = (on: Container) =>
      (on.children[0] as Container).children.filter((c) => c.visible).length;
    expect(rings(layer)).toBe(0);
    const sea = new Container();
    const onSea = new Puddles(
      field(Biome.Ocean, Terrain.Water),
      sea,
      () => ({ x: 0, y: 0 }),
      () => false,
    );
    onSea.update(0.1, 0.9, { x: -400, y: 0, w: 800, h: 600 });
    expect(rings(sea)).toBeGreaterThan(0);
    onSea.update(0.1, 0, { x: -400, y: 0, w: 800, h: 600 });
    expect(sea.children[0].visible).toBe(false);
  });
});

describe('the rain in the wind', () => {
  it('falls straight down in a calm, slants with the wind and falls harder as it blows', () => {
    expect(rainVelocity(0, 1).vx).toBe(0);
    expect(rainVelocity(0.7, 1).vx).toBeGreaterThan(0);
    expect(rainVelocity(0.7, -1).vx).toBeLessThan(0);
    expect(rainVelocity(1, 1).vy).toBeGreaterThan(rainVelocity(0.2, 1).vy);
  });

  it('turns the streak from its drawn slant to the way the drop falls', () => {
    // a drop falling along the drawn slant needs no turn
    expect(streakRotation(-1, 3)).toBeCloseTo(0, 9);
    // a drop falling straight down: the top of the streak swings back over it
    expect(streakRotation(0, 1)).toBeCloseTo(Math.atan2(-3, 9), 9);
    expect(streakRotation(1, 1)).toBeLessThan(streakRotation(0, 1));
  });
});
