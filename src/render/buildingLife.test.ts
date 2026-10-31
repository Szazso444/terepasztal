import { Container, Sprite, Texture } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { millOf, potsOf } from '../art/buildingLife';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import type { WindState } from '../sim/wind';
import { BuildingLife, SAILS_FRAME } from './buildingLife';
import type { SurfaceAssets } from './surfaceAssets';

beforeEach(fakeDocument);
afterEach(() => vi.unstubAllGlobals());

const FRAME = {
  texture: Texture.EMPTY,
  anchorX: 0.5,
  anchorY: 0.5,
  w: 70,
  h: 70,
} as unknown as FrameInfo;

/** A canvas that draws nothing, for the puffs' picture. */
function fakeDocument() {
  const context = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
}

function setup() {
  const layer = new Container();
  const atlas = {
    has: (k: string) => k === SAILS_FRAME,
    get: () => FRAME,
  } as unknown as AtlasRegistry;
  const load = { texture: Texture.EMPTY, anchorX: 0.5, anchorY: 0 };
  const surfaces = {
    crane: () => ({ picture: Texture.WHITE, load }),
  } as unknown as SurfaceAssets;
  return { layer, life: new BuildingLife(atlas, layer, surfaces) };
}

function building(x = 1000, y = 500) {
  const s = new Sprite(Texture.EMPTY);
  s.position.set(x, y);
  s.zIndex = 4120;
  return s;
}

const wind = (strength: number): WindState => ({
  level: 'windy',
  strength,
  gust: strength,
  fromRad: 4.7,
  dir: { x: 1, y: 0 },
  tile: { x: 0.7, y: 0.7 },
});
const VIEW = { x: 800, y: 300, w: 400, h: 300 };
const FAR = { x: -9000, y: -9000, w: 100, h: 100 };

/** The sails' sprite on a layer: the only sprite with the sails' transform. */
const parts = (layer: Container) => layer.children as Sprite[];

describe('the sails of a windmill', () => {
  const FRAME_KEY = 'structures/windmill_lv2';

  it('turn about the hub, which stays where it is, over the body and in its depth', () => {
    const { layer, life } = setup();
    const body = building();
    life.place('m', body, FRAME_KEY, 1);
    const [sails] = parts(layer);
    const hub = millOf(FRAME_KEY)!.hub;
    expect(sails.zIndex).toBeGreaterThan(body.zIndex);
    expect(sails.zIndex).toBeLessThan(body.zIndex + 1);
    const angles = new Set<number>();
    for (let i = 0; i < 40; i++) {
      life.update(1 / 4, wind(0.7), VIEW);
      expect(sails.x).toBeCloseTo(body.x + hub[0], 6);
      expect(sails.y).toBeCloseTo(body.y + hub[1], 6);
      angles.add(Math.round((sails.rotation + sails.skew.y) * 100));
    }
    expect(angles.size).toBeGreaterThan(10);
  });

  it('stand in a calm, and with Building life off stand wherever they are at once', () => {
    const { layer, life } = setup();
    life.place('m', building(), FRAME_KEY, 1);
    const [sails] = parts(layer);
    const pose = () => [sails.rotation, sails.skew.x, sails.skew.y, sails.scale.x];
    life.update(1, wind(0), VIEW);
    const calm = pose();
    life.update(1, wind(0), VIEW);
    expect(pose()).toEqual(calm);
    for (let i = 0; i < 20; i++) life.update(0.25, wind(1), VIEW);
    life.enabled = false;
    life.update(0.25, wind(1), VIEW);
    const held = pose();
    life.update(3, wind(1), VIEW);
    expect(pose()).toEqual(held);
  });

  it('go with their building', () => {
    const { layer, life } = setup();
    life.place('m', building(), FRAME_KEY, 1);
    life.place('m', building(), FRAME_KEY, 1);
    expect(parts(layer)).toHaveLength(1);
    life.remove('m');
    expect(parts(layer)).toHaveLength(0);
    life.remove('m');
  });
});

describe('the load of a crane', () => {
  const FRAME_KEY = 'structures/quarry_2';

  it('takes the picture without it, hangs still in a calm or with Building life off', () => {
    const { layer, life } = setup();
    const body = building();
    life.place('q', body, FRAME_KEY, 1);
    expect(body.texture).toBe(Texture.WHITE);
    const [load] = parts(layer);
    life.update(1, wind(0), VIEW);
    expect(load.rotation).toBe(0);
    life.update(1, wind(0.8), VIEW);
    expect(load.rotation).not.toBe(0);
    life.enabled = false;
    life.update(1, wind(0.8), VIEW);
    expect(load.rotation).toBe(0);
  });
});

describe('the smoke of a chimney', () => {
  const FRAME_KEY = 'structures/lumber_2';

  it('is made only when its pot comes into view, and rises from the pot', () => {
    const { layer, life } = setup();
    const body = building();
    life.place('l', body, FRAME_KEY, 1);
    life.update(1 / 60, wind(0.3), FAR);
    expect(parts(layer)).toHaveLength(0);
    life.update(1 / 60, wind(0.3), VIEW);
    expect(parts(layer)).toHaveLength(1);
    const pot = potsOf(FRAME_KEY)![0];
    const puffs = parts(layer)[0].children as Sprite[];
    expect(puffs).toHaveLength(17);
    const pin = puffs[16];
    expect(pin.x).toBeCloseTo(body.x + pot.dx, 6);
    expect(pin.y).toBeCloseTo(body.y + pot.dy, 6);
    for (const p of puffs.filter((p) => p.visible)) expect(p.y).toBeLessThanOrEqual(pin.y + 8);
  });

  it('draws the oldest puff first, so the youngest lies on top', () => {
    const { layer, life } = setup();
    life.place('l', building(), FRAME_KEY, 1);
    for (let i = 0; i < 37; i++) life.update(1 / 7, wind(0), VIEW);
    const heights = (parts(layer)[0].children as Sprite[])
      .slice(0, 16)
      .filter((p) => p.visible)
      .map((p) => p.y);
    // climbing with a small jitter: higher (smaller y) comes first, with no large step back
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThan(heights[i - 1] - 3);
    expect(heights.at(-1)! - heights[0]).toBeGreaterThan(15);
  });

  it('goes at once with Building life off, and from a pot out of view', () => {
    const { layer, life } = setup();
    life.place('l', building(), FRAME_KEY, 1);
    life.update(1 / 60, wind(0.3), VIEW);
    const [plume] = parts(layer);
    expect(plume.visible).toBe(true);
    life.update(1 / 60, wind(0.3), FAR);
    expect(plume.visible).toBe(false);
    life.update(1 / 60, wind(0.3), VIEW);
    expect(plume.visible).toBe(true);
    life.enabled = false;
    life.update(1 / 60, wind(0.3), VIEW);
    expect(plume.visible).toBe(false);
  });

  it('lights about a third of the house chimneys, the same ones every time', () => {
    const { life } = setup();
    let lit = 0;
    const N = 300;
    const sites = (life as unknown as { sites: Map<string, { plumes: unknown[] }> }).sites;
    for (let i = 0; i < N; i++) {
      life.place(`h${i}`, building(40 * i, 17 * i), 'structures/townhouse', 1);
      lit += sites.get(`h${i}`)?.plumes.length ?? 0;
    }
    expect(lit).toBeGreaterThan(N * 0.22);
    expect(lit).toBeLessThan(N * 0.45);
    const again = sites.get('h7')?.plumes.length;
    life.place('h7', building(40 * 7, 17 * 7), 'structures/townhouse', 1);
    expect(sites.get('h7')?.plumes.length).toBe(again);
  });
});

it('gives nothing to a frame with nothing that moves', () => {
  const { layer, life } = setup();
  life.place('s', building(), 'structures/substation', 1);
  life.update(1, wind(1), VIEW);
  expect(parts(layer)).toHaveLength(0);
});
